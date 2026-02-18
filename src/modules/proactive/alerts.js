'use strict';

const logger = require('../../utils/logger');

/**
 * RouteWise Proactive Alerts (PRD Section 6.2)
 *
 * Alert generation functions for schedule drift, weather events, hotel nudge,
 * and flight delays. All functions return a Telegram-ready formatted string.
 *
 * noRepeatGuard() prevents naggy duplicate alerts (30-minute suppression window).
 */

/**
 * Generate a schedule drift alert with 2–3 triage options.
 *
 * @param {number}   driftMinutes      - Minutes behind schedule (positive = behind)
 * @param {object}   affectedActivity  - Activity object with { name, description }
 * @param {object[]} alternatives      - Up to 3 options [{ name, tradeoff }]
 * @returns {string} Formatted alert message
 */
function scheduleAlert(driftMinutes, affectedActivity, alternatives = []) {
  const actName  = affectedActivity?.name || affectedActivity?.description || 'the next stop';
  const direction = driftMinutes >= 0 ? 'behind' : 'ahead of';
  const absDrift  = Math.abs(driftMinutes);

  const lines = [
    `⏰ Running ${absDrift} min ${direction} schedule.`,
    `${actName} is affected. A few options:\n`,
  ];

  const opts = alternatives.slice(0, 3);

  if (opts.length === 0) {
    // Default generic options when caller provides none
    lines.push(`1. Press on — arrive ${absDrift} min late.`);
    lines.push(`2. Skip ${actName} and stay on schedule.`);
    lines.push(`3. Shorten the next stop to recover time.`);
  } else {
    opts.forEach((alt, i) => {
      const tradeoff = alt.tradeoff ? ` — ${alt.tradeoff}` : '';
      lines.push(`${i + 1}. ${alt.name}${tradeoff}`);
    });
  }

  lines.push('');
  lines.push('Which works best for the family?');

  logger.info(`Schedule alert: ${absDrift} min drift at "${actName}"`);
  return lines.join('\n');
}

/**
 * Generate a weather alert for an outdoor activity.
 * Rain / adverse conditions → swap suggestion.
 *
 * @param {object} forecast  - { condition, tempF, precipChance, chanceOfRain }
 * @param {object} activity  - Activity with { name, description }
 * @returns {string} Formatted alert message
 */
function weatherAlert(forecast, activity) {
  const actName      = activity?.name || activity?.description || 'your next outdoor activity';
  const condition    = forecast?.condition || 'Rain';
  const precipChance = forecast?.precipChance ?? forecast?.chanceOfRain ?? null;

  const precipStr = precipChance != null ? ` (${precipChance}% chance)` : '';

  const lines = [
    `🌧 ${condition}${precipStr} forecast at ${actName}.\n`,
    '1. Proceed as planned — weather may clear.',
    `2. Swap with an indoor activity and come back to ${actName} later.`,
    '3. Skip it and add extra time at the next stop.',
    '',
    'What would you like to do?',
  ];

  logger.info(`Weather alert: "${condition}" at "${actName}"`);
  return lines.join('\n');
}

/**
 * Generate a 5 PM hotel nudge alert (no hotel booked for tonight).
 *
 * @param {number} currentLat
 * @param {number} currentLon
 * @param {object} tomorrowActivity  - Tomorrow's first activity { name, description }
 * @param {object} [budget={}]       - { budgetMin, budgetMax } per night in USD
 * @returns {string} Formatted nudge message
 */
function hotelNudge(currentLat, currentLon, tomorrowActivity, budget = {}) {
  const tomorrowName = tomorrowActivity?.name
    || tomorrowActivity?.description
    || "tomorrow's first stop";

  const budgetStr = budget.budgetMax
    ? ` (budget: $${budget.budgetMin || 0}–$${budget.budgetMax}/night)`
    : '';

  const lines = [
    `🏨 It's past 5 PM and no hotel is booked for tonight${budgetStr}.`,
    `Tomorrow starts at ${tomorrowName} — positioning matters.\n`,
    '1. Find hotels near your current location.',
    "2. Find hotels closer to tomorrow's first stop (saves drive time tomorrow).",
    '3. Remind me again in 30 minutes.',
    '',
    'Availability can thin fast. Want me to search now?',
  ];

  logger.info(`Hotel nudge: tomorrow activity "${tomorrowName}"`);
  return lines.join('\n');
}

/**
 * Generate a flight delay alert with triage options.
 *
 * @param {object}   flightInfo     - { flightNumber, delayMinutes, newDeparture?, newArrival? }
 * @param {object[]} dayItinerary   - Today's planned activities
 * @returns {string} Formatted alert message
 */
function flightDelayAlert(flightInfo, dayItinerary = []) {
  const flightNum  = flightInfo?.flightNumber || 'Your flight';
  const delayMin   = flightInfo?.delayMinutes  || 0;
  const delayHours = Math.floor(delayMin / 60);
  const delayRem   = delayMin % 60;

  const delayStr = delayHours > 0
    ? `${delayHours} hr${delayRem > 0 ? ` ${delayRem} min` : ''}`
    : `${delayMin} min`;

  // Soft goals that could be cut to accommodate delay
  const softGoals = dayItinerary
    .filter(a => (a.category || a.type || '').toLowerCase() !== 'hard')
    .slice(0, 2);

  const skipSuggestion = softGoals.length > 0
    ? `skip ${softGoals.map(a => a.name || a.description).join(' and ')}`
    : 'skip the first stop';

  const lines = [
    `✈️ ${flightNum} is delayed ${delayStr}.\n`,
    "1. Adjust today's plan — you'll arrive later but can still make dinner.",
    `2. Simplify today: ${skipSuggestion} and head straight to your hotel.`,
    '3. Keep the original plan and see how things shake out.',
    '',
    'How do you want to play it?',
  ];

  logger.info(`Flight delay alert: ${flightNum} delayed ${delayMin} min`);
  return lines.join('\n');
}

/**
 * Prevent repeat alerts of the same type within a 30-minute window.
 * Dona surfaces information once and waits — not naggy (PRD Section 14.1).
 *
 * @param {string}               alertType  - e.g. 'schedule-drift', 'weather', 'hotel-nudge'
 * @param {string|Date|number|null} lastSentAt - Timestamp of last send (any parseable format)
 * @returns {boolean} true → suppress (already sent recently), false → allow sending
 */
function noRepeatGuard(alertType, lastSentAt) {
  if (lastSentAt == null) {
    logger.debug(`noRepeatGuard: no prior "${alertType}" → allow`);
    return false;  // Never sent → allow
  }

  const lastMs = lastSentAt instanceof Date
    ? lastSentAt.getTime()
    : typeof lastSentAt === 'number'
    ? lastSentAt
    : new Date(lastSentAt).getTime();

  if (isNaN(lastMs)) {
    logger.warn(`noRepeatGuard: invalid lastSentAt for "${alertType}" → allow`);
    return false;
  }

  const elapsedMinutes = (Date.now() - lastMs) / 60000;
  const suppress       = elapsedMinutes < 30;

  logger.debug(
    `noRepeatGuard: "${alertType}" last sent ${elapsedMinutes.toFixed(1)} min ago → ${suppress ? 'SUPPRESS' : 'allow'}`
  );
  return suppress;
}

module.exports = {
  scheduleAlert,
  weatherAlert,
  hotelNudge,
  flightDelayAlert,
  noRepeatGuard,
};
