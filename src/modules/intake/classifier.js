'use strict';

/**
 * RouteWise Itinerary Item Classifier
 *
 * Classifies each itinerary item into one of three categories (per PRD Section 5):
 *
 *   Hard Commitment — Fixed time, has a booking/confirmation, flight, hotel reservation,
 *                     restaurant reservation, or tour with a fixed time.
 *                     RouteWise works BACKWARD from these.
 *
 *   Soft Goal       — Beach visit, viewpoint, hike, scenic stop, sunset watching, exploring.
 *                     No booking, flexible. Can be reordered or skipped.
 *
 *   Open Slot       — Unresolved: "find a hotel", "lunch on the way", "somewhere near X".
 *                     RouteWise actively solves these using route-aware search.
 */

// ── Hard Commitment Keywords ────────────────────────────────────────────────
const HARD_COMMITMENT_PATTERNS = [
  /\bconfirmation\b/i,
  /\bbooked?\b/i,
  /\breservation\b/i,
  /\bflight\b/i,
  /\bcheck.?in\b/i,
  /\bcheck.?out\b/i,
  /\bferry\b/i,
  /\btour\b.*\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i,
  /\brestaurant\b.*\breservation\b/i,
  /\b\d{1,2}:\d{2}\s*(am|pm)\b/i,  // specific time mentioned
  /\bhired\b/i,
  /\bticket\b/i,
  /\bcruise\b/i,
  /\bdepart(ure)?\b.*\b(am|pm)\b/i,
  /\barri(ve|val)\b.*\b(am|pm)\b/i,
  /\bconcert\b/i,
  /\bevent\b.*\bticket\b/i,
  /\bhotel\b.*\bbooked?\b/i,
  /\bcar\s*rental\b/i,
  /\bpickup\b.*\btime\b/i,
];

// ── Open Slot Keywords ───────────────────────────────────────────────────────
const OPEN_SLOT_PATTERNS = [
  /\bfind\s+(a|an|us|some)\b/i,
  /\blooking\s+for\b/i,
  /\bsomewhere\s+near\b/i,
  /\bon\s+the\s+way\b/i,
  /\balong\s+the\s+way\b/i,
  /\btbd\b/i,
  /\bto\s+be\s+determined\b/i,
  /\bnot\s+sure\s+where\b/i,
  /\bmight\s+stop\b/i,
  /\bwill\s+need\s+(a|to\s+find)\b/i,
  /\bunbooked\b/i,
  /\bneed\s+to\s+(find|book|locate)\b/i,
  /\bprobably\s+(stop|find|grab)\b/i,
  /\blunch\s+on\s+the\s+way\b/i,
  /\bgrab\s+(food|lunch|dinner|breakfast|coffee)\b/i,
  /\bfuel\s+up\b/i,
  /\bgas\s+somewhere\b/i,
];

// ── Soft Goal Keywords ──────────────────────────────────────────────────────
const SOFT_GOAL_PATTERNS = [
  /\bbeach\b/i,
  /\bviewpoint\b/i,
  /\boverlook\b/i,
  /\bhike\b/i,
  /\btrail\b/i,
  /\bsunset\b/i,
  /\bsunrise\b/i,
  /\bscenic\b/i,
  /\bexplor(e|ing)\b/i,
  /\bwalk\s+(around|through|along)\b/i,
  /\bstop\s+(at|by|and\s+see)\b/i,
  /\bvisit\b/i,
  /\bcheck\s+out\b/i,
  /\bgolden\s+hour\b/i,
  /\bphoto\s*stop\b/i,
  /\blighthouse\b/i,
  /\bpark\b/i,
  /\bwaterfal+\b/i,
  /\bdunes?\b/i,
  /\bcaves?\b/i,
  /\bstate\s+park\b/i,
  /\bnational\s+park\b/i,
  /\btide\s*pool\b/i,
  /\bcliff\b/i,
  /\brock\s+formation\b/i,
];

/**
 * Classify a single itinerary item text.
 *
 * @param {string|object} item - Either a plain string description, or an object with a `description` or `activity` field.
 * @returns {'Hard Commitment'|'Soft Goal'|'Open Slot'} Classification
 */
function classify(item) {
  // Normalize to string
  const text = typeof item === 'string'
    ? item
    : item.description || item.activity || item.name || JSON.stringify(item);

  // ── 1. Check Open Slot first (most actionable for RouteWise to solve) ──
  for (const pattern of OPEN_SLOT_PATTERNS) {
    if (pattern.test(text)) return 'Open Slot';
  }

  // ── 2. Check Hard Commitment ────────────────────────────────────────────
  for (const pattern of HARD_COMMITMENT_PATTERNS) {
    if (pattern.test(text)) return 'Hard Commitment';
  }

  // ── 3. Check Soft Goal ──────────────────────────────────────────────────
  for (const pattern of SOFT_GOAL_PATTERNS) {
    if (pattern.test(text)) return 'Soft Goal';
  }

  // ── 4. Default: Soft Goal ───────────────────────────────────────────────
  // If we can't determine it's an Open Slot or Hard Commitment, it's
  // likely a flexible activity — treat as Soft Goal.
  return 'Soft Goal';
}

module.exports = { classify };
