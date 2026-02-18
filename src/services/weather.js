'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * RouteWise Weather Service
 *
 * Wraps WeatherAPI.com for current conditions, forecasts, and
 * astronomy data (sunrise, sunset, golden hour).
 *
 * M2 additions: current(lat, lon) and forecast(lat, lon, days)
 * with consistent return shapes consumed by the tracking/weather module.
 */

const BASE_URL = 'https://api.weatherapi.com/v1';

function apiKey() {
  return config.weather.apiKey;
}

// ─────────────────────────────────────────────────────────────────────────────
// M2 additions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get current weather for a lat/lon position.
 * Returns the raw WeatherAPI current-weather object.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<object>} Raw WeatherAPI current weather response
 */
async function current(lat, lon) {
  const q = `${lat},${lon}`;
  const res = await axios.get(`${BASE_URL}/current.json`, {
    params: { key: apiKey(), q, aqi: 'no' },
  });
  logger.debug(`Current weather fetched for: ${q}`);
  return res.data;
}

/**
 * Get forecast including astronomy (sunset, sunrise) for a lat/lon.
 * Needed by the tracking/weather module for golden hour calculation.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} [days=1] - Forecast days (1–3)
 * @returns {Promise<object>} Raw WeatherAPI forecast response
 */
async function forecast(lat, lon, days = 1) {
  const q = `${lat},${lon}`;
  const res = await axios.get(`${BASE_URL}/forecast.json`, {
    params: { key: apiKey(), q, days, aqi: 'no', alerts: 'yes' },
  });
  logger.debug(`Forecast (${days}d) + astronomy fetched for: ${q}`);
  return res.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// M1 originals — kept for backwards compatibility
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get current weather conditions for a location.
 * @param {string} location - City name, US zip, or "lat,lng"
 * @returns {Promise<object>} WeatherAPI current weather object
 */
async function getCurrent(location) {
  const res = await axios.get(`${BASE_URL}/current.json`, {
    params: { key: apiKey(), q: location },
  });
  logger.debug(`Current weather fetched for: ${location}`);
  return res.data;
}

/**
 * Get forecast for up to 3 days ahead.
 * @param {string} location
 * @param {number} [days=1] - 1–3
 * @returns {Promise<object>} WeatherAPI forecast object
 */
async function getForecast(location, days = 1) {
  const res = await axios.get(`${BASE_URL}/forecast.json`, {
    params: { key: apiKey(), q: location, days, aqi: 'no', alerts: 'yes' },
  });
  logger.debug(`Forecast (${days}d) fetched for: ${location}`);
  return res.data;
}

/**
 * Get astronomy data (sunrise, sunset, moon phase) for a location and date.
 * @param {string} location
 * @param {string} [date] - YYYY-MM-DD format, defaults to today
 * @returns {Promise<object>} WeatherAPI astronomy object
 */
async function getAstronomy(location, date) {
  const dt = date || new Date().toISOString().split('T')[0];
  const res = await axios.get(`${BASE_URL}/astronomy.json`, {
    params: { key: apiKey(), q: location, dt },
  });
  logger.debug(`Astronomy data fetched for: ${location} on ${dt}`);
  return res.data.astronomy?.astro || {};
}

/**
 * Calculate golden hour start time (~45 min before sunset).
 * @param {string} sunsetTime - Time string like "7:15 PM"
 * @returns {string} Golden hour start time string
 */
function goldenHourStart(sunsetTime) {
  try {
    const [time, period] = sunsetTime.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    const totalMinutes = hours * 60 + minutes - 45;
    const gh = new Date();
    gh.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
    return gh.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return 'Unknown';
  }
}

module.exports = {
  // M2
  current,
  forecast,
  // M1 originals
  getCurrent,
  getForecast,
  getAstronomy,
  goldenHourStart,
};
