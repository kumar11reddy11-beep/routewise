'use strict';

require('dotenv').config();

/**
 * RouteWise Configuration
 * Loads all runtime config from environment variables (via .env).
 * Never hardcode credentials — always read from process.env.
 */
module.exports = {
  gmail: {
    credentialsPath: process.env.GMAIL_CREDENTIALS_PATH,
    tokenPath: process.env.GMAIL_TOKEN_PATH,
    account: process.env.GMAIL_ACCOUNT,
  },
  googleMaps: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY,
  },
  weather: {
    apiKey: process.env.WEATHER_API_KEY,
  },
  rapidApi: {
    key: process.env.RAPIDAPI_KEY,
  },
  tripStatePath: process.env.TRIP_STATE_PATH || './trip-state.json',
};
