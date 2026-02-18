'use strict';

const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');
const { formatDuration, formatDistance } = require('../../utils/geo');

/**
 * RouteWise ETA Calculator
 *
 * Uses Google Maps Directions API for real-time ETA with traffic,
 * and Geocoding API for reverse geocoding of current location.
 */

const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const GEOCODE_URL    = 'https://maps.googleapis.com/maps/api/geocode/json';

function apiKey() {
  return config.googleMaps.apiKey;
}

/**
 * Calculate ETA from an origin to a destination.
 *
 * @param {number} originLat
 * @param {number} originLon
 * @param {number} destLat
 * @param {number} destLon
 * @returns {Promise<{durationSeconds, durationText, distanceMeters, distanceText, arrivalTime}>}
 */
async function calculateETA(originLat, originLon, destLat, destLon) {
  logger.debug(`Calculating ETA: (${originLat},${originLon}) → (${destLat},${destLon})`);

  const res = await axios.get(DIRECTIONS_URL, {
    params: {
      origin:       `${originLat},${originLon}`,
      destination:  `${destLat},${destLon}`,
      key:          apiKey(),
      departure_time: 'now',
      traffic_model:  'best_guess',
    },
  });

  const data = res.data;
  if (!data.routes || data.routes.length === 0) {
    throw new Error(`No route found (status: ${data.status})`);
  }

  const leg = data.routes[0].legs[0];

  // Prefer traffic-aware duration when available
  const durationSeconds = (leg.duration_in_traffic?.value) || leg.duration.value;
  const distMeters      = leg.distance.value;
  const arrivalTime     = new Date(Date.now() + durationSeconds * 1000);

  return {
    durationSeconds,
    durationText:  formatDuration(durationSeconds),
    distanceMeters: distMeters,
    distanceText:  formatDistance(distMeters),
    arrivalTime,
  };
}

/**
 * Calculate ETAs for all pending activities in the itinerary.
 * Activities without coordinates are skipped.
 *
 * @param {number} currentLat
 * @param {number} currentLon
 * @param {object[]} itinerary - Array of day objects from tripState
 * @returns {Promise<Array<{activityId, activityName, scheduledTime, estimatedArrival, driftMinutes}>>}
 */
async function calculateETAsForItinerary(currentLat, currentLon, itinerary) {
  const results = [];

  for (const day of (itinerary || [])) {
    for (const activity of (day.activities || [])) {
      // Skip completed activities or those without coordinates
      if (!activity.lat || !activity.lon) continue;
      if (activity.state === 'completed') continue;

      try {
        const eta = await calculateETA(currentLat, currentLon, activity.lat, activity.lon);

        const scheduledDate = activity.scheduledTime ? new Date(activity.scheduledTime) : null;
        const driftMinutes = scheduledDate
          ? Math.round((eta.arrivalTime.getTime() - scheduledDate.getTime()) / 60000)
          : null;

        results.push({
          activityId:      activity.id || activity.description,
          activityName:    activity.name || activity.description,
          scheduledTime:   scheduledDate?.toISOString() || null,
          estimatedArrival: eta.arrivalTime.toISOString(),
          durationText:    eta.durationText,
          distanceText:    eta.distanceText,
          driftMinutes,
        });
      } catch (err) {
        logger.warn(`ETA failed for "${activity.name || activity.description}": ${err.message}`);
      }
    }
  }

  return results;
}

/**
 * Reverse geocode a lat/lon pair to a human-readable address.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<string>} Formatted address, or "lat, lon" on failure
 */
async function geocodeLocation(lat, lon) {
  logger.debug(`Reverse geocoding: (${lat}, ${lon})`);

  const res = await axios.get(GEOCODE_URL, {
    params: { latlng: `${lat},${lon}`, key: apiKey() },
  });

  const results = res.data.results;
  if (!results || results.length === 0) {
    return `${lat}, ${lon}`;
  }

  return results[0].formatted_address;
}

module.exports = { calculateETA, calculateETAsForItinerary, geocodeLocation };
