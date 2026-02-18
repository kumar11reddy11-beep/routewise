'use strict';

const flightService = require('../../services/flights');
const maps          = require('../../services/maps');
const logger        = require('../../utils/logger');

/**
 * RouteWise Flight Intelligence (PRD Section 8.7)
 *
 * Handles:
 *   1. getFlightStatus      — fetch and parse AeroDataBox response
 *   2. calculateDelayImpact — re-triage Day 1 itinerary when inbound flight delayed
 *   3. calculateDepartureWindow — work backward from outbound departure to find latest leave time
 */

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a time string (ISO or "HH:MM" local) to a Date object.
 * If a base date is provided, attaches the time to that date.
 *
 * @param {string} timeStr
 * @param {Date}   [baseDate]
 * @returns {Date|null}
 */
function parseTime(timeStr, baseDate = null) {
  if (!timeStr) return null;

  // ISO format with timezone (AeroDataBox local time)
  if (timeStr.includes('T') || timeStr.includes('Z')) {
    const d = new Date(timeStr);
    return isNaN(d) ? null : d;
  }

  // "HH:MM" format — attach to base date
  if (baseDate && /^\d{1,2}:\d{2}$/.test(timeStr.trim())) {
    const [h, m] = timeStr.trim().split(':').map(Number);
    const d = new Date(baseDate);
    d.setHours(h, m, 0, 0);
    return d;
  }

  return null;
}

/**
 * Format a Date as "h:mm AM/PM".
 *
 * @param {Date} d
 * @returns {string}
 */
function formatTime(d) {
  if (!(d instanceof Date) || isNaN(d)) return 'unknown time';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Subtract minutes from a Date and return new Date.
 *
 * @param {Date}   d
 * @param {number} minutes
 * @returns {Date}
 */
function subtractMinutes(d, minutes) {
  return new Date(d.getTime() - minutes * 60000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get real-time flight status and return a structured, formatted result.
 *
 * @param {string} flightNumber - IATA flight number (e.g. "DL1234")
 * @param {string} [date]       - YYYY-MM-DD (defaults to today)
 * @returns {Promise<{
 *   flightNumber: string,
 *   status: string,
 *   departure: { airport: string, scheduled: string, actual: string|null },
 *   arrival:   { airport: string, scheduled: string, actual: string|null },
 *   delayMinutes: number,
 *   isDelayed: boolean,
 *   formatted: string
 * }>}
 */
async function getFlightStatus(flightNumber, date) {
  logger.info(`Flight status: ${flightNumber} on ${date || 'today'}`);

  let flights;
  try {
    flights = await flightService.getFlightStatus(flightNumber, date);
  } catch (err) {
    throw new Error(`Could not retrieve flight status: ${err.message}`);
  }

  const flight = flights[0] || {};

  const status        = flight.status || 'Unknown';
  const depScheduled  = flight.departure?.scheduledTime?.local  || flight.departure?.scheduledTime?.utc  || '';
  const depActual     = flight.departure?.actualTime?.local     || flight.departure?.estimatedTime?.local || '';
  const arrScheduled  = flight.arrival?.scheduledTime?.local    || flight.arrival?.scheduledTime?.utc    || '';
  const arrActual     = flight.arrival?.actualTime?.local       || flight.arrival?.estimatedTime?.local  || '';
  const depAirport    = flight.departure?.airport?.iata         || flight.departure?.airport?.name       || 'DEP';
  const arrAirport    = flight.arrival?.airport?.iata           || flight.arrival?.airport?.name         || 'ARR';

  // Calculate delay in minutes
  let delayMinutes = 0;
  if (depScheduled && depActual) {
    const diffMs = new Date(depActual) - new Date(depScheduled);
    delayMinutes = Math.max(0, Math.round(diffMs / 60000));
  }
  const isDelayed = delayMinutes > 15;

  // Build a concise human-readable formatted string
  const statusEmoji = isDelayed ? '⚠️' : (status === 'Landed' ? '✅' : '✈️');
  const delayNote   = isDelayed ? ` (${delayMinutes} min delay)` : '';
  const formatted   = [
    `${statusEmoji} Flight ${flightNumber}: ${status}${delayNote}`,
    `   Dep: ${depAirport} ${depScheduled}${depActual && depActual !== depScheduled ? ' → ' + depActual : ''}`,
    `   Arr: ${arrAirport} ${arrScheduled}${arrActual && arrActual !== arrScheduled ? ' → ' + arrActual : ''}`,
  ].join('\n');

  return {
    flightNumber,
    status,
    departure: { airport: depAirport, scheduled: depScheduled, actual: depActual || null },
    arrival:   { airport: arrAirport, scheduled: arrScheduled, actual: arrActual  || null },
    delayMinutes,
    isDelayed,
    formatted,
  };
}

/**
 * Given an inbound flight delay, recalculate what fits in Day 1 and triage soft goals.
 *
 * @param {number}   delayMinutes    - How many minutes the inbound flight is delayed
 * @param {object[]} dayItinerary    - Array of activity objects from tripState.itinerary[0].activities
 *   Each activity: { name, category, scheduledTime, duration? }
 *   category: 'hard' | 'soft' | 'open'
 * @returns {{
 *   affectedItems: string[],
 *   triageOptions: string[],
 *   formatted: string
 * }}
 */
function calculateDelayImpact(delayMinutes, dayItinerary = []) {
  if (delayMinutes <= 0) {
    return { affectedItems: [], triageOptions: [], formatted: '✅ No delay — Day 1 plan unchanged.' };
  }

  const hardCommitments = dayItinerary.filter(a => (a.category || a.type) === 'hard');
  const softGoals       = dayItinerary.filter(a => (a.category || a.type) === 'soft');

  // Identify which soft goals are at risk
  const affectedItems = softGoals.map(a => a.name).filter(Boolean);

  // Build 2-3 triage options
  const triageOptions = [];

  // Option 1: Skip first soft goal if any
  if (softGoals.length > 0) {
    const skipped = softGoals[0].name || 'first soft stop';
    triageOptions.push(`Skip ${skipped}, relaxed drive direct to ${hardCommitments[0]?.name || 'dinner'} ✅`);
  }

  // Option 2: Shorten a soft goal to fit
  if (softGoals.length > 0) {
    const shortened = softGoals[0].name || 'first soft stop';
    const slimTime  = Math.max(15, (softGoals[0].duration || 60) / 3);
    triageOptions.push(`Quick ${Math.round(slimTime)}-min stop at ${shortened}, then push through ⚠️`);
  }

  // Option 3: If hard commitment is at risk — suggest calling ahead
  if (hardCommitments.length > 0) {
    const hard = hardCommitments[0].name || 'dinner reservation';
    triageOptions.push(`Skip everything, call ahead to push ${hard} back 1 hour — want the number? 📞`);
  }

  // Last resort: if no soft goals exist, just note the delay impact
  if (!triageOptions.length) {
    triageOptions.push(`Delay of ${delayMinutes} min — no soft goals to cut. Proceed as planned.`);
  }

  // Cap at 3
  const opts = triageOptions.slice(0, 3);

  const hoursDelayed = Math.floor(delayMinutes / 60);
  const minsDelayed  = delayMinutes % 60;
  const delayStr     = hoursDelayed > 0 ? `${hoursDelayed} hr ${minsDelayed} min` : `${minsDelayed} min`;

  const lines = [
    `✈️ Flight delay ate ${delayStr}. Options:`,
    '',
    ...opts.map((o, i) => `${i + 1}. ${o}`),
    '',
    'Which works?',
  ];

  return {
    affectedItems,
    triageOptions: opts,
    formatted: lines.join('\n'),
  };
}

/**
 * Work backward from an outbound flight departure to determine the latest time
 * the family should leave their current location.
 *
 * Buffers:
 *   - 90 min: security screening + gate
 *   - 30 min: car rental return
 *   - 30 min: shuttle from rental to terminal
 *   - Drive time from current location to airport
 *
 * @param {string|Date} flightTime     - Departure time (ISO string or Date)
 * @param {number}      airportLat     - Airport coordinates
 * @param {number}      airportLon
 * @param {number}      currentLat     - Family's current location
 * @param {number}      currentLon
 * @returns {Promise<{ latestDepartureTime: Date, breakdown: object, formatted: string }>}
 */
async function calculateDepartureWindow(flightTime, airportLat, airportLon, currentLat, currentLon) {
  const departure = flightTime instanceof Date ? flightTime : new Date(flightTime);
  if (isNaN(departure)) throw new Error('Invalid flight time provided');

  // Fixed buffers (minutes)
  const SECURITY_BUFFER     = 90;
  const CAR_RENTAL_RETURN   = 30;
  const SHUTTLE_BUFFER      = 30;

  // Dynamic: drive from current location to airport
  let driveMinutes = 60;  // safe default
  try {
    const data = await maps.directions(currentLat, currentLon, airportLat, airportLon);
    const leg  = data?.routes?.[0]?.legs?.[0];
    if (leg) {
      const seconds = (leg.duration_in_traffic?.value) ?? leg.duration?.value ?? 3600;
      driveMinutes = Math.ceil(seconds / 60);
    }
  } catch (err) {
    logger.warn(`Drive time to airport failed, using ${driveMinutes} min default: ${err.message}`);
  }

  const totalBufferMinutes = SECURITY_BUFFER + CAR_RENTAL_RETURN + SHUTTLE_BUFFER + driveMinutes;
  const latestDepartureTime = subtractMinutes(departure, totalBufferMinutes);

  const breakdown = {
    flightDeparture:    formatTime(departure),
    securityBuffer:     `${SECURITY_BUFFER} min`,
    carRentalReturn:    `${CAR_RENTAL_RETURN} min`,
    shuttleBuffer:      `${SHUTTLE_BUFFER} min`,
    driveToAirport:     `${driveMinutes} min`,
    totalBuffer:        `${totalBufferMinutes} min`,
    latestDepartureTime: formatTime(latestDepartureTime),
  };

  const formatted = [
    `✈️ Flight departs at ${breakdown.flightDeparture}`,
    `Working backward:`,
    `  • Security + gate: ${SECURITY_BUFFER} min`,
    `  • Car rental return: ${CAR_RENTAL_RETURN} min`,
    `  • Shuttle to terminal: ${SHUTTLE_BUFFER} min`,
    `  • Drive to airport: ${driveMinutes} min`,
    ``,
    `🕐 Leave by ${breakdown.latestDepartureTime} to make it comfortably.`,
  ].join('\n');

  return { latestDepartureTime, breakdown, formatted };
}

module.exports = { getFlightStatus, calculateDelayImpact, calculateDepartureWindow };
