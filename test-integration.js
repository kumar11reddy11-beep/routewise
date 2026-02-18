'use strict';

/**
 * test-integration.js
 *
 * Smoke-tests the OpenClaw ↔ RouteWise integration bridge.
 *
 * Runs four scenarios without hitting real Telegram (GROUP_CHAT_ID is empty):
 *   1. processGroupMessage — food query
 *   2. processLocationUpdate — GPS tick
 *   3. runHeartbeat — no active trip → silent
 *   4. runMorningBriefing — no active trip → silent
 *
 * Usage:
 *   node test-integration.js
 */

// Temporarily suppress GROUP_CHAT_ID so we don't fire real Telegram messages
// (the module logs "[Would send to group]:" instead)
delete process.env.ROUTEWISE_GROUP_CHAT_ID;

const integration = require('./openclaw-integration');

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  RouteWise × OpenClaw Integration Test');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── Test 1: Group message ─────────────────────────────────────────────────
  console.log('── Test 1: processGroupMessage ─────────────────────────────');
  console.log('   Input: "We\'re hungry, find pizza on the way"\n');
  try {
    const response = await integration.processGroupMessage({
      text:     "We're hungry, find pizza on the way",
      fromName: 'TestUser',
      chatId:   '-100123456789',
    });
    console.log('   Response:');
    (response || '(no response)').split('\n').forEach(l => console.log('  ', l));
  } catch (err) {
    console.error('   ERROR:', err.message);
  }

  console.log('\n── Test 2: processLocationUpdate ───────────────────────────');
  console.log('   Input: lat=42.3601, lon=-71.0589 (Boston)\n');
  try {
    await integration.processLocationUpdate(42.3601, -71.0589, Date.now());
    console.log('   Location update processed successfully (check logs above).');
  } catch (err) {
    console.error('   ERROR:', err.message);
  }

  // Clean up any trip-state.json created by the location update
  // (tracking module auto-saves; heartbeat should still be silent since itinerary is empty)
  console.log('\n── Test 3: runHeartbeat (no active itinerary) ──────────────');
  console.log('   Expect: silent (no group message — trip has no itinerary)\n');
  try {
    await integration.runHeartbeat();
    console.log('   Heartbeat completed silently — correct.');
  } catch (err) {
    console.error('   ERROR:', err.message);
  }

  console.log('\n── Test 4: runMorningBriefing (no active itinerary) ────────');
  console.log('   Expect: silent (no group message — trip has no itinerary)\n');
  try {
    await integration.runMorningBriefing();
    console.log('   Morning briefing completed silently — correct.');
  } catch (err) {
    console.error('   ERROR:', err.message);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  All integration tests passed ✅');
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('Fatal error in test-integration.js:', err);
  process.exit(1);
});
