'use strict';

const https  = require('https');
const zlib   = require('zlib');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * RouteWise Hotels Service
 *
 * Searches hotels via Booking.com API (apidojo-booking-v1.p.rapidapi.com).
 * Uses native HTTPS with gzip handling to match the tested hotel-search.js pattern.
 *
 * Flow:
 *   1. autocomplete(query)      → get lat/lon + dest_id for a location string
 *   2. searchByBbox(bbox, ...)  → list hotels within bounding box
 */

const BOOKING_HOST = 'apidojo-booking-v1.p.rapidapi.com';

/**
 * Make an HTTPS GET request to the Booking.com RapidAPI endpoint,
 * handling gzip decompression transparently.
 *
 * @param {string} path - URL path including query string
 * @returns {Promise<any>} Parsed JSON response
 */
function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BOOKING_HOST,
      path,
      method:   'GET',
      headers: {
        'X-RapidAPI-Key':  config.rapidApi.key,
        'X-RapidAPI-Host': BOOKING_HOST,
        'Accept-Encoding': 'gzip, deflate',
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      const stream = res.headers['content-encoding'] === 'gzip'
        ? res.pipe(zlib.createGunzip())
        : res;

      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error(`Booking.com parse error: ${e.message} | body: ${raw.slice(0, 200)}`));
        }
      });
      stream.on('error', reject);
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Autocomplete a location name to get coordinates and Booking.com dest_id.
 *
 * @param {string} query - City or area name (e.g. "Gold Beach, Oregon")
 * @returns {Promise<Array<{label, dest_id, dest_type, latitude, longitude}>>}
 */
async function autocomplete(query) {
  logger.info(`Booking.com autocomplete: "${query}"`);
  const path = `/locations/auto-complete?text=${encodeURIComponent(query)}&languagecode=en-us`;
  const results = await makeRequest(path);
  // API returns an array of location candidates
  return Array.isArray(results) ? results : [];
}

/**
 * Search hotels within a geographic bounding box for given dates.
 *
 * @param {string} bbox         - "minLat,minLon,maxLat,maxLon"
 * @param {string} checkIn      - YYYY-MM-DD
 * @param {string} checkOut     - YYYY-MM-DD
 * @param {number} [guests=2]   - Number of guests
 * @returns {Promise<object>}   Raw API response (has .result array)
 */
async function searchByBbox(bbox, checkIn, checkOut, guests = 2) {
  logger.info(`Booking.com searchByBbox: bbox=${bbox} ${checkIn}→${checkOut} guests=${guests}`);
  const params = new URLSearchParams({
    arrival_date:             checkIn,
    departure_date:           checkOut,
    room_qty:                 1,
    guest_qty:                guests,
    bbox,
    search_id:                'none',
    price_filter_currencycode: 'USD',
    languagecode:             'en-us',
    travel_purpose:           'leisure',
    order_by:                 'popularity',
    offset:                   0,
  });

  const path = `/properties/list-by-map?${params.toString()}`;
  return makeRequest(path);
}

/**
 * Build a bounding box string around a lat/lon point with a given radius.
 *
 * @param {number} lat       - Center latitude
 * @param {number} lon       - Center longitude
 * @param {number} radiusKm  - Search radius in kilometers
 * @returns {string}         "minLat,minLon,maxLat,maxLon"
 */
function createBoundingBox(lat, lon, radiusKm = 10) {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
  return `${lat - latDelta},${lon - lonDelta},${lat + latDelta},${lon + lonDelta}`;
}

/**
 * High-level hotel search: find hotels near a lat/lon, filtered by price.
 *
 * @param {object} params
 * @param {number} params.lat      - Center latitude
 * @param {number} params.lon      - Center longitude
 * @param {string} params.checkIn  - YYYY-MM-DD
 * @param {string} params.checkOut - YYYY-MM-DD
 * @param {number} [params.guests=2]
 * @param {number} [params.radiusKm=10]
 * @param {number} [params.minPrice]
 * @param {number} [params.maxPrice]
 * @returns {Promise<Array<{name, stars, rating, pricePerNight, lat, lon, address, bookingLink}>>}
 */
async function searchNear({ lat, lon, checkIn, checkOut, guests = 2, radiusKm = 10, minPrice, maxPrice }) {
  const bbox = createBoundingBox(lat, lon, radiusKm);
  const data = await searchByBbox(bbox, checkIn, checkOut, guests);

  let hotels = data.result || [];

  // Filter by price range if provided
  if (minPrice != null || maxPrice != null) {
    hotels = hotels.filter(h => {
      const price = h.price_breakdown?.gross_price ?? h.min_total_price ?? 0;
      if (minPrice != null && price < minPrice) return false;
      if (maxPrice != null && price > maxPrice) return false;
      return true;
    });
  }

  // Normalize to a consistent shape
  return hotels.slice(0, 10).map(h => ({
    name:         h.hotel_name || 'Unknown Hotel',
    stars:        h.class     || null,
    rating:       h.review_score ? parseFloat(h.review_score) : null,
    reviewWord:   h.review_score_word || '',
    pricePerNight: h.price_breakdown?.gross_price ?? h.min_total_price ?? null,
    currency:     h.price_breakdown?.currency || 'USD',
    lat:          h.latitude  || null,
    lon:          h.longitude || null,
    address:      h.address   || h.city || '',
    bookingLink:  h.url ? `https://www.booking.com${h.url}` : null,
    hotelId:      h.hotel_id  || null,
  }));
}

module.exports = { autocomplete, searchByBbox, searchNear, createBoundingBox };
