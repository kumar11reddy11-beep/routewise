'use strict';

const routeSearch = require('./routeSearch');
const maps        = require('../../services/maps');
const tripState   = require('../../memory/tripState');
const logger      = require('../../utils/logger');

/**
 * RouteWise Fuel Correlation Intelligence (PRD Section 8.4)
 *
 * Finds gas stations along the route and, where possible, correlates them
 * with other needed stops (food, hotel) to minimise total detours.
 *
 * Key behaviour:
 *   - First tries to find gas stations *near* other needed stops
 *   - If correlation found → flags the combined stop
 *   - If no correlation → finds best on-route gas station independently
 */

/**
 * Estimate distance in miles between two lat/lon pairs (straight-line).
 * Used to detect "nearby" stops for correlation.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Miles
 */
function straightLineMiles(lat1, lon1, lat2, lon2) {
  const EARTH_RADIUS_MILES = 3958.8;
  const toRad = d => (d * Math.PI) / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLon  = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find gas stations on the route, with optional correlation to other needed stops.
 *
 * @param {number}   currentLat
 * @param {number}   currentLon
 * @param {number}   nextDestLat
 * @param {number}   nextDestLon
 * @param {string[]} [otherNeeds=[]]  - e.g. ['food', 'hotel']
 *                                     These are passed as context so correlation note can be added
 * @param {object[]} [nearbyStops=[]] - Array of { name, lat, lon } representing other queued stops
 *                                     (e.g. a dining option the family is considering)
 * @returns {Promise<string>}         Formatted Telegram-ready message
 */
async function findGas(currentLat, currentLon, nextDestLat, nextDestLon, otherNeeds = [], nearbyStops = []) {
  logger.info(`Fuel search: otherNeeds=${JSON.stringify(otherNeeds)} nearbyStops=${nearbyStops.length}`);

  let gasResults = [];
  try {
    gasResults = await routeSearch.searchAlongRoute(
      currentLat, currentLon,
      nextDestLat, nextDestLon,
      'gas_station',
      20,   // 20-min detour budget
      ''    // no keyword filter
    );
  } catch (err) {
    logger.error('Gas route search failed:', err.message);
    return `❌ Couldn't find gas stations right now: ${err.message}`;
  }

  if (!gasResults.length) {
    return '⛽ No gas stations found within a 20-min detour on your route. Keep an eye on the tank.';
  }

  // Cap at 3 options
  const options = gasResults.slice(0, 3);

  // Build correlation map: for each gas station, check if any nearbyStop is within 0.25 miles
  const CORRELATION_MILES = 0.25;
  const correlations = {};
  for (const gas of options) {
    for (const stop of nearbyStops) {
      const dist = straightLineMiles(gas.lat, gas.lon, stop.lat, stop.lon);
      if (dist <= CORRELATION_MILES) {
        correlations[gas.name] = stop.name;
        break;
      }
    }
  }

  // Format message
  const lines = ['⛽ Gas stations on your route:\n'];

  const wantsFood  = otherNeeds.includes('food');
  const wantsHotel = otherNeeds.includes('hotel');

  options.forEach((opt, i) => {
    const ratingStr = opt.rating ? `${opt.rating}★` : '';
    const detourStr = opt.detourMinutes <= 0
      ? 'right on your way'
      : `${opt.detourMinutes} min detour`;

    lines.push(`${i + 1}. ${opt.name}${ratingStr ? ' — ' + ratingStr : ''}`);
    lines.push(`   ${detourStr}`);

    // Correlation note
    if (correlations[opt.name]) {
      const correlated = correlations[opt.name];
      if (wantsFood) {
        lines.push(`   🍕 ${correlated} nearby — knock out gas + food in one stop`);
      } else if (wantsHotel) {
        lines.push(`   🏨 ${correlated} nearby — check in and fill up in one stop`);
      } else {
        lines.push(`   📍 Right next to ${correlated}`);
      }
    }

    lines.push(`   📍 ${opt.mapsLink}`);
    if (i < options.length - 1) lines.push('');
  });

  if (Object.keys(correlations).length === 0 && (wantsFood || wantsHotel)) {
    lines.push('');
    lines.push('💡 No overlapping stops found — you\'ll need separate stops for gas and food/hotel.');
  }

  lines.push('');
  lines.push('Which one?');

  return lines.join('\n');
}

/**
 * Update the trip state with the current estimated fuel level.
 *
 * @param {number} milesRemaining - Estimated miles left in the tank
 * @returns {object} Updated trip state
 */
function updateFuelState(milesRemaining) {
  logger.info(`Updating fuel state: ${milesRemaining} miles remaining`);
  return tripState.set('vehicle.currentFuelMiles', milesRemaining);
}

module.exports = { findGas, updateFuelState, straightLineMiles };
