'use strict';

const routeSearch = require('./routeSearch');
const logger      = require('../../utils/logger');
const patterns    = require('../patterns');

/**
 * RouteWise Dining Intelligence (PRD Section 8.2)
 *
 * Adapts dining suggestions based on:
 *   - Route corridor (not just proximity)
 *   - Schedule pressure (drift minutes, time to next hard commitment)
 *   - Fuel correlation (if gas is also needed)
 *
 * Returns a formatted Telegram-ready message with 2–3 options.
 */

/**
 * Determine how many minutes ahead an option is based on its detour time.
 * Negative detours (on-route) are expressed as "right on your way".
 *
 * @param {number} detourMinutes
 * @returns {string}
 */
function describeDetour(detourMinutes) {
  if (detourMinutes <= 0)  return 'right on your way, no detour';
  if (detourMinutes <= 5)  return `~${detourMinutes} min detour`;
  if (detourMinutes <= 15) return `${detourMinutes} min detour`;
  return `${detourMinutes} min detour`;
}

/**
 * Determine schedule tradeoff text based on context and detour.
 *
 * @param {number} detourMinutes
 * @param {{ driftMinutes?: number, hoursUntilNextHardCommitment?: number }} scheduleContext
 * @returns {string}
 */
function scheduleTradeoff(detourMinutes, scheduleContext = {}) {
  const { driftMinutes = 0, hoursUntilNextHardCommitment = null } = scheduleContext;

  const totalImpact = driftMinutes + Math.max(0, detourMinutes);

  if (hoursUntilNextHardCommitment !== null && hoursUntilNextHardCommitment < 1) {
    return '⚠️ Tight — hard commitment in under 1 hr.';
  }
  if (totalImpact > 45) {
    return `⚠️ Puts you ${totalImpact} min behind. Consider calling ahead or getting takeout.`;
  }
  if (totalImpact > 20) {
    return `Running ${driftMinutes > 0 ? driftMinutes + ' min behind' : 'on time'} — this adds ${detourMinutes} min.`;
  }
  if (detourMinutes <= 5) {
    return 'Keeps you right on track.';
  }
  return `Adds ${detourMinutes} min — still comfortable.`;
}

/**
 * Check whether the schedule is tight enough to flag a takeout recommendation.
 *
 * Tight = drift > 20 min OR less than 1 hr to next hard commitment.
 *
 * @param {{ driftMinutes?: number, hoursUntilNextHardCommitment?: number }} scheduleContext
 * @returns {boolean}
 */
function isTight(scheduleContext = {}) {
  const { driftMinutes = 0, hoursUntilNextHardCommitment = null } = scheduleContext;
  return driftMinutes > 20 || (hoursUntilNextHardCommitment !== null && hoursUntilNextHardCommitment < 1);
}

/**
 * Find dining options along the route and format a Telegram-ready response.
 *
 * @param {string} query                - User's search phrase (e.g. "pizza", "seafood")
 * @param {number} currentLat
 * @param {number} currentLon
 * @param {number} nextDestLat
 * @param {number} nextDestLon
 * @param {{ driftMinutes?: number, hoursUntilNextHardCommitment?: number }} scheduleContext
 * @param {number} [detourBudget=20]    - Max detour in minutes (can be overridden by user)
 * @param {object} [tripState=null]     - Optional trip state for pattern-based ranking (M5)
 * @returns {Promise<string>}           Formatted message
 */
async function findDining(query, currentLat, currentLon, nextDestLat, nextDestLon, scheduleContext = {}, detourBudget = 20, tripState = null) {
  logger.info(`Dining search: "${query}" detour=${detourBudget}min`);

  let results = [];
  try {
    results = await routeSearch.searchAlongRoute(
      currentLat, currentLon,
      nextDestLat, nextDestLon,
      'restaurant',
      detourBudget,
      query
    );
  } catch (err) {
    logger.error('Dining route search failed:', err.message);
    return `❌ Couldn't find dining options right now: ${err.message}`;
  }

  if (!results.length) {
    return `🍽️ No dining options found within a ${detourBudget}-min detour on your route. Try a longer detour budget or different search terms.`;
  }

  // M5: Re-rank results based on food preference bias (PRD Section 10)
  let rankedResults = results;
  if (tripState) {
    const bias = patterns.getFoodBias(tripState);
    if (bias !== 'neutral') {
      rankedResults = applyFoodBiasRanking(results, bias);
      logger.info(`Dining: re-ranked by food bias "${bias}"`);
    }
  }

  // Cap at 3 options
  const options = rankedResults.slice(0, 3);
  const tight   = isTight(scheduleContext);

  // Build header
  const foodEmoji = detectFoodEmoji(query);
  const lines = [`${foodEmoji} Found ${options.length} option${options.length > 1 ? 's' : ''} on your way:\n`];

  options.forEach((opt, i) => {
    const ratingStr  = opt.rating ? `${opt.rating}★` : 'No rating';
    const detourDesc = describeDetour(opt.detourMinutes);
    const tradeoff   = scheduleTradeoff(opt.detourMinutes, scheduleContext);

    lines.push(`${i + 1}. ${opt.name} — ${ratingStr}`);
    lines.push(`   ${detourDesc}`);
    lines.push(`   ${tradeoff}`);
    lines.push(`   📍 ${opt.mapsLink}`);
    if (i < options.length - 1) lines.push('');
  });

  // Add takeout advisory if schedule is tight
  if (tight) {
    lines.push('');
    lines.push('⚡ Schedule tight — consider calling ahead or ordering takeout to save 20–30 min.');
  }

  lines.push('');
  lines.push('Which one?');

  return lines.join('\n');
}

/**
 * Pick an appropriate emoji based on the food query.
 * @param {string} query
 * @returns {string}
 */
function detectFoodEmoji(query = '') {
  const q = query.toLowerCase();
  if (/pizza/.test(q))   return '🍕';
  if (/burger|burgers/.test(q)) return '🍔';
  if (/taco|mexican/.test(q))   return '🌮';
  if (/sushi|japanese/.test(q)) return '🍣';
  if (/seafood|fish/.test(q))   return '🦞';
  if (/coffee|cafe/.test(q))    return '☕';
  if (/breakfast/.test(q))      return '🥞';
  if (/sandwich|sub/.test(q))   return '🥪';
  return '🍽️';
}

/**
 * Re-rank dining results based on the family's learned food preference.
 *
 * 'casual'  → boost options with lower price levels or casual-sounding names.
 * 'upscale' → boost options with higher price levels or upscale-sounding names.
 *
 * @param {object[]} results  - Array of dining result objects
 * @param {'casual'|'upscale'} bias
 * @returns {object[]}  Sorted results
 */
function applyFoodBiasRanking(results, bias) {
  return [...results].sort((a, b) => {
    const scoreA = diningBiasScore(a, bias);
    const scoreB = diningBiasScore(b, bias);
    // Higher score = better match for the bias → sort descending
    return scoreB - scoreA;
  });
}

/**
 * Compute a bias-alignment score for a dining option.
 * @param {object} option
 * @param {'casual'|'upscale'} bias
 * @returns {number}
 */
function diningBiasScore(option, bias) {
  const priceLevel = option.priceLevel ?? 2; // default middle
  const name       = (option.name || '').toLowerCase();

  if (bias === 'casual') {
    // Prefer lower price levels and casual keywords
    let score = (4 - priceLevel); // 0–4 inverted → 4 best for price level 0
    if (/diner|deli|cafe|taco|burger|pizza|fast|grill|bbq/.test(name)) score += 2;
    return score;
  }

  if (bias === 'upscale') {
    // Prefer higher price levels and upscale keywords
    let score = priceLevel; // 4 = best
    if (/bistro|steakhouse|prime|fine|chef|reserve|vineyard|rooftop/.test(name)) score += 2;
    return score;
  }

  return 0;
}

module.exports = { findDining, isTight, scheduleTradeoff, describeDetour, applyFoodBiasRanking };
