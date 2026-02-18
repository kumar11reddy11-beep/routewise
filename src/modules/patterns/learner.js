'use strict';

const logger = require('../../utils/logger');

/**
 * RouteWise Pattern Learning Engine (PRD Section 10, 19.3)
 *
 * Learns from observed family behaviour during the trip and adapts future
 * suggestions accordingly.  All patterns are stored inside tripState.patterns
 * so they persist across heartbeat cycles.
 *
 * PRD Section 19.3 rules:
 *  - Single instance = learned pattern (no threshold required).
 *  - Departure: track average minutes late; apply to all future departure times.
 *  - Food: track last 5 choices; majority wins for getFoodBias.
 *  - Activity pace: track per activity-type (beach, hike, scenic);
 *                   average the deltas for getActivityBuffer.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely retrieve the patterns object from tripState, initialising
 * sub-namespaces as needed.  Returns a mutable reference.
 *
 * @param {object} tripState
 * @returns {object} patterns sub-object (mutated in-place)
 */
function patterns(tripState) {
  if (!tripState.patterns) tripState.patterns = {};
  return tripState.patterns;
}

/**
 * Compute the arithmetic mean of a numeric array.
 * @param {number[]} arr
 * @returns {number}
 */
function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Departure learning
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a departure observation.
 *
 * Stores the delta between planned and actual departure times so future
 * morning-briefing departure suggestions can be adjusted accordingly.
 *
 * @param {object} tripState         - Mutable trip state (patterns stored here)
 * @param {string|Date} plannedDeparture - When departure was planned
 * @param {string|Date} actualDeparture  - When departure actually happened
 */
function learnDeparturePattern(tripState, plannedDeparture, actualDeparture) {
  const planned = new Date(plannedDeparture).getTime();
  const actual  = new Date(actualDeparture).getTime();

  if (isNaN(planned) || isNaN(actual)) {
    logger.warn('learnDeparturePattern: invalid timestamps, skipping.');
    return;
  }

  const deltaMins = (actual - planned) / 60000; // positive = late, negative = early

  const p = patterns(tripState);
  if (!p.departure) p.departure = { observations: [] };

  p.departure.observations.push(deltaMins);
  p.departure.avgLateMins = mean(p.departure.observations);

  logger.info(
    `Departure pattern: delta=${deltaMins.toFixed(1)} min ` +
    `avg=${p.departure.avgLateMins.toFixed(1)} min ` +
    `(${p.departure.observations.length} observations)`
  );
}

/**
 * Return a departure time adjusted for the family's historical lateness.
 *
 * If the family is typically 20 min late, suggest departing 20 min earlier.
 *
 * @param {Date|string} plannedTime  - Naive suggested departure time
 * @param {object}      tripState    - Trip state containing patterns
 * @returns {Date} Adjusted departure time
 */
function applyDepartureAdjustment(plannedTime, tripState) {
  const base = new Date(plannedTime);
  if (isNaN(base.getTime())) return base;

  const avg = tripState?.patterns?.departure?.avgLateMins || 0;
  if (avg === 0) return base;

  // Shift departure EARLIER by the average lateness so the family
  // arrives on time despite their historical behaviour.
  const adjusted = new Date(base.getTime() - avg * 60000);

  logger.debug(
    `applyDepartureAdjustment: ${base.toISOString()} → ${adjusted.toISOString()} ` +
    `(avg late: ${avg.toFixed(1)} min)`
  );
  return adjusted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Food preference learning
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a food choice observation.
 *
 * Classifies the chosen option as 'casual' or 'upscale' by comparing its
 * price_level (or rating) to the other available options, then appends to
 * a rolling window of the last 5 choices.
 *
 * @param {object} tripState     - Mutable trip state
 * @param {object} chosenOption  - The option the family selected
 * @param {object[]} options     - All options that were presented
 */
function learnFoodPreference(tripState, chosenOption, options) {
  if (!chosenOption) return;

  // Classify the choice.  We use priceLevel if available, otherwise fall
  // back to a name-based heuristic.
  const classification = classifyDiningOption(chosenOption, options);

  const p = patterns(tripState);
  if (!p.food) p.food = { choices: [] };

  // Rolling window: keep only the last 5 choices.
  p.food.choices.push(classification);
  if (p.food.choices.length > 5) p.food.choices.shift();

  logger.info(
    `Food preference: "${chosenOption.name || 'option'}" classified as "${classification}". ` +
    `History: [${p.food.choices.join(', ')}]`
  );
}

/**
 * Classify a dining option as 'casual', 'upscale', or 'neutral'.
 *
 * Heuristic:
 *  - price_level 0–2  → casual
 *  - price_level 3–4  → upscale
 *  - No price_level: name-based keywords, then rating, then neutral.
 *
 * @param {object}   chosen
 * @param {object[]} allOptions
 * @returns {'casual'|'upscale'|'neutral'}
 */
function classifyDiningOption(chosen, allOptions = []) {
  // Explicit priceLevel field (Google Places uses 0–4)
  if (chosen.priceLevel != null) {
    return chosen.priceLevel <= 2 ? 'casual' : 'upscale';
  }

  // Name-based keywords
  const name = (chosen.name || '').toLowerCase();
  if (/diner|deli|café|cafe|taco|burger|pizza|fast|grill|bbq|roadside/i.test(name)) {
    return 'casual';
  }
  if (/bistro|steakhouse|prime|fine|upscale|vineyard|rooftop|chef|reserve/i.test(name)) {
    return 'upscale';
  }

  // Relative rating: if chosen is below-average rating among options it's
  // likely a more casual, popular spot.
  const ratings = allOptions.map(o => o.rating || 0).filter(r => r > 0);
  if (ratings.length > 1 && chosen.rating) {
    const avg = mean(ratings);
    return chosen.rating < avg ? 'casual' : 'upscale';
  }

  return 'neutral';
}

/**
 * Return the family's current food preference bias.
 *
 * Majority of the last 5 recorded choices wins.
 * Tie → 'neutral'.
 *
 * @param {object} tripState
 * @returns {'casual'|'upscale'|'neutral'}
 */
function getFoodBias(tripState) {
  const choices = tripState?.patterns?.food?.choices || [];
  if (choices.length === 0) return 'neutral';

  const counts = { casual: 0, upscale: 0, neutral: 0 };
  for (const c of choices) counts[c] = (counts[c] || 0) + 1;

  const max = Math.max(counts.casual, counts.upscale, counts.neutral);
  if (counts.casual === counts.upscale) return 'neutral';

  if (counts.casual === max) return 'casual';
  if (counts.upscale === max) return 'upscale';
  return 'neutral';
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity pace learning
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record an activity pace observation.
 *
 * Stores how many minutes over (positive) or under (negative) the planned
 * duration the family spent at a given activity type.
 *
 * @param {object}      tripState         - Mutable trip state
 * @param {string}      activityId        - Unique identifier for the activity
 * @param {number}      plannedDuration   - Planned duration in minutes
 * @param {number}      actualDuration    - Actual time spent in minutes
 */
function learnActivityPace(tripState, activityId, plannedDuration, actualDuration) {
  if (plannedDuration == null || actualDuration == null) {
    logger.warn('learnActivityPace: missing durations, skipping.');
    return;
  }

  const delta = actualDuration - plannedDuration; // positive = ran long
  const type  = deriveActivityType(activityId);

  const p = patterns(tripState);
  if (!p.pace) p.pace = {};
  if (!p.pace[type]) p.pace[type] = { observations: [] };

  p.pace[type].observations.push(delta);
  p.pace[type].avgDeltaMins = mean(p.pace[type].observations);

  logger.info(
    `Activity pace (${type}): delta=${delta.toFixed(1)} min ` +
    `avg=${p.pace[type].avgDeltaMins.toFixed(1)} min ` +
    `(${p.pace[type].observations.length} observations)`
  );
}

/**
 * Return the expected extra minutes to budget for a given activity type.
 *
 * A positive return value means the family historically runs long at this
 * type of activity; the caller should add this buffer to the scheduled time.
 *
 * Returns 0 if no observations exist (no penalty for unknown types).
 *
 * @param {string} activityType   - e.g. 'beach', 'hike', 'scenic'
 * @param {object} tripState
 * @returns {number} Extra minutes (may be negative if family runs short)
 */
function getActivityBuffer(activityType, tripState) {
  const type = (activityType || '').toLowerCase();
  const avg  = tripState?.patterns?.pace?.[type]?.avgDeltaMins;
  return avg != null ? avg : 0;
}

/**
 * Derive a canonical activity type string from an activity ID or name.
 * Falls back to the raw string lowercased.
 *
 * @param {string} activityId
 * @returns {string}
 */
function deriveActivityType(activityId) {
  const id = (activityId || '').toLowerCase();
  if (/beach|coast|shore|sand/.test(id)) return 'beach';
  if (/hike|trail|trek|walk/.test(id))   return 'hike';
  if (/scenic|overlook|viewpoint|vista/.test(id)) return 'scenic';
  if (/museum|gallery|exhibit/.test(id)) return 'museum';
  if (/city|town|downtown/.test(id))     return 'city';
  return id.split(/[\s-_]+/)[0] || 'other';
}

module.exports = {
  learnDeparturePattern,
  applyDepartureAdjustment,
  learnFoodPreference,
  getFoodBias,
  learnActivityPace,
  getActivityBuffer,
  // Exported for testing
  classifyDiningOption,
  deriveActivityType,
};
