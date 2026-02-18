'use strict';

const logger      = require('../../utils/logger');
const personality = require('./personality');

/**
 * RouteWise Conflict Resolver (PRD Section 13.3, 19.6)
 *
 * Handles the case where multiple family members respond to a RouteWise
 * suggestion with different choices.  Per the PRD:
 *
 *   "Family resolves conflicts, not Dona."
 *   "Seeing different votes — let me know when you've decided!"
 *
 * Responses for a single request are tracked in an in-memory store keyed by
 * requestId.  The caller must call clearRequest() once the family has agreed.
 *
 * Design notes:
 *  - requestId is any unique string (e.g. "dining-2026-02-18T09:00:00Z").
 *  - familyMember is a string identifier (e.g. Telegram username or role).
 *  - choice is a string (option text, number, or free text).
 *  - A conflict exists when ≥2 different family members have made ≥2
 *    distinct choices.
 */

// In-memory store: { [requestId]: { [familyMember]: choice } }
const _store = {};

/**
 * Record a family member's response to a request.
 *
 * If the family member already responded, their choice is overwritten
 * (last response wins for that member).
 *
 * @param {string} requestId    - Unique request identifier
 * @param {string} familyMember - Family member identifier
 * @param {string} choice       - Their chosen option
 */
function trackResponse(requestId, familyMember, choice) {
  if (!requestId || !familyMember) {
    logger.warn('trackResponse: requestId and familyMember are required');
    return;
  }

  if (!_store[requestId]) _store[requestId] = {};

  const previous = _store[requestId][familyMember];
  _store[requestId][familyMember] = String(choice);

  logger.info(
    `Conflict tracker [${requestId}]: ` +
    `${familyMember} → "${choice}"` +
    (previous !== undefined ? ` (was: "${previous}")` : '')
  );
}

/**
 * Determine whether there is a conflict for a given request.
 *
 * A conflict is present when there are at least 2 distinct choices
 * among the recorded responses.
 *
 * @param {string} requestId
 * @returns {boolean}
 */
function hasConflict(requestId) {
  const responses = _store[requestId];
  if (!responses) return false;

  const uniqueChoices = new Set(Object.values(responses));
  return uniqueChoices.size >= 2;
}

/**
 * Return the conflict message for a given request.
 *
 * @param {string} requestId
 * @returns {string} Conflict message (or empty string if no conflict)
 */
function getConflictMessage(requestId) {
  if (!hasConflict(requestId)) return '';
  return personality.formatConflictResponse();
}

/**
 * Get a snapshot of all recorded responses for a request.
 * Useful for debugging and testing.
 *
 * @param {string} requestId
 * @returns {object} { [familyMember]: choice } or {}
 */
function getResponses(requestId) {
  return { ...(_store[requestId] || {}) };
}

/**
 * Clear all response data for a request once it has been resolved.
 *
 * @param {string} requestId
 */
function clearRequest(requestId) {
  if (_store[requestId]) {
    delete _store[requestId];
    logger.debug(`Conflict tracker: cleared request "${requestId}"`);
  }
}

/**
 * Clear ALL stored requests (useful for test isolation).
 */
function clearAll() {
  Object.keys(_store).forEach(k => delete _store[k]);
}

module.exports = {
  trackResponse,
  hasConflict,
  getConflictMessage,
  getResponses,
  clearRequest,
  clearAll,
};
