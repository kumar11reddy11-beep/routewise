'use strict';

/**
 * RouteWise M4 Tests — Proactive Alerts & Daily Rituals
 *
 * 13 test cases using Node.js built-in test runner (node:test).
 * All external API calls (ETA, weather, hotel search) are mocked — no HTTP.
 *
 * Test coverage (per spec):
 *  1.  runHeartbeat → { mode: 'autopilot', message: null } when on track
 *  2.  runHeartbeat → alert message when 40+ min schedule drift
 *  3.  weatherAlert → correct message for rain at outdoor activity
 *  4.  hotelNudge → fires after 5PM with no hotel booked
 *  5.  hotelNudge → does NOT fire before 5PM (checkFivePMTrigger)
 *  6.  generateBriefing → contains activities, weather, departure time
 *  7.  generateBriefing → wardrobe nudge when temp < 55°F
 *  8.  shouldSendLateStartFollowUp → true when GPS at hotel 30+ min past departure
 *  9.  detectHotelArrival → true when within 500m after 5PM
 * 10.  generateRecap → driving time, completed/skipped activities, budget summary
 * 11.  logExpense → correctly adds to category and updates total
 * 12.  getBudgetStatus → correct percentUsed and isOverBudget flag
 * 13.  noRepeatGuard → true (suppress) < 30 min, false > 30 min ago
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { test }   = require('node:test');
const assert     = require('node:assert/strict');
const path       = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Mock infrastructure
// We patch require.cache before loading modules under test so that any
// module that tries to load our mocked dependencies gets the fake version.
// ─────────────────────────────────────────────────────────────────────────────

// ── Fake ETA module ───────────────────────────────────────────────────────────
const etaPath = require.resolve('../../src/modules/tracking/eta');
require.cache[etaPath] = {
  id: etaPath, filename: etaPath, loaded: true,
  exports: {
    calculateETAsForItinerary: async (lat, lon, itinerary) => {
      // Return an empty array by default (no drift) — tests override via the
      // injected tripState or by swapping the mock.
      return [];
    },
    calculateETA: async () => ({
      durationSeconds: 1800, durationText: '30 min',
      distanceMeters: 40000, distanceText: '24.9 mi',
      arrivalTime: new Date(Date.now() + 1800000),
    }),
    geocodeLocation: async () => 'Mock Location, OR',
  },
};

// ── Fake weather module ───────────────────────────────────────────────────────
const weatherPath = require.resolve('../../src/modules/tracking/weather');
require.cache[weatherPath] = {
  id: weatherPath, filename: weatherPath, loaded: true,
  exports: {
    getWeather: async () => ({
      condition: 'Sunny', tempF: 72, tempC: 22, humidity: 55, windMph: 8,
    }),
    getSunsetInfo: async () => ({
      sunrise: '6:30 AM', sunset: '7:45 PM',
      goldenHourStart: '6:45 PM', goldenHourEnd: '7:35 PM',
    }),
    getWeatherForLocation: async () => ({
      condition: 'Partly cloudy', tempF: 65, tempC: 18, humidity: 60, windMph: 10,
    }),
  },
};

// ── Fake hotel service (needed by hotels intelligence module) ─────────────────
const hotelServicePath = require.resolve('../../src/services/hotels');
require.cache[hotelServicePath] = {
  id: hotelServicePath, filename: hotelServicePath, loaded: true,
  exports: {
    searchNear: async () => [],
  },
};

// ── Fake maps service ─────────────────────────────────────────────────────────
const mapsPath = require.resolve('../../src/services/maps');
require.cache[mapsPath] = {
  id: mapsPath, filename: mapsPath, loaded: true,
  exports: {
    directions: async () => ({ routes: [{ legs: [{ duration: { value: 1800 }, distance: { value: 40000 } }] }] }),
    places: async () => [],
    geocode: async () => ({ results: [{ formatted_address: 'Test Location, OR' }] }),
  },
};

// ── Fake stateMachine (prevents tripState.load() side effects) ────────────────
const stateMachinePath = require.resolve('../../src/modules/tracking/stateMachine');
require.cache[stateMachinePath] = {
  id: stateMachinePath, filename: stateMachinePath, loaded: true,
  exports: {
    updateActivityStates: (lat, lon, ts, itinerary) => ({
      itinerary: itinerary || [],
      events:    [],
    }),
    getActivityState: () => 'pending',
  },
};

// Load modules under test AFTER cache is patched
const proactive        = require('../../src/modules/proactive/index');
const alerts           = require('../../src/modules/proactive/alerts');
const budgetTracker    = require('../../src/modules/proactive/budgetTracker');
const morningBriefing  = require('../../src/modules/proactive/morningBriefing');
const endOfDay         = require('../../src/modules/proactive/endOfDay');
const hotelsIntel      = require('../../src/modules/intelligence/hotels');

// ─────────────────────────────────────────────────────────────────────────────
// Shared test fixtures
// ─────────────────────────────────────────────────────────────────────────────

// Oregon coast coordinates
const HOTEL_LAT   = 42.4240;
const HOTEL_LON   = -124.2960;  // Gold Beach, OR
const CURRENT_LAT = 42.4240;    // Same spot as hotel (at hotel)
const CURRENT_LON = -124.2960;

// A location far from the hotel (Bandon Beach, ~55 km north)
const FAR_LAT     = 43.1180;
const FAR_LON     = -124.4070;

// Basic trip state used across tests
function makeTripState(overrides = {}) {
  return {
    tripId: 'test-trip-001',
    budget: {
      total:    2500,
      targets:  { gas: 300, food: 500, hotels: 1200, activities: 300, misc: 200 },
      spent:    { gas: 0, food: 0, hotels: 0, activities: 0, misc: 0 },
      expenses: [],
    },
    bookings: { hotels: [], flights: [], carRental: null },
    itinerary: [
      {
        date:       '2026-03-01',
        activities: [
          {
            id:            'act-1',
            name:          'Oregon Dunes NRA',
            description:   'Oregon Dunes NRA',
            category:      'soft',
            state:         'pending',
            lat:           43.9154,
            lon:           -124.1067,
            scheduledTime: '2026-03-01T14:00:00.000Z',
            driveMinutes:  90,
          },
          {
            id:            'act-2',
            name:          'Bandon Beach Sunset',
            description:   'Bandon Beach Sunset',
            category:      'soft',
            state:         'pending',
            lat:           43.1180,
            lon:           -124.4070,
            scheduledTime: '2026-03-01T19:00:00.000Z',
            isOutdoor:     true,
          },
        ],
      },
      {
        date:       '2026-03-02',
        activities: [
          {
            id:          'act-3',
            name:        'Redwood National Park',
            description: 'Redwood National Park',
            category:    'soft',
            state:       'pending',
            lat:         41.2132,
            lon:         -124.0046,
            scheduledTime: '2026-03-02T10:00:00.000Z',
            driveMinutes: 120,
          },
        ],
      },
    ],
    preferences: {},
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: runHeartbeat returns { mode: 'autopilot', message: null } — no issues
// ─────────────────────────────────────────────────────────────────────────────

test('1. runHeartbeat — autopilot when everything on track', async () => {
  // ETA mock already returns [] (no drift) — no alerts should fire
  // Use a mid-morning timestamp (not 5 PM) and a trip state with a hotel booked
  const state = makeTripState({
    bookings: {
      hotels: [{
        checkIn:  '2026-03-01',
        checkOut: '2026-03-02',
        hotelName: 'Test Hotel Gold Beach',
      }],
      flights: [], carRental: null,
    },
  });

  const ts = new Date('2026-03-01T14:00:00.000Z');
  const result = await proactive.runHeartbeat(state, CURRENT_LAT, CURRENT_LON, ts);

  assert.equal(result.mode, 'autopilot', 'Expected autopilot mode');
  assert.equal(result.message, null, 'Expected null message in autopilot');
  assert.deepEqual(result.alerts, [], 'Expected empty alerts array');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: runHeartbeat returns alert when 40+ min schedule drift detected
// ─────────────────────────────────────────────────────────────────────────────

test('2. runHeartbeat — alert when 40+ min schedule drift', async () => {
  // Temporarily patch the ETA mock to return a 50-minute drift
  const etaMod = require.cache[etaPath];
  const originalFn = etaMod.exports.calculateETAsForItinerary;

  etaMod.exports.calculateETAsForItinerary = async () => [
    {
      activityId:       'act-1',
      activityName:     'Oregon Dunes NRA',
      scheduledTime:    '2026-03-01T14:00:00.000Z',
      estimatedArrival: new Date(Date.now() + 50 * 60 * 1000).toISOString(),
      durationText:     '2 hr 20 min',
      distanceText:     '82.5 mi',
      driftMinutes:     50,  // ← triggers alert
    },
  ];

  try {
    // Reset alertLastSent for 'schedule-drift' to ensure no suppression
    // (access via the module's internal state — we do this by loading a fresh module
    // instance or by clearing cache; simplest: just run with no prior state)
    const state = makeTripState({
      bookings: { hotels: [{ checkIn: '2026-03-01', checkOut: '2026-03-02' }], flights: [], carRental: null },
    });

    const ts     = new Date('2026-03-01T11:00:00.000Z');
    const result = await proactive.runHeartbeat(state, CURRENT_LAT, CURRENT_LON, ts);

    assert.equal(result.mode, 'alert', 'Expected alert mode for 50-min drift');
    assert.ok(result.message,         'Expected a non-null alert message');
    assert.ok(
      result.message.includes('50 min') || result.message.includes('behind'),
      `Alert should mention drift: "${result.message.slice(0, 80)}"`
    );
    assert.ok(result.alerts.length >= 1, 'Expected at least one alert entry');
  } finally {
    // Restore original mock
    etaMod.exports.calculateETAsForItinerary = originalFn;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: weatherAlert — correct message for rain at outdoor activity
// ─────────────────────────────────────────────────────────────────────────────

test('3. weatherAlert — rain at outdoor activity', () => {
  const forecast = {
    condition:    'Heavy Rain',
    tempF:        58,
    precipChance: 80,
  };
  const activity = { name: 'Bandon Beach Sunset', category: 'soft' };

  const msg = alerts.weatherAlert(forecast, activity);

  assert.ok(msg.includes('🌧'),                    'Should have rain emoji');
  assert.ok(msg.includes('Heavy Rain'),            'Should include condition');
  assert.ok(msg.includes('80%'),                   'Should include precip chance');
  assert.ok(msg.includes('Bandon Beach Sunset'),   'Should mention activity name');
  // Must offer 2-3 options (look for "1." and "2.")
  assert.ok(msg.includes('1.'),  'Should list option 1');
  assert.ok(msg.includes('2.'),  'Should list option 2');
  assert.ok(msg.includes('?'),   'Should end with a question / CTA');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: hotelNudge fires after 5PM with no hotel booked
// ─────────────────────────────────────────────────────────────────────────────

test('4. hotelNudge — fires after 5PM, no hotel booked', () => {
  // checkFivePMTrigger: after 5PM, no hotels array → should trigger
  const { checkFivePMTrigger } = hotelsIntel;
  const stateNoHotel = makeTripState({ bookings: { hotels: [], flights: [], carRental: null } });

  const triggered = checkFivePMTrigger(18, stateNoHotel);  // 6 PM
  assert.equal(triggered, true, 'Should trigger at 6PM with no hotel');

  // Also test the hotelNudge message content
  const tomorrowAct = { name: 'Redwood National Park' };
  const budget      = { budgetMin: 150, budgetMax: 200 };
  const msg         = alerts.hotelNudge(CURRENT_LAT, CURRENT_LON, tomorrowAct, budget);

  assert.ok(msg.includes('🏨'),                       'Should include hotel emoji');
  assert.ok(msg.includes('5 PM'),                     'Should mention 5 PM trigger');
  assert.ok(msg.includes('Redwood National Park'),    "Should mention tomorrow's activity");
  assert.ok(msg.includes('$150'),                     'Should show budget min');
  assert.ok(msg.includes('1.') && msg.includes('2.'), 'Should list options');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: hotelNudge does NOT fire before 5PM
// ─────────────────────────────────────────────────────────────────────────────

test('5. hotelNudge — does NOT fire before 5PM', () => {
  const { checkFivePMTrigger } = hotelsIntel;
  const stateNoHotel = makeTripState({ bookings: { hotels: [], flights: [], carRental: null } });

  // 3 PM (15:00) — should NOT trigger
  const triggered = checkFivePMTrigger(15, stateNoHotel);
  assert.equal(triggered, false, 'Should NOT trigger at 3PM even without hotel');

  // 4:59 PM (16) — still should not trigger
  const triggered2 = checkFivePMTrigger(16, stateNoHotel);
  assert.equal(triggered2, false, 'Should NOT trigger at 4PM');

  // 5 PM (17) — should trigger
  const triggered3 = checkFivePMTrigger(17, stateNoHotel);
  assert.equal(triggered3, true, 'Should trigger exactly at 5PM (hour=17)');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: generateBriefing contains activities, weather section, departure time
// ─────────────────────────────────────────────────────────────────────────────

test('6. generateBriefing — contains activities, weather, departure time', () => {
  const state = makeTripState();
  const date  = '2026-03-01';

  const weatherData = { condition: 'Partly cloudy', tempF: 65, precipChance: 10 };
  const sunsetData  = { sunset: '7:45 PM', goldenHourStart: '6:45 PM', goldenHourEnd: '7:35 PM' };

  const msg = morningBriefing.generateBriefing(
    state, CURRENT_LAT, CURRENT_LON, date,
    weatherData, sunsetData, 90
  );

  // Activities section
  assert.ok(msg.includes("Today's plan") || msg.includes("plan for today"), 'Should have activities section');
  assert.ok(msg.includes('Oregon Dunes NRA'), 'Should list first activity');
  assert.ok(msg.includes('Bandon Beach Sunset'), 'Should list second activity');

  // Weather section
  assert.ok(msg.includes('🌤') || msg.includes('Weather'), 'Should have weather section');
  assert.ok(msg.includes('Partly cloudy'),  'Should include weather condition');
  assert.ok(msg.includes('65°F'),           'Should include temperature');

  // Departure time suggestion
  assert.ok(
    msg.includes('🚀') || msg.includes('departure') || msg.includes('Departure'),
    'Should suggest a departure time'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: generateBriefing includes wardrobe nudge when temp < 55°F
// ─────────────────────────────────────────────────────────────────────────────

test('7. generateBriefing — wardrobe nudge when temp < 55°F', () => {
  const state = makeTripState();
  const date  = '2026-03-01';

  // Cold weather — 45°F
  const coldWeather = { condition: 'Overcast', tempF: 45, precipChance: 20 };

  const msg = morningBriefing.generateBriefing(
    state, CURRENT_LAT, CURRENT_LON, date, coldWeather, null, 60
  );

  assert.ok(
    msg.includes('🧥') || msg.includes('layers') || msg.includes('chilly'),
    `Should include cold-weather wardrobe nudge: "${msg.slice(0, 200)}"`
  );

  // Confirm hot weather nudge does NOT fire at 45°F
  assert.ok(
    !msg.includes('Hot day') && !msg.includes('hydrated'),
    'Should NOT show hot-weather nudge at 45°F'
  );

  // Separately verify hot weather nudge
  const hotWeather = { condition: 'Sunny', tempF: 92, precipChance: 0 };
  const hotMsg = morningBriefing.generateBriefing(
    state, CURRENT_LAT, CURRENT_LON, date, hotWeather, null, 60
  );
  assert.ok(
    hotMsg.includes('☀️') || hotMsg.includes('Hot') || hotMsg.includes('hydrated'),
    'Should show hot-weather nudge at 92°F'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: shouldSendLateStartFollowUp → true when GPS at hotel 30+ min past departure
// ─────────────────────────────────────────────────────────────────────────────

test('8. shouldSendLateStartFollowUp — true when at hotel 30+ min past departure', () => {
  const state = makeTripState();

  // Suggested departure was 45 minutes ago
  const departureTime = new Date(Date.now() - 45 * 60 * 1000);

  // Family is still at the hotel location (within 500m)
  const result = morningBriefing.shouldSendLateStartFollowUp(
    state,
    CURRENT_LAT,   // family lat = hotel lat
    CURRENT_LON,   // family lon = hotel lon
    HOTEL_LAT,     // hotel lat
    HOTEL_LON,     // hotel lon
    departureTime
  );

  assert.equal(result, true, 'Should send follow-up when at hotel 30+ min late');

  // Not late enough yet (only 15 minutes past)
  const recentDeparture = new Date(Date.now() - 15 * 60 * 1000);
  const resultNotLate = morningBriefing.shouldSendLateStartFollowUp(
    state, CURRENT_LAT, CURRENT_LON, HOTEL_LAT, HOTEL_LON, recentDeparture
  );
  assert.equal(resultNotLate, false, 'Should NOT send if only 15 min past departure');

  // Family is away from hotel (Bandon Beach — 55 km north)
  const resultFarAway = morningBriefing.shouldSendLateStartFollowUp(
    state, FAR_LAT, FAR_LON, HOTEL_LAT, HOTEL_LON, departureTime
  );
  assert.equal(resultFarAway, false, 'Should NOT send if family has already left');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: detectHotelArrival → true when within 500m after 5PM
// ─────────────────────────────────────────────────────────────────────────────

test('9. detectHotelArrival — true when within 500m after 5PM', () => {
  // Within 500m, at 7 PM → should return true
  const result1 = endOfDay.detectHotelArrival(
    CURRENT_LAT, CURRENT_LON,   // exactly at hotel
    HOTEL_LAT,   HOTEL_LON,
    19                           // 7 PM
  );
  assert.equal(result1, true, 'Should detect arrival at hotel at 7PM within 500m');

  // Within 500m, but BEFORE 5 PM → should return false
  const result2 = endOfDay.detectHotelArrival(
    CURRENT_LAT, CURRENT_LON,
    HOTEL_LAT,   HOTEL_LON,
    14                           // 2 PM
  );
  assert.equal(result2, false, 'Should NOT detect arrival before 5PM');

  // FAR from hotel (55 km north), after 5PM → should return false
  const result3 = endOfDay.detectHotelArrival(
    FAR_LAT, FAR_LON,
    HOTEL_LAT, HOTEL_LON,
    18                           // 6 PM
  );
  assert.equal(result3, false, 'Should NOT detect arrival when far from hotel');

  // Edge: exactly at 5PM (hour=17) → should trigger
  const result4 = endOfDay.detectHotelArrival(
    CURRENT_LAT, CURRENT_LON,
    HOTEL_LAT,   HOTEL_LON,
    17
  );
  assert.equal(result4, true, 'Should detect arrival at exactly 5PM (hour=17)');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10: generateRecap — driving time, completed/skipped, budget summary
// ─────────────────────────────────────────────────────────────────────────────

test('10. generateRecap — driving time, completed/skipped activities, budget summary', () => {
  const state = makeTripState();

  // Mark act-1 as completed, act-2 as pending (skipped)
  state.itinerary[0].activities[0].state = 'completed';
  state.itinerary[0].activities[1].state = 'pending';

  // Log some expenses
  budgetTracker.logExpense(state, 'gas', 45, 'Costco gas');
  budgetTracker.logExpense(state, 'food', 68, 'Dinner at Mo\'s');

  const date = '2026-03-01';
  const msg  = endOfDay.generateRecap(state, date, 120);

  // Driving summary — 90 min formats as "1 hr 30 min"
  assert.ok(
    msg.includes('🚗') || msg.includes('Driving') || msg.includes('drive'),
    'Should include driving time section'
  );
  assert.ok(
    msg.includes('1 hr 30 min') || msg.includes('1 hr') || msg.includes('30 min'),
    'Should include formatted drive time (90 min = 1 hr 30 min)'
  );

  // Activities completed/skipped
  assert.ok(msg.includes('✅') || msg.includes('completed'), 'Should show completed activities');
  assert.ok(msg.includes('⏭') || msg.includes('skipped'),   'Should show skipped activities');
  assert.ok(msg.includes('Oregon Dunes NRA'),               'Should name completed activity');
  assert.ok(msg.includes('Bandon Beach Sunset'),            'Should name skipped activity');

  // Budget
  assert.ok(msg.includes('🟢') || msg.includes('🟡') || msg.includes('🔴'), 'Should have budget emoji');
  assert.ok(msg.includes('$45') || msg.includes('45'),   'Should show gas expense');
  assert.ok(msg.includes('$68') || msg.includes('68'),   'Should show food expense');

  // Tomorrow preview
  assert.ok(msg.includes('Tomorrow') || msg.includes('tomorrow'), 'Should have tomorrow preview');
  assert.ok(msg.includes('Redwood National Park'),   "Should name tomorrow's first stop");
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11: logExpense — correctly adds to category and updates total
// ─────────────────────────────────────────────────────────────────────────────

test('11. logExpense — adds to category and updates total', () => {
  const state = makeTripState();

  // Log gas
  budgetTracker.logExpense(state, 'gas', 50, 'Shell station');
  assert.equal(state.budget.spent.gas, 50, 'Gas should be $50');

  // Log more gas
  budgetTracker.logExpense(state, 'gas', 25, 'Chevron');
  assert.equal(state.budget.spent.gas, 75, 'Gas should cumulate to $75');

  // Log food
  budgetTracker.logExpense(state, 'food', 68, 'Mo\'s Seafood');
  assert.equal(state.budget.spent.food, 68, 'Food should be $68');

  // Synonym: 'dinner' → maps to 'food'
  budgetTracker.logExpense(state, 'dinner', 55, 'Restaurant');
  assert.equal(state.budget.spent.food, 123, 'Food+dinner should accumulate: $123');

  // Expenses log should have 4 entries
  assert.equal(state.budget.expenses.length, 4, 'Should have 4 expense records');

  // Notes and timestamps stored
  const firstExp = state.budget.expenses[0];
  assert.equal(firstExp.category, 'gas',         'First expense category = gas');
  assert.equal(firstExp.amount,   50,             'First expense amount = 50');
  assert.equal(firstExp.note,     'Shell station', 'Note stored correctly');
  assert.ok(firstExp.loggedAt,                    'Timestamp stored');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 12: getBudgetStatus — correct percentUsed and isOverBudget
// ─────────────────────────────────────────────────────────────────────────────

test('12. getBudgetStatus — correct percentUsed and isOverBudget', () => {
  // Under budget: $500 spent of $2500 total = 20%
  const stateUnder = makeTripState();
  budgetTracker.logExpense(stateUnder, 'gas',   100, '');
  budgetTracker.logExpense(stateUnder, 'food',  150, '');
  budgetTracker.logExpense(stateUnder, 'hotels', 250, '');

  const statusUnder = budgetTracker.getBudgetStatus(stateUnder);
  assert.equal(statusUnder.totalSpent,    500,  'Total spent should be $500');
  assert.equal(statusUnder.totalBudget,   2500, 'Total budget should be $2500');
  assert.equal(statusUnder.percentUsed,   20,   'percentUsed = 20%');
  assert.equal(statusUnder.isOverBudget,  false, 'Should NOT be over budget');
  assert.equal(statusUnder.remainingBudget, 2000, 'Remaining = $2000');

  // Over budget: $2600 spent of $2500 total = 104%
  const stateOver = makeTripState();
  budgetTracker.logExpense(stateOver, 'hotels', 2600, 'Expensive resort');

  const statusOver = budgetTracker.getBudgetStatus(stateOver);
  assert.equal(statusOver.totalSpent,   2600, 'Total spent = $2600');
  assert.equal(statusOver.percentUsed,  104,  'percentUsed = 104%');
  assert.equal(statusOver.isOverBudget, true,  'Should be over budget');
  assert.equal(statusOver.remainingBudget, -100, 'Remaining = -$100');

  // byCategory breakdown
  assert.ok(statusUnder.byCategory.gas,        'byCategory.gas should exist');
  assert.equal(statusUnder.byCategory.gas.spent, 100, 'Gas spent = $100');
  assert.equal(statusUnder.byCategory.gas.target, 300, 'Gas target = $300');
  assert.equal(statusUnder.byCategory.gas.over,   false, 'Gas NOT over target');

  // getBudgetAwareness
  assert.equal(budgetTracker.getBudgetAwareness(stateUnder), 'under',    'Under budget → "under"');
  assert.equal(budgetTracker.getBudgetAwareness(stateOver),  'over',     'Over budget → "over"');

  const stateMid = makeTripState();
  budgetTracker.logExpense(stateMid, 'gas', 1800, 'Big expense'); // 72% → 'on-track'
  assert.equal(budgetTracker.getBudgetAwareness(stateMid), 'on-track', '72% → "on-track"');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 13: noRepeatGuard — suppresses < 30 min, allows > 30 min ago
// ─────────────────────────────────────────────────────────────────────────────

test('13. noRepeatGuard — suppress < 30 min, allow > 30 min', () => {
  const alertType = 'schedule-drift';

  // Never sent → should allow (false)
  assert.equal(alerts.noRepeatGuard(alertType, null), false, 'Never sent → allow');
  assert.equal(alerts.noRepeatGuard(alertType, undefined), false, 'Undefined → allow');

  // Sent 10 minutes ago → suppress (true)
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  assert.equal(alerts.noRepeatGuard(alertType, tenMinutesAgo), true,  '10 min ago → suppress');

  // Sent 29 minutes ago → still suppress (true)
  const twentyNineMinutesAgo = Date.now() - 29 * 60 * 1000;
  assert.equal(alerts.noRepeatGuard(alertType, twentyNineMinutesAgo), true, '29 min ago → suppress');

  // Sent 31 minutes ago → allow (false)
  const thirtyOneMinutesAgo = Date.now() - 31 * 60 * 1000;
  assert.equal(alerts.noRepeatGuard(alertType, thirtyOneMinutesAgo), false, '31 min ago → allow');

  // Sent 2 hours ago → allow (false)
  const twoHoursAgo = Date.now() - 120 * 60 * 1000;
  assert.equal(alerts.noRepeatGuard(alertType, twoHoursAgo), false, '2 hr ago → allow');

  // Works with Date object input
  const dateObj = new Date(Date.now() - 5 * 60 * 1000);
  assert.equal(alerts.noRepeatGuard(alertType, dateObj), true, 'Date object 5 min ago → suppress');

  // Works with ISO string input
  const isoString = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  assert.equal(alerts.noRepeatGuard(alertType, isoString), false, 'ISO string 45 min ago → allow');
});
