'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * RouteWise Google Maps Service
 *
 * Wraps Google Maps Platform APIs:
 *   - Directions API  (ETA, routing)
 *   - Geocoding API   (address ↔ coordinates)
 *   - Places API      (nearby search — M3)
 *   - Distance Matrix (multi-destination comparison — M3)
 */

const BASE_URL = 'https://maps.googleapis.com/maps/api';

function apiKey() {
  return config.googleMaps.apiKey;
}

// ─────────────────────────────────────────────────────────────────────────────
// M2 additions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw Directions API response for two lat/lon pairs.
 * Includes traffic-aware duration via departure_time=now.
 *
 * @param {number} originLat
 * @param {number} originLon
 * @param {number} destLat
 * @param {number} destLon
 * @returns {Promise<object>} Full Google Directions API JSON response
 */
async function directions(originLat, originLon, destLat, destLon) {
  const res = await axios.get(`${BASE_URL}/directions/json`, {
    params: {
      origin:         `${originLat},${originLon}`,
      destination:    `${destLat},${destLon}`,
      mode:           'driving',
      key:            apiKey(),
      departure_time: 'now',
      traffic_model:  'best_guess',
    },
  });
  logger.debug(`Directions: (${originLat},${originLon}) → (${destLat},${destLon})`);
  return res.data;
}

/**
 * Raw Geocoding API response for a lat/lon pair (reverse geocoding).
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<object>} Full Google Geocoding API JSON response
 */
async function reverseGeocode(lat, lon) {
  const res = await axios.get(`${BASE_URL}/geocode/json`, {
    params: { latlng: `${lat},${lon}`, key: apiKey() },
  });
  logger.debug(`Reverse geocode: (${lat}, ${lon})`);
  return res.data;
}

/**
 * Places API search — stub for M3. Returns empty array until implemented.
 *
 * @param {string} query     - Search keyword (e.g. "pizza", "gas station")
 * @param {number} lat       - Center latitude
 * @param {number} lon       - Center longitude
 * @param {number} [radiusMeters=5000] - Search radius
 * @returns {Promise<object[]>} Place results (M3 implementation)
 */
async function places(query, lat, lon, radiusMeters = 5000) {
  // M3 stub — full implementation in Milestone 3 (route-aware search)
  logger.debug(`Places search (M3 stub): "${query}" near (${lat},${lon}) r=${radiusMeters}m`);
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// M1 originals — kept for backwards compatibility
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate driving directions between two points (address or lat,lng string).
 * @param {string} origin - Address or "lat,lng"
 * @param {string} destination - Address or "lat,lng"
 * @returns {Promise<object>} Google Directions API response
 */
async function getDirections(origin, destination) {
  const res = await axios.get(`${BASE_URL}/directions/json`, {
    params: { origin, destination, mode: 'driving', key: apiKey() },
  });
  logger.debug(`Directions: ${origin} → ${destination}`);
  return res.data;
}

/**
 * Search for nearby places of a given type.
 * @param {string} location - "lat,lng" for center of search
 * @param {string} type - Place type (restaurant, gas_station, lodging, etc.)
 * @param {number} [radiusMeters=5000] - Search radius
 * @param {string} [keyword] - Optional keyword
 * @returns {Promise<object[]>}
 */
async function searchNearby(location, type, radiusMeters = 5000, keyword = '') {
  const params = { location, radius: radiusMeters, type, key: apiKey() };
  if (keyword) params.keyword = keyword;

  const res = await axios.get(`${BASE_URL}/place/nearbysearch/json`, { params });
  logger.debug(`Nearby search: type=${type} near ${location}`);
  return res.data.results || [];
}

/**
 * Compare driving times from one origin to multiple destinations.
 * @param {string} origin - "lat,lng" or address
 * @param {string[]} destinations - Array of addresses or "lat,lng" strings
 * @returns {Promise<object>} Distance Matrix API response
 */
async function getDistanceMatrix(origin, destinations) {
  const res = await axios.get(`${BASE_URL}/distancematrix/json`, {
    params: {
      origins:      origin,
      destinations: destinations.join('|'),
      mode:         'driving',
      key:          apiKey(),
    },
  });
  logger.debug(`Distance matrix: ${origin} → ${destinations.length} destinations`);
  return res.data;
}

/**
 * Geocode an address to lat/lng coordinates.
 * @param {string} address
 * @returns {Promise<{lat: number, lng: number}|null>}
 */
async function geocode(address) {
  const res = await axios.get(`${BASE_URL}/geocode/json`, {
    params: { address, key: apiKey() },
  });
  const results = res.data.results;
  if (!results || !results.length) return null;
  return results[0].geometry.location;
}

/**
 * Build a Google Maps navigation deep link for a destination.
 * @param {number} lat
 * @param {number} lng
 * @returns {string} Google Maps URL
 */
function buildMapsLink(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

module.exports = {
  // M2
  directions,
  reverseGeocode,
  places,
  // M1 originals
  getDirections,
  searchNearby,
  getDistanceMatrix,
  geocode,
  buildMapsLink,
};
