'use strict';

/**
 * RouteWise Geospatial Utilities
 * Haversine distance, radius checks, and human-readable formatters.
 */

const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculate great-circle distance between two lat/lon points using the Haversine formula.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in meters
 */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Check whether two coordinates are within a given radius.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @param {number} radiusMeters
 * @returns {boolean}
 */
function isWithinRadius(lat1, lon1, lat2, lon2, radiusMeters) {
  return distanceMeters(lat1, lon1, lat2, lon2) <= radiusMeters;
}

/**
 * Format a distance in meters as a human-readable miles string.
 * @param {number} meters
 * @returns {string} e.g. "0.3 mi" or "1.2 mi"
 */
function formatDistance(meters) {
  const miles = meters / 1609.344;
  return `${miles.toFixed(1)} mi`;
}

/**
 * Format a duration in seconds as a human-readable string.
 * @param {number} seconds
 * @returns {string} e.g. "23 min" or "1 hr 15 min"
 */
function formatDuration(seconds) {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

module.exports = { distanceMeters, isWithinRadius, formatDistance, formatDuration };
