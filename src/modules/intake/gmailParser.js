'use strict';

/**
 * RouteWise Gmail Parser
 *
 * Parses raw email body text into structured booking data.
 * Handles: hotel confirmations, flight confirmations, car rental confirmations.
 *
 * Supports multiple email format patterns (Booking.com, Expedia, direct airline/hotel emails).
 */

// ────────────────────────────────────────────────────────────────────────────
// Hotel Patterns
// ────────────────────────────────────────────────────────────────────────────

const HOTEL_INDICATORS = [
  /\b(hotel|inn|resort|lodge|motel|suites?|bed\s*&\s*breakfast|b&b|hostel|airbnb|vacation\s*rental)\b/i,
  /\bcheck.?in\b.*\bcheck.?out\b/i,
  /\broom\s+(type|number|confirmation)\b/i,
  /\bbooking\.com\b/i,
  /\bexpedia\.com.*hotel\b/i,
  /\byour\s+(stay|reservation|booking)\b.*\bnight\b/i,
];

// Hotel regex patterns — at least 3 to handle different format styles
const HOTEL_PATTERNS = {
  // Pattern 1: Booking.com / Expedia / direct hotel email styles
  // Use explicit label anchors (Property:, Hotel Name:, etc.) — NOT the word "hotel" alone,
  // because that word appears inside hotel names themselves (e.g. "Pacific Reef Hotel & Spa").
  hotelName: [
    /^property[:\s]+([^\n]+)/im,                                // "Property: Pacific Reef Hotel & Spa"
    /^hotel\s+name[:\s]+([^\n]+)/im,                           // "Hotel Name: ..."
    /^accommodation[:\s]+([^\n]+)/im,                          // "Accommodation: ..."
    /you(?:'re|'re|\s+are)\s+staying\s+at[:\s]+([^\n,]+)/i,  // "You're staying at ..."
    /booking\s+at[:\s]+([^\n]+)/i,                             // "Booking at: ..."
    /confirmed\s+at[:\s]+([^\n]+)/i,                           // "confirmed at: ..."
    /welcome\s+to\s+([^\n,!]+)/i,                              // "Welcome to Pacific Reef"
    /^([A-Z][^\n]{5,60}(?:Hotel|Inn|Resort|Lodge|Motel|Suites|Retreat))/im, // Standalone hotel brand line
  ],
  confirmationNumber: [
    /confirmation\s+number[:\s]+([A-Z0-9\-]{4,20})/i,                        // "Confirmation number: BKG-7842916"
    /(?:^booking|^confirmation|^reservation)[:\s]+([A-Z0-9\-]{4,20})/im,     // Line-start "Booking: BKG-..."
    /(?:conf|booking)\s*#\s*([A-Z0-9\-]{4,20})/i,                            // "Conf# BKG-..."
    /PIN[:\s]*([A-Z0-9]{4,12})/i,                                             // "PIN: 9314"
    /booking\s+ID[:\s]*([A-Z0-9\-]+)/i,                                       // "Booking ID: ..."
  ],
  checkIn: [
    // "Check-in: Friday, June 20, 2025 (from 3:00 PM)" — capture up to parenthesis/newline
    /check[- ]?in[:\s]+([^\n(]{5,40}?\d{4})/i,
    // "Arrival: June 20, 2025" or "Arrival: 06/20/2025"
    /^arrival[:\s]+([^\n(]{5,40}?\d{4})/im,
    // "From: June 20, 2025"
    /^from[:\s]+([^\n(]{5,40}?\d{4})/im,
    // Generic date formats
    /check[- ]?in[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ],
  checkOut: [
    // "Check-out: Saturday, June 21, 2025 (until 11:00 AM)"
    /check[- ]?out[:\s]+([^\n(]{5,40}?\d{4})/i,
    // "Departure: June 21, 2025"
    /^departure[:\s]+([^\n(]{5,40}?\d{4})/im,
    // Generic
    /check[- ]?out[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ],
  address: [
    /address[:\s]+([^\n]{10,80})/i,
    /located\s+at[:\s]+([^\n]{10,80})/i,
    /(\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Way|Lane|Ln)[^\n]*)/i,
  ],
  phone: [
    /(?:phone|tel|telephone|call\s+us)[:\s]+(\+?[\d\s\(\)\-\.]{10,20})/i,
    /(\(\d{3}\)\s*\d{3}[-.\s]\d{4})/,
    /(\+?1[-.\s]?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})/,
  ],
  totalCost: [
    /(?:total|amount|cost|price|charge)[:\s]+\$?([\d,]+(?:\.\d{2})?)/i,
    /\$\s*([\d,]+\.\d{2})\s*(?:USD|total|per\s+night)?/i,
    /(?:you(?:'ll|\s+will)\s+pay|charged)[:\s]+\$?([\d,]+(?:\.\d{2})?)/i,
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// Flight Patterns
// ────────────────────────────────────────────────────────────────────────────

const FLIGHT_INDICATORS = [
  /\b(flight|airline|airport|boarding\s+pass|itinerary)\b/i,
  /\b(departure|arrival)\s+terminal\b/i,
  /\b(depart|arrive)\s+from\b/i,
  /\bflight\s+number\b/i,
  /\b(delta|united|southwest|american|alaska|jetblue|spirit)\b/i,
  /\be-?ticket\b/i,
];

const FLIGHT_PATTERNS = {
  airline: [
    /(?:operated|operated by|carrier|airline)[:\s]+([A-Za-z\s]{3,40}(?:Airlines?|Airways?|Air))/i,
    /^(Delta|United|American|Southwest|Alaska|JetBlue|Spirit|Frontier|Allegiant|Hawaiian|Sun Country)[^\n]*/im,
    /(?:your\s+flight\s+with|flying\s+with)[:\s]+([A-Za-z\s]{3,30})/i,
  ],
  flightNumber: [
    /flight\s*(?:#|number|no\.?)?[:\s]*([A-Z]{2}\d{3,4})/i,
    /\b([A-Z]{2}\d{3,4})\b(?:\s+departs?)?/,
    /(?:operated\s+as|marketed\s+as)[:\s]+([A-Z]{2}\d{3,4})/i,
    /your\s+flight[:\s]+([A-Z]{2}\d{3,4})/i,
  ],
  origin: [
    // "Route: Portland (PDX) → San Francisco (SFO)" — capture before arrow
    /Route[:\s]+([A-Za-z\s]+\([A-Z]{3}\))\s*→/i,
    // "(PDX) →"
    /\(([A-Z]{3})\)\s*→/,
    /from\s+([A-Z]{3})\s+to/i,
    /departing[:\s]+([A-Z]{3})/i,
    /(?:departs?|departing|from|origin)[:\s]+([A-Za-z][A-Za-z\s]+\([A-Z]{3}\))/i,
  ],
  destination: [
    // "Route: Portland (PDX) → San Francisco (SFO)" — capture after arrow
    /→\s*([A-Za-z\s]+\([A-Z]{3}\))/,
    // "to SFO on ..."
    /to\s+([A-Z]{3})\s*(?:\(|on|\s|$)/i,
    // Arrival line with city name: "Arrival: Portland (PDX)"
    /^Arrival[:\s]+[A-Za-z,\s]+at\s+(\d)|^Arrival\s+(?:Airport|Terminal|City)[:\s]+([A-Za-z\s]+\([A-Z]{3}\))/im,
    // Narrow: requires city+airport-code format to avoid "at airport"
    /(?:arrives?\s+(?:in|at)|arriving\s+(?:in|at))\s+([A-Za-z][A-Za-z\s]+\([A-Z]{3}\))/i,
    /arriving[:\s]+([A-Z]{3})/i,
  ],
  departureTime: [
    // "Departure: Friday, June 20, 2025 at 8:15 AM PDT" — extract time from "at HH:MM AM/PM"
    /^Departure[^\n]*at\s+(\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s+[A-Z]{3})?)/im,
    /(?:departs?|departure\s+time)[:\s]+(\d{1,2}:\d{2}\s*(?:AM|PM)?(?:\s+[A-Z]{3})?)/i,
    /boards?\s+at[:\s]+(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
  ],
  arrivalTime: [
    // "Arrival: Friday, June 20, 2025 at 10:32 AM PDT"
    /^Arrival[^\n]*at\s+(\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s+[A-Z]{3})?)/im,
    /(?:arrives?|arrival\s+time)[:\s]+(\d{1,2}:\d{2}\s*(?:AM|PM)?(?:\s+[A-Z]{3})?)/i,
    /estimated\s+arrival[:\s]+(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
  ],
  confirmationNumber: [
    // Require colon/# after the keyword to avoid matching "eTicket Itinerary" → "Itinerary"
    /(?:^confirmation|^record\s+locator)[:\s]+([A-Z0-9]{4,10})/im,             // "Confirmation: KLMPX7"
    /for\s+[Cc]onfirmation\s+([A-Z0-9]{4,10})/,                                // "...for Confirmation KLMPX7"
    /PNR[:\s]+([A-Z0-9]{4,8})/i,                                               // "PNR: KLMPX7"
    /e-?ticket\s+number[:\s]+([A-Z0-9\-]{6,20})/i,                             // "eTicket number: 006-..."
    /(?:booking|reservation)\s+(?:reference|number|code)[:\s]+([A-Z0-9]{4,10})/i, // "Booking reference: ..."
    /(?:your\s+)?(?:booking\s+)?reference[:\s#]+([A-Z0-9]{4,10})/i,            // "Your reference: ..."
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// Car Rental Patterns
// ────────────────────────────────────────────────────────────────────────────

const CAR_RENTAL_INDICATORS = [
  /\b(car\s+rental|vehicle\s+rental|rent\s+a\s+car|rental\s+car)\b/i,
  /\b(hertz|enterprise|avis|budget|national|alamo|thrifty|dollar|sixt|priceline)\b/i,
  /\bpickup\b.*\bdropoff\b/i,
  /\bvehicle\s+class\b/i,
];

const CAR_RENTAL_PATTERNS = {
  company: [
    /(?:rental\s+company|rented\s+from|with)[:\s]+([A-Za-z\s]+(?:Rental|Car\s+Rental)?)/i,
    /^(Hertz|Enterprise|Avis|Budget|National|Alamo|Thrifty|Dollar|Sixt|Priceline)[^\n]*/im,
    /reserved\s+with[:\s]+([A-Za-z\s]+Car)/i,
  ],
  confirmationNumber: [
    /(?:confirmation|booking|reservation|rental)[:\s#]+([A-Z0-9\-]{4,20})/i,
    /rental\s+agreement[:\s]+([A-Z0-9\-]+)/i,
    /confirmation\s+code[:\s]+([A-Z0-9\-]+)/i,
  ],
  pickupLocation: [
    /(?:pickup|pick[\s-]?up|pick\s+up\s+location)[:\s]+([^\n]{5,80})/i,
    /(?:from|start)\s+location[:\s]+([^\n]{5,80})/i,
    /collect\s+(?:your\s+)?(?:car|vehicle)\s+(?:at|from)[:\s]+([^\n]{5,80})/i,
  ],
  pickupTime: [
    /(?:pickup|pick[\s-]?up)\s+(?:date|time|on)[:\s]+([^\n]{5,40})/i,
    /pick\s+up[:\s]+([A-Za-z]+\s+\d+,?\s+\d{4}\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
    /collecting\s+on[:\s]+([^\n]{5,40})/i,
  ],
  dropoffLocation: [
    /(?:dropoff|drop[\s-]?off|return)\s+location[:\s]+([^\n]{5,80})/i,
    /(?:return|end)\s+(?:location|at)[:\s]+([^\n]{5,80})/i,
    /return\s+(?:your\s+)?(?:car|vehicle)\s+(?:at|to)[:\s]+([^\n]{5,80})/i,
  ],
  dropoffTime: [
    /(?:dropoff|drop[\s-]?off|return)\s+(?:date|time|on|by)[:\s]+([^\n]{5,40})/i,
    /return\s+(?:date|by|on)[:\s]+([^\n]{5,40})/i,
    /due\s+back[:\s]+([^\n]{5,40})/i,
  ],
  vehicleType: [
    /(?:vehicle|car|vehicle\s+class|car\s+type)[:\s]+([A-Za-z\s]+(?:SUV|Sedan|Compact|Full.?Size|Midsize|Economy|Luxury|Van|Truck|Convertible)?)/i,
    /(?:you(?:'ve|\s+have)\s+reserved)[:\s]+(?:a\s+)?([A-Za-z\s]+(?:SUV|Sedan|or\s+similar))/i,
    /class[:\s]+([A-Za-z]+(?:\s+or\s+similar)?)/i,
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// Helper: Try multiple regex patterns, return first match
// ────────────────────────────────────────────────────────────────────────────

function extractField(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Type Detection
// ────────────────────────────────────────────────────────────────────────────

function detectType(body, subject = '') {
  const text = `${subject}\n${body}`;

  const flightScore = FLIGHT_INDICATORS.filter(p => p.test(text)).length;
  const hotelScore = HOTEL_INDICATORS.filter(p => p.test(text)).length;
  const carScore = CAR_RENTAL_INDICATORS.filter(p => p.test(text)).length;

  // Must have at least 2 indicator matches to confidently identify type
  if (carScore >= 2 && carScore >= flightScore && carScore >= hotelScore) return 'carRental';
  if (flightScore >= 2 && flightScore >= hotelScore) return 'flight';
  if (hotelScore >= 2) return 'hotel';
  if (carScore === 1) return 'carRental';
  if (flightScore === 1) return 'flight';
  if (hotelScore === 1) return 'hotel';
  return 'unknown';
}

// ────────────────────────────────────────────────────────────────────────────
// Field Extractors by Type
// ────────────────────────────────────────────────────────────────────────────

function extractHotelData(body) {
  return {
    hotelName:          extractField(body, HOTEL_PATTERNS.hotelName),
    confirmationNumber: extractField(body, HOTEL_PATTERNS.confirmationNumber),
    checkIn:            extractField(body, HOTEL_PATTERNS.checkIn),
    checkOut:           extractField(body, HOTEL_PATTERNS.checkOut),
    address:            extractField(body, HOTEL_PATTERNS.address),
    phone:              extractField(body, HOTEL_PATTERNS.phone),
    totalCost:          extractField(body, HOTEL_PATTERNS.totalCost),
  };
}

function extractFlightData(body) {
  return {
    airline:            extractField(body, FLIGHT_PATTERNS.airline),
    flightNumber:       extractField(body, FLIGHT_PATTERNS.flightNumber),
    origin:             extractField(body, FLIGHT_PATTERNS.origin),
    destination:        extractField(body, FLIGHT_PATTERNS.destination),
    departureTime:      extractField(body, FLIGHT_PATTERNS.departureTime),
    arrivalTime:        extractField(body, FLIGHT_PATTERNS.arrivalTime),
    confirmationNumber: extractField(body, FLIGHT_PATTERNS.confirmationNumber),
  };
}

function extractCarRentalData(body) {
  return {
    company:            extractField(body, CAR_RENTAL_PATTERNS.company),
    confirmationNumber: extractField(body, CAR_RENTAL_PATTERNS.confirmationNumber),
    pickupLocation:     extractField(body, CAR_RENTAL_PATTERNS.pickupLocation),
    pickupTime:         extractField(body, CAR_RENTAL_PATTERNS.pickupTime),
    dropoffLocation:    extractField(body, CAR_RENTAL_PATTERNS.dropoffLocation),
    dropoffTime:        extractField(body, CAR_RENTAL_PATTERNS.dropoffTime),
    vehicleType:        extractField(body, CAR_RENTAL_PATTERNS.vehicleType),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Main Export
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse a raw email object into structured booking data.
 *
 * @param {object} email - Email object: { id, subject, from, date, body, attachments }
 * @returns {{ type: string, data: object, raw: object }}
 *   type: 'hotel' | 'flight' | 'carRental' | 'unknown'
 *   data: Extracted structured booking fields
 *   raw: Original email object
 */
function parseEmail(email) {
  const body = email.body || '';
  const subject = email.subject || '';
  const type = detectType(body, subject);

  let data = {};
  switch (type) {
    case 'hotel':    data = extractHotelData(body);    break;
    case 'flight':   data = extractFlightData(body);   break;
    case 'carRental':data = extractCarRentalData(body); break;
    default:
      data = { raw_subject: subject };
  }

  return { type, data, raw: email };
}

module.exports = { parseEmail, detectType, extractHotelData, extractFlightData, extractCarRentalData };
