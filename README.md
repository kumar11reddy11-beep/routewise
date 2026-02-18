# RouteWise 🗺️

**AI-powered road trip co-pilot built on [OpenClaw](https://github.com/openclaw/openclaw)/Dona.**

RouteWise eliminates road trip decision fatigue by monitoring your real-time position, weather, schedule, and bookings — then surfacing 2–3 curated options whenever the plan needs to change. Built for families traveling by car on multi-day trips, RouteWise lives inside a Telegram group chat and speaks only when it has something useful to say.

---

## Architecture Overview

```
src/
├── index.js              ← Message router (intent detection → module dispatch + personality filter)
├── config/               ← Environment-based configuration (no hardcoded secrets)
├── services/             ← External API clients (Gmail, Maps, Weather, Flights, Hotels)
├── modules/
│   ├── intake/           ← M1: Email parsing, trip briefing, document storage, queries
│   ├── tracking/         ← M2: GPS state machine, ETA calculation, deferred requests
│   ├── intelligence/     ← M3: Route-aware search, dining/hotel/fuel/flight logic
│   ├── proactive/        ← M4: Heartbeat alerts, morning briefing, end-of-day recap
│   └── patterns/         ← M5: Family behavior learning, personality, conflict resolver
├── memory/
│   └── tripState.js      ← Persistent JSON trip state (bookings, itinerary, budget, docs, patterns)
└── utils/
    └── logger.js         ← Leveled logger with [RouteWise] prefix
```

**Data flow:** User sends message → `src/index.js` detects intent → routes to correct module → response passes through `personality.formatMessage()` → returned to user. All pattern learning is stored in `tripState.patterns` and applied on the next relevant operation.

---

## Prerequisites

- **Node.js** ≥ 18 (uses built-in `node:test` runner)
- **Gmail OAuth credentials** (`gmail-oauth.json` + `gmail-token.json`)
- **Google Maps Platform API key** (Directions, Places, Geocoding, Distance Matrix)
- **WeatherAPI.com key** (free tier sufficient)
- **RapidAPI key** (AeroDataBox, Booking.com, Priceline subscriptions)

---

## Installation & Setup

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/routewise.git
cd routewise

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env with your actual API keys and credential paths

# 4. Ensure Gmail OAuth is set up
#    Your credentials should be at the paths specified in .env

# 5. Run the app
npm start
```

---

## Environment Variables

| Variable | Description | Example |
|---|---|---|
| `GMAIL_CREDENTIALS_PATH` | Path to Gmail OAuth2 credentials JSON | `/path/to/gmail-oauth.json` |
| `GMAIL_TOKEN_PATH` | Path to Gmail OAuth2 token JSON | `/path/to/gmail-token.json` |
| `GMAIL_ACCOUNT` | Gmail address to monitor | `your@gmail.com` |
| `GOOGLE_MAPS_API_KEY` | Google Maps Platform API key | `AIzaSy...` |
| `WEATHER_API_KEY` | WeatherAPI.com API key | `abc123...` |
| `RAPIDAPI_KEY` | RapidAPI key (AeroDataBox + Booking.com + Priceline) | `xyz789...` |
| `TRIP_STATE_PATH` | Path for persistent trip state JSON file | `./trip-state.json` |
| `LOG_LEVEL` | Logging verbosity: `debug`, `info`, `warn`, `error` | `info` |

---

## Running the App

```bash
# Start the message router (CLI mode for testing)
npm start

# Pass a message directly
node src/index.js "Check your email"
node src/index.js "What's our confirmation number?"
```

---

## Running Tests

```bash
# Run all milestone tests individually
node --test tests/m1/intake.test.js
node --test tests/m2/tracking.test.js
node --test tests/m3/intelligence.test.js
node --test tests/m4/proactive.test.js
node --test tests/m5/patterns.test.js
node --test tests/integration/e2e.test.js

# Or run all at once (chain with &&)
node --test tests/m1/intake.test.js && \
node --test tests/m2/tracking.test.js && \
node --test tests/m3/intelligence.test.js && \
node --test tests/m4/proactive.test.js && \
node --test tests/m5/patterns.test.js && \
node --test tests/integration/e2e.test.js

# Verbose output (any single suite)
node --test --reporter spec tests/m5/patterns.test.js

# npm shortcut (runs M1 by default; update package.json for full suite)
npm test
```

---

## Milestone Status

| Milestone | Description | Status | Tests |
|---|---|---|---|
| **M1** | Trip Intake & Document Memory | ✅ Complete | 8/8 |
| **M2** | GPS Tracking, State Machine & Schedule Engine | ✅ Complete | 10/10 |
| **M3** | On-Demand Intelligence (route-aware search) | ✅ Complete | 23/23 |
| **M4** | Proactive Alerts & Daily Rituals | ✅ Complete | 13/13 |
| **M5** | Pattern Learning, Personality & Integration | ✅ Complete | 10/10 |
| **E2E** | End-to-End Integration | ✅ Complete | 10/10 |

**Total: 74/74 tests passing ✅**

**M1 covers:**
- Gmail integration (fetch unread emails labeled `RouteWise`, parse bookings, mark as read)
- Natural language trip briefing parsing (itinerary days, budget, vehicle, preferences, flights, hotels)
- Itinerary classification: Hard Commitment / Soft Goal / Open Slot
- Trip state persistence (load/save, nested get/set, booking search)
- Document & photo storage references
- On-demand queries ("what's our confirmation?", "when's our flight?", etc.)

**M5 covers:**
- Pattern learning: departure timing, food preference, activity pace (PRD §10, §19.3)
- Dona personality enforcement: 200-word limit, ≤2 emoji, CTA required, no filler phrases (PRD §14)
- Conflict resolver: multi-family-member vote tracking + detection (PRD §13.3, §19.6)
- All module responses routed through `personality.formatMessage()`
- Morning briefing uses departure pattern adjustment + food preference bias
- Dining re-ranked by casual/upscale preference
- Activity state machine uses pace-pattern buffer for expected remaining time

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 18 |
| AI Agent Platform | OpenClaw on AWS |
| Interface | Telegram Bot API |
| Email | Gmail API (googleapis) |
| Navigation | Google Maps Platform |
| Weather | WeatherAPI.com |
| Flights | AeroDataBox via RapidAPI |
| Hotels | Booking.com via RapidAPI |
| Car Rentals | Priceline via RapidAPI |
| Persistence | JSON file (trip-state.json) |
| HTTP Client | axios |
| Test Runner | Node.js built-in `node:test` |

---

## Project Structure

```
routewise/
├── .env.example            ← Environment variable template
├── .gitignore
├── README.md
├── package.json
├── src/
│   ├── index.js            ← Main message router
│   ├── config/index.js     ← Config loaded from environment
│   ├── services/
│   │   ├── gmail.js        ← Gmail API client
│   │   ├── maps.js         ← Google Maps API client
│   │   ├── weather.js      ← WeatherAPI.com client
│   │   ├── flights.js      ← AeroDataBox flight tracking
│   │   └── hotels.js       ← Booking.com hotel search
│   ├── modules/
│   │   ├── intake/         ← M1: Full intake flow
│   │   ├── tracking/       ← M2 stub
│   │   ├── intelligence/   ← M3 stub
│   │   ├── proactive/      ← M4 stub
│   │   └── patterns/       ← M5 stub
│   ├── memory/
│   │   └── tripState.js    ← Trip state JSON store
│   └── utils/
│       └── logger.js       ← Leveled logger
├── tests/
│   ├── m1/
│   │   └── intake.test.js  ← M1 test suite (8 tests)
│   └── fixtures/
│       ├── sample-hotel-email.txt
│       ├── sample-flight-email.txt
│       └── sample-briefing.txt
└── docs/
    ├── prd.md
    └── implementation-plan.md
```

---

*RouteWise PRD v1.0 | Powered by Dona (OpenClaw)*
