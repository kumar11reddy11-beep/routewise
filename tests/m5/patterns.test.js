'use strict';

/**
 * RouteWise M5 Tests — Pattern Learning, Personality & Conflict Resolution
 *
 * 9 test cases using Node.js built-in test runner (node:test).
 * All pattern data is stored in an in-memory tripState object — no disk I/O.
 *
 * Test coverage:
 *  1. learnDeparturePattern: 20-min late → applyDepartureAdjustment returns 20 min earlier
 *  2. learnFoodPreference: casual chosen twice → getFoodBias returns 'casual'
 *  3. learnActivityPace: beach 30 min over → getActivityBuffer('beach') returns 30
 *  4. formatMessage: strips filler phrases
 *  5. formatMessage: enforces 200-word limit
 *  6. formatMessage: max 2 emoji enforced
 *  7. formatConflictResponse: returns correct waiting message
 *  8. formatErrorRecovery: formats correctly with next-best option
 *  9. hasConflict: correctly detects when 2 members pick different options
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { test }  = require('node:test');
const assert    = require('node:assert/strict');

const learner         = require('../../src/modules/patterns/learner');
const personality     = require('../../src/modules/patterns/personality');
const conflictResolver = require('../../src/modules/patterns/conflictResolver');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: create a fresh empty trip state with patterns namespace
// ─────────────────────────────────────────────────────────────────────────────
function freshState() {
  return {
    patterns: {},
    itinerary: [],
    budget: { total: 0, targets: {}, spent: {} },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Departure pattern: late departure adjusts future suggestion
// ─────────────────────────────────────────────────────────────────────────────
test('learnDeparturePattern: family departs 20 min late → applyDepartureAdjustment returns 20 min earlier', () => {
  const state = freshState();

  const planned  = new Date('2026-06-15T08:00:00Z');
  const actual   = new Date('2026-06-15T08:20:00Z'); // 20 min late

  learner.learnDeparturePattern(state, planned, actual);

  assert.ok(
    state.patterns?.departure?.observations?.length === 1,
    'Should have 1 departure observation'
  );
  assert.ok(
    Math.abs(state.patterns.departure.avgLateMins - 20) < 0.01,
    'Average lateness should be 20 min'
  );

  // Apply adjustment to a future planned departure at 09:00
  const futurePlanned  = new Date('2026-06-16T09:00:00Z');
  const adjusted       = learner.applyDepartureAdjustment(futurePlanned, state);

  // Adjusted should be ~20 min earlier than planned (08:40)
  const diffMs = futurePlanned.getTime() - adjusted.getTime();
  assert.ok(
    Math.abs(diffMs - 20 * 60 * 1000) < 1000,
    `Expected departure shifted 20 min earlier; got ${diffMs / 60000} min diff`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Food preference: casual chosen twice → getFoodBias returns 'casual'
// ─────────────────────────────────────────────────────────────────────────────
test('learnFoodPreference: casual chosen twice → getFoodBias returns casual', () => {
  const state = freshState();

  // Simulate choosing clearly casual options twice
  const casualOption  = { name: 'Roadside Burger Diner', priceLevel: 1 };
  const casualOption2 = { name: 'Taco Shack', priceLevel: 1 };
  const allOptions    = [
    { name: 'Roadside Burger Diner', priceLevel: 1 },
    { name: 'Upscale Bistro', priceLevel: 4 },
    { name: 'Taco Shack', priceLevel: 1 },
  ];

  learner.learnFoodPreference(state, casualOption,  allOptions);
  learner.learnFoodPreference(state, casualOption2, allOptions);

  const bias = learner.getFoodBias(state);
  assert.strictEqual(bias, 'casual', `Expected 'casual', got '${bias}'`);
  assert.strictEqual(state.patterns.food.choices.length, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Activity pace: beach 30 min over → getActivityBuffer('beach') = 30
// ─────────────────────────────────────────────────────────────────────────────
test('learnActivityPace: beach activity 30 min over → getActivityBuffer returns 30', () => {
  const state = freshState();

  learner.learnActivityPace(state, 'beach-day-1', 60, 90); // planned 60, actual 90 → +30

  const buffer = learner.getActivityBuffer('beach', state);
  assert.ok(
    Math.abs(buffer - 30) < 0.01,
    `Expected buffer of 30, got ${buffer}`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — formatMessage: strips filler phrases
// ─────────────────────────────────────────────────────────────────────────────
test('formatMessage: strips filler phrases from start of message', () => {
  const raw      = "Great! Here's your options. Which one?";
  const result   = personality.formatMessage(raw);

  // "Great!" should be removed; core content should remain
  assert.ok(
    !/^great!/i.test(result),
    `Message should not start with "Great!": "${result}"`
  );
  assert.ok(
    result.toLowerCase().includes("here's your options"),
    `Core content should be preserved: "${result}"`
  );
});

test('formatMessage: strips stacked filler phrases', () => {
  const raw    = "Sure! Absolutely! Here is the plan. What do you think?";
  const result = personality.formatMessage(raw);

  assert.ok(!/^sure!/i.test(result), 'Should strip "Sure!"');
  assert.ok(!/^absolutely!/i.test(result), 'Should strip "Absolutely!"');
  assert.ok(result.includes('Here is the plan'), 'Core content preserved');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — formatMessage: enforces 200-word limit
// ─────────────────────────────────────────────────────────────────────────────
test('formatMessage: enforces 200-word limit', () => {
  // Generate a 250-word message
  const word    = 'word';
  const longMsg = Array.from({ length: 250 }, () => word).join(' ') + ' Which option?';
  const result  = personality.formatMessage(longMsg);

  const wc = personality.wordCount(result);
  assert.ok(
    wc <= 205, // small slack for CTA append
    `Expected ≤200 words after formatting, got ${wc}`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — formatMessage: max 2 emoji enforced
// ─────────────────────────────────────────────────────────────────────────────
test('formatMessage: max 2 emoji enforced', () => {
  const raw    = '🍕🍔🌮🍣🦞 Great options! Which one?';
  const result = personality.formatMessage(raw);

  const emojiCount = personality.countEmoji(result);
  assert.ok(
    emojiCount <= 2,
    `Expected ≤2 emoji, got ${emojiCount} in: "${result}"`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — formatConflictResponse: correct waiting message
// ─────────────────────────────────────────────────────────────────────────────
test('formatConflictResponse: returns correct waiting message', () => {
  const msg = personality.formatConflictResponse();
  assert.ok(
    msg.includes("Seeing different votes"),
    `Expected conflict message, got: "${msg}"`
  );
  assert.ok(
    msg.includes("let me know when you've decided"),
    `Expected decision prompt, got: "${msg}"`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — formatErrorRecovery: formats correctly with next-best option
// ─────────────────────────────────────────────────────────────────────────────
test('formatErrorRecovery: formats correctly with next-best option', () => {
  const failedOption  = 'Pier Pizza';
  const nextBest      = {
    name:     'Seaside Grill',
    detail:   '4.2★ — 5 min detour',
    tradeoff: 'Slightly further but great views.',
    mapsLink: 'https://maps.google.com/example',
  };

  const result = personality.formatErrorRecovery(failedOption, nextBest);

  assert.ok(result.includes('Pier Pizza'), 'Should name the failed place');
  assert.ok(result.includes("didn't work out"), 'Should acknowledge failure');
  assert.ok(result.includes('Seaside Grill'), 'Should show next-best option name');
  assert.ok(result.includes('next best option'), 'Should use standard phrasing');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9 — hasConflict: detects when 2 members pick different options
// ─────────────────────────────────────────────────────────────────────────────
test('hasConflict: detects conflict when two members choose differently', () => {
  const reqId = 'test-request-001';

  // Start fresh
  conflictResolver.clearRequest(reqId);

  // No responses yet → no conflict
  assert.strictEqual(conflictResolver.hasConflict(reqId), false, 'No responses = no conflict');

  // First member picks option 1
  conflictResolver.trackResponse(reqId, 'parent1', '1');
  assert.strictEqual(conflictResolver.hasConflict(reqId), false, 'One response = no conflict');

  // Second member picks option 2 — CONFLICT!
  conflictResolver.trackResponse(reqId, 'parent2', '2');
  assert.strictEqual(conflictResolver.hasConflict(reqId), true, 'Two different choices = conflict');

  // Conflict message should contain the standard text
  const msg = conflictResolver.getConflictMessage(reqId);
  assert.ok(msg.includes("Seeing different votes"), 'Conflict message correct');

  // Cleanup
  conflictResolver.clearRequest(reqId);
  assert.strictEqual(conflictResolver.hasConflict(reqId), false, 'Cleared = no conflict');
});
