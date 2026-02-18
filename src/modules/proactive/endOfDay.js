'use strict';

const logger              = require('../../utils/logger');
const { distanceMeters }  = require('../../utils/geo');
const { generateBudgetSummary, getBudgetStatus } = require('./budgetTracker');

/**
 * RouteWise End of Day Recap (PRD Section 11.2)
 *
 * Triggered when GPS detects the family has arrived at tonight's hotel after 5 PM.
 * Sends a Telegram-formatted day summary covering:
 *   - Total driving time
 *   - Activities completed vs. planned (with skipped items flagged)
 *   - Budget spent today by category (Gas, Food, Hotels, Activities, Misc)
 *   - Running trip total vs. budget
 *   - Tomorrow's preview: first stop, drive time, suggested departure
 *   - Open items for tomorrow that still need resolving
 */

// GPS proximity threshold for hotel arrival detection
const HOTEL_ARRIVAL_RADIUS_M = 500;  // meters

// Earliest hour to consider hotel arrival (5 PM = 17)
const HOTEL_ARRIVAL_EARLIEST_HOUR = 17;

/**
 * Detect whether the family has arrived at tonight's booked hotel.
 * Requires GPS within 500m AND the hour to be past 5 PM.
 *
 * @param {number} currentLat
 * @param {number} currentLon
 * @param {number} bookedHotelLat
 * @param {number} bookedHotelLon
 * @param {number} currentHour    - 0–23 (local time)
 * @returns {boolean}
 */
function detectHotelArrival(
  currentLat, currentLon,
  bookedHotelLat, bookedHotelLon,
  currentHour
) {
  if (currentLat == null || currentLon == null) return false;
  if (bookedHotelLat == null || bookedHotelLon == null) return false;
  if (currentHour < HOTEL_ARRIVAL_EARLIEST_HOUR) return false; // Before 5 PM → ignore

  const dist    = distanceMeters(currentLat, currentLon, bookedHotelLat, bookedHotelLon);
  const arrived = dist <= HOTEL_ARRIVAL_RADIUS_M;

  logger.debug(
    `Hotel arrival check: ${dist.toFixed(0)}m from hotel, hour=${currentHour} → ${arrived ? 'ARRIVED' : 'not yet'}`
  );

  return arrived;
}

/**
 * Format duration minutes as a human-readable string.
 * @param {number} minutes
 * @returns {string}
 */
function fmtDuration(minutes) {
  if (!minutes || minutes <= 0) return '0 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

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
 * Get today's activities from the itinerary by date string.
 * Falls back to the first day that has any activities.
 *
 * @param {object[]} itinerary
 * @param {string}   date      - YYYY-MM-DD
 * @returns {object[]}
 */
function getTodaysActivities(itinerary, date) {
  if (!itinerary || itinerary.length === 0) return [];

  const dayByDate = itinerary.find(d => d.date === date);
  if (dayByDate) return dayByDate.activities || [];

  // Fallback: first day with activities
  for (const day of itinerary) {
    if ((day.activities || []).length > 0) return day.activities;
  }
  return [];
}

/**
 * Get tomorrow's first pending (non-completed) activity.
 *
 * @param {object[]} itinerary
 * @param {string}   todayDate - YYYY-MM-DD
 * @returns {object|null}
 */
function getTomorrowFirstActivity(itinerary, todayDate) {
  if (!itinerary || itinerary.length === 0) return null;

  const todayIdx   = itinerary.findIndex(d => d.date === todayDate);
  const tomorrowDay = todayIdx >= 0
    ? itinerary[todayIdx + 1]
    : itinerary[1]; // Fallback: second day

  if (!tomorrowDay) return null;

  return (tomorrowDay.activities || []).find(a => a.state !== 'completed') || null;
}

/**
 * Calculate total planned driving minutes across a day's activities.
 * Uses the `driveMinutes` field stored on each activity.
 *
 * @param {object[]} activities
 * @returns {number}
 */
function calcTotalDriveMinutes(activities) {
  return (activities || []).reduce((sum, act) => sum + (Number(act.driveMinutes) || 0), 0);
}

/**
 * Generate the end-of-day recap message.
 *
 * @param {object}      tripState              - Full trip state
 * @param {string}      date                   - YYYY-MM-DD (today)
 * @param {number|null} [tomorrowDriveMinutes] - Drive time (min) to tomorrow's first stop
 * @returns {string} Formatted Telegram message
 */
function generateRecap(tripState, date, tomorrowDriveMinutes = null) {
  logger.info(`Generating end-of-day recap for ${date}`);

  const itinerary  = tripState?.itinerary || [];
  const activities = getTodaysActivities(itinerary, date);

  // ── Driving summary ────────────────────────────────────────────────────────
  const totalDriveMin = calcTotalDriveMinutes(activities);

  // ── Activity completion stats ──────────────────────────────────────────────
  // "Planned" = any non-Open activity (open slots are fill-ins, not plan items)
  const planned   = activities.filter(a => (a.category || a.type || '').toLowerCase() !== 'open');
  const completed = activities.filter(a => a.state === 'completed');
  const skipped   = planned.filter(a => a.state !== 'completed' && a.state !== 'in-progress');

  // ── Tomorrow preview ───────────────────────────────────────────────────────
  const tomorrowAct = getTomorrowFirstActivity(itinerary, date);

  // Tomorrow's open items
  const todayIdx    = itinerary.findIndex(d => d.date === date);
  const tomorrowDay = todayIdx >= 0
    ? itinerary[todayIdx + 1]
    : (itinerary.length >= 2 ? itinerary[1] : null);

  const tomorrowOpen = tomorrowDay
    ? (tomorrowDay.activities || []).filter(a =>
        (a.category || a.type || '').toLowerCase() === 'open'
      )
    : [];

  // ── Build message ──────────────────────────────────────────────────────────
  const lines = [`🌙 Day Wrap-Up — ${date}\n`];

  // Driving
  lines.push(`🚗 Driving today: ${fmtDuration(totalDriveMin)}`);
  lines.push('');

  // Activities completed vs planned
  lines.push(`📅 Activities: ${completed.length} of ${planned.length} completed`);
  completed.forEach(a => lines.push(`  ✅ ${a.name || a.description}`));
  if (skipped.length > 0) {
    skipped.forEach(a => lines.push(`  ⏭ ${a.name || a.description} — skipped`));
  }
  lines.push('');

  // Budget summary
  lines.push(generateBudgetSummary(tripState));
  lines.push('');

  // Tomorrow preview
  lines.push('📅 Tomorrow:');

  if (tomorrowAct) {
    const tomorrowName = tomorrowAct.name || tomorrowAct.description || 'First stop';
    const driveStr     = tomorrowDriveMinutes
      ? `${fmtDuration(tomorrowDriveMinutes)} drive`
      : 'drive time TBD';
    const timeStr = tomorrowAct.scheduledTime ? ` at ${fmtTime(tomorrowAct.scheduledTime)}` : '';

    lines.push(`  First stop: ${tomorrowName}${timeStr}`);
    lines.push(`  🚗 ${driveStr} from hotel`);

    // Suggested departure
    if (tomorrowDriveMinutes && tomorrowAct.scheduledTime) {
      const scheduled = new Date(tomorrowAct.scheduledTime);
      const departure  = new Date(scheduled.getTime() - (tomorrowDriveMinutes + 15) * 60 * 1000);
      if (!isNaN(departure.getTime())) {
        lines.push(`  🚀 Suggested departure: ${fmtTime(departure)}`);
      }
    }
  } else {
    lines.push('  No activities scheduled yet for tomorrow.');
  }

  // Tomorrow's open items
  if (tomorrowOpen.length > 0) {
    lines.push('');
    lines.push('  ⚠️ Open items for tomorrow:');
    tomorrowOpen.forEach(slot => lines.push(`    • ${slot.name || slot.description}`));
  }

  lines.push('');
  lines.push('Get some rest! 🌙');

  return lines.join('\n');
}

module.exports = {
  generateRecap,
  detectHotelArrival,
  getTodaysActivities,      // Exported for testing
  getTomorrowFirstActivity, // Exported for testing
};
