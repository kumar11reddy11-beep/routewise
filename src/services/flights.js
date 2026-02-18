'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * RouteWise Flights Service
 * Uses AeroDataBox via RapidAPI for real-time flight status tracking.
 * Used by Milestone 3+ (flight delay detection, outbound time calculation).
 */

const BASE_URL = 'https://aerodatabox.p.rapidapi.com';

function rapidApiHeaders() {
  return {
    'X-RapidAPI-Key': config.rapidApi.key,
    'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
  };
}

/**
 * Get real-time flight status by flight number and departure date.
 * @param {string} flightNumber - IATA flight number (e.g. 'DL1234')
 * @param {string} [date] - YYYY-MM-DD, defaults to today
 * @returns {Promise<object>} Flight status data
 */
async function getFlightStatus(flightNumber, date) {
  const dt = date || new Date().toISOString().split('T')[0];
  logger.info(`Fetching flight status: ${flightNumber} on ${dt}`);

  const res = await axios.get(`${BASE_URL}/flights/number/${flightNumber}/${dt}`, {
    headers: rapidApiHeaders(),
  });

  return res.data;
}

/**
 * Check if a flight is delayed and return delay details.
 * @param {string} flightNumber
 * @param {string} [date]
 * @returns {Promise<{isDelayed: boolean, delayMinutes: number, status: string, flightData: object}>}
 */
async function checkDelay(flightNumber, date) {
  const data = await getFlightStatus(flightNumber, date);
  const flight = Array.isArray(data) ? data[0] : data;

  const status = flight?.status || 'Unknown';
  const scheduledDep = flight?.departure?.scheduledTime?.local;
  const actualDep = flight?.departure?.actualTime?.local || flight?.departure?.estimatedTime?.local;

  let delayMinutes = 0;
  if (scheduledDep && actualDep) {
    const diffMs = new Date(actualDep) - new Date(scheduledDep);
    delayMinutes = Math.max(0, Math.round(diffMs / 60000));
  }

  return {
    isDelayed: delayMinutes > 15,
    delayMinutes,
    status,
    flightData: flight,
  };
}

module.exports = { getFlightStatus, checkDelay };
