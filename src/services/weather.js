'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * RouteWise Weather Service
 *
 * Uses Google Weather API (weather.googleapis.com) for current conditions,
 * forecasts, and astronomy data (sunrise, sunset, golden hour).
 *
 * Same Google Maps API key as Directions/Places — no extra key needed.
 *
 * Endpoints:
 *   GET /v1/currentConditions:lookup
 *   GET /v1/forecast/days:lookup
 *   GET /v1/forecast/hours:lookup
 */

const BASE_URL = 'https://weather.googleapis.com/v1';

function apiKey() {
  return config.googleMaps.apiKey;
}

const DEFAULT_PARAMS = {
  unitsSystem: 'IMPERIAL',
  languageCode: 'en-US',
};

/**
 * Format ISO time string to readable "7:15 PM" format in local time.
 * Google Weather API returns times in UTC with timezone offset info in the response.
 */
function formatTime(isoString) {
  if (!isoString) return 'Unknown';
  try {
    // Parse the ISO string — it may include offset (e.g. "2026-02-18T07:15:00-08:00")
    const date = new Date(isoString);
    // If offset is embedded in the string, use it directly
    const hasOffset = /[+-]\d{2}:\d{2}$/.test(isoString);
    if (hasOffset) {
      // Extract offset hours and manually adjust display
      const offsetMatch = isoString.match(/([+-])(\d{2}):(\d{2})$/);
      if (offsetMatch) {
        const sign = offsetMatch[1] === '+' ? 1 : -1;
        const offsetMinutes = sign * (parseInt(offsetMatch[2]) * 60 + parseInt(offsetMatch[3]));
        const localMs = date.getTime() + offsetMinutes * 60 * 1000;
        const localDate = new Date(localMs);
        return localDate.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: 'UTC',
        });
      }
    }
    // Fallback: use system local time
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return isoString;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core — used by tracking/weather module
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get current weather for a lat/lon.
 * Returns normalized object used throughout RouteWise.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<object>}
 */
async function current(lat, lon) {
  const res = await axios.get(`${BASE_URL}/currentConditions:lookup`, {
    params: {
      key: apiKey(),
      'location.latitude': lat,
      'location.longitude': lon,
      ...DEFAULT_PARAMS,
    },
  });
  const d = res.data;
  logger.debug(`Current weather fetched for: ${lat},${lon} — ${d.weatherCondition?.description?.text}`);

  return {
    condition: d.weatherCondition?.description?.text || 'Unknown',
    tempF: d.temperature?.degrees,
    tempC: d.temperature ? Math.round((d.temperature.degrees - 32) * 5 / 9) : null,
    feelsLikeF: d.feelsLikeTemperature?.degrees,
    humidity: d.relativeHumidity,
    windMph: d.wind?.speed?.value,
    uvIndex: d.uvIndex,
    isDaytime: d.isDaytime,
    cloudCover: d.cloudCover,
    thunderstormProbability: d.thunderstormProbability,
    raw: d,
  };
}

/**
 * Get daily forecast for a lat/lon.
 * Includes sunrise/sunset from astronomy data.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} [days=1]
 * @returns {Promise<object>}
 */
async function forecast(lat, lon, days = 1) {
  const res = await axios.get(`${BASE_URL}/forecast/days:lookup`, {
    params: {
      key: apiKey(),
      'location.latitude': lat,
      'location.longitude': lon,
      days,
      ...DEFAULT_PARAMS,
    },
  });
  const d = res.data;
  logger.debug(`Forecast (${days}d) fetched for: ${lat},${lon}`);

  const forecastDays = (d.forecastDays || []).map(day => ({
    date: day.interval?.startTime?.split('T')[0],
    maxTempF: day.maxTemperature?.degrees,
    minTempF: day.minTemperature?.degrees,
    condition: day.daytimeForecast?.weatherCondition?.description?.text || day.weatherCondition?.description?.text,
    sunrise: formatTime(day.sunEvents?.sunriseTime),
    sunset: formatTime(day.sunEvents?.sunsetTime),
    sunriseIso: day.sunEvents?.sunriseTime,
    sunsetIso: day.sunEvents?.sunsetTime,
    precipProbability: day.daytimeForecast?.precipitationProbability,
    rain: day.daytimeForecast?.rain?.value,
    snow: day.daytimeForecast?.snow?.value,
  }));

  return {
    location: `${lat},${lon}`,
    sunrise: forecastDays[0]?.sunrise,
    sunset: forecastDays[0]?.sunset,
    sunriseIso: forecastDays[0]?.sunriseIso,
    sunsetIso: forecastDays[0]?.sunsetIso,
    days: forecastDays,
    raw: d,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience wrappers
// ─────────────────────────────────────────────────────────────────────────────

async function getCurrent(location) {
  let lat, lon;
  if (typeof location === 'string' && location.includes(',')) {
    [lat, lon] = location.split(',').map(parseFloat);
  } else {
    // Geocode location name via Maps API
    const maps = require('./maps');
    const geo = await maps.geocode(location);
    lat = geo.lat;
    lon = geo.lng;
  }
  return current(lat, lon);
}

async function getForecast(location, days = 1) {
  let lat, lon;
  if (typeof location === 'string' && location.includes(',')) {
    [lat, lon] = location.split(',').map(parseFloat);
  } else {
    const maps = require('./maps');
    const geo = await maps.geocode(location);
    lat = geo.lat;
    lon = geo.lng;
  }
  return forecast(lat, lon, days);
}

async function getAstronomy(location) {
  const f = await getForecast(location, 1);
  return {
    sunrise: f.sunrise,
    sunset: f.sunset,
    sunriseIso: f.sunriseIso,
    sunsetIso: f.sunsetIso,
  };
}

/**
 * Calculate golden hour start (~45 min before sunset).
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
  current,
  forecast,
  getCurrent,
  getForecast,
  getAstronomy,
  goldenHourStart,
};
