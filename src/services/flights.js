'use strict';

const https  = require('https');
const zlib   = require('zlib');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * RouteWise Flights Service
 *
 * Uses AeroDataBox via RapidAPI for real-time flight status tracking.
 * Handles gzip-encoded responses from the API using Node's built-in zlib.
 *
 * Endpoint: aerodatabox.p.rapidapi.com/flights/number/{flightNumber}/{date}
 */

const AERO_HOST = 'aerodatabox.p.rapidapi.com';

/**
 * Make an HTTPS GET request to AeroDataBox, handling gzip decompression.
 *
 * @param {string} path - URL path
 * @returns {Promise<any>} Parsed JSON
 */
function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: AERO_HOST,
      path,
      method:   'GET',
      headers: {
        'X-RapidAPI-Key':  config.rapidApi.key,
        'X-RapidAPI-Host': AERO_HOST,
        'Accept-Encoding': 'gzip, deflate',
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      const encoding = res.headers['content-encoding'];

      let stream = res;
      if (encoding === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      }

      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error(`AeroDataBox parse error: ${e.message} | body: ${raw.slice(0, 200)}`));
        }
      });
      stream.on('error', reject);
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Get real-time flight status by flight number and departure date.
 * Returns an array of flight segments (usually 1 for domestic, may be 2 for codeshares).
 *
 * @param {string} flightNumber - IATA flight number (e.g. 'DL1234', 'AA100')
 * @param {string} [date]       - YYYY-MM-DD, defaults to today
 * @returns {Promise<any[]>}    Array of flight objects from AeroDataBox
 */
async function getFlightStatus(flightNumber, date) {
  const dt = date || new Date().toISOString().split('T')[0];
  logger.info(`Fetching flight status: ${flightNumber} on ${dt}`);

  const path = `/flights/number/${encodeURIComponent(flightNumber)}/${dt}`;
  const data = await makeRequest(path);
  // AeroDataBox returns an array or a single object; normalise to array
  return Array.isArray(data) ? data : [data];
}

/**
 * Check if a flight is delayed and return a normalised delay summary.
 *
 * @param {string} flightNumber
 * @param {string} [date]
 * @returns {Promise<{isDelayed: boolean, delayMinutes: number, status: string, flightData: object}>}
 */
async function checkDelay(flightNumber, date) {
  const flights = await getFlightStatus(flightNumber, date);
  const flight  = flights[0] || {};

  const status       = flight.status || 'Unknown';
  const scheduledDep = flight.departure?.scheduledTime?.local;
  const actualDep    = flight.departure?.actualTime?.local
                    || flight.departure?.estimatedTime?.local;

  let delayMinutes = 0;
  if (scheduledDep && actualDep) {
    const diffMs = new Date(actualDep) - new Date(scheduledDep);
    delayMinutes = Math.max(0, Math.round(diffMs / 60000));
  }

  return {
    isDelayed:  delayMinutes > 15,
    delayMinutes,
    status,
    flightData: flight,
  };
}

module.exports = { getFlightStatus, checkDelay };
