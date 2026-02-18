'use strict';

const { distanceMeters } = require('../../utils/geo');
const logger = require('../../utils/logger');

// Lazy-load patterns to avoid circular-require issues
// (stateMachine ← tracking ← patterns and patterns can observe tracking events)
let _patterns = null;
function getPatterns() {
  if (!_patterns) _patterns = require('../patterns');
  return _patterns;
}

/**
 * RouteWise Activity State Machine
 *
 * State transition rules (PRD Section 7.2):
 *
 *   pending     → arrived:     family within 1000m of activity coordinates
 *   arrived     → in-progress: family within 1000m for 20+ continuous minutes
 *   in-progress → completed:   family moved >1000m away (back on road / speed heuristic)
 *   any (not started) → uncertain: family 1000m–2000m away AND activity not yet started
 *   uncertain   → (ask event): Dona asks the family, does NOT auto-transition
 *
 * Activities must have { lat, lon } to participate in state tracking.
 * Activities without coordinates are passed through unchanged.
 */

const PROXIMITY_ARRIVED_M   = 1000;  // meters — "arrived" threshold
const PROXIMITY_UNCERTAIN_M = 2000;  // meters — outer "uncertain" ring
const IN_PROGRESS_MINUTES   = 20;    // continuous minutes at location → in-progress

/**
 * Determine the next state for a single activity given current position.
 *
 * @param {object} activity - Activity object with { lat, lon, state, arrivedAt }
 * @param {number} lat - Current family latitude
 * @param {number} lon - Current family longitude
 * @param {number} timeAtLocation - Minutes family has been continuously within 1000m
 * @returns {'pending'|'arrived'|'in-progress'|'completed'|'uncertain'}
 */
function getActivityState(activity, lat, lon, timeAtLocation = 0) {
  // Activities without coordinates can't be tracked
  if (activity.lat == null || activity.lon == null) {
    return activity.state || 'pending';
  }

  const distance = distanceMeters(lat, lon, activity.lat, activity.lon);
  const currentState = activity.state || 'pending';

  // Terminal state — never transition away
  if (currentState === 'completed') return 'completed';

  // in-progress → completed: family moved >1000m away
  if (currentState === 'in-progress' && distance > PROXIMITY_ARRIVED_M) {
    return 'completed';
  }

  // arrived → in-progress: been at location for 20+ continuous minutes
  if (currentState === 'arrived' && distance <= PROXIMITY_ARRIVED_M && timeAtLocation >= IN_PROGRESS_MINUTES) {
    return 'in-progress';
  }

  // pending / uncertain / arrived → arrived: within 1000m
  // (arrived stays arrived if within 1000m but timer hasn't hit 20min yet)
  const hasStarted = currentState === 'in-progress' || currentState === 'completed';
  if (!hasStarted && distance <= PROXIMITY_ARRIVED_M) {
    return 'arrived';
  }

  // Any non-started state → uncertain: within outer ring but NOT within inner ring
  if (!hasStarted && distance > PROXIMITY_ARRIVED_M && distance <= PROXIMITY_UNCERTAIN_M) {
    return 'uncertain';
  }

  // No transition applicable — hold current state
  return currentState;
}

/**
 * Run state transitions for all activities in the itinerary.
 *
 * @param {number} lat - Current family latitude
 * @param {number} lon - Current family longitude
 * @param {string} timestamp - ISO timestamp of this location update
 * @param {object[]} itinerary - Array of day objects from tripState
 * @returns {{ itinerary: object[], events: object[] }}
 *   itinerary — updated itinerary with new state fields
 *   events    — state-change and ask events for the caller to act on
 */
function updateActivityStates(lat, lon, timestamp, itinerary) {
  const ts = timestamp || new Date().toISOString();
  const events = [];

  const updatedItinerary = (itinerary || []).map(day => {
    const updatedActivities = (day.activities || []).map(activity => {
      // Skip activities without coordinates
      if (activity.lat == null || activity.lon == null) return activity;

      const currentState = activity.state || 'pending';

      // Terminal state — skip
      if (currentState === 'completed') return activity;

      // Calculate how long family has been continuously within 1000m
      let timeAtLocation = 0;
      if (activity.arrivedAt && (currentState === 'arrived' || currentState === 'in-progress')) {
        const arrivalMs = new Date(activity.arrivedAt).getTime();
        const nowMs = new Date(ts).getTime();
        timeAtLocation = Math.max(0, (nowMs - arrivalMs) / 60000);
      }

      const newState = getActivityState(activity, lat, lon, timeAtLocation);

      // No change — return as-is
      if (newState === currentState) return activity;

      // Emit appropriate event
      const actId = activity.id || activity.description;
      const actName = activity.name || activity.description;

      if (newState === 'uncertain') {
        events.push({
          type: 'ask',
          activityId: actId,
          activityName: actName,
          question: `Are you at ${actName}?`,
        });
        logger.info(`Activity uncertain: "${actName}" (family is nearby but not confirmed)`);
      } else {
        events.push({
          type: 'stateChange',
          activityId: actId,
          activityName: actName,
          from: currentState,
          to: newState,
        });
        logger.info(`Activity state: "${actName}" ${currentState} → ${newState}`);
      }

      // Build updated activity
      const updated = { ...activity, state: newState };

      // Track arrival timestamp (start of timer for in-progress)
      if (newState === 'arrived' && currentState !== 'arrived') {
        updated.arrivedAt = ts;
      }
      // Track departure
      if (newState === 'completed' && currentState !== 'completed') {
        updated.completedAt = ts;
      }

      return updated;
    });

    return { ...day, activities: updatedActivities };
  });

  return { itinerary: updatedItinerary, events };
}

/**
 * Calculate the expected remaining time at an activity, factoring in
 * the family's historical pace pattern for the activity type.
 *
 * Used by the heartbeat / ETA modules to avoid underestimating how
 * long the family will spend at activities they historically linger at.
 *
 * @param {object}      activity      - Activity object with { plannedDuration, name, id }
 * @param {number}      minutesSpent  - Minutes already spent at the activity
 * @param {object|null} tripState     - Trip state (used for pattern lookup)
 * @returns {number} Expected remaining minutes (≥ 0)
 */
function getExpectedRemainingTime(activity, minutesSpent, tripState = null) {
  const planned = activity?.plannedDuration || 60; // default 1 hour

  // M5: Add pattern-based buffer for this activity type
  let buffer = 0;
  if (tripState) {
    const activityType = (activity?.type || activity?.name || activity?.id || '').toLowerCase();
    buffer = getPatterns().getActivityBuffer(activityType, tripState);
    if (buffer > 0) {
      logger.debug(
        `stateMachine.getExpectedRemainingTime: adding ${buffer.toFixed(0)} min buffer ` +
        `for activity type "${activityType}" (pattern learning)`
      );
    }
  }

  const totalExpected = planned + buffer;
  const remaining     = Math.max(0, totalExpected - (minutesSpent || 0));
  return remaining;
}

module.exports = { getActivityState, updateActivityStates, getExpectedRemainingTime };
