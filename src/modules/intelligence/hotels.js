'use strict';

const hotelService = require('../../services/hotels');
const maps         = require('../../services/maps');
const logger       = require('../../utils/logger');

/**
 * RouteWise Hotel Intelligence (PRD Section 8.3)
 *
 * Hotel suggestions factor in:
 *   - Budget filtering
 *   - Drive time from tonight's current position
 *   - Drive time to tomorrow's first activity (next-day positioning tradeoff)
 *   - 5 PM trigger: proactively nudge if no hotel is booked
 *
 * Returns a formatted Telegram-ready message with 2–3 options.
 */

/**
 * Format a drive time in minutes as a human string.
 *
 * @param {number|null} minutes
 * @returns {string}
 */
function formatDriveTime(minutes) {
  if (minutes == null) return 'unknown drive';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

/**
 * Get drive time in minutes between two lat/lon pairs via Google Directions.
 * Returns null if the route can't be calculated.
 *
 * @param {number} fromLat
 * @param {number} fromLon
 * @param {number} toLat
 * @param {number} toLon
 * @returns {Promise<number|null>} Minutes
 */
async function getDriveMinutes(fromLat, fromLon, toLat, toLon) {
  try {
    const data = await maps.directions(fromLat, fromLon, toLat, toLon);
    const leg  = data?.routes?.[0]?.legs?.[0];
    if (!leg) return null;
    const seconds = (leg.duration_in_traffic?.value) ?? leg.duration?.value ?? null;
    return seconds != null ? Math.round(seconds / 60) : null;
  } catch (err) {
    logger.warn(`Drive time calc failed: ${err.message}`);
    return null;
  }
}

/**
 * Build a positioning note comparing two hotels' proximity to tomorrow's first activity.
 *
 * @param {number|null} minutesA  - Hotel A's drive time to tomorrow's activity
 * @param {number|null} minutesB  - Hotel B's drive time to tomorrow's activity
 * @param {string}      nameA
 * @param {string}      nameB
 * @returns {string}              e.g. "35 min closer to tomorrow's first stop"
 */
function positioningNote(minutesToActivity, bestMinutesToActivity) {
  if (minutesToActivity == null) return '';
  if (bestMinutesToActivity == null) return '';

  const diff = minutesToActivity - bestMinutesToActivity;
  if (Math.abs(diff) < 5) return '⭐ Best positioning for tomorrow';
  if (diff < 0) return `⭐ ${Math.abs(diff)} min closer to tomorrow's first stop`;
  return `${diff} min further from tomorrow's first stop`;
}

/**
 * Find hotels along the route and format a Telegram-ready response.
 *
 * @param {number}  currentLat              - Family's current position
 * @param {number}  currentLon
 * @param {number}  tomorrowActivityLat     - Tomorrow's first activity coordinates
 * @param {number}  tomorrowActivityLon
 * @param {object}  [budget={}]             - { budgetMin, budgetMax } per night in USD
 * @param {string}  [checkIn]               - YYYY-MM-DD (defaults to today)
 * @param {string}  [checkOut]              - YYYY-MM-DD (defaults to tomorrow)
 * @param {string}  [budgetAwareness]       - 'over'|'on-track'|'under' from budgetTracker (M4)
 * @returns {Promise<string>}               Formatted message
 */
async function findHotels(
  currentLat, currentLon,
  tomorrowActivityLat, tomorrowActivityLon,
  budget = {},
  checkIn         = null,
  checkOut        = null,
  budgetAwareness = null
) {
  logger.info(`Hotel search near (${currentLat},${currentLon}), tomorrow activity at (${tomorrowActivityLat},${tomorrowActivityLon})`);

  // Default dates
  const today    = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const ci = checkIn  || today.toISOString().split('T')[0];
  const co = checkOut || tomorrow.toISOString().split('T')[0];

  // Search within 15 km radius of current position
  let hotels = [];
  try {
    hotels = await hotelService.searchNear({
      lat:      currentLat,
      lon:      currentLon,
      checkIn:  ci,
      checkOut: co,
      guests:   2,
      radiusKm: 15,
      minPrice: budget.budgetMin,
      maxPrice: budget.budgetMax,
    });
  } catch (err) {
    logger.error('Hotel service failed:', err.message);
    return `❌ Couldn't search hotels right now: ${err.message}`;
  }

  if (!hotels.length) {
    const budgetNote = budget.budgetMax ? ` within $${budget.budgetMin || 0}–$${budget.budgetMax}/night` : '';
    return `🏨 No hotels found${budgetNote} near your current location. Try expanding the budget or searching a different area.`;
  }

  // ── M4 Budget-awareness filtering (PRD §9.3) ─────────────────────────────
  // Over budget → only show options under the budget max
  // Under budget → include one upgrade option (sorted by price desc) if available
  let filteredHotels = hotels;

  if (budgetAwareness === 'over' && budget.budgetMax) {
    const affordable = hotels.filter(h => !h.pricePerNight || h.pricePerNight <= budget.budgetMax);
    if (affordable.length > 0) {
      filteredHotels = affordable;
      logger.info(`Budget-over mode: filtered to ${filteredHotels.length} affordable options`);
    }
  } else if (budgetAwareness === 'under' && budget.budgetMax) {
    // Keep normal options; append one upgrade if there's a pricier option above budgetMax
    const upgrade = hotels.find(h => h.pricePerNight && h.pricePerNight > budget.budgetMax);
    if (upgrade) {
      // Mark the upgrade option so we can annotate it
      upgrade._upgradeOption = true;
      const base = hotels.filter(h => !h._upgradeOption).slice(0, 2);
      filteredHotels = [...base, upgrade];
      logger.info('Budget-under mode: added one upgrade option');
    }
  }

  // Cap at 3 options
  const options = filteredHotels.slice(0, 3);

  // Calculate drive times: current→hotel and hotel→tomorrow's activity
  const driveTimes = await Promise.all(options.map(async h => {
    if (!h.lat || !h.lon) return { toHotel: null, toActivity: null };
    const [toHotel, toActivity] = await Promise.all([
      getDriveMinutes(currentLat, currentLon, h.lat, h.lon),
      tomorrowActivityLat != null
        ? getDriveMinutes(h.lat, h.lon, tomorrowActivityLat, tomorrowActivityLon)
        : Promise.resolve(null),
    ]);
    return { toHotel, toActivity };
  }));

  // Find best positioning (lowest drive time to tomorrow's activity)
  const activityTimes    = driveTimes.map(d => d.toActivity).filter(t => t != null);
  const bestActivityTime = activityTimes.length ? Math.min(...activityTimes) : null;

  // Format message
  const lines = ['🏨 Hotel options for tonight:\n'];

  options.forEach((h, i) => {
    const stars       = h.stars ? '★'.repeat(Math.round(h.stars)) : '';
    const rating      = h.rating ? `${h.rating}/10` : '';
    const price       = h.pricePerNight ? `$${Math.round(h.pricePerNight)}/night` : 'Price TBD';
    const dt          = driveTimes[i];
    const tonight     = dt.toHotel != null ? formatDriveTime(dt.toHotel) + ' to get there' : '';
    const posNote     = positioningNote(dt.toActivity, bestActivityTime);
    const bookUrl     = h.bookingLink || 'booking.com';
    const upgradeNote = h._upgradeOption ? "💎 Upgrade — you've got budget room for this one" : '';

    lines.push(`${i + 1}. ${h.name}${stars ? ' ' + stars : ''}`);
    lines.push(`   ${price}${rating ? ' — ' + rating : ''}`);
    if (upgradeNote) lines.push(`   ${upgradeNote}`);
    if (tonight)     lines.push(`   🚗 ${tonight}`);
    if (posNote)     lines.push(`   ${posNote}`);
    if (h.lat && h.lon) {
      const mapsLink = `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lon}`;
      lines.push(`   📍 ${mapsLink}`);
    }
    lines.push(`   🔗 ${bookUrl}`);
    if (i < options.length - 1) lines.push('');
  });

  lines.push('');
  lines.push('Availability can thin fast — want to lock one in?');

  return lines.join('\n');
}

/**
 * Check whether the 5 PM hotel nudge should fire.
 * Returns true when it's past 5 PM and no hotel is booked for tonight.
 *
 * @param {number} currentHour  - Hour in 24h format (0–23), local time
 * @param {object} tripStateObj - Trip state object (from memory/tripState.load())
 * @returns {boolean}
 */
function checkFivePMTrigger(currentHour, tripStateObj = {}) {
  if (currentHour < 17) return false;   // before 5 PM

  const hotels = tripStateObj?.bookings?.hotels || [];
  if (!hotels.length) return true;      // no hotels at all → trigger

  // Check if any hotel booking covers tonight
  const today = new Date().toISOString().split('T')[0];
  const hasTonight = hotels.some(h => {
    const checkIn  = h.checkIn  || h.checkinDate  || '';
    const checkOut = h.checkOut || h.checkoutDate || '';
    return checkIn <= today && today < checkOut;
  });

  return !hasTonight;
}

module.exports = { findHotels, checkFivePMTrigger, getDriveMinutes, positioningNote };
