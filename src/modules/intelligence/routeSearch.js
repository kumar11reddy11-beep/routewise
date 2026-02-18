'use strict';

const maps   = require('../../services/maps');
const logger = require('../../utils/logger');

/**
 * RouteWise Route-Aware Search Corridor (PRD Section 8.1)
 *
 * Instead of searching by proximity alone, RouteWise searches within a corridor
 * along the family's current route to their next destination. Each result is
 * filtered by detour budget (default 20 min round-trip) so only genuinely
 * convenient stops are surfaced.
 *
 * Search flow:
 *   1. Get route waypoints from Google Directions API
 *   2. Search for places of `type` near each waypoint
 *   3. De-duplicate results
 *   4. Estimate detour time for each candidate
 *   5. Filter to those within detour budget
 *   6. Sort by (detourMinutes ASC, rating DESC)
 */

/**
 * Build a Google Maps navigation deep link.
 *
 * @param {number} destLat
 * @param {number} destLon
 * @returns {string} e.g. "https://www.google.com/maps/dir/?api=1&destination=42.1,-124.3"
 */
function buildMapsLink(destLat, destLon) {
  return `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLon}`;
}

/**
 * Extract a set of sample waypoints from a Google Directions API response.
 * We decode the encoded polyline by sampling step end-points — no external
 * polyline library needed. Steps give us ~2–10 km resolution which is plenty
 * for a 5000 m search radius.
 *
 * @param {object} directionsData - Raw Google Directions API response
 * @returns {Array<{lat: number, lon: number}>}
 */
function extractWaypoints(directionsData) {
  const waypoints = [];
  const routes = directionsData.routes || [];
  if (!routes.length) return waypoints;

  const legs = routes[0].legs || [];
  for (const leg of legs) {
    // Add each step's end location as a waypoint candidate
    for (const step of (leg.steps || [])) {
      if (step.end_location) {
        waypoints.push({ lat: step.end_location.lat, lon: step.end_location.lng });
      }
    }
  }
  return waypoints;
}

/**
 * Estimate round-trip detour time in minutes to visit a stop en route.
 *
 * Formula: detour = (currentToStop + stopToDest) - directTime
 * This gives the *extra* minutes added to the trip by visiting the stop.
 *
 * @param {number} currentLat
 * @param {number} currentLon
 * @param {number} stopLat
 * @param {number} stopLon
 * @param {number} destLat
 * @param {number} destLon
 * @returns {Promise<number>} Detour in minutes (can be negative if stop is on-route)
 */
async function estimateDetour(currentLat, currentLon, stopLat, stopLon, destLat, destLon) {
  // Run the three legs in parallel for speed
  const [directData, toStopData, fromStopData] = await Promise.all([
    maps.directions(currentLat, currentLon, destLat, destLon),
    maps.directions(currentLat, currentLon, stopLat, stopLon),
    maps.directions(stopLat, stopLon, destLat, destLon),
  ]);

  function legSeconds(data) {
    const leg = data?.routes?.[0]?.legs?.[0];
    if (!leg) return null;
    // Prefer traffic-aware duration
    return (leg.duration_in_traffic?.value) ?? leg.duration?.value ?? null;
  }

  const directSec   = legSeconds(directData);
  const toStopSec   = legSeconds(toStopData);
  const fromStopSec = legSeconds(fromStopData);

  if (directSec == null || toStopSec == null || fromStopSec == null) {
    throw new Error('Could not retrieve route durations from Google Directions API');
  }

  const detourSeconds = (toStopSec + fromStopSec) - directSec;
  return Math.round(detourSeconds / 60);
}

/**
 * Search for places of a given type along the route corridor from origin to destination.
 *
 * @param {number} originLat
 * @param {number} originLon
 * @param {number} destLat
 * @param {number} destLon
 * @param {string} type                  - Google Place type (e.g. 'restaurant', 'gas_station')
 * @param {number} [detourBudgetMinutes=20] - Max acceptable detour in minutes (round-trip)
 * @param {string} [keyword='']          - Optional keyword filter (e.g. 'pizza')
 * @returns {Promise<Array<{name, rating, address, lat, lon, detourMinutes, mapsLink}>>}
 */
async function searchAlongRoute(originLat, originLon, destLat, destLon, type, detourBudgetMinutes = 20, keyword = '') {
  logger.info(`Route search: type=${type} keyword="${keyword}" detourBudget=${detourBudgetMinutes}min`);

  // Step 1: Get route from Google Directions
  let directionsData;
  try {
    directionsData = await maps.directions(originLat, originLon, destLat, destLon);
  } catch (err) {
    logger.error('Directions API failed:', err.message);
    throw new Error(`Could not retrieve route: ${err.message}`);
  }

  if (!directionsData.routes || !directionsData.routes.length) {
    logger.warn('No routes found for corridor search');
    return [];
  }

  // Step 2: Extract waypoints along the route (step end-points)
  const waypoints = extractWaypoints(directionsData);
  // Always include origin and destination as search centres
  waypoints.unshift({ lat: originLat, lon: originLon });
  waypoints.push({ lat: destLat, lon: destLon });

  // Sample every Nth waypoint to avoid too many API calls
  // For short routes (< 10 steps) use all; otherwise sample ~5 points
  const stride = Math.max(1, Math.floor(waypoints.length / 5));
  const samplePoints = waypoints.filter((_, i) => i % stride === 0);

  logger.debug(`Searching ${samplePoints.length} waypoints along route`);

  // Step 3: Search for places near each waypoint (5 km radius)
  const seen    = new Set();
  const rawHits = [];

  for (const wp of samplePoints) {
    try {
      const results = await maps.places(keyword, wp.lat, wp.lon, 5000, type);
      for (const place of results) {
        const id = place.place_id;
        if (!seen.has(id)) {
          seen.add(id);
          rawHits.push(place);
        }
      }
    } catch (err) {
      logger.warn(`Places search failed near (${wp.lat},${wp.lon}): ${err.message}`);
    }
  }

  logger.info(`Found ${rawHits.length} unique candidates for type=${type}`);

  if (!rawHits.length) return [];

  // Step 4: Estimate detour for each candidate in parallel (cap at 10 to avoid API flood)
  const candidates = rawHits.slice(0, 12);
  const evaluated  = await Promise.allSettled(
    candidates.map(async place => {
      const lat = place.geometry?.location?.lat;
      const lon = place.geometry?.location?.lng;
      if (lat == null || lon == null) return null;

      try {
        const detourMinutes = await estimateDetour(
          originLat, originLon, lat, lon, destLat, destLon
        );
        return {
          name:         place.name,
          rating:       place.rating || null,
          address:      place.vicinity || place.formatted_address || '',
          lat,
          lon,
          detourMinutes,
          mapsLink:     buildMapsLink(lat, lon),
          isOpen:       place.opening_hours?.open_now ?? null,
          priceLevel:   place.price_level ?? null,
        };
      } catch (err) {
        logger.debug(`Detour estimate failed for ${place.name}: ${err.message}`);
        return null;
      }
    })
  );

  // Step 5: Filter by detour budget and sort
  const results = evaluated
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value)
    .filter(r => r.detourMinutes <= detourBudgetMinutes)
    .sort((a, b) => {
      // Primary: detour time (ascending)
      if (a.detourMinutes !== b.detourMinutes) return a.detourMinutes - b.detourMinutes;
      // Secondary: rating (descending)
      return (b.rating || 0) - (a.rating || 0);
    });

  logger.info(`${results.length} results within ${detourBudgetMinutes}min detour budget`);
  return results;
}

module.exports = { searchAlongRoute, buildMapsLink, estimateDetour, extractWaypoints };
