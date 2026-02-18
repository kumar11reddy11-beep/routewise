'use strict';

const logger = require('../../utils/logger');

/**
 * RouteWise Deferred Request Handler
 *
 * Stores time-delayed reminders in memory (not persisted across restarts).
 *
 * Rules (per PRD Section 19.4):
 *   - Same category → override existing request for that category
 *   - Different category → requests stack independently
 *
 * Each request: { id, category, text, firesAt, originLat, originLon }
 */

let requests = [];
let nextId = 1;

/**
 * Add a deferred request. Overrides any existing request in the same category.
 *
 * @param {string} category - e.g. "lunch", "coffee", "gas"
 * @param {number} delayMinutes - Minutes until the reminder fires
 * @param {string} text - The original request text
 * @param {number|null} currentLat - Family's current latitude (may be null if unknown)
 * @param {number|null} currentLon - Family's current longitude
 * @returns {object} The created request object
 */
function addRequest(category, delayMinutes, text, currentLat = null, currentLon = null) {
  // Same category → override existing
  requests = requests.filter(r => r.category !== category);

  const firesAt = new Date(Date.now() + delayMinutes * 60 * 1000);
  const req = {
    id: nextId++,
    category,
    text,
    firesAt,
    originLat: currentLat,
    originLon: currentLon,
  };
  requests.push(req);

  logger.info(`Deferred request added: [${category}] "${text}" fires in ${delayMinutes} min (at ${firesAt.toISOString()})`);
  return req;
}

/**
 * Get all pending (not yet fired) deferred requests.
 * @returns {object[]}
 */
function getPendingRequests() {
  return [...requests];
}

/**
 * Check which requests have elapsed. Removes them from the queue and returns them.
 *
 * @param {number|null} currentLat - Family's current latitude (informational, for context)
 * @param {number|null} currentLon - Family's current longitude
 * @returns {object[]} Requests that have fired
 */
function checkAndFire(currentLat = null, currentLon = null) {
  const now = new Date();
  const fired = requests.filter(r => r.firesAt <= now);
  requests = requests.filter(r => r.firesAt > now);

  if (fired.length) {
    logger.info(`Deferred requests fired: ${fired.map(r => `[${r.category}] "${r.text}"`).join(', ')}`);
  }

  return fired;
}

/**
 * Remove all pending requests for a given category.
 * @param {string} category
 */
function clearCategory(category) {
  const before = requests.length;
  requests = requests.filter(r => r.category !== category);
  const removed = before - requests.length;
  logger.info(`Cleared ${removed} deferred request(s) for category: ${category}`);
}

/**
 * Reset all requests (useful for testing).
 */
function _reset() {
  requests = [];
  nextId = 1;
}

module.exports = { addRequest, getPendingRequests, checkAndFire, clearCategory, _reset };
