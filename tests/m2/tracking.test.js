'use strict';

/**
 * RouteWise M2 Tests — GPS Tracking, State Machine & Schedule Engine
 *
 * 10 test cases using Node.js built-in test runner (node:test).
 * API-dependent modules (ETA, weather) are mocked — no real HTTP calls.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { distanceMeters, isWithinRadius, formatDistance, formatDuration } = require('../../src/utils/geo');
const { getActivityState, updateActivityStates } = require('../../src/modules/tracking/stateMachine');
const deferred = require('../../src/modules/tracking/deferredRequests');

// ── Test fixture coordinates ──────────────────────────────────────────────────
// Eugene, OR → Oregon Dunes NRA (~82 km apart)
const EUGENE  = { lat: 44.0521, lon: -123.0868 };
const DUNES   = { lat: 43.9154, lon: -124.1067 };

// A point ~40m from the Dunes activity (well within 1000m)
const NEAR_DUNES = { lat: 43.9151, lon: -124.1067 };

// A point ~1500m from the Dunes (between 1000m and 2000m → uncertain zone)
// 0.0135 degrees lat ≈ 1500m
const NEARBY_DUNES = { lat: 43.9289, lon: -124.1067 };

// A point >2000m away from Dunes (outside all proximity zones)
const FAR_FROM_DUNES = { lat: 43.9900, lon: -124.1067 };

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: distanceMeters returns correct result for known coordinates
// ─────────────────────────────────────────────────────────────────────────────

test('1. distanceMeters — correct result for Eugene → Oregon Dunes', () => {
  const dist = distanceMeters(EUGENE.lat, EUGENE.lon, DUNES.lat, DUNES.lon);

  // Eugene to Oregon Dunes NRA is ~82 km (within ±5km tolerance)
  assert.ok(dist > 75000, `Expected >75,000m, got ${dist.toFixed(0)}m`);
  assert.ok(dist < 95000, `Expected <95,000m, got ${dist.toFixed(0)}m`);

  // Identity check: distance from a point to itself is 0
  assert.strictEqual(distanceMeters(DUNES.lat, DUNES.lon, DUNES.lat, DUNES.lon), 0);

  // Near-Dunes should be within ~50m of Dunes
  const nearDist = distanceMeters(NEAR_DUNES.lat, NEAR_DUNES.lon, DUNES.lat, DUNES.lon);
  assert.ok(nearDist < 50, `Near-Dunes should be <50m, got ${nearDist.toFixed(1)}m`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: isWithinRadius — true when within 1000m, false when outside
// ─────────────────────────────────────────────────────────────────────────────

test('2. isWithinRadius — returns true within 1000m, false outside', () => {
  // Near-Dunes is ~40m from Dunes → within 1000m
  assert.ok(
    isWithinRadius(NEAR_DUNES.lat, NEAR_DUNES.lon, DUNES.lat, DUNES.lon, 1000),
    'Near-Dunes should be within 1000m of Dunes'
  );

  // Eugene is ~82km from Dunes → outside 1000m
  assert.ok(
    !isWithinRadius(EUGENE.lat, EUGENE.lon, DUNES.lat, DUNES.lon, 1000),
    'Eugene should NOT be within 1000m of Dunes'
  );

  // Identity: zero distance, any positive radius → true
  assert.ok(
    isWithinRadius(DUNES.lat, DUNES.lon, DUNES.lat, DUNES.lon, 1),
    'Same point should be within any positive radius'
  );

  // Nearby-Dunes is ~1500m → outside 1000m, inside 2000m
  assert.ok(
    !isWithinRadius(NEARBY_DUNES.lat, NEARBY_DUNES.lon, DUNES.lat, DUNES.lon, 1000),
    'Nearby-Dunes should be outside 1000m'
  );
  assert.ok(
    isWithinRadius(NEARBY_DUNES.lat, NEARBY_DUNES.lon, DUNES.lat, DUNES.lon, 2000),
    'Nearby-Dunes should be within 2000m'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: stateMachine — activity transitions to 'arrived' when within 1000m
// ─────────────────────────────────────────────────────────────────────────────

test('3. stateMachine — pending → arrived when within 1000m', () => {
  const activity = {
    id: 'dunes',
    name: 'Oregon Dunes NRA',
    lat: DUNES.lat,
    lon: DUNES.lon,
    state: 'pending',
    arrivedAt: null,
  };

  const newState = getActivityState(activity, NEAR_DUNES.lat, NEAR_DUNES.lon, 0);
  assert.strictEqual(newState, 'arrived');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: stateMachine — transitions to 'in-progress' after 20+ min at location
// ─────────────────────────────────────────────────────────────────────────────

test('4. stateMachine — arrived → in-progress after 20+ min at location', () => {
  const activity = {
    id: 'dunes',
    name: 'Oregon Dunes NRA',
    lat: DUNES.lat,
    lon: DUNES.lon,
    state: 'arrived',
    arrivedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(), // 25 min ago
  };

  // At location with 25 minutes elapsed → in-progress
  const newState = getActivityState(activity, NEAR_DUNES.lat, NEAR_DUNES.lon, 25);
  assert.strictEqual(newState, 'in-progress');

  // At location with only 10 minutes elapsed → still arrived
  const stillArrived = getActivityState(activity, NEAR_DUNES.lat, NEAR_DUNES.lon, 10);
  assert.strictEqual(stillArrived, 'arrived');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: stateMachine — transitions to 'completed' after leaving (>1000m away)
// ─────────────────────────────────────────────────────────────────────────────

test('5. stateMachine — in-progress → completed after moving >1000m away', () => {
  const activity = {
    id: 'dunes',
    name: 'Oregon Dunes NRA',
    lat: DUNES.lat,
    lon: DUNES.lon,
    state: 'in-progress',
    arrivedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
  };

  // Far from Dunes (>1000m) → completed
  const newState = getActivityState(activity, FAR_FROM_DUNES.lat, FAR_FROM_DUNES.lon, 90);
  assert.strictEqual(newState, 'completed');

  // Still at Dunes (within 1000m) → stays in-progress
  const stillInProgress = getActivityState(activity, NEAR_DUNES.lat, NEAR_DUNES.lon, 90);
  assert.strictEqual(stillInProgress, 'in-progress');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: stateMachine — returns 'uncertain' when between 1000m and 2000m
// ─────────────────────────────────────────────────────────────────────────────

test('6. stateMachine — returns uncertain when 1000m–2000m from unstarted activity', () => {
  const activity = {
    id: 'dunes',
    name: 'Oregon Dunes NRA',
    lat: DUNES.lat,
    lon: DUNES.lon,
    state: 'pending',
    arrivedAt: null,
  };

  // Nearby-Dunes is ~1500m → uncertain
  const newState = getActivityState(activity, NEARBY_DUNES.lat, NEARBY_DUNES.lon, 0);
  assert.strictEqual(newState, 'uncertain');

  // Verify the 'ask' event fires via updateActivityStates
  const itinerary = [{
    day: 1,
    activities: [{ ...activity }],
  }];

  const { events } = updateActivityStates(
    NEARBY_DUNES.lat, NEARBY_DUNES.lon, new Date().toISOString(), itinerary
  );

  const askEvent = events.find(e => e.type === 'ask');
  assert.ok(askEvent, 'Should emit an ask event for uncertain state');
  assert.strictEqual(askEvent.activityName, 'Oregon Dunes NRA');
  assert.ok(askEvent.question.includes('Oregon Dunes NRA'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: deferredRequests — same category override works correctly
// ─────────────────────────────────────────────────────────────────────────────

test('7. deferredRequests — same category overrides existing request', () => {
  deferred._reset(); // start fresh

  deferred.addRequest('lunch', 60, 'Find lunch in 1 hour', 44.0521, -123.0868);
  const afterFirst = deferred.getPendingRequests();
  assert.strictEqual(afterFirst.length, 1);
  assert.strictEqual(afterFirst[0].text, 'Find lunch in 1 hour');

  // Same category — should override
  deferred.addRequest('lunch', 30, 'Find lunch in 30 min', 44.0521, -123.0868);
  const afterSecond = deferred.getPendingRequests();
  assert.strictEqual(afterSecond.length, 1, 'Should still have exactly 1 request (override)');
  assert.strictEqual(afterSecond[0].text, 'Find lunch in 30 min', 'Should have the newer request');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: deferredRequests — different categories stack independently
// ─────────────────────────────────────────────────────────────────────────────

test('8. deferredRequests — different categories stack independently', () => {
  deferred._reset();

  deferred.addRequest('lunch', 60, 'Find lunch', 44.0521, -123.0868);
  deferred.addRequest('coffee', 30, 'Find coffee', 44.0521, -123.0868);

  const pending = deferred.getPendingRequests();
  assert.strictEqual(pending.length, 2, 'Both categories should be present');

  const categories = pending.map(r => r.category).sort();
  assert.deepStrictEqual(categories, ['coffee', 'lunch']);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: deferredRequests — request fires after delay elapses
// ─────────────────────────────────────────────────────────────────────────────

test('9. deferredRequests — request fires after delay elapses', () => {
  deferred._reset();

  // Add a request that fires immediately (0 minutes delay = fires right now)
  // We manipulate the firesAt directly by using -1 minute delay equivalent:
  // Instead, add request then manually backdate firesAt via a near-zero delay
  // and wait... but we don't want to sleep. Instead, add request with 0 delay
  // (fires at Date.now()) and check — but the comparison is <= so it fires.

  // Use a request set to fire 1ms ago by backdating via addRequest with 0 delay
  // then manually check. Since addRequest uses Date.now() + delay*60*1000,
  // 0 delay means firesAt = now, which satisfies firesAt <= now.
  deferred.addRequest('gas', 0, 'Check gas level', 44.0521, -123.0868);

  const fired = deferred.checkAndFire(44.0521, -123.0868);
  assert.strictEqual(fired.length, 1, 'Request with 0-min delay should fire immediately');
  assert.strictEqual(fired[0].category, 'gas');
  assert.strictEqual(fired[0].text, 'Check gas level');

  // Queue should be empty after firing
  const remaining = deferred.getPendingRequests();
  assert.strictEqual(remaining.length, 0, 'Queue should be empty after request fired');

  // Future request should NOT fire yet
  deferred.addRequest('hotel', 120, 'Find hotel', 44.0521, -123.0868);
  const notFired = deferred.checkAndFire(44.0521, -123.0868);
  assert.strictEqual(notFired.length, 0, 'Future request should not fire yet');
  assert.strictEqual(deferred.getPendingRequests().length, 1, 'Future request should remain in queue');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10: formatDuration and formatDistance return correctly formatted strings
// ─────────────────────────────────────────────────────────────────────────────

test('10. formatDuration and formatDistance — correct formatting', () => {
  // formatDuration
  assert.strictEqual(formatDuration(60),     '1 min',       '60 seconds → "1 min"');
  assert.strictEqual(formatDuration(1380),   '23 min',      '1380 seconds (23 min) → "23 min"');
  assert.strictEqual(formatDuration(3600),   '1 hr',        '3600 seconds (1 hr) → "1 hr"');
  assert.strictEqual(formatDuration(4500),   '1 hr 15 min', '4500 seconds (1h15m) → "1 hr 15 min"');
  assert.strictEqual(formatDuration(7200),   '2 hr',        '7200 seconds (2 hr) → "2 hr"');
  assert.strictEqual(formatDuration(9000),   '2 hr 30 min', '9000 seconds (2h30m) → "2 hr 30 min"');

  // formatDistance
  // 1609.344m = 1.0 mile
  assert.strictEqual(formatDistance(1609.344), '1.0 mi',  '1609.344m → "1.0 mi"');
  // 482.8m ≈ 0.3 miles
  const halfKm = formatDistance(482.8);
  assert.ok(halfKm.endsWith(' mi'), 'formatDistance should end with " mi"');
  assert.ok(halfKm.startsWith('0.3'), `482.8m should format as "0.3 mi", got ${halfKm}`);
  // 1931.3m ≈ 1.2 miles
  const onePointTwo = formatDistance(1931.3);
  assert.ok(onePointTwo.startsWith('1.2'), `1931.3m should format as "1.2 mi", got ${onePointTwo}`);
});
