'use strict';

const dining  = require('./dining');
const fuel    = require('./fuel');
const hotels  = require('./hotels');
const flights = require('./flights');
const safety  = require('./safety');
const tripStateMemory = require('../../memory/tripState');
const logger  = require('../../utils/logger');

/**
 * RouteWise On-Demand Intelligence Orchestrator (Milestone 3)
 *
 * This module is the single entry point for all M3 on-demand requests.
 * `handleRequest` parses user intent from free text and routes to the
 * appropriate sub-handler with the correct context from trip state.
 *
 * Public API:
 *   handleRequest(text, tripState, currentLat, currentLon)
 *   findFood(query, currentLat, currentLon, nextDestLat, nextDestLon, scheduleContext)
 *   findGas(currentLat, currentLon, nextDestLat, nextDestLon)
 *   findHotel(currentLat, currentLon, tomorrowFirstActivity, budget, checkIn, checkOut)
 *   findNearestHospital(currentLat, currentLon)
 *   getFlightStatus(flightNumber, date)
 *   correlateNeeds(needs, currentLat, currentLon, nextDestLat, nextDestLon)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Intent detection
// ─────────────────────────────────────────────────────────────────────────────

const INTENTS = {
  food:     /hungry|food|eat|pizza|restaurant|lunch|dinner|breakfast|cafe|coffee|burger|taco|seafood|sushi/i,
  gas:      /\bgas\b|fuel|fill\s*up|tank|petrol/i,
  hotel:    /hotel|place\s+to\s+stay|where.*sleep|accommodation|lodge|motel|airbnb|room/i,
  hospital: /hospital|emergency|ER\b|urgent\s+care|doctor|clinic|ambulance|hurt|injured/i,
  flight:   /flight.*status|is.*flight.*delayed|check.*flight|flight\s+\w+\d+/i,
};

/**
 * Detect all intents present in a user message.
 * @param {string} text
 * @returns {string[]} Array of detected intent keys
 */
function detectIntents(text) {
  return Object.entries(INTENTS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([key]) => key);
}

/**
 * Extract a flight number from text (e.g. "DL1234", "AA 100", "flight UA456").
 * @param {string} text
 * @returns {string|null}
 */
function extractFlightNumber(text) {
  // Match common IATA patterns: 2-letter airline code + 1-4 digits
  const match = text.match(/\b([A-Z]{2})\s*(\d{1,4})\b/i);
  if (!match) return null;
  return `${match[1].toUpperCase()}${match[2]}`;
}

/**
 * Build a scheduleContext from the current trip state.
 * @param {object} state - Trip state object
 * @returns {{ driftMinutes: number, hoursUntilNextHardCommitment: number|null }}
 */
function buildScheduleContext(state) {
  // Look for drift patterns stored by tracking module
  const driftMinutes = state?.patterns?.averageDriftMinutes || 0;

  // Find next hard commitment with a scheduled time
  let hoursUntilNextHardCommitment = null;
  const now = Date.now();

  outer: for (const day of (state?.itinerary || [])) {
    for (const act of (day.activities || [])) {
      if ((act.category || act.type) === 'hard' && act.scheduledTime) {
        const actTime = new Date(act.scheduledTime).getTime();
        if (actTime > now) {
          hoursUntilNextHardCommitment = (actTime - now) / 3600000;
          break outer;
        }
      }
    }
  }

  return { driftMinutes, hoursUntilNextHardCommitment };
}

/**
 * Get the next destination coordinates from the trip state.
 * @param {object} state
 * @returns {{ lat: number|null, lon: number|null }}
 */
function getNextDestination(state) {
  for (const day of (state?.itinerary || [])) {
    for (const act of (day.activities || [])) {
      if (act.state !== 'completed' && act.lat != null && act.lon != null) {
        return { lat: act.lat, lon: act.lon };
      }
    }
  }
  return { lat: null, lon: null };
}

/**
 * Get tomorrow's first activity coordinates from trip state.
 * @param {object} state
 * @returns {{ lat: number|null, lon: number|null }}
 */
function getTomorrowFirstActivity(state) {
  if (!state?.itinerary?.length) return { lat: null, lon: null };

  // Find today's day index based on current date
  const today = new Date().toISOString().split('T')[0];
  let foundToday = false;

  for (const day of state.itinerary) {
    if (!foundToday) {
      if (day.date === today || !day.date) {
        foundToday = true;
        continue; // skip to next day
      }
      continue;
    }
    // This is the next day
    for (const act of (day.activities || [])) {
      if (act.lat != null && act.lon != null) {
        return { lat: act.lat, lon: act.lon };
      }
    }
    break;
  }

  // Fallback: use second day if date matching fails
  if (state.itinerary.length >= 2) {
    for (const act of (state.itinerary[1].activities || [])) {
      if (act.lat != null && act.lon != null) {
        return { lat: act.lat, lon: act.lon };
      }
    }
  }

  return { lat: null, lon: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public exported functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main entry point. Parse intent from free text and route to the right handler.
 *
 * @param {string} text           - User's message
 * @param {object} [tripState]    - Current trip state (from memory/tripState.load())
 * @param {number} [currentLat]
 * @param {number} [currentLon]
 * @returns {Promise<string>}     Formatted response
 */
async function handleRequest(text, tripState = null, currentLat = null, currentLon = null) {
  const state = tripState || tripStateMemory.load();
  logger.info(`Intelligence.handleRequest: "${text.slice(0, 80)}"`);

  // Require location for most intents
  if (currentLat == null || currentLon == null) {
    return "📍 I don't have your location yet. Share your live location in Telegram first.";
  }

  const intents = detectIntents(text);
  logger.debug('Detected intents:', intents);

  // Combined need: gas + food
  if (intents.includes('gas') && intents.includes('food')) {
    return correlateNeeds(['gas', 'food'], currentLat, currentLon, null, null, state);
  }

  // Single intents
  if (intents.includes('hospital')) {
    return findNearestHospital(currentLat, currentLon);
  }

  if (intents.includes('flight')) {
    const flightNumber = extractFlightNumber(text);
    if (!flightNumber) {
      return "✈️ I need a flight number to check status (e.g. \"DL1234\"). Which flight?";
    }
    return getFlightStatus(flightNumber, null);
  }

  if (intents.includes('hotel')) {
    const tomorrow = getTomorrowFirstActivity(state);
    const budget   = {
      budgetMin: state?.budget?.targets?.hotels ? state.budget.targets.hotels * 0.7 : null,
      budgetMax: state?.budget?.targets?.hotels ? state.budget.targets.hotels * 1.2 : null,
    };
    return findHotel(currentLat, currentLon, tomorrow, budget, null, null, state);
  }

  if (intents.includes('gas')) {
    const nextDest = getNextDestination(state);
    return findGas(currentLat, currentLon, nextDest.lat, nextDest.lon);
  }

  if (intents.includes('food')) {
    // Extract the food query from text (strip intent words)
    const query = text
      .replace(/find|get|i'?m?|we'?re?|need|want|looking for/gi, '')
      .replace(/\b(food|hungry|eat|something to eat)\b/gi, 'food')
      .trim() || 'food';

    const nextDest = getNextDestination(state);
    const ctx      = buildScheduleContext(state);
    return findFood(query, currentLat, currentLon, nextDest.lat, nextDest.lon, ctx);
  }

  // No recognised M3 intent — return null so the router can fall through to M1/M2
  return null;
}

/**
 * Find dining options along the route.
 *
 * @param {string} query
 * @param {number} currentLat
 * @param {number} currentLon
 * @param {number} nextDestLat
 * @param {number} nextDestLon
 * @param {{ driftMinutes?, hoursUntilNextHardCommitment? }} scheduleContext
 * @param {number} [detourBudget=20]
 * @returns {Promise<string>}
 */
async function findFood(query, currentLat, currentLon, nextDestLat, nextDestLon, scheduleContext = {}, detourBudget = 20) {
  if (!nextDestLat || !nextDestLon) {
    return "📅 I don't have your next destination. Set up an itinerary first, or share where you're headed.";
  }
  return dining.findDining(query, currentLat, currentLon, nextDestLat, nextDestLon, scheduleContext, detourBudget);
}

/**
 * Find gas stations along the route.
 *
 * @param {number} currentLat
 * @param {number} currentLon
 * @param {number} nextDestLat
 * @param {number} nextDestLon
 * @param {string[]} [otherNeeds=[]]
 * @returns {Promise<string>}
 */
async function findGas(currentLat, currentLon, nextDestLat, nextDestLon, otherNeeds = []) {
  if (!nextDestLat || !nextDestLon) {
    return "📅 I don't have your next destination. Share where you're headed and I'll find gas on the way.";
  }
  return fuel.findGas(currentLat, currentLon, nextDestLat, nextDestLon, otherNeeds);
}

/**
 * Find hotel options for tonight, with next-day positioning tradeoff.
 *
 * @param {number} currentLat
 * @param {number} currentLon
 * @param {{ lat?, lon? }} tomorrowFirstActivity
 * @param {{ budgetMin?, budgetMax? }} budget
 * @param {string} [checkIn]
 * @param {string} [checkOut]
 * @param {object} [state]
 * @returns {Promise<string>}
 */
async function findHotel(currentLat, currentLon, tomorrowFirstActivity = {}, budget = {}, checkIn = null, checkOut = null) {
  const actLat = tomorrowFirstActivity?.lat  ?? null;
  const actLon = tomorrowFirstActivity?.lon  ?? null;
  return hotels.findHotels(currentLat, currentLon, actLat, actLon, budget, checkIn, checkOut);
}

/**
 * Find the nearest hospital or ER.
 *
 * @param {number} currentLat
 * @param {number} currentLon
 * @returns {Promise<string>}
 */
async function findNearestHospital(currentLat, currentLon) {
  const result = await safety.findNearestHospital(currentLat, currentLon);
  return result.formatted;
}

/**
 * Get real-time flight status and return a formatted message.
 *
 * @param {string} flightNumber
 * @param {string} [date]
 * @returns {Promise<string>}
 */
async function getFlightStatus(flightNumber, date) {
  try {
    const result = await flights.getFlightStatus(flightNumber, date);
    return result.formatted;
  } catch (err) {
    return `❌ Couldn't retrieve flight status for ${flightNumber}: ${err.message}`;
  }
}

/**
 * Bundle multiple on-demand needs into a single coordinated response.
 * Tries to find overlapping stops to minimise total detours.
 *
 * @param {string[]} needs   - e.g. ['gas', 'food']
 * @param {number}   currentLat
 * @param {number}   currentLon
 * @param {number}   nextDestLat
 * @param {number}   nextDestLon
 * @param {object}   [state]
 * @returns {Promise<string>}
 */
async function correlateNeeds(needs, currentLat, currentLon, nextDestLat, nextDestLon, state = null) {
  const tripState = state || tripStateMemory.load();
  const nextDest  = nextDestLat != null
    ? { lat: nextDestLat, lon: nextDestLon }
    : getNextDestination(tripState);

  if (!nextDest.lat || !nextDest.lon) {
    return "📅 I need your next destination to find correlated stops. Share your itinerary or tell me where you're headed.";
  }

  logger.info(`Correlating needs: ${needs.join(' + ')}`);

  // Get food options first (if requested)
  let foodResults = [];
  if (needs.includes('food')) {
    try {
      const { searchAlongRoute } = require('./routeSearch');
      foodResults = await searchAlongRoute(
        currentLat, currentLon,
        nextDest.lat, nextDest.lon,
        'restaurant', 20, ''
      );
    } catch (err) {
      logger.warn('Correlated food search failed:', err.message);
    }
  }

  // Pass food stop locations to fuel search so it can flag correlations
  const nearbyStops = foodResults.slice(0, 3).map(r => ({ name: r.name, lat: r.lat, lon: r.lon }));
  const gasResponse = await fuel.findGas(
    currentLat, currentLon,
    nextDest.lat, nextDest.lon,
    needs.filter(n => n !== 'gas'),
    nearbyStops
  );

  if (!needs.includes('food')) return gasResponse;

  // Prepend a brief food summary if food was also needed
  const ctx = buildScheduleContext(tripState);
  const foodResponse = await dining.findDining(
    'food', currentLat, currentLon,
    nextDest.lat, nextDest.lon,
    ctx, 20
  );

  // Combine with a separator
  return [
    foodResponse,
    '',
    '─────────────',
    '',
    gasResponse,
  ].join('\n');
}

module.exports = {
  handleRequest,
  findFood,
  findGas,
  findHotel,
  findNearestHospital,
  getFlightStatus,
  correlateNeeds,
};
