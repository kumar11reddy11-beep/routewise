'use strict';

require('dotenv').config();

const logger      = require('../../utils/logger');
const tripState   = require('../../memory/tripState');
const stateMachine = require('./stateMachine');
const eta          = require('./eta');
const weather      = require('./weather');
const deferred     = require('./deferredRequests');

/**
 * RouteWise Tracking Module — Milestone 2 Orchestrator
 *
 * Entry point for all GPS tracking, ETA calculation, schedule drift detection,
 * weather queries, and deferred reminder handling.
 *
 * Maintains current location in-process (reset on restart — acceptable for M2).
 */

// In-memory current location (updated on every GPS tick from Telegram)
let currentLocation = { lat: null, lon: null, timestamp: null };

// ─────────────────────────────────────────────────────────────────────────────
// Location Update
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main entry point when a GPS location update is received (e.g., from Telegram live location).
 *
 * @param {number} lat
 * @param {number} lon
 * @param {string|null} timestamp - ISO timestamp; defaults to now
 * @returns {Promise<{events, firedRequests, location}>}
 */
async function handleLocationUpdate(lat, lon, timestamp = null) {
  const ts = timestamp || new Date().toISOString();
  currentLocation = { lat, lon, timestamp: ts };

  logger.info(`Location update received: ${lat}, ${lon}`);

  // ── Activity state machine ─────────────────────────────────────────────────
  const state = tripState.load();
  const { itinerary: updatedItinerary, events } = stateMachine.updateActivityStates(
    lat, lon, ts, state.itinerary || []
  );

  // Persist updated itinerary
  state.itinerary = updatedItinerary;
  tripState.save(state);

  // ── Deferred requests ──────────────────────────────────────────────────────
  const firedRequests = deferred.checkAndFire(lat, lon);

  return {
    events,
    firedRequests,
    location: { lat, lon, timestamp: ts },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ETA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate ETA to a destination.
 *
 * @param {object|string} destination
 *   - object: { lat, lon, name? }
 *   - string: activity name to look up in the itinerary
 * @returns {Promise<object>} ETA result or { error }
 */
async function getETA(destination) {
  if (!currentLocation.lat) {
    return { error: 'No current location available. Share your live location first.' };
  }

  let destLat, destLon, destName;

  if (destination && typeof destination === 'object' && destination.lat != null) {
    destLat  = destination.lat;
    destLon  = destination.lon;
    destName = destination.name || destination.description || `${destLat},${destLon}`;
  } else if (typeof destination === 'string') {
    destName = destination;
    const state = tripState.load();
    outer: for (const day of (state.itinerary || [])) {
      for (const act of (day.activities || [])) {
        const name = act.name || act.description || '';
        if (name.toLowerCase().includes(destination.toLowerCase()) && act.lat != null) {
          destLat  = act.lat;
          destLon  = act.lon;
          destName = name;
          break outer;
        }
      }
    }
    if (destLat == null) {
      return { error: `Couldn't find "${destination}" with coordinates in your itinerary.` };
    }
  } else {
    return { error: 'Invalid destination — pass { lat, lon } or an activity name string.' };
  }

  try {
    const result = await eta.calculateETA(currentLocation.lat, currentLocation.lon, destLat, destLon);
    return { destination: destName, ...result };
  } catch (err) {
    logger.error('ETA calculation failed:', err.message);
    return { error: `ETA calculation failed: ${err.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule Drift
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compare current ETAs to planned activity times. Returns a drift report.
 * Drift threshold: 10 minutes (absolute).
 *
 * @returns {Promise<object>} { activities, drifted, hasDrift } or { error }
 */
async function detectScheduleDrift() {
  if (!currentLocation.lat) {
    return { error: 'No current location available.' };
  }

  const state = tripState.load();

  try {
    const activities = await eta.calculateETAsForItinerary(
      currentLocation.lat, currentLocation.lon, state.itinerary || []
    );

    const drifted = activities.filter(
      a => a.driftMinutes !== null && Math.abs(a.driftMinutes) >= 10
    );

    return { activities, drifted, hasDrift: drifted.length > 0 };
  } catch (err) {
    logger.error('Schedule drift detection failed:', err.message);
    return { error: `Drift detection failed: ${err.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deferred Requests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schedule a deferred reminder. Same category → override. Different → stack.
 *
 * @param {string} category   - e.g. "lunch", "coffee", "gas"
 * @param {number} delayMinutes
 * @param {string} requestText
 * @returns {object} The created deferred request
 */
function handleDeferredRequest(category, delayMinutes, requestText) {
  const { lat, lon } = currentLocation;
  return deferred.addRequest(category, delayMinutes, requestText, lat, lon);
}

/**
 * Return all pending deferred requests.
 * @returns {object[]}
 */
function getDeferredRequests() {
  return deferred.getPendingRequests();
}

/**
 * Check if any deferred requests should fire now.
 * @param {number} lat
 * @param {number} lon
 * @returns {object[]} Requests that fired
 */
function checkDeferredRequests(lat, lon) {
  return deferred.checkAndFire(lat, lon);
}

// ─────────────────────────────────────────────────────────────────────────────
// Weather / Sunset (convenience pass-throughs)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get weather for a named location.
 * @param {string} locationName
 */
async function getWeatherForLocation(locationName) {
  return weather.getWeatherForLocation(locationName);
}

/**
 * Get sunset + golden hour for a given lat/lon and date.
 * @param {number} lat
 * @param {number} lon
 * @param {Date|string|null} date
 */
async function getSunsetInfo(lat, lon, date) {
  return weather.getSunsetInfo(lat, lon, date);
}

/**
 * Expose the current in-memory location (useful for tests and heartbeat).
 * @returns {{ lat, lon, timestamp }}
 */
function getCurrentLocation() {
  return { ...currentLocation };
}

module.exports = {
  handleLocationUpdate,
  getETA,
  detectScheduleDrift,
  handleDeferredRequest,
  getDeferredRequests,
  checkDeferredRequests,
  getWeatherForLocation,
  getSunsetInfo,
  getCurrentLocation,
};
