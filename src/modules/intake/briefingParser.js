'use strict';

/**
 * RouteWise Trip Briefing Parser
 *
 * Parses a natural language Trip Briefing message into a structured trip plan.
 * Handles: itinerary days, budget figures, vehicle details, flight numbers,
 * hotel mentions, car rental, and driving preferences.
 *
 * Per PRD Section 4.1 — Trip Briefing Contents.
 */

// ────────────────────────────────────────────────────────────────────────────
// Regex Patterns
// ────────────────────────────────────────────────────────────────────────────

// Match "Day 1", "Day 2:", "Day 1 —", "Day 1 -", "DAY ONE" etc.
const DAY_HEADER_PATTERN = /^day\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)[:\s\-—]*(.*)/im;
const DAY_BLOCK_SPLITTER = /(?=^day\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)[\s:\-—])/im;

// Budget patterns
const TOTAL_BUDGET_PATTERN  = /(?:total|overall|trip)\s+budget[:\s]+\$?([\d,]+)/i;
const CATEGORY_BUDGET_PATTERN = /(?:(gas|fuel|food|hotel|hotels?|accommodation|activities?|misc|miscellaneous))[:\s]+\$?([\d,]+)/gi;

// Vehicle patterns
const VEHICLE_PATTERN = /(?:we(?:'re|'re|'ll be)?\s+driving|(?:our|the)\s+car\s+is)[:\sa-z]*([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+){0,3})/i;
const FUEL_RANGE_PATTERN = /(?:~?(\d{2,3})\s*(?:miles?|mi)\s+(?:on\s+a?\s+)?(?:full\s+)?tank|range\s+of\s+~?(\d{2,3})\s*(?:miles?|mi)|(?:can\s+go|gets?)\s+~?(\d{2,3})\s*mi(?:les?)?)/i;

// Flight number pattern (IATA: 2-letter airline code + 3-4 digits)
const FLIGHT_NUMBER_PATTERN = /\b([A-Z]{2}\d{3,4})\b/g;

// Driving limit preference
const DRIVING_HOURS_PATTERN = /(?:no\s+more\s+than|max(?:imum)?|limit)\s+(\d+(?:\.\d+)?)\s+hours?\s+(?:of\s+)?driving/i;

// Overnight / hotel mentions
const HOTEL_MENTION_PATTERN = /(?:(?:stay(?:ing)?|sleep(?:ing)?|night|overnight|hotel|lodging)\s+(?:at|in|near|@)\s+)([A-Za-z][^\n,\.]{3,60})/gi;

// Car rental mentions
const CAR_RENTAL_PATTERN = /(?:car\s+rental|rent(?:ed|ing)?\s+a\s+car|rental\s+car|(?:from|with|at)\s+(?:hertz|enterprise|avis|budget|national|alamo))[^\n]*/i;

// Food preference patterns
const FOOD_PREF_PATTERN = /(?:we\s+(?:love|prefer|like|enjoy)|food\s+preference[s]?)[:\s]+([^\n.]+)/i;

// Pace preference
const PACE_PATTERN = /(?:pace|style)[:\s]+(\w+(?:\s+\w+)?)/i;

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const WORD_TO_NUM = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function wordToNumber(word) {
  const n = parseInt(word, 10);
  return isNaN(n) ? (WORD_TO_NUM[word.toLowerCase()] || 0) : n;
}

function parseBudgetCategory(label) {
  const normalized = label.toLowerCase();
  if (/gas|fuel/.test(normalized)) return 'gas';
  if (/food/.test(normalized)) return 'food';
  if (/hotel|accommodation/.test(normalized)) return 'hotels';
  if (/activit/.test(normalized)) return 'activities';
  return 'misc';
}

// ────────────────────────────────────────────────────────────────────────────
// Day Parser
// ────────────────────────────────────────────────────────────────────────────

function parseDays(text) {
  const days = [];
  // Split on day headers
  const blocks = text.split(DAY_BLOCK_SPLITTER);

  for (const block of blocks) {
    const headerMatch = block.match(DAY_HEADER_PATTERN);
    if (!headerMatch) continue;

    const dayNumber = wordToNumber(headerMatch[1]);
    // Collect all non-empty lines after the header as activities
    const content = block.replace(DAY_HEADER_PATTERN, '').trim();
    const lines = content
      .split(/\n+/)
      .map(l => l.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean);

    days.push({
      day: dayNumber,
      activities: lines,
      raw: block.trim(),
    });
  }

  return days;
}

// ────────────────────────────────────────────────────────────────────────────
// Budget Parser
// ────────────────────────────────────────────────────────────────────────────

function parseBudget(text) {
  const budget = {
    total: 0,
    targets: { gas: 0, food: 0, hotels: 0, activities: 0, misc: 0 },
  };

  const totalMatch = text.match(TOTAL_BUDGET_PATTERN);
  if (totalMatch) {
    budget.total = parseInt(totalMatch[1].replace(',', ''), 10);
  }

  let catMatch;
  const catRegex = new RegExp(CATEGORY_BUDGET_PATTERN.source, 'gi');
  while ((catMatch = catRegex.exec(text)) !== null) {
    const category = parseBudgetCategory(catMatch[1]);
    const amount = parseInt(catMatch[2].replace(',', ''), 10);
    budget.targets[category] = amount;
    // Accumulate total if not explicitly stated
    if (!totalMatch) budget.total += amount;
  }

  return budget;
}

// ────────────────────────────────────────────────────────────────────────────
// Vehicle Parser
// ────────────────────────────────────────────────────────────────────────────

function parseVehicle(text) {
  const vehicle = { type: null, fuelRangeMiles: null };

  // 1. Try specific make/model patterns first — most reliable, handles "Honda CR-V", hyphens, etc.
  const carMatch = text.match(
    /\b(Honda\s+CR-?V|Toyota\s+[\w-]+(?:\s+\w+)?|Ford\s+[\w-]+(?:\s+\w+)?|Chevy\s+[\w-]+(?:\s+\w+)?|Chevrolet\s+[\w-]+(?:\s+\w+)?|Subaru\s+[\w-]+(?:\s+\w+)?|Jeep\s+[\w-]+(?:\s+\w+)?|Hyundai\s+[\w-]+(?:\s+\w+)?|Kia\s+[\w-]+|GMC\s+[\w-]+|Ram\s+[\w-]+|Dodge\s+[\w-]+|Nissan\s+[\w-]+|Mazda\s+[\w-]+|Volkswagen\s+[\w-]+|VW\s+[\w-]+|BMW\s+[\w-]+)\b/i
  );
  if (carMatch) vehicle.type = carMatch[1].trim();

  // 2. Fall back to generic driving-context pattern (without case-insensitive to avoid greedy class matching)
  if (!vehicle.type) {
    const vehicleMatch = text.match(
      /(?:we(?:'re|'re|'ll\s+be)?\s+driving|(?:our|the)\s+car\s+is)\s+(?:our\s+)?([A-Z][A-Za-z][\w\-\/]*(?:\s+[A-Z][\w\-\/]*){0,3})/
    );
    if (vehicleMatch) vehicle.type = vehicleMatch[1].trim();
  }

  const rangeMatch = text.match(FUEL_RANGE_PATTERN);
  if (rangeMatch) {
    vehicle.fuelRangeMiles = parseInt(rangeMatch[1] || rangeMatch[2] || rangeMatch[3], 10);
  }

  return vehicle;
}

// ────────────────────────────────────────────────────────────────────────────
// Flights Parser
// ────────────────────────────────────────────────────────────────────────────

function parseFlights(text) {
  const flights = [];
  let match;
  const regex = new RegExp(FLIGHT_NUMBER_PATTERN.source, 'g');

  while ((match = regex.exec(text)) !== null) {
    const flightNumber = match[1];
    // Get surrounding context (up to 80 chars on each side)
    const start = Math.max(0, match.index - 80);
    const end = Math.min(text.length, match.index + 80);
    const context = text.slice(start, end);

    // Try to extract date from context
    const dateMatch = context.match(/(\w+\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
    const timeMatch = context.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);

    flights.push({
      flightNumber,
      date: dateMatch ? dateMatch[1] : null,
      time: timeMatch ? timeMatch[1] : null,
      context: context.trim(),
    });
  }

  // Deduplicate by flight number
  const seen = new Set();
  return flights.filter(f => {
    if (seen.has(f.flightNumber)) return false;
    seen.add(f.flightNumber);
    return true;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Hotels Parser
// ────────────────────────────────────────────────────────────────────────────

function parseHotels(text) {
  const hotels = [];
  let match;
  const regex = new RegExp(HOTEL_MENTION_PATTERN.source, 'gi');

  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    if (name && !hotels.find(h => h.name === name)) {
      // Get surrounding context to extract dates
      const start = Math.max(0, match.index - 60);
      const end = Math.min(text.length, match.index + 100);
      const context = text.slice(start, end);

      const dateMatch = context.match(/(\w+\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?,?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);

      hotels.push({
        name,
        date: dateMatch ? dateMatch[1] : null,
        context: context.trim(),
      });
    }
  }
  return hotels;
}

// ────────────────────────────────────────────────────────────────────────────
// Preferences Parser
// ────────────────────────────────────────────────────────────────────────────

function parsePreferences(text) {
  const preferences = {
    maxDrivingHoursPerDay: 6,
    food: [],
    pace: 'moderate',
  };

  const drivingMatch = text.match(DRIVING_HOURS_PATTERN);
  if (drivingMatch) {
    preferences.maxDrivingHoursPerDay = parseFloat(drivingMatch[1]);
  }

  const foodMatch = text.match(FOOD_PREF_PATTERN);
  if (foodMatch) {
    preferences.food = foodMatch[1]
      .split(/[,&\/]+/)
      .map(f => f.trim().toLowerCase())
      .filter(Boolean);
  }

  const paceMatch = text.match(PACE_PATTERN);
  if (paceMatch) {
    preferences.pace = paceMatch[1].trim().toLowerCase();
  }

  return preferences;
}

// ────────────────────────────────────────────────────────────────────────────
// Car Rental Parser
// ────────────────────────────────────────────────────────────────────────────

function parseCarRental(text) {
  const rentalMatch = text.match(CAR_RENTAL_PATTERN);
  if (!rentalMatch) return null;

  return {
    raw: rentalMatch[0].trim(),
    mentioned: true,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Main Export
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse a natural language Trip Briefing text into structured trip data.
 *
 * @param {string} text - Raw trip briefing message text
 * @returns {{
 *   itinerary: Array,
 *   budget: object,
 *   vehicle: object,
 *   preferences: object,
 *   flights: Array,
 *   hotels: Array,
 *   carRental: object|null,
 *   dayCount: number
 * }}
 */
function parseBriefing(text) {
  if (!text || typeof text !== 'string') {
    return { itinerary: [], budget: {}, vehicle: {}, preferences: {}, flights: [], hotels: [], carRental: null, dayCount: 0 };
  }

  const itinerary = parseDays(text);
  const budget = parseBudget(text);
  const vehicle = parseVehicle(text);
  const preferences = parsePreferences(text);
  const flights = parseFlights(text);
  const hotels = parseHotels(text);
  const carRental = parseCarRental(text);

  return {
    itinerary,
    budget,
    vehicle,
    preferences,
    flights,
    hotels,
    carRental,
    dayCount: itinerary.length,
  };
}

module.exports = { parseBriefing };
