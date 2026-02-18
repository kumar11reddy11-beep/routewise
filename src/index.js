'use strict';

require('dotenv').config();

const intake   = require('./modules/intake');
const tracking = require('./modules/tracking');
const logger   = require('./utils/logger');

/**
 * RouteWise Main Message Router
 *
 * Routes incoming messages to the appropriate module based on intent.
 * This is the single entry point for all user messages.
 *
 * Intent routing order (M2 additions inserted before M1 fallbacks):
 *   1. Location object present → handleLocationUpdate (GPS tick)
 *   2. Attachment present → handleDocument (M1)
 *   3. ETA/distance query → getETA
 *   4. Weather query → getWeatherForLocation
 *   5. Sunset/golden hour query → getSunsetInfo
 *   6. Deferred request → handleDeferredRequest
 *   7. Email check trigger → handleEmailCheck (M1)
 *   8. Trip briefing → handleTripBriefing (M1)
 *   9. General query → handleQuery (M1)
 *  10. Default → help message
 */

const INTENT_PATTERNS = {
  // M1
  emailCheck:   /check\s*(your\s*)?email|check\s+for\s+emails?|fetch\s+emails?/i,
  tripBriefing: /^day\s+\d+/im,
  query:        /what(?:'s|'s|\s+is)\s+(our|the|my)|when\s+(is|are)\s+(our|the|my)|how\s+much|what\s+time\s+is|what'?s\s+our|where\s+(is|are)\s+(our|the)|what\s+is\s+our/i,

  // M2
  etaQuery:     /\b(eta|how\s+far|how\s+long|when\s+(will\s+we|do\s+we)\s+(arrive|get|reach)|what'?s\s+our\s+eta)\b/i,
  weatherQuery: /\bweather\s+(at|in|for|near)\b|\bforecast\s+(at|in|for)\b/i,
  sunsetQuery:  /\b(sunset|golden\s+hour|sunrise)\b/i,
  // "[thing] in [N] hour(s)/min(s)/minute(s)"
  deferredReq:  /\bin\s+(\d+)\s*(hour|hr|minute|min)s?\b/i,
};

/**
 * Parse deferred request from text: "[thing] in [N] hour(s)/min(s)"
 * @param {string} text
 * @returns {{ category: string, delayMinutes: number, text: string }|null}
 */
function parseDeferredRequest(text) {
  const match = text.match(/^(.+?)\s+in\s+(\d+)\s*(hour|hr|minute|min)s?\b/i);
  if (!match) return null;

  const requestText  = match[1].trim();
  const amount       = parseInt(match[2], 10);
  const unit         = match[3].toLowerCase();
  const delayMinutes = (unit === 'hour' || unit === 'hr') ? amount * 60 : amount;

  // Derive category from first meaningful word
  const category = requestText.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');

  return { category, delayMinutes, text: requestText };
}

/**
 * Extract location name from a weather query.
 * "weather at Bandon Beach" → "Bandon Beach"
 * @param {string} text
 * @returns {string|null}
 */
function extractWeatherLocation(text) {
  const match = text.match(/weather\s+(?:at|in|for|near)\s+(.+?)(?:\?|$)/i)
    || text.match(/forecast\s+(?:at|in|for)\s+(.+?)(?:\?|$)/i);
  return match ? match[1].trim() : null;
}

/**
 * Route an incoming message to the correct module.
 *
 * @param {object} params
 * @param {string}   [params.text]        - Message text
 * @param {object[]} [params.attachments] - Array of attachment objects { filePath, mimeType, description }
 * @param {object}   [params.location]    - GPS location object { lat, lon, timestamp? } from Telegram live location
 * @returns {Promise<string>} Response to send back to the user
 */
async function handleMessage({ text = '', attachments = [], location = null } = {}) {
  logger.info('Routing message:', text.slice(0, 80).replace(/\n/g, ' '));

  try {
    // ── 1. Live location (GPS tick from Telegram) ─────────────────────────────
    if (location && location.lat != null && location.lon != null) {
      const ts = location.timestamp || new Date().toISOString();
      const result = await tracking.handleLocationUpdate(location.lat, location.lon, ts);

      const lines = [`📍 Location updated (${location.lat.toFixed(4)}, ${location.lon.toFixed(4)})`];

      for (const event of (result.events || [])) {
        if (event.type === 'stateChange') {
          const icons = { pending: '⏳', arrived: '📍', 'in-progress': '🚶', completed: '✅', uncertain: '❓' };
          lines.push(`${icons[event.to] || '→'} ${event.activityName}: ${event.from} → ${event.to}`);
        } else if (event.type === 'ask') {
          lines.push(`❓ ${event.question}`);
        }
      }

      for (const req of (result.firedRequests || [])) {
        lines.push(`⏰ Reminder: ${req.text}`);
      }

      return lines.join('\n');
    }

    // ── 2. Attachment → store document ────────────────────────────────────────
    if (attachments && attachments.length > 0) {
      const att = attachments[0];
      return await intake.handleDocument(
        att.filePath,
        att.mimeType || 'application/octet-stream',
        att.description || text || 'Uploaded document'
      );
    }

    // ── 3. ETA / distance query ───────────────────────────────────────────────
    if (INTENT_PATTERNS.etaQuery.test(text)) {
      const loc = tracking.getCurrentLocation();
      if (!loc.lat) {
        return "📍 I don't have your location yet. Share your live location in Telegram first.";
      }

      // Try to find next activity from itinerary
      const { load } = require('./memory/tripState');
      const state = load();
      let nextActivity = null;
      outer: for (const day of (state.itinerary || [])) {
        for (const act of (day.activities || [])) {
          if (act.lat != null && act.state !== 'completed') {
            nextActivity = act;
            break outer;
          }
        }
      }

      if (!nextActivity) {
        return "📅 No upcoming activities with coordinates in your itinerary.";
      }

      const result = await tracking.getETA(nextActivity);
      if (result.error) return `❌ ${result.error}`;

      const arrivalStr = result.arrivalTime instanceof Date
        ? result.arrivalTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        : result.arrivalTime;

      return `🗺️ ETA to ${result.destination}:\n⏱ ${result.durationText} (${result.distanceText})\n🕐 Arrive ~${arrivalStr}`;
    }

    // ── 4. Weather query ──────────────────────────────────────────────────────
    if (INTENT_PATTERNS.weatherQuery.test(text)) {
      const place = extractWeatherLocation(text);
      if (!place) {
        return "🌤 Try: \"weather at Bandon Beach\" or \"forecast in Gold Beach\"";
      }

      try {
        const w = await tracking.getWeatherForLocation(place);
        return `🌤 Weather at ${place}:\n${w.condition}, ${w.tempF}°F (${w.tempC.toFixed(0)}°C)\n💧 Humidity: ${w.humidity}% | 💨 Wind: ${w.windMph} mph`;
      } catch (err) {
        return `❌ Couldn't get weather for "${place}": ${err.message}`;
      }
    }

    // ── 5. Sunset / golden hour query ─────────────────────────────────────────
    if (INTENT_PATTERNS.sunsetQuery.test(text)) {
      const loc = tracking.getCurrentLocation();
      if (!loc.lat) {
        return "📍 Share your live location first so I can look up sunset for your position.";
      }

      try {
        const info = await tracking.getSunsetInfo(loc.lat, loc.lon, new Date());
        return `🌅 Today's sun info:\n🌄 Sunrise: ${info.sunrise}\n🌇 Sunset: ${info.sunset}\n📷 Golden hour: ${info.goldenHourStart} – ${info.goldenHourEnd}`;
      } catch (err) {
        return `❌ Couldn't fetch sunset info: ${err.message}`;
      }
    }

    // ── 6. Deferred request ───────────────────────────────────────────────────
    if (INTENT_PATTERNS.deferredReq.test(text)) {
      const parsed = parseDeferredRequest(text);
      if (parsed) {
        tracking.handleDeferredRequest(parsed.category, parsed.delayMinutes, parsed.text);
        const timeLabel = parsed.delayMinutes >= 60
          ? `${(parsed.delayMinutes / 60).toFixed(1)} hr`
          : `${parsed.delayMinutes} min`;
        return `⏰ Got it! I'll remind you about "${parsed.text}" in ${timeLabel}.`;
      }
    }

    // ── 7. Email check ────────────────────────────────────────────────────────
    if (INTENT_PATTERNS.emailCheck.test(text)) {
      return await intake.handleEmailCheck();
    }

    // ── 8. Trip briefing — multi-line plan starting with "Day 1" ─────────────
    if (INTENT_PATTERNS.tripBriefing.test(text)) {
      return await intake.handleTripBriefing(text);
    }

    // ── 9. Query about stored trip data ───────────────────────────────────────
    if (INTENT_PATTERNS.query.test(text)) {
      return await intake.handleQuery(text);
    }

    // ── 10. Default: help message ─────────────────────────────────────────────
    return [
      "I didn't understand that. Here's what I can do:\n",
      '📍 **Share your live location** — I\'ll track activities automatically',
      '🗺 **"What\'s our ETA?"** — get drive time to next stop',
      '🌤 **"Weather at [place]"** — current conditions',
      '🌅 **"When\'s sunset?"** — sunset + golden hour times',
      '⏰ **"[thing] in [N] hours/mins"** — set a deferred reminder',
      '📬 **"Check your email"** — parse forwarded booking confirmations',
      '📅 **Send your trip briefing** — start with "Day 1..."',
      '🔍 **Ask about your trip** — confirmation numbers, flights, hotels, etc.',
      '📎 **Share a document or photo** — license plate, confirmation screenshot, etc.',
    ].join('\n');

  } catch (err) {
    logger.error('Unhandled error in message router:', err.message, err.stack);
    return `❌ Something went wrong: ${err.message}. Please try again.`;
  }
}

module.exports = { handleMessage };

// ── CLI usage for testing ─────────────────────────────────────────────────────
if (require.main === module) {
  const text = process.argv.slice(2).join(' ') || 'What\'s our ETA?';
  handleMessage({ text }).then(console.log).catch(console.error);
}
