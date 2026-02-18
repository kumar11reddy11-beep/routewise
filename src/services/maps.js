'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * RouteWise Google Maps Service
 *
 * Wraps Google Maps Platform APIs:
 *   - Directions API  (ETA, routing, route waypoints)
 *   - Geocoding API   (address ↔ coordinates)
 *   - Places API      (nearby search — M3)
 *   - Distance Matrix (multi-destination comparison — M3)
 */

const BASE_URL = 'https://maps.googleapis.com/maps/api';

function apiKey() {
  return config.googleMaps.apiKey;
}

// ─────────────────────────────────────────────────────────────────────────────
// M2 additions (retained + enhanced for M3)
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
 * Google Places Nearby Search API.
 * Searches for places of a given type (or matching a keyword) within a radius.
 *
 * @param {string} query       - Search keyword (e.g. "pizza", "gas station")
 * @param {number} lat         - Center latitude
 * @param {number} lon         - Center longitude
 * @param {number} [radiusMeters=5000] - Search radius in meters (max 50000)
 * @param {string} [type]      - Google place type (e.g. "restaurant", "gas_station", "hospital")
 * @returns {Promise<object[]>} Array of Google Places results
 */
async function places(query, lat, lon, radiusMeters = 5000, type = null) {
  const params = {
    location: `${lat},${lon}`,
    radius:   radiusMeters,
    key:      apiKey(),
  };

  if (type)  params.type    = type;
  if (query) params.keyword = query;

  const res = await axios.get(`${BASE_URL}/place/nearbysearch/json`, { params });
  logger.debug(`Places: "${query}" (type=${type}) near (${lat},${lon}) r=${radiusMeters}m → ${(res.data.results || []).length} results`);
  return res.data.results || [];
}

/**
 * Distance Matrix API — compare drive times from one origin to multiple destinations.
 * Returns raw API response.
 *
 * @param {number} originLat
 * @param {number} originLon
 * @param {Array<{lat: number, lon: number}>} destinations
 * @returns {Promise<object>} Full Distance Matrix API JSON response
 */
async function distanceMatrix(originLat, originLon, destinations) {
  const destStrings = destinations.map(d => `${d.lat},${d.lon}`);
  const res = await axios.get(`${BASE_URL}/distancematrix/json`, {
    params: {
      origins:      `${originLat},${originLon}`,
      destinations: destStrings.join('|'),
      mode:         'driving',
      key:          apiKey(),
      departure_time: 'now',
      traffic_model:  'best_guess',
    },
  });
  logger.debug(`Distance matrix: (${originLat},${originLon}) → ${destinations.length} destinations`);
  return res.data;
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
 * Search for nearby places of a given type (M1 version — simpler interface).
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
 * Compare driving times from one origin to multiple destinations (M1 version).
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
  // M3
  directions,
  reverseGeocode,
  places,
  distanceMatrix,
  // M1 originals
  getDirections,
  searchNearby,
  getDistanceMatrix,
  geocode,
  buildMapsLink,
};
