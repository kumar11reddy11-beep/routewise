'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Default empty trip state structure.
 * Represents a trip that hasn't been set up yet.
 */
const DEFAULT_STATE = {
  tripId: null,
  createdAt: null,
  updatedAt: null,
  vehicle: {
    type: null,
    fuelRangeMiles: null,
    currentFuelMiles: null,
  },
  budget: {
    total: 0,
    targets: { gas: 0, food: 0, hotels: 0, activities: 0, misc: 0 },
    spent:   { gas: 0, food: 0, hotels: 0, activities: 0, misc: 0 },
  },
  preferences: {
    maxDrivingHoursPerDay: 6,
    food: [],
    pace: 'moderate',
  },
  itinerary: [],
  bookings: {
    flights: [],
    hotels: [],
    carRental: null,
  },
  documents: [],
  parsedEmails: [],
  patterns: {},
};

// Resolve the state file path from config
function statePath() {
  return path.resolve(config.tripStatePath);
}

/**
 * Load trip state from disk.
 * Returns the parsed object, or a fresh default state if the file doesn't exist.
 */
function load() {
  const file = statePath();
  if (!fs.existsSync(file)) {
    logger.debug('No trip-state.json found; returning default state.');
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    logger.error('Failed to parse trip-state.json:', err.message);
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
}

/**
 * Persist trip state to disk.
 * Automatically sets updatedAt timestamp.
 */
function save(state) {
  state.updatedAt = new Date().toISOString();
  if (!state.createdAt) state.createdAt = state.updatedAt;
  if (!state.tripId) state.tripId = `trip-${Date.now()}`;
  const file = statePath();
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
  logger.debug('Trip state saved to', file);
  return state;
}

/**
 * Get a nested value by dot-path string.
 * Example: get('bookings.flights') → state.bookings.flights
 */
function get(dotPath) {
  const state = load();
  return dotPath.split('.').reduce((obj, key) => (obj != null ? obj[key] : undefined), state);
}

/**
 * Set a nested value by dot-path string and persist.
 * Example: set('preferences.pace', 'relaxed')
 */
function set(dotPath, value) {
  const state = load();
  const keys = dotPath.split('.');
  let cursor = state;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cursor[keys[i]] == null) cursor[keys[i]] = {};
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = value;
  save(state);
  return state;
}

/**
 * Add a booking to a specific type array (flights, hotels) or set carRental.
 * @param {string} type - 'flights' | 'hotels' | 'carRental'
 * @param {object} booking - The booking data object
 */
function addBooking(type, booking) {
  const state = load();
  booking.addedAt = new Date().toISOString();
  if (type === 'carRental') {
    state.bookings.carRental = booking;
  } else {
    if (!Array.isArray(state.bookings[type])) state.bookings[type] = [];
    state.bookings[type].push(booking);
  }
  save(state);
  logger.info(`Added ${type} booking:`, booking.confirmationNumber || booking.hotelName || booking.airline || '(no ID)');
  return state;
}

/**
 * Add a document reference to the documents array.
 * @param {object} doc - { filePath, mimeType, description, addedAt }
 */
function addDocument(doc) {
  const state = load();
  doc.addedAt = new Date().toISOString();
  state.documents.push(doc);
  save(state);
  return state;
}

/**
 * Get all bookings of a specific type.
 * @param {string} type - 'flights' | 'hotels' | 'carRental'
 */
function getBookings(type) {
  const state = load();
  if (type === 'carRental') return state.bookings.carRental;
  return state.bookings[type] || [];
}

/**
 * Search bookings across all types for a matching field/value.
 * @param {object} query - Key/value pairs to match (e.g. { confirmationNumber: 'ABC123' })
 * @returns {Array} Matching booking objects with a `_type` field added
 */
function findBooking(query) {
  const state = load();
  const results = [];

  // Search array-type bookings
  for (const type of ['flights', 'hotels']) {
    for (const booking of (state.bookings[type] || [])) {
      const matches = Object.entries(query).every(([k, v]) =>
        String(booking[k] || '').toLowerCase().includes(String(v).toLowerCase())
      );
      if (matches) results.push({ ...booking, _type: type });
    }
  }

  // Search carRental (single object)
  if (state.bookings.carRental) {
    const matches = Object.entries(query).every(([k, v]) =>
      String(state.bookings.carRental[k] || '').toLowerCase().includes(String(v).toLowerCase())
    );
    if (matches) results.push({ ...state.bookings.carRental, _type: 'carRental' });
  }

  return results;
}

/**
 * Return a human-readable summary of the current trip state.
 */
function getSummary() {
  const state = load();
  const lines = [];

  lines.push(`📋 Trip State Summary`);
  lines.push(`ID: ${state.tripId || 'Not set'}`);

  // Vehicle
  if (state.vehicle.type) {
    lines.push(`🚗 Vehicle: ${state.vehicle.type} (~${state.vehicle.fuelRangeMiles} mi range)`);
  }

  // Budget
  const { total, spent } = state.budget;
  const totalSpent = Object.values(spent).reduce((a, b) => a + b, 0);
  lines.push(`💰 Budget: $${totalSpent} spent of $${total} total`);

  // Itinerary
  if (state.itinerary.length) {
    lines.push(`📅 Itinerary: ${state.itinerary.length} day(s) planned`);
  }

  // Bookings
  const flightCount = state.bookings.flights.length;
  const hotelCount = state.bookings.hotels.length;
  const hasCarRental = !!state.bookings.carRental;
  lines.push(`✈️  Flights: ${flightCount} | 🏨 Hotels: ${hotelCount} | 🚙 Car Rental: ${hasCarRental ? 'Yes' : 'No'}`);

  // Documents
  if (state.documents.length) {
    lines.push(`📄 Documents: ${state.documents.length} stored`);
  }

  return lines.join('\n');
}

/**
 * Persist the family's latest GPS position in the trip state.
 * Used by the heartbeat and morning briefing to reference the last known
 * location even between live-location updates.
 *
 * Only writes when there is already an active trip (tripId set).
 * This prevents a GPS update from auto-creating a phantom trip.
 *
 * @param {number} lat       - Latitude
 * @param {number} lon       - Longitude
 * @param {number} timestamp - Unix ms timestamp
 * @returns {object} Updated state (unchanged if no active trip)
 */
function updateCurrentLocation(lat, lon, timestamp) {
  const state = load();

  // Update location unconditionally (in memory)
  state.currentLocation = { lat, lon, updatedAt: timestamp || Date.now() };

  // Only persist when there is an active trip — avoids auto-creating a tripId
  // via save(), which would cause the heartbeat to treat a no-trip state as active.
  if (state.tripId) {
    save(state);
    logger.debug(`Current location updated: (${lat}, ${lon})`);
  } else {
    logger.debug(`Location received but no active trip — not persisting: (${lat}, ${lon})`);
  }

  return state;
}

module.exports = { load, save, get, set, addBooking, addDocument, getBookings, findBooking, getSummary, updateCurrentLocation };
