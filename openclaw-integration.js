'use strict';

/**
 * RouteWise ↔ OpenClaw Integration Bridge
 *
 * This module is the single seam between OpenClaw (which owns the Telegram
 * channel) and RouteWise (which owns trip intelligence).
 *
 * Exports:
 *   processGroupMessage(message)        — handle a Telegram group message
 *   processLocationUpdate(lat,lon,ts)   — handle a live-location GPS tick
 *   runHeartbeat()                      — 15-min proactive alert check
 *   runMorningBriefing()                — 6 AM daily briefing
 *   sendToGroup(text)                   — send text to the family group
 *
 * Environment variables (loaded from .env):
 *   TELEGRAM_BOT_TOKEN       — Telegram Bot API token (from openclaw.json)
 *   ROUTEWISE_GROUP_CHAT_ID  — Target group chat ID (set when group is created)
 */

require('dotenv').config({ path: __dirname + '/.env' });

const routewise        = require('./src/index');
const tracking         = require('./src/modules/tracking');
const proactive        = require('./src/modules/proactive');
const morningBriefing  = require('./src/modules/proactive/morningBriefing');
const tripState        = require('./src/memory/tripState');
const logger           = require('./src/utils/logger');
const https            = require('https');

const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_CHAT_ID  = process.env.ROUTEWISE_GROUP_CHAT_ID;

// ─────────────────────────────────────────────────────────────────────────────
// Telegram delivery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a message to the family Telegram group via the Bot API.
 * Uses native https — no extra dependencies.
 *
 * Falls back to logging when credentials are absent (dev/test mode).
 *
 * @param {string} text  — Message text (Markdown)
 * @returns {Promise<object|undefined>}  Telegram API response object, or undefined
 */
async function sendToGroup(text) {
  if (!BOT_TOKEN || !GROUP_CHAT_ID) {
    logger.warn('TELEGRAM_BOT_TOKEN or ROUTEWISE_GROUP_CHAT_ID not set — message not sent to group');
    logger.info('[Would send to group]:', text);
    return;
  }

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id:    GROUP_CHAT_ID,
      text,
      parse_mode: 'Markdown',
    });

    const options = {
      hostname: 'api.telegram.org',
      path:     `/bot${BOT_TOKEN}/sendMessage`,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.ok) {
            logger.warn('Telegram sendMessage failed:', parsed.description);
          } else {
            logger.info('Message sent to group (message_id:', parsed.result?.message_id, ')');
          }
          resolve(parsed);
        } catch (err) {
          logger.error('Failed to parse Telegram API response:', err.message);
          reject(err);
        }
      });
    });

    req.on('error', err => {
      logger.error('Telegram HTTPS request error:', err.message);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Message handling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a message from the Telegram family group.
 *
 * Called by OpenClaw whenever a message arrives in the group chat.
 * Passes the message into the RouteWise intelligence router and
 * sends the response back to the group.
 *
 * @param {object} params
 * @param {string}   params.text        — Message text
 * @param {object[]} [params.attachments] — Array of { filePath, mimeType, description }
 * @param {string}   [params.fromName]  — Sender's display name
 * @param {string}   [params.chatId]    — Source chat ID (for logging)
 * @returns {Promise<string|undefined>} The response that was sent, or undefined
 */
async function processGroupMessage({ text, attachments, fromName, chatId } = {}) {
  const preview = (text || '').substring(0, 80).replace(/\n/g, ' ');
  logger.info(`RouteWise: message from ${fromName || 'unknown'}: "${preview}"`);

  const response = await routewise.handleMessage({ text: text || '', attachments });

  if (response) {
    await sendToGroup(response);
    return response;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Location tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a live-location GPS update from Telegram.
 *
 * Feeds the coordinate into RouteWise tracking (activity state machine,
 * deferred requests), persists it in tripState for heartbeat use, and
 * sends any triggered messages back to the group.
 *
 * @param {number} lat        — Latitude
 * @param {number} lon        — Longitude
 * @param {number} [timestamp] — Unix ms timestamp (defaults to now)
 * @returns {Promise<void>}
 */
async function processLocationUpdate(lat, lon, timestamp) {
  logger.info(`RouteWise: location update (${lat}, ${lon})`);

  const ts     = timestamp || Date.now();
  const result = await tracking.handleLocationUpdate(lat, lon, ts);

  // Persist the latest GPS into tripState so heartbeat + morning briefing
  // can reference it even between live-location updates.
  tripState.updateCurrentLocation(lat, lon, ts);

  if (result?.message) {
    await sendToGroup(result.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Proactive: heartbeat
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the 15-minute proactive heartbeat.
 *
 * Called by the OpenClaw cron job every 15 minutes.
 * Silent when no trip is active or no alert condition is detected.
 * Sends an alert to the family group when an issue is found.
 *
 * @returns {Promise<void>}
 */
async function runHeartbeat() {
  const state = tripState.load();

  // No active trip — stay silent (cron job will reply HEARTBEAT_OK).
  // We require BOTH a tripId AND a non-empty itinerary, because the tracking
  // module auto-creates a tripId on any location update; we only want proactive
  // monitoring when the family has actually loaded their trip plan.
  const hasActiveTrip = state.tripId && Array.isArray(state.itinerary) && state.itinerary.length > 0;
  if (!hasActiveTrip) {
    logger.info('RouteWise heartbeat: no active trip or itinerary, skipping.');
    return;
  }

  const lat = state.currentLocation?.lat;
  const lon = state.currentLocation?.lon;

  if (lat == null || lon == null) {
    logger.info('RouteWise heartbeat: no GPS fix yet, skipping.');
    return;
  }

  const result = await proactive.runHeartbeat(state, lat, lon, Date.now());

  if (result?.mode === 'alert' && result?.message) {
    logger.info('RouteWise heartbeat: alert detected, sending to group.');
    await sendToGroup(result.message);
  } else {
    logger.info('RouteWise heartbeat: autopilot — no action needed.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Proactive: morning briefing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate and send the 6 AM morning briefing.
 *
 * Called by the OpenClaw cron job at 6:00 AM America/New_York every day.
 * Silent when no trip is active.
 *
 * @returns {Promise<void>}
 */
async function runMorningBriefing() {
  const state = tripState.load();

  // No active trip — stay silent (same guard as heartbeat: needs itinerary too)
  const hasActiveTrip = state.tripId && Array.isArray(state.itinerary) && state.itinerary.length > 0;
  if (!hasActiveTrip) {
    logger.info('RouteWise morning briefing: no active trip or itinerary, skipping.');
    return;
  }

  const lat  = state.currentLocation?.lat;
  const lon  = state.currentLocation?.lon;
  const date = new Date().toISOString().split('T')[0];

  logger.info(`RouteWise morning briefing: generating for ${date}`);

  // generateBriefing handles missing lat/lon gracefully
  const briefing = morningBriefing.generateBriefing(state, lat, lon, date);
  await sendToGroup(briefing);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  processGroupMessage,
  processLocationUpdate,
  runHeartbeat,
  runMorningBriefing,
  sendToGroup,
};
