'use strict';

/**
 * RouteWise M1 Test Suite — Trip Intake & Document Memory
 *
 * Uses the Node.js built-in test runner (node:test).
 * Run: node --test tests/m1/intake.test.js
 *
 * Tests:
 *   1. gmailParser correctly parses hotel confirmation fixture
 *   2. gmailParser correctly parses flight confirmation fixture
 *   3. classifier returns 'Hard Commitment' for a booked hotel
 *   4. classifier returns 'Soft Goal' for a beach visit
 *   5. classifier returns 'Open Slot' for "find a hotel near Gold Beach"
 *   6. briefingParser extracts day count from sample briefing
 *   7. tripState load/save round-trip
 *   8. tripState addBooking and findBooking
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Paths ─────────────────────────────────────────────────────────────────
const FIXTURES = path.join(__dirname, '../fixtures');

// ── Load modules under test ───────────────────────────────────────────────
const { parseEmail } = require('../../src/modules/intake/gmailParser');
const { classify } = require('../../src/modules/intake/classifier');
const { parseBriefing } = require('../../src/modules/intake/briefingParser');

// ── Test 1: Hotel email parsing ───────────────────────────────────────────
test('gmailParser — parses hotel confirmation email correctly', () => {
  const body = fs.readFileSync(path.join(FIXTURES, 'sample-hotel-email.txt'), 'utf8');
  const email = {
    id: 'test-hotel-001',
    subject: 'Booking confirmation – Pacific Reef Hotel & Spa, Gold Beach',
    from: 'confirmations@booking.com',
    date: 'Fri, 20 Jun 2025 09:00:00 +0000',
    body,
    attachments: [],
  };

  const result = parseEmail(email);

  assert.strictEqual(result.type, 'hotel', `Expected type 'hotel', got '${result.type}'`);
  assert.ok(result.data, 'Should return a data object');

  // Hotel name
  assert.ok(
    result.data.hotelName && /Pacific Reef/i.test(result.data.hotelName),
    `Expected hotelName to include "Pacific Reef", got: ${result.data.hotelName}`
  );

  // Confirmation number
  assert.ok(
    result.data.confirmationNumber && /BKG-7842916|9314/i.test(result.data.confirmationNumber),
    `Expected confirmationNumber to be BKG-7842916 or 9314, got: ${result.data.confirmationNumber}`
  );

  // Check-in date
  assert.ok(
    result.data.checkIn,
    `Expected checkIn to be extracted, got: ${result.data.checkIn}`
  );
  assert.ok(
    /June|2025|20/i.test(result.data.checkIn),
    `Expected checkIn to mention June 20 2025, got: ${result.data.checkIn}`
  );

  // Check-out date
  assert.ok(
    result.data.checkOut,
    `Expected checkOut to be extracted, got: ${result.data.checkOut}`
  );

  // Address
  assert.ok(
    result.data.address,
    `Expected address to be extracted, got: ${result.data.address}`
  );
  assert.ok(
    /Gold Beach|Ellensburg/i.test(result.data.address),
    `Expected address to mention Gold Beach, got: ${result.data.address}`
  );

  // Total cost
  assert.ok(
    result.data.totalCost,
    `Expected totalCost to be extracted, got: ${result.data.totalCost}`
  );
});

// ── Test 2: Flight email parsing ──────────────────────────────────────────
test('gmailParser — parses flight confirmation email correctly', () => {
  const body = fs.readFileSync(path.join(FIXTURES, 'sample-flight-email.txt'), 'utf8');
  const email = {
    id: 'test-flight-001',
    subject: 'Your eTicket Itinerary and Receipt for Confirmation KLMPX7',
    from: 'no-reply@delta.com',
    date: 'Mon, 15 May 2025 12:00:00 +0000',
    body,
    attachments: [],
  };

  const result = parseEmail(email);

  assert.strictEqual(result.type, 'flight', `Expected type 'flight', got '${result.type}'`);
  assert.ok(result.data, 'Should return a data object');

  // Flight number
  assert.ok(
    result.data.flightNumber && /DL1842|DL1255/i.test(result.data.flightNumber),
    `Expected flightNumber to be DL1842 or DL1255, got: ${result.data.flightNumber}`
  );

  // Confirmation number
  assert.ok(
    result.data.confirmationNumber && /KLMPX7/i.test(result.data.confirmationNumber),
    `Expected confirmationNumber to be KLMPX7, got: ${result.data.confirmationNumber}`
  );

  // Origin
  assert.ok(
    result.data.origin,
    `Expected origin to be extracted, got: ${result.data.origin}`
  );
  assert.ok(
    /Portland|PDX/i.test(result.data.origin),
    `Expected origin to mention Portland/PDX, got: ${result.data.origin}`
  );

  // Destination
  assert.ok(
    result.data.destination,
    `Expected destination to be extracted, got: ${result.data.destination}`
  );
  assert.ok(
    /San Francisco|SFO/i.test(result.data.destination),
    `Expected destination to mention San Francisco/SFO, got: ${result.data.destination}`
  );
});

// ── Test 3: Classifier — Hard Commitment ──────────────────────────────────
test('classifier — returns Hard Commitment for a booked hotel', () => {
  const items = [
    'Check in at Pacific Reef Hotel (confirmation BKG-7842916)',
    'Hotel booked at Chinook Winds Casino Resort, confirmation CWCR-4412',
    'Check-in at Curly Redwood Lodge — reservation confirmed',
    'Dinner reservation at Blackfish Café at 7:00 PM',
    'Flight DL1842 departs at 8:15 AM',
  ];

  for (const item of items) {
    const result = classify(item);
    assert.strictEqual(
      result, 'Hard Commitment',
      `Expected 'Hard Commitment' for: "${item}", got: '${result}'`
    );
  }
});

// ── Test 4: Classifier — Soft Goal ────────────────────────────────────────
test('classifier — returns Soft Goal for a beach visit', () => {
  const items = [
    'Walk along D River Beach at sunset',
    'Visit Heceta Head Lighthouse for photos',
    'Stop at the whale watching viewpoint',
    'Hike to Thor\'s Well at Cape Perpetua',
    'Explore tide pools along the coast',
    'Stout Grove trail — easy walk through redwoods',
    'Sunset at Crescent Beach overlook',
  ];

  for (const item of items) {
    const result = classify(item);
    assert.strictEqual(
      result, 'Soft Goal',
      `Expected 'Soft Goal' for: "${item}", got: '${result}'`
    );
  }
});

// ── Test 5: Classifier — Open Slot ────────────────────────────────────────
test('classifier — returns Open Slot for "find a hotel near Gold Beach"', () => {
  const items = [
    'Find a hotel somewhere near Gold Beach or Brookings for the night',
    'Lunch on the way — somewhere near Port Orford',
    'Need to find a gas station along the coast',
    'Looking for somewhere to grab breakfast',
    'TBD — might stop at the dunes if time allows',
    'Find us a place to eat in Bandon',
  ];

  for (const item of items) {
    const result = classify(item);
    assert.strictEqual(
      result, 'Open Slot',
      `Expected 'Open Slot' for: "${item}", got: '${result}'`
    );
  }
});

// ── Test 6: briefingParser — day count extraction ─────────────────────────
test('briefingParser — extracts correct day count from sample briefing', () => {
  const text = fs.readFileSync(path.join(FIXTURES, 'sample-briefing.txt'), 'utf8');
  const result = parseBriefing(text);

  assert.ok(result, 'Should return a parsed result');
  assert.ok(typeof result.dayCount === 'number', `dayCount should be a number, got: ${typeof result.dayCount}`);
  assert.strictEqual(result.dayCount, 3, `Expected 3 days, got: ${result.dayCount}`);

  // Verify itinerary structure
  assert.ok(Array.isArray(result.itinerary), 'itinerary should be an array');
  assert.strictEqual(result.itinerary.length, 3, `Expected 3 itinerary items, got: ${result.itinerary.length}`);

  // Verify budget parsing
  assert.ok(result.budget.total > 0, `Expected total budget > 0, got: ${result.budget.total}`);
  assert.strictEqual(result.budget.total, 2500, `Expected total budget $2500, got: $${result.budget.total}`);

  // Verify vehicle
  assert.ok(result.vehicle.type, `Expected vehicle type to be extracted, got: ${result.vehicle.type}`);
  assert.ok(/Honda|CR-?V/i.test(result.vehicle.type), `Expected Honda CR-V, got: ${result.vehicle.type}`);
  assert.strictEqual(result.vehicle.fuelRangeMiles, 350, `Expected 350 mile range, got: ${result.vehicle.fuelRangeMiles}`);

  // Verify flights extracted
  assert.ok(Array.isArray(result.flights), 'flights should be an array');
  assert.ok(result.flights.length >= 1, `Expected at least 1 flight, got: ${result.flights.length}`);
  const flightNumbers = result.flights.map(f => f.flightNumber);
  assert.ok(
    flightNumbers.includes('DL1842') || flightNumbers.includes('DL1255'),
    `Expected DL1842 or DL1255 in flights, got: ${flightNumbers.join(', ')}`
  );

  // Verify preferences
  assert.ok(result.preferences.maxDrivingHoursPerDay === 6, `Expected 6 driving hours, got: ${result.preferences.maxDrivingHoursPerDay}`);
});

// ── Test 7: tripState — load/save round-trip ──────────────────────────────
test('tripState — load and save round-trip with temp file', () => {
  // Override config to use a temp file
  const tmpFile = path.join(os.tmpdir(), `routewise-test-${Date.now()}.json`);
  process.env.TRIP_STATE_PATH = tmpFile;

  // Re-require config and tripState to pick up new env var
  // Clear require cache to force reload
  delete require.cache[require.resolve('../../src/config')];
  delete require.cache[require.resolve('../../src/memory/tripState')];

  const tripState = require('../../src/memory/tripState');

  try {
    // 1. Load should return default state if file doesn't exist
    const defaultState = tripState.load();
    assert.ok(defaultState, 'Should return a state object');
    assert.strictEqual(defaultState.tripId, null, 'Default tripId should be null');
    assert.ok(Array.isArray(defaultState.itinerary), 'itinerary should be empty array');

    // 2. Modify and save
    const modifiedState = {
      ...defaultState,
      tripId: 'test-trip-001',
      vehicle: { type: 'Honda CR-V', fuelRangeMiles: 350, currentFuelMiles: 200 },
    };
    tripState.save(modifiedState);

    // 3. Reload and verify persistence
    const reloaded = tripState.load();
    assert.strictEqual(reloaded.tripId, 'test-trip-001', `Expected tripId 'test-trip-001', got: ${reloaded.tripId}`);
    assert.strictEqual(reloaded.vehicle.type, 'Honda CR-V', `Expected vehicle 'Honda CR-V', got: ${reloaded.vehicle.type}`);
    assert.strictEqual(reloaded.vehicle.fuelRangeMiles, 350, `Expected fuelRange 350, got: ${reloaded.vehicle.fuelRangeMiles}`);
    assert.ok(reloaded.updatedAt, 'updatedAt should be set after save');

  } finally {
    // Cleanup temp file
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

// ── Test 8: tripState — addBooking and findBooking ────────────────────────
test('tripState — addBooking stores data and findBooking retrieves it', () => {
  const tmpFile = path.join(os.tmpdir(), `routewise-test-${Date.now()}.json`);
  process.env.TRIP_STATE_PATH = tmpFile;

  // Clear require cache
  delete require.cache[require.resolve('../../src/config')];
  delete require.cache[require.resolve('../../src/memory/tripState')];

  const tripState = require('../../src/memory/tripState');

  try {
    // 1. Add a hotel booking
    tripState.addBooking('hotels', {
      hotelName: 'Pacific Reef Hotel & Spa',
      confirmationNumber: 'BKG-7842916',
      checkIn: 'June 20, 2025',
      checkOut: 'June 21, 2025',
      address: '29362 Ellensburg Avenue, Gold Beach, OR 97444',
      totalCost: '175.82',
    });

    // 2. Add a flight booking
    tripState.addBooking('flights', {
      airline: 'Delta',
      flightNumber: 'DL1842',
      origin: 'Portland (PDX)',
      destination: 'San Francisco (SFO)',
      confirmationNumber: 'KLMPX7',
      departureTime: '8:15 AM',
    });

    // 3. Verify hotels stored correctly
    const hotels = tripState.getBookings('hotels');
    assert.ok(Array.isArray(hotels), 'hotels should be an array');
    assert.strictEqual(hotels.length, 1, `Expected 1 hotel, got: ${hotels.length}`);
    assert.strictEqual(hotels[0].hotelName, 'Pacific Reef Hotel & Spa');
    assert.strictEqual(hotels[0].confirmationNumber, 'BKG-7842916');

    // 4. Verify flights stored correctly
    const flights = tripState.getBookings('flights');
    assert.ok(Array.isArray(flights), 'flights should be an array');
    assert.strictEqual(flights.length, 1, `Expected 1 flight, got: ${flights.length}`);
    assert.strictEqual(flights[0].flightNumber, 'DL1842');

    // 5. findBooking by confirmation number
    const foundByConf = tripState.findBooking({ confirmationNumber: 'BKG-7842916' });
    assert.ok(Array.isArray(foundByConf), 'findBooking should return an array');
    assert.ok(foundByConf.length > 0, 'Should find the hotel by confirmation number');
    assert.strictEqual(foundByConf[0].hotelName, 'Pacific Reef Hotel & Spa');
    assert.strictEqual(foundByConf[0]._type, 'hotels');

    // 6. findBooking by hotel name (partial match)
    const foundByName = tripState.findBooking({ hotelName: 'pacific reef' });
    assert.ok(foundByName.length > 0, 'Should find hotel by partial name (case-insensitive)');

    // 7. findBooking with no match
    const notFound = tripState.findBooking({ confirmationNumber: 'NONEXISTENT' });
    assert.ok(Array.isArray(notFound), 'Should return empty array for no match');
    assert.strictEqual(notFound.length, 0, 'Should return 0 results for non-existent booking');

    // 8. getSummary should include booking counts
    const summary = tripState.getSummary();
    assert.ok(typeof summary === 'string', 'getSummary should return a string');
    assert.ok(/Hotels:\s*1/i.test(summary), `Summary should show 1 hotel, got: ${summary}`);
    assert.ok(/Flights:\s*1/i.test(summary), `Summary should show 1 flight, got: ${summary}`);

  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});
