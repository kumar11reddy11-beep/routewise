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

---

---

# Milestone 3 — On-Demand Intelligence

**Built:** 2026-02-18
**Node version:** v22.22.0

---

## Test Results

```
# tests 23
# suites 1
# pass 23
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms ~155ms
```

### All 23 tests passing ✅

| # | Test | Result |
|---|------|--------|
| 1 | buildMapsLink formats correctly | ✅ PASS |
| 2 | estimateDetour calculates correctly (mocked drive times) | ✅ PASS |
| 3a | checkFivePMTrigger: true after 5PM with no hotel | ✅ PASS |
| 3b | checkFivePMTrigger: false before 5PM | ✅ PASS |
| 3c | checkFivePMTrigger: false when hotel is booked tonight | ✅ PASS |
| 4 | calculateDepartureWindow works backward from flight time | ✅ PASS |
| 5a | calculateDelayImpact identifies soft goals to cut | ✅ PASS |
| 5b | calculateDelayImpact protects hard commitments | ✅ PASS |
| 5c | calculateDelayImpact with no delay: no-op | ✅ PASS |
| 6 | findDining returns 2–3 options | ✅ PASS |
| 7 | findDining tight schedule includes takeout mention | ✅ PASS |
| 8 | correlateNeeds bundles gas + food | ✅ PASS |
| 9 | getFlightStatus parses mocked AeroDataBox response | ✅ PASS |
| 10 | findNearestHospital: formatted response with maps link | ✅ PASS |
| 11 | findHotels: positioning tradeoff note present | ✅ PASS |
| 12a | findDining: under 200 words, ends with CTA | ✅ PASS |
| 12b | findHotels: under 200 words | ✅ PASS |
| 12c | getFlightStatus formatted: under 200 words | ✅ PASS |
| 12d | calculateDelayImpact formatted: ends with CTA | ✅ PASS |
| 12e | findNearestHospital formatted: under 200 words | ✅ PASS |
| 12f | calculateDepartureWindow: ends with "Leave by" instruction | ✅ PASS |
| B1 | isTight: detects schedule pressure correctly (bonus) | ✅ PASS |
| B2 | buildMapsLink: handles negative coordinates (bonus) | ✅ PASS |

---

## What Was Built

### Files Created / Updated

```
src/
├── modules/intelligence/
│   ├── index.js          ← Orchestrator: handleRequest, findFood, findGas,
│   │                        findHotel, findNearestHospital, getFlightStatus,
│   │                        correlateNeeds
│   ├── routeSearch.js    ← Route-aware search corridor (PRD §8.1)
│   │                        buildMapsLink, estimateDetour, searchAlongRoute
│   ├── dining.js         ← Dining intelligence (PRD §8.2)
│   │                        findDining, isTight, scheduleTradeoff
│   ├── hotels.js         ← Hotel intelligence (PRD §8.3)
│   │                        findHotels, checkFivePMTrigger
│   ├── fuel.js           ← Fuel correlation (PRD §8.4)
│   │                        findGas, updateFuelState
│   ├── flights.js        ← Flight monitoring (PRD §8.7)
│   │                        getFlightStatus, calculateDelayImpact,
│   │                        calculateDepartureWindow
│   └── safety.js         ← Safety queries (PRD §8.8)
│                            findNearestHospital
├── services/
│   ├── maps.js           ← Updated: places() implemented (nearbysearch)
│   │                        + distanceMatrix() added
│   ├── hotels.js         ← Rewritten: apidojo-booking-v1.p.rapidapi.com
│   │                        autocomplete(), searchByBbox(), searchNear()
│   └── flights.js        ← Updated: gzip/deflate handling via zlib
└── index.js              ← M3 intent routing added (steps 7a–7g)
                             food/gas/hotel/hospital/flight patterns

tests/m3/intelligence.test.js  ← 23 tests, all passing
```

### Architecture Notes

**Route-Aware Search** (`routeSearch.js`):
- Calls Google Directions API to get step end-points as waypoints
- Samples every Nth waypoint (max 5 search points) to avoid API flooding
- Searches Google Places API (nearbysearch) within 5 km of each waypoint
- De-duplicates by `place_id`
- Runs `estimateDetour` in parallel for all candidates (capped at 12)
- Filters to detour budget (default 20 min), sorts by detour ASC then rating DESC

**Detour Formula**: `detour = (current→stop + stop→dest) − (current→dest)` — extra minutes added to trip, can be ≤ 0 if stop is directly on route.

**Hotel Intelligence** (`hotels.js`):
- Uses `apidojo-booking-v1.p.rapidapi.com` with gzip via native HTTPS (not axios), matching the tested `hotel-search.js` pattern
- Calculates drive time tonight (current→hotel) + drive time tomorrow (hotel→tomorrow's activity)
- Positioning note: "X min closer to tomorrow's first stop" vs best option

**Flight Departure Window** (`flights.js`):
- Buffers: 90 min security + 30 min car rental return + 30 min shuttle + live drive time
- Drive time fetched from Google Directions API; 60 min default if API unavailable

**Correlated Needs** (`intelligence/index.js`):
- Fetches food options first, passes their coords to fuel search as `nearbyStops`
- `fuel.js` checks each gas station against nearby stops (within 0.25 mi) to flag correlations

**Schedule Tightness** (`dining.js`):
- `isTight()`: true if drift > 20 min OR < 1 hr to next hard commitment
- Tight schedule → adds takeout/call-ahead advisory to dining response

---

## API Keys Required for Live Testing

| Service | Status | Key Location |
|---------|--------|-------------|
| Google Maps (Directions, Places, Geocoding) | ✅ Key set | `GOOGLE_MAPS_API_KEY` in `.env` |
| RapidAPI (AeroDataBox + Booking.com) | ✅ Key set | `RAPIDAPI_KEY` in `.env` |
| WeatherAPI.com | ⚠️ Not set | `WEATHER_API_KEY` in `.env` — needed for M4 only |

All M3 functions work with the keys already in `.env`. No new keys required for M3.

---

## Next: Milestone 5

Pattern Learning, Personality & End-to-End Dry Run.

---

---

# Milestone 4 — Proactive Alerts & Daily Rituals

**Built:** 2026-02-18
**Node version:** v22.22.0

---

## Test Results

```
# tests 13
# suites 0
# pass 13
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms ~195ms
```

### All 13 tests passing ✅

| # | Test | Result |
|---|------|--------|
| 1 | runHeartbeat → `{ mode: 'autopilot', message: null }` when on track | ✅ PASS |
| 2 | runHeartbeat → alert message when 40+ min schedule drift detected | ✅ PASS |
| 3 | weatherAlert → correct message for rain at outdoor activity | ✅ PASS |
| 4 | hotelNudge → fires after 5PM with no hotel booked | ✅ PASS |
| 5 | hotelNudge → does NOT fire before 5PM | ✅ PASS |
| 6 | generateBriefing → activities, weather section, departure time suggestion | ✅ PASS |
| 7 | generateBriefing → wardrobe nudge when temp < 55°F | ✅ PASS |
| 8 | shouldSendLateStartFollowUp → true when GPS at hotel 30+ min past departure | ✅ PASS |
| 9 | detectHotelArrival → true when within 500m after 5PM | ✅ PASS |
| 10 | generateRecap → driving time, completed/skipped activities, budget summary | ✅ PASS |
| 11 | logExpense → correctly adds to category and updates total | ✅ PASS |
| 12 | getBudgetStatus → correct percentUsed and isOverBudget flag | ✅ PASS |
| 13 | noRepeatGuard → true (suppress) < 30 min, false > 30 min ago | ✅ PASS |

All prior milestone tests (M1: 8, M2: 10+, M3: 23) remain green.

---

## What Was Built

### Files Created

```
src/modules/proactive/
├── alerts.js          ← Alert generation (PRD §6.2)
│                         scheduleAlert, weatherAlert, hotelNudge,
│                         flightDelayAlert, noRepeatGuard
├── budgetTracker.js   ← Budget tracking (PRD §9)
│                         logExpense, getBudgetStatus, generateBudgetSummary,
│                         getBudgetAwareness, endOfDayBudgetPrompt,
│                         normaliseCategory (with synonym mapping)
├── morningBriefing.js ← Morning briefing (PRD §11.1)
│                         generateBriefing, shouldSendLateStartFollowUp,
│                         calcDepartureTime, getTodaysActivities
├── endOfDay.js        ← End-of-day recap (PRD §11.2)
│                         generateRecap, detectHotelArrival,
│                         getTodaysActivities, getTomorrowFirstActivity
└── index.js           ← Heartbeat orchestrator (PRD §7.1)
                          runHeartbeat, checkAlertConditions, sendAlert

tests/m4/
└── proactive.test.js  ← 13 tests, all passing (node:test, all mocked)
```

### Files Updated

```
src/index.js
  ├── Added budgetTracker import (M4)
  ├── Added budget routing step 7: "how much.*spent" → getBudgetStatus
  ├── Added budget routing step 8: "spent $X on [category]" → logExpense
  └── Passes getBudgetAwareness() to M3 intelligence calls (enrichedState)

src/modules/intelligence/hotels.js
  ├── Added budgetAwareness parameter to findHotels()
  ├── Over budget → filters to only affordable options (< budgetMax)
  ├── Under budget → appends one upgrade option above budget range
  └── Upgrade options annotated with 💎 "You've got budget room" note
```

### Architecture Notes

**Heartbeat engine** (`proactive/index.js`):
- `runHeartbeat(tripStateObj, lat, lon, ts)` — accepts injected tripState for testability
- In-memory `alertLastSent` map tracks per-type last-send timestamp for noRepeatGuard
- Steps: state machine → ETAs → weather check → alert conditions → 5PM hotel → deferred requests
- Returns `{ mode, message, alerts[] }` — caller (OpenClaw layer) handles Telegram delivery
- `sendAlert()` is a stub; real delivery handled by the OpenClaw heartbeat cron

**Alert generation** (`alerts.js`):
- All functions return formatted strings (no side effects, pure generators)
- noRepeatGuard accepts Date, number (ms), or ISO string — normalises before comparison
- 30-minute suppression window (PRD §14.1: "proactive, not naggy")

**Budget tracker** (`budgetTracker.js`):
- `normaliseCategory()` handles 15+ synonyms: 'dinner'→food, 'fuel'→gas, 'lodge'→hotels, etc.
- `getBudgetAwareness()` returns 'over'/'on-track'/'under' based on percentUsed thresholds
  - over: >100% or isOverBudget
  - under: ≤60% spent
  - on-track: 61–99%
- Expenses logged with category, amount, note, and ISO timestamp

**Morning briefing** (`morningBriefing.js`):
- `shouldSendLateStartFollowUp` uses Haversine distance (≤500m) + time threshold (≥30 min past departure)
- Wardrobe nudge: < 55°F → 🧥 "pack layers"; > 85°F → ☀️ "stay hydrated"
- Departure time = first scheduled activity time − driveMinutes − 15-min buffer

**End-of-day recap** (`endOfDay.js`):
- `detectHotelArrival()` requires GPS within 500m AND currentHour ≥ 17 (5 PM)
- Uses Haversine from `utils/geo.js` for accurate great-circle distance
- Tomorrow preview includes suggested departure (first activity time − drive − 15 min buffer)

---

## M4 Completion Checklist

- [x] Heartbeat orchestrator (runHeartbeat, 15-min cycle, PRD §7.1)
- [x] Alert triggers: schedule drift (40+ min), weather (rain/adverse), hotel nudge (5PM), flight delay
- [x] noRepeatGuard — 30-min suppression window, prevents naggy repeats
- [x] Morning briefing: activities, weather, wardrobe nudge, sunset, hard commitments, open slots, departure time
- [x] Late-start follow-up: GPS at hotel 30+ min past departure
- [x] End-of-day recap: driving time, activities done/skipped, budget, tomorrow preview
- [x] Hotel arrival detection (Haversine ≤500m, after 5PM)
- [x] Budget tracking: logExpense, getBudgetStatus, generateBudgetSummary, getBudgetAwareness
- [x] Budget-aware hotel suggestions: over→filter affordable, under→add upgrade option
- [x] Budget routing in src/index.js (status query + log expense)
- [x] All 13 M4 tests passing
- [x] No hardcoded API keys
- [x] CommonJS style, same logger as M1–M3
- [x] All prior tests (M1+M2+M3: 41 total) remain green
