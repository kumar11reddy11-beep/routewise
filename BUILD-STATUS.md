# RouteWise — Build Status

**Milestone:** M1 — Trip Intake & Document Memory
**Built:** 2026-02-18
**Node version:** v22.22.0

---

## Test Results

```
TAP version 13
# tests 8
# suites 0
# pass 8
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms ~127ms
```

### All 8 tests passing ✅

| # | Test | Result |
|---|------|--------|
| 1 | gmailParser — parses hotel confirmation email correctly | ✅ PASS |
| 2 | gmailParser — parses flight confirmation email correctly | ✅ PASS |
| 3 | classifier — returns Hard Commitment for a booked hotel | ✅ PASS |
| 4 | classifier — returns Soft Goal for a beach visit | ✅ PASS |
| 5 | classifier — returns Open Slot for "find a hotel near Gold Beach" | ✅ PASS |
| 6 | briefingParser — extracts correct day count from sample briefing | ✅ PASS |
| 7 | tripState — load and save round-trip with temp file | ✅ PASS |
| 8 | tripState — addBooking stores data and findBooking retrieves it | ✅ PASS |

---

## What Was Built

### Files Created (26 files)

```
routewise/
├── .env                        ← Real credentials (not committed)
├── .env.example                ← Template for GitHub
├── .gitignore
├── README.md                   ← Professional project README
├── package.json                ← Node 18+, dependencies: googleapis/dotenv/axios
├── BUILD-STATUS.md             ← This file
├── src/
│   ├── index.js                ← Message router with intent detection
│   ├── config/index.js         ← dotenv-backed config (no hardcoded secrets)
│   ├── services/
│   │   ├── gmail.js            ← Full Gmail OAuth2 client (fetch/mark-read/attachments)
│   │   ├── maps.js             ← Google Maps client (directions/places/matrix/geocode)
│   │   ├── weather.js          ← WeatherAPI.com client + golden hour calculation
│   │   ├── flights.js          ← AeroDataBox/RapidAPI flight status + delay detection
│   │   └── hotels.js           ← Booking.com/RapidAPI hotel search
│   ├── modules/
│   │   ├── intake/
│   │   │   ├── index.js        ← Intake orchestrator (email check, briefing, doc, query)
│   │   │   ├── gmailParser.js  ← Email type detection + structured field extraction
│   │   │   ├── briefingParser.js ← NL trip briefing → structured plan
│   │   │   └── classifier.js  ← Hard Commitment / Soft Goal / Open Slot
│   │   ├── tracking/index.js   ← M2 stub
│   │   ├── intelligence/index.js ← M3 stub
│   │   ├── proactive/index.js  ← M4 stub
│   │   └── patterns/index.js   ← M5 stub
│   ├── memory/tripState.js     ← Full JSON trip state manager (load/save/get/set/search)
│   └── utils/logger.js         ← Leveled logger with [RouteWise] prefix + timestamp
├── tests/
│   ├── m1/intake.test.js       ← 8-test suite using node:test built-in runner
│   └── fixtures/
│       ├── sample-hotel-email.txt    ← Realistic Booking.com-style confirmation
│       ├── sample-flight-email.txt   ← Realistic Delta-style eTicket
│       └── sample-briefing.txt       ← Realistic 3-day Oregon coast trip briefing
└── docs/
    ├── prd.md
    └── implementation-plan.md
```

### Key Implementation Notes

**gmailParser.js** — 3+ regex patterns per booking type. Handles:
- Hotel: Booking.com, direct hotel, Expedia-style emails
- Flight: Delta/United/American airline eTicket formats (route arrow `→`, departure/arrival with dates)
- Car Rental: Hertz/Enterprise/Avis/Priceline style

**Bugs encountered and fixed during build:**
1. Hotel name regex was anchoring on the word "hotel" inside the property name itself → fixed by using explicit label anchors (`Property:`, `Hotel Name:`)
2. Flight confirmation regex matched `eTicket Itinerary` → `Itinerary` due to `i` flag making `[A-Z0-9]` match all letters → fixed by requiring `:` anchor after keyword
3. Vehicle parser regex was case-insensitively matching too broadly, consuming "Honda" in its intermediate group and leaving only "CR" → fixed by checking specific make/model pattern first before generic context pattern
4. Hotel check-in date format `Friday, June 20, 2025` (weekday + date) → fixed with greedy-up-to-parenthesis capture pattern

**tripState.js** — Full dot-path get/set, addBooking (arrays for flights/hotels, single for carRental), findBooking (case-insensitive partial match across all types), getSummary.

**classifier.js** — 3-tier classification with 20+ patterns per tier. Correctly handles all test cases including ambiguous items.

**briefingParser.js** — Parses Days 1-N, budget categories, vehicle make/model, IATA flight numbers, hotel mentions, and driving preferences.

---

## Milestone 1 Completion Checklist

- [x] Gmail API integration (label `RouteWise`, `is:unread`)
- [x] Email parsing: hotel, flight, car rental (3+ patterns each)
- [x] Trip Briefing natural language parsing
- [x] Itinerary item classification: Hard Commitment / Soft Goal / Open Slot
- [x] Document/photo storage references
- [x] Trip state persistence (JSON, dot-path access, booking search)
- [x] On-demand queries (confirmation numbers, flights, hotels, car rental, budget)
- [x] All 8 M1 test cases passing
- [x] Industry-standard project structure (GitHub-ready)
- [x] Real .env with credentials (not committed per .gitignore)
- [x] Milestone 2-5 service stubs in place (maps, weather, flights, hotels)

## Next: Milestone 2

GPS Tracking, State Machine & Schedule Engine — requires Google Maps API key confirmation and live Telegram location sharing setup.
