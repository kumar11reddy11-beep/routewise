'use strict';

require('dotenv').config();

const gmailService = require('../../services/gmail');
const { parseEmail } = require('./gmailParser');
const { classify } = require('./classifier');
const { parseBriefing } = require('./briefingParser');
const tripState = require('../../memory/tripState');
const logger = require('../../utils/logger');

/**
 * RouteWise M1 Intake Module
 *
 * Orchestrates the full Milestone 1 intake flow:
 *   - Gmail email checking & booking parsing
 *   - Natural language trip briefing intake
 *   - Document/photo storage
 *   - On-demand queries from trip state
 */

// ────────────────────────────────────────────────────────────────────────────
// handleEmailCheck
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fetch unread RouteWise emails, parse booking data, store in trip state,
 * mark emails as read, and return a user-facing summary.
 *
 * @returns {Promise<string>} Summary message to return to user
 */
async function handleEmailCheck() {
  logger.info('Starting email check...');

  let emails;
  try {
    emails = await gmailService.fetchRouteWiseEmails();
  } catch (err) {
    logger.error('Gmail fetch failed:', err.message);
    return `❌ Couldn't reach Gmail: ${err.message}`;
  }

  if (!emails.length) {
    return '📭 No new booking emails found. (Check that emails have the "RouteWise" label and are unread.)';
  }

  const summary = [];
  let parsed = 0;

  for (const email of emails) {
    try {
      const result = parseEmail(email);
      const { type, data } = result;

      if (type === 'unknown') {
        logger.warn(`Couldn't classify email: "${email.subject}"`);
        summary.push(`⚠️  "${email.subject}" — couldn't identify booking type`);
      } else {
        // Store in trip state
        tripState.addBooking(type, { ...data, emailId: email.id, emailSubject: email.subject, emailDate: email.date });

        // Format summary line
        switch (type) {
          case 'hotel':
            summary.push(`🏨 Hotel: ${data.hotelName || 'Unknown'} (Conf: ${data.confirmationNumber || 'N/A'})`);
            break;
          case 'flight':
            summary.push(`✈️  Flight: ${data.flightNumber || 'N/A'} — ${data.origin || '?'} → ${data.destination || '?'} (Conf: ${data.confirmationNumber || 'N/A'})`);
            break;
          case 'carRental':
            summary.push(`🚙 Car Rental: ${data.company || 'Unknown'} — Pickup: ${data.pickupLocation || 'N/A'} (Conf: ${data.confirmationNumber || 'N/A'})`);
            break;
        }
        parsed++;
      }

      // Mark email as read
      await gmailService.markAsRead(email.id);
    } catch (err) {
      logger.error(`Error processing email "${email.subject}":`, err.message);
      summary.push(`❌ Error parsing "${email.subject}": ${err.message}`);
    }
  }

  const header = `📬 Found ${emails.length} new email(s). Parsed ${parsed} booking(s):`;
  return [header, ...summary].join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// handleTripBriefing
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse a natural language trip briefing, classify each itinerary item,
 * merge with existing trip state, and return a confirmation summary.
 *
 * @param {string} text - Raw trip briefing text from user
 * @returns {Promise<string>} Confirmation message
 */
async function handleTripBriefing(text) {
  logger.info('Parsing trip briefing...');

  const parsed = parseBriefing(text);
  const state = tripState.load();

  // ── Merge vehicle ─────────────────────────────────────────────────────────
  if (parsed.vehicle.type) {
    state.vehicle.type = parsed.vehicle.type;
    state.vehicle.fuelRangeMiles = parsed.vehicle.fuelRangeMiles;
  }

  // ── Merge budget ──────────────────────────────────────────────────────────
  if (parsed.budget.total > 0) {
    state.budget.total = parsed.budget.total;
    state.budget.targets = { ...state.budget.targets, ...parsed.budget.targets };
  }

  // ── Merge preferences ─────────────────────────────────────────────────────
  state.preferences = { ...state.preferences, ...parsed.preferences };

  // ── Merge itinerary with classification ───────────────────────────────────
  const classifiedDays = parsed.itinerary.map(day => ({
    ...day,
    activities: day.activities.map(activity => ({
      description: activity,
      classification: classify(activity),
    })),
  }));
  state.itinerary = classifiedDays;

  // ── Merge flights (from briefing text) ────────────────────────────────────
  for (const flight of parsed.flights) {
    // Avoid duplicates
    const exists = state.bookings.flights.some(f => f.flightNumber === flight.flightNumber);
    if (!exists) {
      state.bookings.flights.push({ ...flight, source: 'briefing' });
    }
  }

  // ── Merge hotels (mentioned hotels) ──────────────────────────────────────
  for (const hotel of parsed.hotels) {
    const exists = state.bookings.hotels.some(h => h.hotelName === hotel.name);
    if (!exists) {
      state.bookings.hotels.push({ hotelName: hotel.name, date: hotel.date, source: 'briefing' });
    }
  }

  // ── Merge car rental reference ────────────────────────────────────────────
  if (parsed.carRental && !state.bookings.carRental) {
    state.bookings.carRental = { ...parsed.carRental, source: 'briefing' };
  }

  tripState.save(state);

  // ── Build response ────────────────────────────────────────────────────────
  const lines = [`✅ Got it! Trip briefing stored. Here's what I captured:\n`];

  if (parsed.dayCount > 0) {
    lines.push(`📅 **${parsed.dayCount}-day itinerary:**`);
    for (const day of classifiedDays) {
      lines.push(`\nDay ${day.day}:`);
      for (const act of day.activities) {
        const icon = act.classification === 'Hard Commitment' ? '🔒' :
                     act.classification === 'Soft Goal' ? '🌅' : '❓';
        lines.push(`  ${icon} ${act.description} [${act.classification}]`);
      }
    }
  }

  if (parsed.vehicle.type) {
    lines.push(`\n🚗 Vehicle: ${parsed.vehicle.type}${parsed.vehicle.fuelRangeMiles ? ` (~${parsed.vehicle.fuelRangeMiles} mi range)` : ''}`);
  }

  if (parsed.budget.total > 0) {
    lines.push(`💰 Budget: $${parsed.budget.total} total`);
  }

  if (parsed.flights.length > 0) {
    lines.push(`✈️  Flights mentioned: ${parsed.flights.map(f => f.flightNumber).join(', ')}`);
  }

  lines.push(`\nSend "Check your email" to pull in any forwarded booking confirmations.`);

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// handleDocument
// ────────────────────────────────────────────────────────────────────────────

/**
 * Store a reference to a document or photo in trip state.
 *
 * @param {string} filePath - Path or URL to the document
 * @param {string} mimeType - MIME type (image/jpeg, application/pdf, etc.)
 * @param {string} description - User-provided description
 * @returns {Promise<string>} Confirmation message
 */
async function handleDocument(filePath, mimeType, description) {
  logger.info(`Storing document: ${description} (${mimeType})`);

  tripState.addDocument({
    filePath,
    mimeType,
    description,
  });

  return `📎 Stored: "${description}". Ask me about it anytime — e.g., "What's our license plate?"`;
}

// ────────────────────────────────────────────────────────────────────────────
// handleQuery
// ────────────────────────────────────────────────────────────────────────────

/**
 * Answer a natural language question from the current trip state.
 *
 * @param {string} text - User question
 * @returns {Promise<string>} Answer based on stored trip data
 */
async function handleQuery(text) {
  const q = text.toLowerCase();
  const state = tripState.load();

  // ── Confirmation number queries ───────────────────────────────────────────
  if (/confirmation|conf\s*#|booking\s*#/.test(q)) {
    const results = [];
    for (const hotel of state.bookings.hotels) {
      if (hotel.confirmationNumber) results.push(`🏨 Hotel (${hotel.hotelName || 'Hotel'}): ${hotel.confirmationNumber}`);
    }
    for (const flight of state.bookings.flights) {
      if (flight.confirmationNumber) results.push(`✈️  Flight (${flight.flightNumber || 'Flight'}): ${flight.confirmationNumber}`);
    }
    if (state.bookings.carRental?.confirmationNumber) {
      results.push(`🚙 Car Rental (${state.bookings.carRental.company || 'Car'}): ${state.bookings.carRental.confirmationNumber}`);
    }
    if (!results.length) return "I don't have any confirmation numbers stored yet. Forward your booking emails or check them in again.";
    return `Here are your confirmation numbers:\n${results.join('\n')}`;
  }

  // ── Flight queries ────────────────────────────────────────────────────────
  if (/flight|fly|flying|depart|arrive/.test(q)) {
    if (!state.bookings.flights.length) return "I don't have any flight details stored yet.";
    const lines = state.bookings.flights.map(f =>
      `✈️  ${f.flightNumber || 'Flight'}: ${f.origin || '?'} → ${f.destination || '?'} | Dep: ${f.departureTime || f.date || 'N/A'} | Conf: ${f.confirmationNumber || 'N/A'}`
    );
    return `Your flights:\n${lines.join('\n')}`;
  }

  // ── Hotel queries ─────────────────────────────────────────────────────────
  if (/hotel|stay|staying|check.?in|check.?out|where.*sleep/.test(q)) {
    if (!state.bookings.hotels.length) return "I don't have any hotel bookings stored yet.";
    const lines = state.bookings.hotels.map(h =>
      `🏨 ${h.hotelName || 'Hotel'}: Check-in ${h.checkIn || 'N/A'}, Check-out ${h.checkOut || 'N/A'} | Conf: ${h.confirmationNumber || 'N/A'}`
    );
    return `Your hotels:\n${lines.join('\n')}`;
  }

  // ── Car rental queries ────────────────────────────────────────────────────
  if (/car\s*rental|rental\s*car|pickup|drop.?off/.test(q)) {
    const cr = state.bookings.carRental;
    if (!cr) return "I don't have car rental details stored yet.";
    return `🚙 Car Rental: ${cr.company || 'Unknown'}\n  Pickup: ${cr.pickupLocation || 'N/A'} at ${cr.pickupTime || 'N/A'}\n  Dropoff: ${cr.dropoffLocation || 'N/A'} at ${cr.dropoffTime || 'N/A'}\n  Vehicle: ${cr.vehicleType || 'N/A'}\n  Conf: ${cr.confirmationNumber || 'N/A'}`;
  }

  // ── Budget queries ────────────────────────────────────────────────────────
  if (/budget|spent|spending|how\s+much/.test(q)) {
    const { total, targets, spent } = state.budget;
    const totalSpent = Object.values(spent).reduce((a, b) => a + b, 0);
    const lines = [`💰 Budget: $${totalSpent} spent of $${total} total\n`];
    for (const cat of ['gas', 'food', 'hotels', 'activities', 'misc']) {
      lines.push(`  ${cat}: $${spent[cat]} spent / $${targets[cat]} budgeted`);
    }
    return lines.join('\n');
  }

  // ── Document recall ───────────────────────────────────────────────────────
  if (/document|photo|picture|image|license|plate/.test(q)) {
    if (!state.documents.length) return "I don't have any documents or photos stored yet.";
    const lines = state.documents.map((d, i) => `${i + 1}. ${d.description} (${d.mimeType})`);
    return `📎 Stored documents:\n${lines.join('\n')}`;
  }

  // ── General trip summary ──────────────────────────────────────────────────
  if (/summary|overview|trip|itinerary/.test(q)) {
    return tripState.getSummary();
  }

  return "I'm not sure what you're looking for. Try asking about: flights, hotels, confirmation numbers, car rental, budget, or documents.";
}

module.exports = { handleEmailCheck, handleTripBriefing, handleDocument, handleQuery };
