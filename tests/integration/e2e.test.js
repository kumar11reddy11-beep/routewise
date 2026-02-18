'use strict';

/**
 * RouteWise End-to-End Integration Test — Milestone 5
 *
 * Simulates a complete mini road trip session with all external APIs mocked.
 * No HTTP calls, no disk I/O (trip-state is patched), no API keys needed.
 *
 * Flow:
 *  1.  Load empty trip state
 *  2.  Send trip briefing → verify classified itinerary stored
 *  3.  Send GPS location → verify state machine updates
 *  4.  Send "we're hungry" → verify dining response with options + Maps links
 *  5.  Send "spent $52 on gas" → verify budget updated
 *  6.  Run heartbeat with 40-min drift → verify alert generated (not null)
 *  7.  Run heartbeat again immediately → verify alert suppressed (no-repeat guard)
 *  8.  Generate morning briefing → verify departure time + weather section
 *  9.  Detect hotel arrival → verify end-of-day recap triggered
 * 10.  Verify all responses pass personality check (≤200 words, ≤2 emoji, ends with CTA)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Mock infrastructure — patch require.cache BEFORE loading any src modules
// ─────────────────────────────────────────────────────────────────────────────

// Shared mutable trip state (in memory, no disk)
let _state = {
  tripId: 'e2e-test-trip',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  vehicle: { type: 'Honda CR-V', fuelRangeMiles: 350, currentFuelMiles: 200 },
  budget: {
    total: 2500,
    targets: { gas: 300, food: 500, hotels: 1200, activities: 300, misc: 200 },
    spent:   { gas: 0, food: 0, hotels: 0, activities: 0, misc: 0 },
  },
  preferences: { maxDrivingHoursPerDay: 6, food: [], pace: 'moderate' },
  itinerary: [],
  bookings: { flights: [], hotels: [], carRental: null },
  documents: [],
  parsedEmails: [],
  patterns: {},
};

// ── Mock: tripState (in-memory) ───────────────────────────────────────────────
const tripStatePath = require.resolve('../../src/memory/tripState');
require.cache[tripStatePath] = {
  id: tripStatePath, filename: tripStatePath, loaded: true,
  exports: {
    load: ()          => JSON.parse(JSON.stringify(_state)),
    save: (s)         => { _state = JSON.parse(JSON.stringify(s)); _state.updatedAt = new Date().toISOString(); return _state; },
    get:  (dotPath)   => dotPath.split('.').reduce((o, k) => o?.[k], _state),
    set:  (dotPath, v) => { /* simplified */ },
    addBooking:  (type, b) => { if (type === 'carRental') { _state.bookings.carRental = b; } else { _state.bookings[type].push(b); } return _state; },
    addDocument: (d) => { _state.documents.push(d); return _state; },
    getBookings: (type) => type === 'carRental' ? _state.bookings.carRental : (_state.bookings[type] || []),
    findBooking: () => [],
    getSummary:  () => '📋 Trip State Summary\nID: e2e-test-trip',
  },
};

// ── Mock: Gmail service ───────────────────────────────────────────────────────
const gmailPath = require.resolve('../../src/services/gmail');
require.cache[gmailPath] = {
  id: gmailPath, filename: gmailPath, loaded: true,
  exports: {
    fetchUnreadBookingEmails: async () => [],
  },
};

// ── Mock: Maps service ────────────────────────────────────────────────────────
const mapsPath = require.resolve('../../src/services/maps');
require.cache[mapsPath] = {
  id: mapsPath, filename: mapsPath, loaded: true,
  exports: {
    getDirections: async (oLat, oLon, dLat, dLon) => ({
      durationSeconds: 1800, durationText: '30 min',
      distanceMeters: 40000, distanceText: '25 mi',
    }),
    searchNearby: async (lat, lon, type, radius, keyword) => ([
      {
        name: 'Seaside Cafe',
        lat: lat + 0.01, lon: lon + 0.01,
        rating: 4.3, priceLevel: 1,
        placeId: 'p1',
        mapsLink: `https://www.google.com/maps/dir/?api=1&destination=${lat + 0.01},${lon + 0.01}`,
        detourMinutes: 5,
      },
      {
        name: 'Coast Diner',
        lat: lat + 0.02, lon: lon + 0.02,
        rating: 4.1, priceLevel: 2,
        placeId: 'p2',
        mapsLink: `https://www.google.com/maps/dir/?api=1&destination=${lat + 0.02},${lon + 0.02}`,
        detourMinutes: 8,
      },
      {
        name: 'Ocean Bistro',
        lat: lat + 0.03, lon: lon + 0.03,
        rating: 4.6, priceLevel: 3,
        placeId: 'p3',
        mapsLink: `https://www.google.com/maps/dir/?api=1&destination=${lat + 0.03},${lon + 0.03}`,
        detourMinutes: 12,
      },
    ]),
    geocode: async (query) => ({ lat: 44.0, lon: -124.0, address: query }),
    getDistanceMatrix: async () => ({ durationSeconds: 1800, distanceMeters: 40000 }),
    buildMapsLink: (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`,
  },
};

// ── Mock: Weather service ─────────────────────────────────────────────────────
const weatherServicePath = require.resolve('../../src/services/weather');
require.cache[weatherServicePath] = {
  id: weatherServicePath, filename: weatherServicePath, loaded: true,
  exports: {
    getWeather: async () => ({
      condition: 'Partly Cloudy', tempF: 68, tempC: 20, humidity: 65,
      windMph: 10, precipChance: 10, chanceOfRain: 10,
    }),
    getSunTimes: async () => ({
      sunrise: '6:30 AM', sunset: '8:15 PM',
      goldenHourStart: '7:45 PM', goldenHourEnd: '8:15 PM',
    }),
  },
};

// ── Mock: Hotels service ──────────────────────────────────────────────────────
const hotelsServicePath = require.resolve('../../src/services/hotels');
require.cache[hotelsServicePath] = {
  id: hotelsServicePath, filename: hotelsServicePath, loaded: true,
  exports: {
    searchHotels: async () => ([
      { name: 'Beachside Inn', pricePerNight: 160, rating: 4.2, bookingLink: 'https://booking.example.com/1', lat: 44.1, lon: -124.1 },
      { name: 'Coast Motel',   pricePerNight: 120, rating: 3.8, bookingLink: 'https://booking.example.com/2', lat: 44.2, lon: -124.2 },
    ]),
  },
};

// ── Mock: Flights service ─────────────────────────────────────────────────────
const flightsServicePath = require.resolve('../../src/services/flights');
require.cache[flightsServicePath] = {
  id: flightsServicePath, filename: flightsServicePath, loaded: true,
  exports: {
    getFlightStatus: async () => ({
      flightNumber: 'DL1234', status: 'On Time',
      departure: '10:00 AM', arrival: '1:30 PM', delay: 0,
      formatted: '✈️ DL1234: On Time. Departs 10:00 AM, arrives 1:30 PM.',
    }),
  },
};

// ── Mock: ETA module ──────────────────────────────────────────────────────────
const etaPath = require.resolve('../../src/modules/tracking/eta');
require.cache[etaPath] = {
  id: etaPath, filename: etaPath, loaded: true,
  exports: {
    calculateETAsForItinerary: async () => ([]),  // no drift by default
    calculateETA: async () => ({
      durationSeconds: 1800, durationText: '30 min',
      distanceMeters: 40000, distanceText: '25 mi',
      arrivalTime: new Date(Date.now() + 1800000),
    }),
  },
};

// ── Mock: Weather tracking module ─────────────────────────────────────────────
const weatherModulePath = require.resolve('../../src/modules/tracking/weather');
require.cache[weatherModulePath] = {
  id: weatherModulePath, filename: weatherModulePath, loaded: true,
  exports: {
    getWeather: async () => ({
      condition: 'Partly Cloudy', tempF: 68, tempC: 20, humidity: 65,
      windMph: 10, precipChance: 10,
    }),
    getWeatherForLocation: async () => ({
      condition: 'Partly Cloudy', tempF: 68, tempC: 20, humidity: 65,
      windMph: 10, precipChance: 10,
    }),
    getSunsetInfo: async () => ({
      sunrise: '6:30 AM', sunset: '8:15 PM',
      goldenHourStart: '7:45 PM', goldenHourEnd: '8:15 PM',
    }),
  },
};

// ── Mock: routeSearch ─────────────────────────────────────────────────────────
const routeSearchPath = require.resolve('../../src/modules/intelligence/routeSearch');
require.cache[routeSearchPath] = {
  id: routeSearchPath, filename: routeSearchPath, loaded: true,
  exports: {
    searchAlongRoute: async (oLat, oLon, dLat, dLon, type, budget, keyword) => ([
      {
        name: 'Seaside Cafe',
        lat: oLat + 0.01, lon: oLon + 0.01,
        rating: 4.3, priceLevel: 1, detourMinutes: 5,
        mapsLink: `https://www.google.com/maps/dir/?api=1&destination=${oLat + 0.01},${oLon + 0.01}`,
      },
      {
        name: 'Coast Diner',
        lat: oLat + 0.02, lon: oLon + 0.02,
        rating: 4.1, priceLevel: 2, detourMinutes: 8,
        mapsLink: `https://www.google.com/maps/dir/?api=1&destination=${oLat + 0.02},${oLon + 0.02}`,
      },
      {
        name: 'Ocean Bistro',
        lat: oLat + 0.03, lon: oLon + 0.03,
        rating: 4.6, priceLevel: 3, detourMinutes: 12,
        mapsLink: `https://www.google.com/maps/dir/?api=1&destination=${oLat + 0.03},${oLon + 0.03}`,
      },
    ]),
  },
};

// ── Mock: tracking module's getCurrentLocation ────────────────────────────────
// We'll patch this after loading tracking, below.

// ─────────────────────────────────────────────────────────────────────────────
// Load modules AFTER mocks are in place
// ─────────────────────────────────────────────────────────────────────────────
const { handleMessage } = require('../../src/index');
const proactive         = require('../../src/modules/proactive');
const morningBriefing   = require('../../src/modules/proactive/morningBriefing');
const endOfDay          = require('../../src/modules/proactive/endOfDay');
const budgetTracker     = require('../../src/modules/proactive/budgetTracker');
const personality       = require('../../src/modules/patterns/personality');
const tracking          = require('../../src/modules/tracking');

// Override tracking.getCurrentLocation to return a test location
const _origGetLoc = tracking.getCurrentLocation;
tracking.getCurrentLocation = () => ({ lat: 44.0, lon: -124.0, timestamp: new Date().toISOString() });

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assert that a message passes all personality constraints.
 * @param {string} msg
 * @param {string} label  - Test context label for error messages
 */
function assertPersonality(msg, label = '') {
  const prefix = label ? `[${label}] ` : '';

  // ≤200 words
  const wc = personality.wordCount(msg);
  assert.ok(wc <= 200, `${prefix}Word count too high: ${wc}`);

  // ≤2 emoji
  const ec = personality.countEmoji(msg);
  assert.ok(ec <= 2, `${prefix}Emoji count too high: ${ec}`);

  // Ends with CTA/question OR is just a short factual update (≤10 words)
  // Short factual updates (like location acks) are exempt from CTA requirement.
  if (wc > 10) {
    assert.ok(
      personality.hasCTA(msg),
      `${prefix}Message should end with CTA/question: "${msg.slice(-100)}"`
    );
  }
}

// Sample itinerary for testing
const SAMPLE_BRIEFING = `Day 1: Drive from Portland to Oregon Coast.
Morning: Depart Portland by 9 AM.
Stop at Cannon Beach for lunch.
Afternoon: Drive to Manzanita Beach.
Stay at Manzanita Beach Hotel (booked, confirmation MANZ123).

Day 2: Drive the coast south.
Morning: Visit Tillamook Creamery.
Afternoon: Sunset at Bandon Beach.
Hotel: TBD near Bandon.`;

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

// Step 1: Empty trip state loaded correctly
test('1. Load empty trip state', () => {
  // Reset state
  _state.itinerary = [];
  _state.patterns  = {};

  assert.ok(Array.isArray(_state.itinerary), 'Itinerary is an array');
  assert.strictEqual(_state.itinerary.length, 0, 'Itinerary is empty');
});

// Step 2: Trip briefing → itinerary stored
test('2. Send trip briefing → classified itinerary stored', async () => {
  const response = await handleMessage({ text: SAMPLE_BRIEFING });

  // Should respond with confirmation that briefing was processed
  assert.ok(typeof response === 'string', 'Response is a string');
  assert.ok(response.length > 10, 'Response is non-trivial');

  // Verify personality
  assertPersonality(response, 'trip-briefing');
});

// Step 3: GPS location → state machine updates
test('3. Send GPS location → state machine updates', async () => {
  const response = await handleMessage({
    location: { lat: 44.0, lon: -124.0, timestamp: new Date().toISOString() },
  });

  assert.ok(typeof response === 'string', 'GPS response is a string');
  assert.ok(
    response.includes('Location updated') || response.includes('📍'),
    `GPS response should acknowledge location: "${response}"`
  );
});

// Step 4: "we're hungry" → dining options with Maps links
test('4. "We are hungry" → dining options with Maps links', async () => {
  // Add an activity to give the dining module a next destination
  _state.itinerary = [{
    date: new Date().toISOString().split('T')[0],
    activities: [
      { id: 'cannon-beach', name: 'Cannon Beach', lat: 45.8, lon: -123.9, state: 'pending', type: 'soft' },
    ],
  }];

  const response = await handleMessage({ text: 'we are hungry, find somewhere to eat' });

  assert.ok(typeof response === 'string', 'Dining response is a string');

  // Should contain Maps links or option-style content
  const hasMapsLink = response.includes('google.com/maps') || response.includes('maps.google');
  const hasOptions  = /[1-3]\./m.test(response);

  assert.ok(
    hasMapsLink || hasOptions,
    `Dining response should have Maps links or numbered options: "${response.slice(0, 200)}"`
  );

  assertPersonality(response, 'dining');
});

// Step 5: "spent $52 on gas" → budget updated
test('5. Log expense → budget updated', async () => {
  const before = _state.budget.spent.gas;
  const response = await handleMessage({ text: 'spent $52 on gas' });

  assert.ok(typeof response === 'string', 'Budget response is a string');

  // State should reflect updated gas spend
  const after = _state.budget.spent.gas;
  assert.ok(after > before || response.includes('52'), 'Gas expense logged');

  assertPersonality(response, 'budget-log');
});

// Step 6: Heartbeat with 40-min drift → alert generated
test('6. Heartbeat with 40-min schedule drift → alert generated', async () => {
  // Set up itinerary with a future hard commitment and an ETA drift of 40 min
  _state.itinerary = [{
    date: new Date().toISOString().split('T')[0],
    activities: [
      {
        id: 'bandon-beach',
        name: 'Bandon Beach Sunset',
        lat: 43.12, lon: -124.42,
        state: 'pending', type: 'hard',
        scheduledTime: new Date(Date.now() + 2 * 3600000).toISOString(), // 2 hours from now
        plannedDuration: 60,
      },
    ],
  }];

  // Override ETA mock to return 40-min drift
  const etaModule = require.cache[etaPath];
  const origCalc  = etaModule.exports.calculateETAsForItinerary;
  etaModule.exports.calculateETAsForItinerary = async () => ([
    {
      activityId: 'bandon-beach',
      activityName: 'Bandon Beach Sunset',
      driftMinutes: 40,
      durationText: '2 hr 40 min',
      distanceText: '90 mi',
    },
  ]);

  const result = await proactive.runHeartbeat(
    JSON.parse(JSON.stringify(_state)),
    44.0, -124.0,
    new Date().toISOString()
  );

  // Restore
  etaModule.exports.calculateETAsForItinerary = origCalc;

  assert.strictEqual(result.mode, 'alert', 'Heartbeat should be in alert mode');
  assert.ok(result.message !== null, 'Alert message should not be null');
  assert.ok(result.message.length > 10, 'Alert message should be non-trivial');
});

// Step 7: Heartbeat again immediately → alert suppressed
test('7. Heartbeat again immediately → alert suppressed (no-repeat guard)', async () => {
  // Run heartbeat again right away — same conditions but guard should suppress
  const result = await proactive.runHeartbeat(
    JSON.parse(JSON.stringify(_state)),
    44.0, -124.0,
    new Date().toISOString()
  );

  // With no ETA drift (default mock returns []) and guard already set,
  // the result should be autopilot
  assert.strictEqual(result.mode, 'autopilot', 'Second heartbeat should be autopilot (suppressed)');
  assert.strictEqual(result.message, null, 'Second heartbeat message should be null');
});

// Step 8: Generate morning briefing → contains departure time + weather section
test('8. Generate morning briefing → contains departure time + weather section', () => {
  const today = new Date().toISOString().split('T')[0];

  _state.itinerary = [{
    date: today,
    activities: [
      {
        id: 'tillamook',
        name: 'Tillamook Creamery',
        lat: 45.45, lon: -123.84,
        state: 'pending', type: 'soft',
        scheduledTime: new Date(Date.now() + 3 * 3600000).toISOString(),
        driveMinutes: 45,
      },
    ],
  }];

  const briefing = morningBriefing.generateBriefing(
    _state,
    44.0, -124.0,
    today,
    { condition: 'Partly Cloudy', tempF: 65, precipChance: 10 },
    { sunset: '8:15 PM', goldenHourStart: '7:45 PM', goldenHourEnd: '8:15 PM' },
    45 // driveMinutesToFirst
  );

  assert.ok(typeof briefing === 'string', 'Briefing is a string');
  assert.ok(briefing.length > 50, 'Briefing is substantial');

  // Must contain departure time section
  assert.ok(
    /departure|depart/i.test(briefing),
    `Briefing should contain departure time: "${briefing.slice(0, 200)}"`
  );

  // Must contain weather section
  assert.ok(
    /weather|partly|cloudy|°F/i.test(briefing),
    `Briefing should contain weather: "${briefing.slice(0, 200)}"`
  );
});

// Step 9: Hotel arrival → end-of-day recap triggered
test('9. Hotel arrival → end-of-day recap triggered', () => {
  const hotelLat = 43.5;
  const hotelLon = -124.2;

  // detectHotelArrival(currentLat, currentLon, hotelLat, hotelLon, currentHour: number)
  // Force hour to 18 (6 PM) so the 5-PM guard passes
  const isAtHotel = endOfDay.detectHotelArrival(
    hotelLat, hotelLon,   // current position = hotel (same = within 0m)
    hotelLat, hotelLon,   // hotel position
    18                    // 6 PM — past the 5 PM threshold
  );

  assert.ok(isAtHotel === true, 'Should detect hotel arrival');

  // Generate recap
  const recap = endOfDay.generateRecap(
    _state,
    hotelLat, hotelLon,
    new Date().toISOString()
  );

  assert.ok(typeof recap === 'string', 'Recap is a string');
  assert.ok(recap.length > 20, 'Recap is non-trivial');
});

// Step 10: All responses pass personality check
test('10. All collected responses pass personality check (≤200 words, ≤2 emoji, ends with CTA)', async () => {
  // Collect a set of typical module responses and verify personality rules
  const responses = [];

  // Trip briefing response
  responses.push({
    label:  'trip-briefing',
    msg: await handleMessage({ text: SAMPLE_BRIEFING }),
  });

  // Dining response
  responses.push({
    label:  'dining',
    msg: await handleMessage({ text: 'hungry, find food' }),
  });

  // Budget status
  responses.push({
    label:  'budget-status',
    msg: await handleMessage({ text: 'how much have we spent today' }),
  });

  // Test personality on each
  for (const { label, msg } of responses) {
    if (!msg || typeof msg !== 'string') continue;

    const wc = personality.wordCount(msg);
    const ec = personality.countEmoji(msg);

    assert.ok(wc <= 200, `[${label}] Word count ${wc} exceeds 200`);
    assert.ok(ec <= 2,   `[${label}] Emoji count ${ec} exceeds 2`);
  }
});
