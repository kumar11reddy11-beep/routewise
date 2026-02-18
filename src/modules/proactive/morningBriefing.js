'use strict';

const logger        = require('../../utils/logger');
const { distanceMeters } = require('../../utils/geo');
const patterns      = require('../patterns');

/**
 * RouteWise Morning Briefing (PRD Section 11.1)
 *
 * Auto-generated at 6:00 AM every trip day. Covers:
 *   - Today's planned activities + drive legs with estimated times
 *   - Weather overview for the day's locations
 *   - Wardrobe nudge when temps are extreme (< 55°F or > 85°F)
 *   - Sunset / golden hour for scenic stops
 *   - Hard commitments flagged clearly (🔒)
 *   - Open slots that still need resolving (⚠️)
 *   - Suggested departure time (works backward from first scheduled activity)
 *
 * Late-start follow-up: if GPS shows family still at hotel 30+ min past
 * suggested departure, shouldSendLateStartFollowUp() returns true.
 */

// Wardrobe nudge thresholds (°F)
const WARDROBE_COLD_F = 55;
const WARDROBE_HOT_F  = 85;

// Proximity threshold for "still at hotel" check (meters)
const HOTEL_PROXIMITY_M = 500;

/**
 * Format a Date or ISO string as "h:mm AM/PM".
 * @param {Date|string} d
 * @returns {string}
 */
function fmtTime(d) {
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return 'TBD';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Format drive minutes as a human-readable label.
 * @param {number|null} minutes
 * @returns {string}
 */
function fmtDriveTime(minutes) {
  if (!minutes || minutes <= 0) return 'drive time TBD';
  if (minutes < 60) return `${Math.round(minutes)} min drive`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h} hr ${m} min drive` : `${h} hr drive`;
}

/**
 * Calculate the suggested departure time by working backward from the first
 * activity's scheduled time, subtracting drive time + 15-min buffer.
 *
 * @param {object}     firstActivity  - Activity object with { scheduledTime } (ISO string)
 * @param {number|null} driveMinutes  - Drive time to first activity in minutes
 * @returns {Date|null}
 */
function calcDepartureTime(firstActivity, driveMinutes) {
  if (!firstActivity?.scheduledTime) return null;
  const scheduled = new Date(firstActivity.scheduledTime);
  if (isNaN(scheduled.getTime())) return null;

  const totalBufferMin = (driveMinutes || 30) + 15; // drive + safety buffer
  return new Date(scheduled.getTime() - totalBufferMin * 60 * 1000);
}

/**
 * Extract today's activities from the itinerary by date.
 * Falls back to the first day with pending activities if no date match.
 *
 * @param {object[]} itinerary - Array of day objects
 * @param {string}   date      - YYYY-MM-DD
 * @returns {object[]} Activities for today
 */
function getTodaysActivities(itinerary, date) {
  if (!itinerary || itinerary.length === 0) return [];

  // Match by date first
  const dayByDate = itinerary.find(d => d.date === date);
  if (dayByDate) return dayByDate.activities || [];

  // Fallback: first day with any pending activity
  for (const day of itinerary) {
    const pending = (day.activities || []).filter(a => a.state !== 'completed');
    if (pending.length > 0) return day.activities || [];
  }

  return [];
}

/**
 * Generate the morning briefing message.
 *
 * @param {object}      tripState          - Full trip state object
 * @param {number}      currentLat         - Family's current latitude
 * @param {number}      currentLon         - Family's current longitude
 * @param {string}      date               - YYYY-MM-DD (today)
 * @param {object|null} [weatherData]      - Pre-fetched weather { condition, tempF, precipChance }
 * @param {object|null} [sunsetData]       - Pre-fetched sunset { sunset, goldenHourStart, goldenHourEnd }
 * @param {number|null} [driveMinutesToFirst] - Drive time (min) to first activity
 * @returns {string} Formatted Telegram message
 */
function generateBriefing(
  tripState,
  currentLat,
  currentLon,
  date,
  weatherData         = null,
  sunsetData          = null,
  driveMinutesToFirst = null
) {
  logger.info(`Generating morning briefing for ${date}`);

  const activities = getTodaysActivities(tripState?.itinerary || [], date);
  const lines      = [`🌅 Good morning! Here's your plan for today (${date}):\n`];

  // ── Activities ─────────────────────────────────────────────────────────────
  if (activities.length === 0) {
    lines.push('📅 No activities scheduled for today.');
  } else {
    lines.push("📅 Today's plan:");

    activities.forEach((act, i) => {
      const name    = act.name || act.description || 'Unknown activity';
      const type    = (act.category || act.type || '').toLowerCase();
      const isHard  = type === 'hard';
      const isOpen  = type === 'open';

      const timeStr  = act.scheduledTime ? ` @ ${fmtTime(act.scheduledTime)}` : '';
      const hardFlag = isHard ? ' 🔒 HARD COMMITMENT' : '';
      const openFlag = isOpen ? ' ⚠️ OPEN — needs booking' : '';

      lines.push(`  ${i + 1}. ${name}${timeStr}${hardFlag}${openFlag}`);

      // Drive leg annotation (if pre-computed on the activity)
      if (act.driveMinutes) {
        lines.push(`     🚗 ${fmtDriveTime(act.driveMinutes)}`);
      }
    });

    lines.push('');
  }

  // ── Weather ────────────────────────────────────────────────────────────────
  lines.push('🌤 Weather today:');

  if (weatherData) {
    const { condition, tempF, precipChance } = weatherData;
    const precipStr = precipChance != null ? ` (${precipChance}% precip)` : '';
    lines.push(`  ${condition || 'Unknown conditions'}${tempF != null ? `, ${tempF}°F` : ''}${precipStr}`);

    // Wardrobe nudge
    if (tempF != null && tempF < WARDROBE_COLD_F) {
      lines.push(`  🧥 Pack layers — it'll be chilly out there.`);
    } else if (tempF != null && tempF > WARDROBE_HOT_F) {
      lines.push(`  ☀️ Hot day ahead — stay hydrated and keep it light.`);
    }
  } else {
    lines.push('  Weather data unavailable — check your weather app.');
  }

  lines.push('');

  // ── Sunset / Golden Hour ───────────────────────────────────────────────────
  if (sunsetData) {
    lines.push(`🌇 Sunset: ${sunsetData.sunset}`);
    if (sunsetData.goldenHourStart && sunsetData.goldenHourEnd) {
      lines.push(`📷 Golden hour: ${sunsetData.goldenHourStart} – ${sunsetData.goldenHourEnd}`);
    }

    // Tag first scenic activity if any
    const scenicAct = activities.find(a =>
      /scenic|beach|sunset|viewpoint|overlook|photo|dune|coast|cliff/i.test(a.name || a.description || '')
    );
    if (scenicAct) {
      lines.push(`   ↳ Ideal timing for ${scenicAct.name || scenicAct.description}`);
    }

    lines.push('');
  }

  // ── Hard commitments ───────────────────────────────────────────────────────
  const hardCommitments = activities.filter(a =>
    (a.category || a.type || '').toLowerCase() === 'hard'
  );

  if (hardCommitments.length > 0) {
    lines.push('🔒 Hard commitments today:');
    hardCommitments.forEach(hc => {
      const timeStr = hc.scheduledTime ? ` at ${fmtTime(hc.scheduledTime)}` : '';
      lines.push(`  • ${hc.name || hc.description}${timeStr}`);
    });
    lines.push('');
  }

  // ── Open slots ─────────────────────────────────────────────────────────────
  const openSlots = activities.filter(a =>
    (a.category || a.type || '').toLowerCase() === 'open'
  );

  if (openSlots.length > 0) {
    lines.push('⚠️ Open items that need resolving:');
    openSlots.forEach(slot => {
      lines.push(`  • ${slot.name || slot.description}`);
    });
    lines.push('');
  }

  // ── Suggested departure ────────────────────────────────────────────────────
  const firstScheduled = activities.find(a => a.scheduledTime);
  let departure        = calcDepartureTime(firstScheduled, driveMinutesToFirst);

  // M5: Apply departure pattern adjustment (PRD Section 10)
  // If the family is consistently late, we suggest leaving earlier.
  if (departure && !isNaN(departure.getTime()) && tripState) {
    const adjusted = patterns.applyDepartureAdjustment(departure, tripState);
    if (adjusted.getTime() !== departure.getTime()) {
      const diffMin = Math.round((departure.getTime() - adjusted.getTime()) / 60000);
      logger.info(`Morning briefing: departure adjusted earlier by ${diffMin} min (pattern learning)`);
      departure = adjusted;
    }
  }

  if (departure && !isNaN(departure.getTime())) {
    lines.push(`🚀 Suggested departure: ${fmtTime(departure)}`);
    if (driveMinutesToFirst && firstScheduled) {
      lines.push(
        `   (${fmtDriveTime(driveMinutesToFirst)} to ${firstScheduled.name || firstScheduled.description || 'first stop'} + 15-min buffer)`
      );
    }
  } else {
    lines.push("🚀 Set a departure time once you've confirmed today's first stop.");
  }

  // M5: Food preference — flavour breakfast suggestion
  if (tripState) {
    const foodBias = patterns.getFoodBias(tripState);
    if (foodBias === 'casual') {
      lines.push('\n☕ Based on your preferences: grabbing coffee and a quick bite on the road today?');
    } else if (foodBias === 'upscale') {
      lines.push('\n☕ Based on your preferences: a sit-down breakfast might be a nice start today.');
    }
  }

  return lines.join('\n');
}

/**
 * Check whether a late-start follow-up nudge should be sent.
 *
 * Returns true when GPS shows the family is still at / near the hotel
 * 30+ minutes after the suggested departure time.
 *
 * @param {object}          tripState             - Trip state (unused currently, reserved for future pattern data)
 * @param {number}          currentLat            - Family's current latitude
 * @param {number}          currentLon            - Family's current longitude
 * @param {number}          hotelLat              - Tonight's hotel latitude
 * @param {number}          hotelLon              - Tonight's hotel longitude
 * @param {Date|string}     suggestedDepartureTime
 * @returns {boolean}
 */
function shouldSendLateStartFollowUp(
  tripState,
  currentLat,
  currentLon,
  hotelLat,
  hotelLon,
  suggestedDepartureTime
) {
  if (currentLat == null || currentLon == null) return false;
  if (hotelLat   == null || hotelLon   == null) return false;
  if (!suggestedDepartureTime) return false;

  const departureMs = suggestedDepartureTime instanceof Date
    ? suggestedDepartureTime.getTime()
    : new Date(suggestedDepartureTime).getTime();

  if (isNaN(departureMs)) return false;

  const minutesPastDeparture = (Date.now() - departureMs) / 60000;
  if (minutesPastDeparture < 30) return false;

  // Check whether family is still within 500m of the hotel
  const dist    = distanceMeters(currentLat, currentLon, hotelLat, hotelLon);
  const atHotel = dist <= HOTEL_PROXIMITY_M;

  logger.debug(
    `Late-start check: ${minutesPastDeparture.toFixed(0)} min past departure, ` +
    `${dist.toFixed(0)}m from hotel (${atHotel ? 'AT hotel' : 'AWAY'})`
  );

  return atHotel;
}

module.exports = {
  generateBriefing,
  shouldSendLateStartFollowUp,
  calcDepartureTime,
  getTodaysActivities,
};
