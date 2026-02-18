'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * RouteWise Hotels Service
 * Searches hotels via Booking.com API (RapidAPI).
 * Used by Milestone 3+ (hotel suggestions, next-day positioning).
 * 
 * Search priority: Booking.com → Priceline → Google Places (fallback)
 */

const BOOKING_HOST = 'booking-com.p.rapidapi.com';
const BASE_URL = `https://${BOOKING_HOST}`;

function rapidApiHeaders(host = BOOKING_HOST) {
  return {
    'X-RapidAPI-Key': config.rapidApi.key,
    'X-RapidAPI-Host': host,
  };
}

/**
 * Search for hotels at a destination for given dates.
 * @param {object} params
 * @param {string} params.destination - City or area name
 * @param {string} params.checkIn - YYYY-MM-DD
 * @param {string} params.checkOut - YYYY-MM-DD
 * @param {number} [params.adults] - Number of adults (default: 2)
 * @param {number} [params.maxPrice] - Max price per night in USD
 * @param {number} [params.minPrice] - Min price per night in USD
 * @returns {Promise<object[]>} Array of hotel options
 */
async function searchHotels({ destination, checkIn, checkOut, adults = 2, maxPrice, minPrice }) {
  logger.info(`Searching hotels in ${destination} (${checkIn} to ${checkOut})`);

  // Step 1: Geocode the destination via Booking.com
  const locationRes = await axios.get(`${BASE_URL}/v1/hotels/locations`, {
    params: { name: destination, locale: 'en-gb' },
    headers: rapidApiHeaders(),
  });

  const locations = locationRes.data;
  if (!locations || !locations.length) {
    logger.warn(`No Booking.com location found for: ${destination}`);
    return [];
  }

  const destId = locations[0].dest_id;
  const destType = locations[0].dest_type;

  // Step 2: Search hotels at that location
  const searchParams = {
    dest_id: destId,
    dest_type: destType,
    checkin_date: checkIn,
    checkout_date: checkOut,
    adults_number: adults,
    room_number: 1,
    order_by: 'popularity',
    locale: 'en-gb',
    currency: 'USD',
    units: 'metric',
    filter_by_currency: 'USD',
  };

  if (maxPrice) searchParams.price_filter_currencycode = 'USD';

  const hotelsRes = await axios.get(`${BASE_URL}/v1/hotels/search`, {
    params: searchParams,
    headers: rapidApiHeaders(),
  });

  let hotels = hotelsRes.data?.result || [];

  // Filter by price range if provided
  if (maxPrice || minPrice) {
    hotels = hotels.filter(h => {
      const price = h.min_total_price || h.price_breakdown?.gross_price || 0;
      const pricePerNight = price;
      if (minPrice && pricePerNight < minPrice) return false;
      if (maxPrice && pricePerNight > maxPrice) return false;
      return true;
    });
  }

  // Return top 5 normalized results
  return hotels.slice(0, 5).map(h => ({
    name: h.hotel_name,
    rating: h.review_score,
    reviewCount: h.review_nr,
    pricePerNight: h.min_total_price || h.price_breakdown?.gross_price,
    currency: 'USD',
    address: h.address,
    city: h.city,
    lat: h.latitude,
    lng: h.longitude,
    bookingUrl: `https://www.booking.com/hotel/${h.countrycode}/${h.url}.html`,
    hotelId: h.hotel_id,
  }));
}

module.exports = { searchHotels };
