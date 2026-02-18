'use strict';

const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');

/**
 * RouteWise Weather Module
 *
 * Fetches current weather, forecasts, and astronomy data (sunset / golden hour)
 * via WeatherAPI.com.
 *
 * Golden hour window per PRD Section 8.5:
 *   goldenHourStart = sunset − 60 minutes
 *   goldenHourEnd   = sunset − 10 minutes
 */

const BASE_URL = 'https://api.weatherapi.com/v1';

function apiKey() {
  return config.weather.apiKey;
}

/**
 * Parse a "12-hour time" string like "7:42 PM" into a Date object (today's date).
 * @param {string} timeStr
 * @returns {Date}
 */
function parseWeatherTime(timeStr) {
  const [time, period] = timeStr.trim().split(' ');
  let [h, m] = time.split(':').map(Number);
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Format a Date as "h:mm AM/PM".
 * @param {Date} d
 * @returns {string}
 */
function fmtTime(d) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Get current weather at a lat/lon position.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{condition, tempF, tempC, humidity, windMph, forecast}>}
 */
async function getWeather(lat, lon) {
  const q = `${lat},${lon}`;
  logger.debug(`Fetching current weather for: ${q}`);

  const res = await axios.get(`${BASE_URL}/current.json`, {
    params: { key: apiKey(), q, aqi: 'no' },
  });

  const { current } = res.data;
  return {
    condition: current.condition.text,
    tempF:     current.temp_f,
    tempC:     current.temp_c,
    humidity:  current.humidity,
    windMph:   current.wind_mph,
    forecast:  null, // Current-only call; use getSunsetInfo for forecast data
  };
}

/**
 * Get sunset and golden hour times for a lat/lon and date.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {Date|string|null} date - Date object, "YYYY-MM-DD" string, or null for today
 * @returns {Promise<{sunrise, sunset, goldenHourStart, goldenHourEnd}>}
 */
async function getSunsetInfo(lat, lon, date = null) {
  const q = `${lat},${lon}`;
  const dt = date instanceof Date
    ? date.toISOString().split('T')[0]
    : (date || new Date().toISOString().split('T')[0]);

  logger.debug(`Fetching sunset info for: ${q} on ${dt}`);

  const res = await axios.get(`${BASE_URL}/forecast.json`, {
    params: { key: apiKey(), q, days: 1, aqi: 'no', alerts: 'no', dt },
  });

  const astro = res.data.forecast?.forecastday?.[0]?.astro;
  if (!astro) {
    throw new Error('No astronomy data returned from WeatherAPI');
  }

  const sunset   = parseWeatherTime(astro.sunset);
  const sunrise  = parseWeatherTime(astro.sunrise);

  // Golden hour window: 60 min before sunset → 10 min before sunset
  const goldenHourStart = new Date(sunset.getTime() - 60 * 60 * 1000);
  const goldenHourEnd   = new Date(sunset.getTime() - 10 * 60 * 1000);

  return {
    sunrise:        fmtTime(sunrise),
    sunset:         fmtTime(sunset),
    goldenHourStart: fmtTime(goldenHourStart),
    goldenHourEnd:   fmtTime(goldenHourEnd),
  };
}

/**
 * Get current weather by location name (city name, zip, or "City, State").
 * WeatherAPI.com handles geocoding internally.
 *
 * @param {string} locationName
 * @returns {Promise<{condition, tempF, tempC, humidity, windMph, forecast}>}
 */
async function getWeatherForLocation(locationName) {
  logger.debug(`Fetching weather for location: "${locationName}"`);

  const res = await axios.get(`${BASE_URL}/current.json`, {
    params: { key: apiKey(), q: locationName, aqi: 'no' },
  });

  const { current } = res.data;
  return {
    condition: current.condition.text,
    tempF:     current.temp_f,
    tempC:     current.temp_c,
    humidity:  current.humidity,
    windMph:   current.wind_mph,
    forecast:  null,
  };
}

module.exports = { getWeather, getSunsetInfo, getWeatherForLocation };
