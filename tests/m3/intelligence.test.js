'use strict';

/**
 * RouteWise Milestone 3 — Intelligence Module Tests
 *
 * Uses node:test with mock/override of all external API calls.
 * No live API calls are made during tests.
 *
 * Test coverage:
 *  1.  buildMapsLink formats correctly
 *  2.  estimateDetour calculates correctly (mocked drive times)
 *  3.  checkFivePMTrigger: true after 5 PM with no hotel, false otherwise
 *  4.  calculateDepartureWindow works backward from flight time (mocked drive)
 *  5.  calculateDelayImpact identifies soft goals to cut vs hard commitments
 *  6.  findDining returns 2–3 options
 *  7.  findDining tight schedule includes takeout mention
 *  8.  correlateNeeds bundles gas + food
 *  9.  getFlightStatus parses mocked AeroDataBox response
 * 10.  findNearestHospital returns correctly formatted response with maps link
 * 11.  findHotels positioning tradeoff note is present in response
 * 12.  Response format: all responses under 200 words, end with question/CTA
 */

const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

// ─────────────────────────────────────────────────────────────────────────────
// Mock infrastructure
// We override require() caches for services before loading intelligence modules.
// ─────────────────────────────────────────────────────────────────────────────

// Sentinel coords for tests
const CURRENT_LAT = 43.366;
const CURRENT_LON = -124.217;
const DEST_LAT    = 42.128;
const DEST_LON    = -124.303;
const STOP_LAT    = 42.800;
const STOP_LON    = -124.260;

// ─── Fake maps service ───────────────────────────────────────────────────────
// Inject before any module loads maps
const fakeMaps = {
  directions: async (oLat, oLon, dLat, dLon) => {
    // Return a realistic Directions-like response.
    // Use dist_degrees * 5000 ≈ 83 min per degree ≈ 80 km/h speed.
    // This keeps detour estimates small and proportional (within 20 min budget
    // for nearby stops), while producing correct triangle-inequality math.
    const dist    = Math.sqrt((dLat - oLat) ** 2 + (dLon - oLon) ** 2);
    const seconds = Math.round(dist * 5000);  // ~80 km/h in seconds/degree
    return {
      routes: [{
        legs: [{
          duration:       { value: seconds, text: `${Math.round(seconds / 60)} min` },
          distance:       { value: Math.round(dist * 111000), text: `${(dist * 111).toFixed(1)} km` },
          steps:          [
            { end_location: { lat: (oLat + dLat) / 2, lng: (oLon + dLon) / 2 } },
          ],
        }],
      }],
      status: 'OK',
    };
  },

  places: async (query, lat, lon, radius, type) => {
    // Return deterministic fake places near the requested location
    const base = [
      {
        place_id: `fake-${type}-1`,
        name:     `Test ${type || 'place'} #1`,
        rating:   4.4,
        vicinity: '123 Main St',
        geometry: { location: { lat: lat + 0.01, lng: lon + 0.01 } },
        opening_hours: { open_now: true },
      },
      {
        place_id: `fake-${type}-2`,
        name:     `Test ${type || 'place'} #2`,
        rating:   4.1,
        vicinity: '456 Oak Ave',
        geometry: { location: { lat: lat + 0.02, lng: lon + 0.02 } },
        opening_hours: { open_now: true },
      },
      {
        place_id: `fake-${type}-3`,
        name:     `Test ${type || 'place'} #3`,
        rating:   3.9,
        vicinity: '789 Pine Rd',
        geometry: { location: { lat: lat + 0.03, lng: lon + 0.03 } },
        opening_hours: { open_now: true },
      },
    ];
    return base;
  },

  reverseGeocode: async () => ({ results: [{ formatted_address: 'Test Location, OR' }] }),
  distanceMatrix: async () => ({ rows: [{ elements: [{ duration: { value: 1800 } }] }] }),
  buildMapsLink: (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`,
};

// ─── Fake hotels service ─────────────────────────────────────────────────────
const fakeHotelsService = {
  autocomplete: async (query) => [{ label: query, latitude: DEST_LAT, longitude: DEST_LON }],
  searchByBbox: async () => ({
    count: 2,
    result: [
      {
        hotel_name: 'Pacific Reef Hotel',
        class: 3,
        review_score: 8.6,
        review_score_word: 'Fabulous',
        price_breakdown: { gross_price: 165, currency: 'USD' },
        latitude:  DEST_LAT + 0.01,
        longitude: DEST_LON + 0.01,
        address: 'Gold Beach, OR',
        url: '/gold-beach/pacific-reef',
      },
      {
        hotel_name: 'Wild Rivers Inn',
        class: 3,
        review_score: 8.2,
        review_score_word: 'Superb',
        price_breakdown: { gross_price: 145, currency: 'USD' },
        latitude:  DEST_LAT + 0.02,
        longitude: DEST_LON + 0.02,
        address: 'Brookings, OR',
        url: '/brookings/wild-rivers',
      },
    ],
  }),
  searchNear: async () => [
    {
      name: 'Pacific Reef Hotel',
      stars: 3,
      rating: 8.6,
      pricePerNight: 165,
      currency: 'USD',
      lat:  DEST_LAT + 0.01,
      lon:  DEST_LON + 0.01,
      address: 'Gold Beach, OR',
      bookingLink: 'https://www.booking.com/gold-beach/pacific-reef',
    },
    {
      name: 'Wild Rivers Inn',
      stars: 3,
      rating: 8.2,
      pricePerNight: 145,
      currency: 'USD',
      lat:  DEST_LAT + 0.02,
      lon:  DEST_LON + 0.02,
      address: 'Brookings, OR',
      bookingLink: 'https://www.booking.com/brookings/wild-rivers',
    },
  ],
  createBoundingBox: (lat, lon, r) => `${lat - 0.1},${lon - 0.1},${lat + 0.1},${lon + 0.1}`,
};

// ─── Fake flights service ────────────────────────────────────────────────────
const fakeFlightsService = {
  getFlightStatus: async (flightNumber, date) => [{
    status: 'EnRoute',
    departure: {
      airport:       { iata: 'PDX', name: 'Portland International' },
      scheduledTime: { local: '2026-03-15T08:00:00' },
      actualTime:    { local: '2026-03-15T09:30:00' },
    },
    arrival: {
      airport:       { iata: 'SFO', name: 'San Francisco International' },
      scheduledTime: { local: '2026-03-15T10:00:00' },
      actualTime:    { local: '2026-03-15T11:30:00' },
    },
  }],
  checkDelay: async () => ({ isDelayed: true, delayMinutes: 90, status: 'EnRoute' }),
};

// ─── Inject mocks via require.cache ──────────────────────────────────────────
function injectMock(resolvedPath, mockModule) {
  require.cache[require.resolve(resolvedPath)] = {
    id:       require.resolve(resolvedPath),
    filename: require.resolve(resolvedPath),
    loaded:   true,
    exports:  mockModule,
    parent:   null,
    children: [],
  };
}

// Inject before loading intelligence modules so they pick up the mocks
injectMock('../../src/services/maps',    fakeMaps);
injectMock('../../src/services/hotels',  fakeHotelsService);
injectMock('../../src/services/flights', fakeFlightsService);

// Resolve paths relative to this test file's directory
const path = require('path');
const ROOT  = path.resolve(__dirname, '../..');

function injectMockByAbsPath(absPath, mockModule) {
  require.cache[absPath] = {
    id: absPath, filename: absPath, loaded: true, exports: mockModule,
    parent: null, children: [],
  };
}

injectMockByAbsPath(path.join(ROOT, 'src/services/maps.js'),    fakeMaps);
injectMockByAbsPath(path.join(ROOT, 'src/services/hotels.js'),  fakeHotelsService);
injectMockByAbsPath(path.join(ROOT, 'src/services/flights.js'), fakeFlightsService);

// Now load the intelligence modules (they will use the mocked services)
const routeSearch = require(path.join(ROOT, 'src/modules/intelligence/routeSearch'));
const dining      = require(path.join(ROOT, 'src/modules/intelligence/dining'));
const hotelsM     = require(path.join(ROOT, 'src/modules/intelligence/hotels'));
const flightsM    = require(path.join(ROOT, 'src/modules/intelligence/flights'));
const safetyM     = require(path.join(ROOT, 'src/modules/intelligence/safety'));
const fuelM       = require(path.join(ROOT, 'src/modules/intelligence/fuel'));
const intel       = require(path.join(ROOT, 'src/modules/intelligence/index'));

// ─────────────────────────────────────────────────────────────────────────────
// Helper: count words in a string
function wordCount(str) {
  return str.trim().split(/\s+/).length;
}

// Helper: check response ends with question/CTA
function endsWithCTA(str) {
  const lower = str.trimEnd().toLowerCase();
  return (
    lower.endsWith('which one?')        ||
    lower.endsWith('which works?')      ||
    lower.endsWith('want to lock one in?') ||
    lower.endsWith('which one')         ||
    lower.endsWith('?')                 ||
    /next step|call ahead|let me know|want me to/.test(lower.slice(-120))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('M3 Intelligence — Test Suite', () => {

  // ── Test 1: buildMapsLink ────────────────────────────────────────────────
  test('1. buildMapsLink formats correctly', () => {
    const link = routeSearch.buildMapsLink(42.128, -124.303);
    assert.equal(
      link,
      'https://www.google.com/maps/dir/?api=1&destination=42.128,-124.303',
      'buildMapsLink should produce the correct Google Maps URL format'
    );
  });

  // ── Test 2: estimateDetour ───────────────────────────────────────────────
  test('2. estimateDetour calculates correctly given mocked drive times', async () => {
    // With fakeMaps.directions returning dist-based seconds, the detour
    // should be positive and numeric (stop is not on the direct route).
    const detour = await routeSearch.estimateDetour(
      CURRENT_LAT, CURRENT_LON,
      STOP_LAT,    STOP_LON,
      DEST_LAT,    DEST_LON
    );
    assert.equal(typeof detour, 'number', 'estimateDetour should return a number');
    // Detour from current→stop→dest vs current→dest; stop is between, detour should be near 0 or positive
    assert.ok(detour >= -60 && detour <= 120, `detour ${detour} should be in reasonable range`);
  });

  // ── Test 3: checkFivePMTrigger ───────────────────────────────────────────
  test('3a. checkFivePMTrigger returns true after 5PM with no hotel tonight', () => {
    const stateNoHotel = { bookings: { hotels: [] } };
    assert.equal(hotelsM.checkFivePMTrigger(17, stateNoHotel), true,
      'Should trigger at 5 PM with no hotels booked');
    assert.equal(hotelsM.checkFivePMTrigger(23, stateNoHotel), true,
      'Should trigger at 11 PM with no hotels booked');
  });

  test('3b. checkFivePMTrigger returns false before 5PM', () => {
    const stateNoHotel = { bookings: { hotels: [] } };
    assert.equal(hotelsM.checkFivePMTrigger(16, stateNoHotel), false,
      'Should NOT trigger before 5 PM');
    assert.equal(hotelsM.checkFivePMTrigger(9, stateNoHotel), false,
      'Should NOT trigger at 9 AM');
  });

  test('3c. checkFivePMTrigger returns false when hotel booked for tonight', () => {
    const today    = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const stateWithHotel = {
      bookings: {
        hotels: [{ checkIn: today, checkOut: tomorrow }],
      },
    };
    assert.equal(hotelsM.checkFivePMTrigger(18, stateWithHotel), false,
      'Should NOT trigger when hotel is booked for tonight');
  });

  // ── Test 4: calculateDepartureWindow ─────────────────────────────────────
  test('4. calculateDepartureWindow works backward from flight time', async () => {
    // Flight at 3 PM today
    const today       = new Date();
    const flightTime  = new Date(today);
    flightTime.setHours(15, 0, 0, 0);

    const result = await flightsM.calculateDepartureWindow(
      flightTime,
      37.619,  -122.374,   // SFO airport
      CURRENT_LAT, CURRENT_LON
    );

    assert.ok(result.latestDepartureTime instanceof Date, 'Should return a Date');
    assert.ok(result.latestDepartureTime < flightTime, 'Departure time should be before flight');
    assert.ok(result.breakdown, 'Should include breakdown');
    assert.equal(typeof result.breakdown.securityBuffer, 'string');
    assert.ok(result.formatted.includes('Leave by'), 'Formatted should include "Leave by"');

    // Total buffer is at least 90+30+30 = 150 min
    const bufferMs = flightTime - result.latestDepartureTime;
    const bufferMin = bufferMs / 60000;
    assert.ok(bufferMin >= 150, `Buffer ${bufferMin} min should be >= 150 min (excluding drive)`);
  });

  // ── Test 5: calculateDelayImpact ─────────────────────────────────────────
  test('5a. calculateDelayImpact identifies soft goals to cut', () => {
    const itinerary = [
      { name: 'Scenic Overlook', category: 'soft', duration: 60 },
      { name: 'Dinner Reservation', category: 'hard', scheduledTime: '2026-03-15T19:00:00', duration: 90 },
    ];

    const result = flightsM.calculateDelayImpact(120, itinerary);

    assert.ok(Array.isArray(result.affectedItems), 'affectedItems should be an array');
    assert.ok(result.affectedItems.includes('Scenic Overlook'), 'Soft goal should be in affectedItems');
    assert.ok(Array.isArray(result.triageOptions), 'triageOptions should be an array');
    assert.ok(result.triageOptions.length >= 1, 'Should have at least 1 triage option');
    assert.ok(result.triageOptions.length <= 3, 'Should have at most 3 triage options');
    assert.ok(result.formatted.includes('delay'), 'Formatted should mention delay');
  });

  test('5b. calculateDelayImpact protects hard commitments', () => {
    const itinerary = [
      { name: 'Beach Walk', category: 'soft', duration: 45 },
      { name: 'Hotel Check-In Deadline', category: 'hard', scheduledTime: '2026-03-15T22:00:00' },
    ];

    const result = flightsM.calculateDelayImpact(60, itinerary);
    // Hard commitment should NOT appear in affectedItems (only soft goals listed there)
    assert.ok(!result.affectedItems.includes('Hotel Check-In Deadline'),
      'Hard commitments should not be in affectedItems');
    // At least one triage option should reference the soft goal or hard commitment
    const allOpts = result.triageOptions.join(' ');
    assert.ok(allOpts.length > 0, 'Should have triage options');
  });

  test('5c. calculateDelayImpact with no delay returns no-op', () => {
    const result = flightsM.calculateDelayImpact(0, []);
    assert.equal(result.affectedItems.length, 0);
    assert.equal(result.triageOptions.length, 0);
  });

  // ── Test 6: findDining returns 2–3 options ───────────────────────────────
  test('6. findDining response includes 2–3 options', async () => {
    const response = await dining.findDining(
      'pizza',
      CURRENT_LAT, CURRENT_LON,
      DEST_LAT,    DEST_LON,
      {},          // no schedule pressure
      20
    );

    assert.equal(typeof response, 'string', 'Response should be a string');

    // Count numbered options (lines starting with "1.", "2.", "3.")
    const optionLines = response.split('\n').filter(l => /^\d+\.\s/.test(l));
    assert.ok(optionLines.length >= 2 && optionLines.length <= 3,
      `Should have 2–3 numbered options, got ${optionLines.length}: ${response}`);
  });

  // ── Test 7: findDining tight schedule includes takeout mention ────────────
  test('7. findDining tight schedule response includes takeout mention', async () => {
    const tightContext = {
      driftMinutes:                  30,
      hoursUntilNextHardCommitment:  0.5,
    };

    const response = await dining.findDining(
      'food',
      CURRENT_LAT, CURRENT_LON,
      DEST_LAT,    DEST_LON,
      tightContext,
      20
    );

    assert.equal(typeof response, 'string');
    const lower = response.toLowerCase();
    assert.ok(
      lower.includes('takeout') || lower.includes('take out') ||
      lower.includes('call ahead') || lower.includes('tight'),
      `Tight schedule response should mention takeout/tight: "${response}"`
    );
  });

  // ── Test 8: correlateNeeds bundles gas + food ─────────────────────────────
  test('8. correlateNeeds bundles gas + food', async () => {
    const response = await intel.correlateNeeds(
      ['gas', 'food'],
      CURRENT_LAT, CURRENT_LON,
      DEST_LAT,    DEST_LON,
      {}   // empty trip state
    );

    assert.equal(typeof response, 'string', 'correlateNeeds should return a string');
    // Response should include gas emoji OR "gas" keyword
    const lower = response.toLowerCase();
    assert.ok(
      lower.includes('gas') || lower.includes('⛽'),
      'Correlated response should include gas content'
    );
    // Response should include food emoji OR dining content
    assert.ok(
      lower.includes('option') || lower.includes('🍕') || lower.includes('found'),
      'Correlated response should include dining content'
    );
  });

  // ── Test 9: getFlightStatus parses mocked AeroDataBox response ────────────
  test('9. getFlightStatus correctly parses mocked AeroDataBox response', async () => {
    const result = await flightsM.getFlightStatus('DL1234', '2026-03-15');

    assert.equal(result.flightNumber, 'DL1234');
    assert.equal(typeof result.status, 'string');
    assert.equal(typeof result.delayMinutes, 'number');
    assert.equal(typeof result.isDelayed, 'boolean');
    assert.ok(result.departure, 'Should have departure info');
    assert.ok(result.arrival, 'Should have arrival info');
    assert.equal(typeof result.formatted, 'string');

    // With our mock, the flight is 90 min delayed (09:30 vs 08:00)
    assert.equal(result.delayMinutes, 90, 'Should calculate 90 min delay');
    assert.equal(result.isDelayed, true, 'Should be marked as delayed');
    assert.ok(result.formatted.includes('DL1234'), 'Formatted should include flight number');
  });

  // ── Test 10: findNearestHospital ─────────────────────────────────────────
  test('10. findNearestHospital returns correctly formatted response with maps link', async () => {
    const result = await safetyM.findNearestHospital(CURRENT_LAT, CURRENT_LON);

    assert.equal(typeof result.name, 'string', 'Should have a name');
    assert.equal(typeof result.formatted, 'string', 'Should have formatted output');
    assert.ok(result.mapsLink, 'Should have a maps link');
    assert.ok(
      result.mapsLink.startsWith('https://www.google.com/maps/dir/?api=1&destination='),
      `Maps link should use correct format: ${result.mapsLink}`
    );
    assert.ok(
      result.formatted.includes('🏥') || result.formatted.includes('hospital'),
      'Formatted response should mention hospital'
    );
  });

  // ── Test 11: findHotels positioning tradeoff ──────────────────────────────
  test('11. findHotels positioning tradeoff note is present in response', async () => {
    const response = await hotelsM.findHotels(
      CURRENT_LAT, CURRENT_LON,
      DEST_LAT,    DEST_LON,      // tomorrow's first activity
      { budgetMin: 100, budgetMax: 250 },
      '2026-03-15',
      '2026-03-16'
    );

    assert.equal(typeof response, 'string', 'findHotels should return a string');

    // Should contain some positioning tradeoff language
    const lower = response.toLowerCase();
    assert.ok(
      lower.includes('tomorrow') ||
      lower.includes('closer')   ||
      lower.includes('positioning') ||
      lower.includes('min') ||
      lower.includes('hr'),
      `Response should include positioning/drive-time language: "${response}"`
    );

    // Should include at least 1 numbered option
    const optionLines = response.split('\n').filter(l => /^\d+\.\s/.test(l));
    assert.ok(optionLines.length >= 1, 'Should have at least 1 hotel option');

    // Should have a maps link or booking link
    assert.ok(
      response.includes('google.com/maps') || response.includes('booking.com'),
      'Should include maps or booking link'
    );
  });

  // ── Test 12: Response format validation ───────────────────────────────────
  test('12a. findDining response is under 200 words and ends with CTA', async () => {
    const response = await dining.findDining(
      'seafood', CURRENT_LAT, CURRENT_LON, DEST_LAT, DEST_LON, {}, 20
    );
    const wc = wordCount(response);
    assert.ok(wc <= 200, `findDining: ${wc} words (limit: 200)\n${response}`);
    assert.ok(endsWithCTA(response), `findDining should end with CTA: "${response.slice(-100)}"`);
  });

  test('12b. findHotels response is under 200 words', async () => {
    const response = await hotelsM.findHotels(
      CURRENT_LAT, CURRENT_LON, DEST_LAT, DEST_LON, {}, '2026-03-15', '2026-03-16'
    );
    const wc = wordCount(response);
    assert.ok(wc <= 200, `findHotels: ${wc} words (limit: 200)\n${response}`);
  });

  test('12c. getFlightStatus formatted response is under 200 words', async () => {
    const result  = await flightsM.getFlightStatus('AA100', '2026-03-15');
    const wc      = wordCount(result.formatted);
    assert.ok(wc <= 200, `flight formatted: ${wc} words (limit: 200)`);
  });

  test('12d. calculateDelayImpact formatted response ends with CTA', () => {
    const itinerary = [
      { name: 'Dunes Walk', category: 'soft', duration: 60 },
      { name: 'Hotel Check-In', category: 'hard' },
    ];
    const result = flightsM.calculateDelayImpact(90, itinerary);
    assert.ok(endsWithCTA(result.formatted),
      `Delay impact should end with CTA: "${result.formatted.slice(-80)}"`);
  });

  test('12e. findNearestHospital formatted is under 200 words', async () => {
    const result = await safetyM.findNearestHospital(CURRENT_LAT, CURRENT_LON);
    const wc = wordCount(result.formatted);
    assert.ok(wc <= 200, `hospital formatted: ${wc} words (limit: 200)`);
  });

  test('12f. calculateDepartureWindow formatted ends with CTA/instruction', async () => {
    const flightTime = new Date();
    flightTime.setHours(15, 0, 0, 0);
    const result = await flightsM.calculateDepartureWindow(
      flightTime, 37.619, -122.374, CURRENT_LAT, CURRENT_LON
    );
    assert.ok(
      result.formatted.includes('Leave by') || result.formatted.includes('leave by'),
      `Departure window should include "Leave by": "${result.formatted}"`
    );
    const wc = wordCount(result.formatted);
    assert.ok(wc <= 200, `departure window: ${wc} words (limit: 200)`);
  });

  // ── Bonus: isTight helper ────────────────────────────────────────────────
  test('Bonus: isTight detects schedule pressure correctly', () => {
    const { isTight } = require(path.join(ROOT, 'src/modules/intelligence/dining'));
    assert.equal(isTight({ driftMinutes: 25 }), true, 'drift>20 is tight');
    assert.equal(isTight({ hoursUntilNextHardCommitment: 0.5 }), true, '<1hr is tight');
    assert.equal(isTight({ driftMinutes: 10, hoursUntilNextHardCommitment: 2 }), false, 'relaxed schedule');
    assert.equal(isTight({}), false, 'empty context is not tight');
  });

  // ── Bonus: buildMapsLink edge cases ─────────────────────────────────────
  test('Bonus: buildMapsLink handles negative coordinates', () => {
    const link = routeSearch.buildMapsLink(-33.8688, 151.2093);  // Sydney
    assert.ok(link.includes('-33.8688'), 'Should include negative lat');
    assert.ok(link.includes('151.2093'), 'Should include positive lon');
    assert.ok(link.startsWith('https://www.google.com/maps/dir/?api=1&destination='));
  });

});
