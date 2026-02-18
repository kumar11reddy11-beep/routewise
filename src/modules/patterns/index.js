'use strict';

const learner  = require('./learner');
const logger   = require('../../utils/logger');

/**
 * RouteWise Pattern Learning Orchestrator — Milestone 5
 *
 * Single entry point for all pattern-learning and pattern-application
 * operations.  Delegates to learner.js for the actual computation.
 *
 * observe() is the inbound pipeline: modules call this whenever a
 * real-world event occurs (departure happened, food was chosen, etc.).
 *
 * applyPatterns() is the outbound pipeline: callers receive a
 * "config overlay" that nudges scheduling buffers, food ranking, and
 * activity pacing based on learned behaviour.
 *
 * All pattern data is stored in tripState.patterns so it persists across
 * heartbeat cycles without needing a separate database.
 *
 * Supported event types:
 *   'departure'   — { value: { planned, actual }, context: {} }
 *   'food'        — { value: { chosen, options }, context: {} }
 *   'activityPace'— { value: { activityId, planned, actual }, context: {} }
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a new observation and update the learned patterns in tripState.
 *
 * @param {{ type: string, value: object, context?: object }} event
 * @param {object} tripState  - Mutable trip state; patterns are stored here
 */
function observe(event, tripState) {
  if (!event || !event.type) {
    logger.warn('patterns.observe: event.type is required');
    return;
  }

  logger.debug(`patterns.observe: type="${event.type}"`);

  switch (event.type) {
    case 'departure':
      learner.learnDeparturePattern(
        tripState,
        event.value?.planned,
        event.value?.actual
      );
      break;

    case 'food':
      learner.learnFoodPreference(
        tripState,
        event.value?.chosen,
        event.value?.options || []
      );
      break;

    case 'activityPace':
      learner.learnActivityPace(
        tripState,
        event.value?.activityId,
        event.value?.planned,
        event.value?.actual
      );
      break;

    default:
      logger.warn(`patterns.observe: unknown event type "${event.type}" — ignored`);
  }
}

/**
 * Compute a pattern-adjusted configuration overlay from the current trip state.
 *
 * Returns an object with three properties that callers use to nudge their
 * own logic:
 *
 *   schedulingBuffer  — extra minutes to add to departure time calculations
 *                       (positive = suggest departing this many minutes earlier)
 *   foodPreference    — 'casual' | 'upscale' | 'neutral'
 *   paceMultiplier    — multiply planned activity durations by this value
 *                       (1.0 = no change, 1.2 = add 20% buffer)
 *
 * @param {object} tripState
 * @returns {{ schedulingBuffer: number, foodPreference: string, paceMultiplier: number }}
 */
function applyPatterns(tripState) {
  const avgLate        = tripState?.patterns?.departure?.avgLateMins || 0;
  const foodPreference = learner.getFoodBias(tripState);

  // Compute a pace multiplier across all activity types that have observations.
  // We take the highest average delta as the overall pace multiplier input,
  // since that is the most conservative (safest) buffer for planning.
  const paceDeltas = Object.values(tripState?.patterns?.pace || {})
    .map(p => p.avgDeltaMins || 0)
    .filter(d => d > 0);

  const maxPaceDelta = paceDeltas.length > 0 ? Math.max(...paceDeltas) : 0;

  // Convert delta to a multiplier: e.g. 30-min delta on a 60-min activity = 1.5×
  // We normalise to a 60-min baseline and cap at 2.0× to stay reasonable.
  const paceMultiplier = maxPaceDelta > 0
    ? Math.min(2.0, 1 + maxPaceDelta / 60)
    : 1.0;

  const config = {
    schedulingBuffer: Math.round(avgLate),
    foodPreference,
    paceMultiplier: parseFloat(paceMultiplier.toFixed(2)),
  };

  logger.debug('patterns.applyPatterns:', config);
  return config;
}

/**
 * Generate a human-readable summary of the learned patterns.
 *
 * Used when the family asks Dona "what patterns have you noticed?" or
 * for internal debugging.
 *
 * @param {object} tripState
 * @returns {string}
 */
function getPatternSummary(tripState) {
  const p = tripState?.patterns || {};
  const lines = ['📊 Learned trip patterns:'];

  // Departure
  if (p.departure?.observations?.length > 0) {
    const avg = p.departure.avgLateMins.toFixed(0);
    const dir = avg >= 0 ? `${avg} min late` : `${Math.abs(avg)} min early`;
    lines.push(`⏰ Departures: typically ${dir} (${p.departure.observations.length} observations)`);
  } else {
    lines.push('⏰ Departures: no pattern yet');
  }

  // Food
  const foodBias = learner.getFoodBias(tripState);
  if (p.food?.choices?.length > 0) {
    lines.push(`🍽️ Food preference: ${foodBias} (${p.food.choices.length} choices recorded)`);
  } else {
    lines.push('🍽️ Food preference: no pattern yet');
  }

  // Activity pace
  const paceEntries = Object.entries(p.pace || {});
  if (paceEntries.length > 0) {
    lines.push('🏃 Activity pace:');
    for (const [type, data] of paceEntries) {
      const avg = (data.avgDeltaMins || 0).toFixed(0);
      const dir = avg >= 0 ? `${avg} min over` : `${Math.abs(avg)} min under`;
      lines.push(`   ${type}: typically ${dir} (${data.observations.length} observations)`);
    }
  } else {
    lines.push('🏃 Activity pace: no pattern yet');
  }

  return lines.join('\n');
}

/**
 * Convenience passthrough for departure adjustment (used by morningBriefing.js).
 * @param {Date|string} plannedTime
 * @param {object}      tripState
 * @returns {Date}
 */
function applyDepartureAdjustment(plannedTime, tripState) {
  return learner.applyDepartureAdjustment(plannedTime, tripState);
}

/**
 * Convenience passthrough for food bias (used by dining.js).
 * @param {object} tripState
 * @returns {'casual'|'upscale'|'neutral'}
 */
function getFoodBias(tripState) {
  return learner.getFoodBias(tripState);
}

/**
 * Convenience passthrough for activity buffer (used by stateMachine.js).
 * @param {string} activityType
 * @param {object} tripState
 * @returns {number}
 */
function getActivityBuffer(activityType, tripState) {
  return learner.getActivityBuffer(activityType, tripState);
}

module.exports = {
  observe,
  applyPatterns,
  getPatternSummary,
  // Convenience passthroughs
  applyDepartureAdjustment,
  getFoodBias,
  getActivityBuffer,
};
