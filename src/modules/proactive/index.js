'use strict';

const logger        = require('../../utils/logger');
const tripState     = require('../../memory/tripState');
const stateMachine  = require('../tracking/stateMachine');
const eta           = require('../tracking/eta');
const weatherModule = require('../tracking/weather');
const hotels        = require('../intelligence/hotels');
const alerts        = require('./alerts');
const { endOfDayBudgetPrompt } = require('./budgetTracker');
const { detectHotelArrival }   = require('./endOfDay');

/**
 * RouteWise Proactive Alert Orchestrator — Milestone 4
 *
 * Implements the 15-minute heartbeat cycle (PRD Section 7.1):
 *   1. Read GPS (passed in as currentLat/currentLon)
 *   2. Update activity states via stateMachine
 *   3. Calculate ETAs via eta.js
 *   4. Check conditions (weather at upcoming outdoor stops)
 *   5. Decide: all OK → Autopilot (silent). Problem detected → Alert
 *   6. Check 5 PM hotel trigger
 *   7. Check deferred requests
 *
 * Returns: { mode: 'autopilot'|'alert', message: string|null, alerts: object[] }
 *
 * Three modes (PRD Section 6):
 *   Autopilot — silent monitoring, no message
 *   Alert     — proactive message with 2-3 options
 *   On-Demand — handled by intelligence module (M3), not here
 */

// Schedule drift threshold that triggers an alert (PRD Section 6.2)
const DRIFT_ALERT_MINUTES = 40;

// Outdoor activity keyword patterns
const OUTDOOR_KEYWORDS = /beach|hike|trail|dunes|coast|outdoor|park|scenic|overlook|viewpoint|cliff|waterfall/i;

// ── In-memory alert state ─────────────────────────────────────────────────────
// Tracks the timestamp each alert type was last sent (for noRepeatGuard)
const alertLastSent = {};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main heartbeat function — run every 15 minutes.
 *
 * Accepts a pre-loaded tripState to allow easy mocking in tests.
 * If tripStateObj is null, loads from disk.
 *
 * @param {object|null}  tripStateObj  - Trip state object (null → load from disk)
 * @param {number}       currentLat
 * @param {number}       currentLon
 * @param {string|Date}  timestamp
 * @returns {Promise<{
 *   mode:    'autopilot' | 'alert',
 *   message: string | null,
 *   alerts:  object[]
 * }>}
 */
async function runHeartbeat(tripStateObj, currentLat, currentLon, timestamp) {
  const ts = timestamp instanceof Date
    ? timestamp.toISOString()
    : (timestamp || new Date().toISOString());

  logger.info(`Heartbeat: (${currentLat}, ${currentLon}) @ ${ts}`);

  const collectedAlerts = [];

  // ── Step 1: GPS received (passed in) ──────────────────────────────────────

  // ── Step 2: Update activity states ────────────────────────────────────────
  let state = tripStateObj || tripState.load();

  const { itinerary: updatedItinerary, events } = stateMachine.updateActivityStates(
    currentLat, currentLon, ts, state.itinerary || []
  );

  state = { ...state, itinerary: updatedItinerary };
  logger.debug(`State machine events: ${events.length}`);

  // ── Step 3: Calculate ETAs ─────────────────────────────────────────────────
  let etas = [];
  try {
    etas = await eta.calculateETAsForItinerary(currentLat, currentLon, updatedItinerary);
    logger.debug(`ETAs calculated: ${etas.length} activities`);
  } catch (err) {
    logger.warn(`ETA calculation failed in heartbeat: ${err.message}`);
  }

  // ── Step 4: Check weather conditions ──────────────────────────────────────
  let weatherForUpcoming = null;
  try {
    const upcomingOutdoor = findUpcomingOutdoorActivity(updatedItinerary);
    if (upcomingOutdoor?.lat && upcomingOutdoor?.lon) {
      weatherForUpcoming = await weatherModule.getWeather(upcomingOutdoor.lat, upcomingOutdoor.lon);
      weatherForUpcoming._activity = upcomingOutdoor;
    }
  } catch (err) {
    logger.warn(`Weather check failed in heartbeat: ${err.message}`);
  }

  // ── Step 5: Evaluate alert conditions ─────────────────────────────────────
  const conditionAlerts = checkAlertConditions(state, etas, weatherForUpcoming);

  for (const alert of conditionAlerts) {
    // Suppress if same type was sent within the last 30 minutes
    if (alerts.noRepeatGuard(alert.type, alertLastSent[alert.type])) {
      logger.debug(`Alert suppressed (noRepeatGuard): ${alert.type}`);
      continue;
    }
    collectedAlerts.push(alert);
  }

  // ── Step 6: 5 PM hotel trigger ────────────────────────────────────────────
  const currentHour  = new Date(ts).getHours();
  const hotelTrigger = hotels.checkFivePMTrigger(currentHour, state);

  if (hotelTrigger) {
    const hotelAlertType = 'hotel-nudge';
    if (!alerts.noRepeatGuard(hotelAlertType, alertLastSent[hotelAlertType])) {
      const tomorrowAct = getNextDayFirstActivity(updatedItinerary);
      const budget = {
        budgetMin: state?.budget?.targets?.hotels
          ? Math.round(state.budget.targets.hotels * 0.7)
          : null,
        budgetMax: state?.budget?.targets?.hotels
          ? Math.round(state.budget.targets.hotels * 1.2)
          : null,
      };

      collectedAlerts.push({
        type:     hotelAlertType,
        severity: 'high',
        message:  alerts.hotelNudge(currentLat, currentLon, tomorrowAct, budget),
      });
    }
  }

  // ── Step 7: Fired deferred requests ───────────────────────────────────────
  // Deferred request management is owned by the tracking module.
  // Heartbeat surfaces any that have matured (fireAt <= now).
  const deferredRequests = state.deferredRequests || [];
  const firedDeferred = deferredRequests.filter(r => {
    const fireAt = new Date(r.fireAt).getTime();
    return !r.fired && fireAt <= Date.now();
  });

  for (const req of firedDeferred) {
    collectedAlerts.push({
      type:     'deferred',
      severity: 'info',
      message:  `⏰ Reminder: ${req.text}`,
    });
  }

  // ── Determine mode ─────────────────────────────────────────────────────────
  if (collectedAlerts.length === 0) {
    logger.info('Heartbeat: Autopilot — no issues detected');
    return { mode: 'autopilot', message: null, alerts: [] };
  }

  // Pick the highest-severity alert as the primary message
  const primary =
    collectedAlerts.find(a => a.severity === 'high')   ||
    collectedAlerts.find(a => a.severity === 'medium') ||
    collectedAlerts[0];

  // Record sent time for future repeat suppression
  alertLastSent[primary.type] = Date.now();

  logger.info(`Heartbeat: Alert mode — "${primary.type}" (${primary.severity})`);
  return {
    mode:    'alert',
    message: primary.message,
    alerts:  collectedAlerts,
  };
}

/**
 * Evaluate all alert triggers from trip state, ETAs, and weather.
 * Pure function — no side effects.
 *
 * @param {object}   tripStateObj
 * @param {object[]} etas           - From eta.calculateETAsForItinerary()
 * @param {object}   [weather]      - Weather at upcoming activity, or null
 * @returns {Array<{ type: string, severity: 'high'|'medium'|'low'|'info', message: string }>}
 */
function checkAlertConditions(tripStateObj, etas = [], weather = null) {
  const foundAlerts = [];

  // ── Schedule drift alert ───────────────────────────────────────────────────
  const significantDrift = etas.find(e =>
    e.driftMinutes !== null && e.driftMinutes >= DRIFT_ALERT_MINUTES
  );

  if (significantDrift) {
    const act          = findActivityById(tripStateObj, significantDrift.activityId);
    const alternatives = buildDriftAlternatives(significantDrift);

    foundAlerts.push({
      type:     'schedule-drift',
      severity: 'high',
      message:  alerts.scheduleAlert(
        significantDrift.driftMinutes,
        act || { name: significantDrift.activityName },
        alternatives
      ),
    });
  }

  // ── Weather alert at outdoor activity ─────────────────────────────────────
  if (weather && isRainyCondition(weather)) {
    const activity = weather._activity;
    if (activity) {
      foundAlerts.push({
        type:     'weather',
        severity: 'medium',
        message:  alerts.weatherAlert(weather, activity),
      });
    }
  }

  return foundAlerts;
}

/**
 * Stub — actual Telegram send is handled by the OpenClaw layer.
 * Returns the message for logging / testing.
 *
 * @param {string} message
 * @returns {string}
 */
function sendAlert(message) {
  logger.info(`[sendAlert] ${message.slice(0, 100).replace(/\n/g, ' ')}…`);
  return message;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the next non-completed outdoor activity with coordinates.
 * @param {object[]} itinerary
 * @returns {object|null}
 */
function findUpcomingOutdoorActivity(itinerary) {
  for (const day of (itinerary || [])) {
    for (const act of (day.activities || [])) {
      if (act.state === 'completed') continue;
      if (!act.lat || !act.lon)     continue;

      const name = act.name || act.description || '';
      if (OUTDOOR_KEYWORDS.test(name) || act.isOutdoor) return act;
    }
  }
  return null;
}

/**
 * Check if a weather object indicates rainy / adverse conditions.
 * @param {object} weather - { condition, precipChance, chanceOfRain }
 * @returns {boolean}
 */
function isRainyCondition(weather) {
  if (!weather) return false;
  const cond          = (weather.condition || '').toLowerCase();
  const precipChance  = weather.precipChance ?? weather.chanceOfRain ?? 0;
  return /rain|shower|storm|drizzle|thunder/.test(cond) || precipChance >= 60;
}

/**
 * Find an activity by its ID (falls back to matching by description).
 * @param {object} tripStateObj
 * @param {string} activityId
 * @returns {object|null}
 */
function findActivityById(tripStateObj, activityId) {
  for (const day of (tripStateObj?.itinerary || [])) {
    for (const act of (day.activities || [])) {
      if ((act.id || act.description) === activityId) return act;
    }
  }
  return null;
}

/**
 * Build 2–3 triage alternatives for a schedule drift event.
 * @param {object} driftEta - ETA result with { driftMinutes, activityName }
 * @returns {object[]}
 */
function buildDriftAlternatives(driftEta) {
  const actName = driftEta.activityName || 'this stop';
  return [
    {
      name:     `Press on — arrive ${driftEta.driftMinutes} min late`,
      tradeoff: 'keeps the activity, compresses the schedule',
    },
    {
      name:     `Skip ${actName}`,
      tradeoff: 'recovers full schedule, lose the stop',
    },
    {
      name:     'Shorten the next stop to recover time',
      tradeoff: 'partial recovery, keeps both activities',
    },
  ];
}

/**
 * Get the first pending activity from the next day in the itinerary.
 * @param {object[]} itinerary
 * @returns {object|null}
 */
function getNextDayFirstActivity(itinerary) {
  if (!itinerary || itinerary.length < 2) return null;

  const today    = new Date().toISOString().split('T')[0];
  const todayIdx = itinerary.findIndex(d => d.date === today);

  const nextDay = todayIdx >= 0
    ? itinerary[todayIdx + 1]
    : itinerary[1] || null;

  if (!nextDay) return null;
  return (nextDay.activities || []).find(a => a.state !== 'completed') || null;
}

module.exports = {
  runHeartbeat,
  checkAlertConditions,
  sendAlert,
};
