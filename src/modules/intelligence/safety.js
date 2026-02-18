'use strict';

const maps   = require('../../services/maps');
const logger = require('../../utils/logger');

/**
 * RouteWise Safety Intelligence (PRD Section 8.8)
 *
 * In remote areas (common on the West Coast), RouteWise can surface the
 * nearest hospital or emergency room on request.
 *
 * Dona does NOT proactively message about hospitals unless specifically asked.
 */

const METERS_PER_MILE = 1609.344;

/**
 * Calculate straight-line distance in miles between two lat/lon pairs.
 * Used for the distance display in the result (actual road distance would
 * require an extra API call; straight-line is a reasonable approximation).
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Miles
 */
function haversineMiles(lat1, lon1, lat2, lon2) {
  const EARTH_RADIUS_MILES = 3958.8;
  const toRad = d => (d * Math.PI) / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLon  = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find the nearest hospital or emergency room to the given coordinates.
 *
 * Uses the Google Places nearbysearch API with type=hospital, searching
 * progressively larger radii until a result is found.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{
 *   name: string,
 *   address: string,
 *   distanceMiles: number,
 *   phone: string|null,
 *   mapsLink: string
 * }>}
 */
async function findNearestHospital(lat, lon) {
  logger.info(`Safety search: nearest hospital to (${lat}, ${lon})`);

  // Try progressively larger radii: 5 km → 20 km → 50 km
  const radii = [5000, 20000, 50000];
  let results = [];

  for (const radius of radii) {
    try {
      results = await maps.places('hospital emergency room', lat, lon, radius, 'hospital');
      if (results.length) break;
    } catch (err) {
      logger.warn(`Hospital search at r=${radius}m failed: ${err.message}`);
    }
  }

  if (!results.length) {
    return {
      name:          'No hospital found',
      address:       'Could not locate a nearby hospital. Call 911 in an emergency.',
      distanceMiles: null,
      phone:         '911',
      mapsLink:      null,
      formatted: '🚨 Could not find a nearby hospital. In an emergency, call 911.',
    };
  }

  // Take the nearest (Places nearbysearch returns in proximity order)
  const hospital = results[0];
  const hLat     = hospital.geometry?.location?.lat;
  const hLon     = hospital.geometry?.location?.lng;
  const distMiles = hLat != null
    ? Math.round(haversineMiles(lat, lon, hLat, hLon) * 10) / 10
    : null;

  const mapsLink = hLat != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${hLat},${hLon}`
    : null;

  // Phone number — Places nearbysearch doesn't always include this;
  // it requires a Place Details call. We surface what we have.
  const phone = hospital.formatted_phone_number || null;

  const result = {
    name:         hospital.name,
    address:      hospital.vicinity || hospital.formatted_address || '',
    distanceMiles: distMiles,
    phone,
    mapsLink,
  };

  // Format for Telegram
  const distStr = distMiles != null ? `${distMiles} mi away` : '';
  const lines = [
    `🏥 Nearest hospital:`,
    `${hospital.name}`,
    hospital.vicinity ? `📍 ${hospital.vicinity}` : '',
    distStr,
    phone ? `📞 ${phone}` : '',
    mapsLink ? `🗺️ ${mapsLink}` : '',
  ].filter(Boolean);

  result.formatted = lines.join('\n');

  return result;
}

module.exports = { findNearestHospital, haversineMiles };
