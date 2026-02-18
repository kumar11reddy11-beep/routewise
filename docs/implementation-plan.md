# RouteWise Implementation Plan

**Context:** This plan assumes Dona/OpenClaw foundation is already running on AWS with Telegram bot connected and persistent memory operational. Each milestone must be fully tested before starting the next. Refer to `routewise-prd.md` for full specs.

---

## Milestone 1: Trip Intake & Document Memory

**Goal:** Dona can ingest a trip, parse booking emails, store documents/photos, and recall everything on demand.

**Build:**

- Gmail API integration filtered by label `RouteWise` + `is:unread` only
- On trigger ("Dona, check your email"): fetch matching emails → parse booking details (confirmation numbers, dates, times, addresses) → store in persistent memory → mark emails as read
- Accept Trip Briefing as natural language in Telegram → parse and store: itinerary, budget, vehicle, preferences, hard bookings, flights, car rental
- Classify each itinerary item as Hard Commitment / Soft Goal / Open Slot (per PRD Section 5)
- Accept and store photos/documents sent via Telegram (license plate, screenshots, etc.)
- Merge email-parsed bookings + manual briefing into unified trip plan

**Test Cases:**

| # | Test | Expected Result |
|---|------|-----------------|
| 1 | Forward a hotel confirmation email to Dona's Gmail with `RouteWise` label | Dona parses hotel name, confirmation #, dates, address and stores in memory |
| 2 | Forward flight + car rental emails, then say "Dona, check your email" in Telegram | Dona reports all 3 bookings parsed. Emails marked as read |
| 3 | Say "Dona, check your email" again with no new emails | Dona responds: "No new booking emails found" |
| 4 | Send a Trip Briefing message with 3-day itinerary in natural language | Dona confirms intake, echoes back the plan with correct Hard/Soft/Open classification |
| 5 | Send a photo of a license plate via Telegram | Dona stores it. Ask "What's our license plate?" → Dona retrieves photo or extracted text |
| 6 | Ask "When's our return flight?" | Dona recalls flight details from parsed email |
| 7 | Ask "What's the hotel confirmation number for Day 3?" | Dona retrieves correct confirmation # |
| 8 | Send a briefing that conflicts with an email booking (different hotel date) | Dona flags the conflict and asks for clarification |

---

## Milestone 2: GPS Tracking, State Machine & Schedule Engine

**Goal:** Dona reads live location, tracks activity status, calculates ETAs, and detects schedule drift. Also pulls weather and sunset data.

**Build:**

- Read GPS coordinates from Telegram live location sharing (continuous)
- Activity detection state machine (PRD Section 7.2): Arrived (within ~1000m), In Progress (20+ min at location), Completed (left area), Uncertain (nearby but ambiguous → ask)
- ETA calculation to remaining activities via Google Directions API
- Schedule drift detection: compare current ETA vs planned times
- Weather data from WeatherAPI.com for upcoming stops
- Sunset/golden hour calculation for scenic activities (PRD Section 8.5)
- Deferred request handling: same category = override, different category = stack (PRD Section 19.4)

**Test Cases:**

| # | Test | Expected Result |
|---|------|-----------------|
| 1 | Share live location in Telegram group | Dona confirms it can read GPS coordinates, reports current location name |
| 2 | Be at (or simulate being at) an itinerary activity location | Dona marks activity as "Arrived" |
| 3 | Stay at activity location for 20+ minutes, then leave | Dona transitions: In Progress → Completed |
| 4 | Ask "What's our ETA to the next stop?" | Dona returns accurate ETA via Directions API |
| 5 | Simulate running 30+ min behind schedule | Dona detects drift and flags it (just detection — alert messaging is Milestone 3) |
| 6 | Ask "What's the weather at Bandon Beach?" | Dona returns current forecast from WeatherAPI |
| 7 | Ask "When's sunset today?" for a scenic stop | Dona returns sunset time + golden hour start |
| 8 | Say "Lunch in 1 hour" then "Lunch in 30 min" | Second request overrides first |
| 9 | Say "Lunch in 1 hour" then "Coffee in 30 min" | Both reminders stack independently |
| 10 | GPS shows family near but not at activity (e.g., gas station nearby) | Dona asks "Are you at [activity]?" instead of assuming |

---

## Milestone 3: On-Demand Intelligence

**Goal:** Dona handles real-time requests with route-aware search and specialized intelligence (dining, hotels, fuel, flights, safety).

**Build:**

- Route-aware search corridor: search within route to next destination, not just radius (PRD Section 8.1)
- Detour budget: default 20 min round-trip, adjustable per request
- Always return 2-3 options with: name, rating, key detail, tradeoff, Google Maps link
- Dining intelligence: adapt to schedule pressure — suggest reservations, takeout, or sit-down (PRD Section 8.2)
- Hotel intelligence: next-day positioning tradeoff, budget filtering, booking links (PRD Section 8.3)
- Fuel correlation: combine gas stops with other needs when possible (PRD Section 8.4)
- Flight monitoring via AviationStack: inbound delay → adjust Day 1, outbound → backward time calc (PRD Section 8.7)
- Safety: nearest hospital/ER on request (PRD Section 8.8)

**Test Cases:**

| # | Test | Expected Result |
|---|------|-----------------|
| 1 | "We're hungry, find pizza on the way" | Dona returns 2-3 pizza options along the route corridor (not just nearest), each with rating, distance, and Google Maps link |
| 2 | "Need gas, 30 miles left in tank" | Dona finds gas stations on-route within detour budget |
| 3 | "We're hungry and need gas" | Dona correlates: at least one option bundles food + gas nearby |
| 4 | "Find a hotel for tonight" (with tomorrow's first stop being Redwoods) | Dona shows options with next-day positioning tradeoff ("35 min closer to Redwoods tomorrow") |
| 5 | "Find a hotel for tonight" with budget set at $150-200/night | All options within budget range |
| 6 | "Find dinner" when schedule is tight | Dona suggests calling ahead / takeout option |
| 7 | "Find dinner, we don't mind a longer detour" | Dona expands search beyond 20-min default detour |
| 8 | "Where's the nearest hospital?" | Dona returns name, address, distance, Google Maps link |
| 9 | Test flight status lookup for inbound flight | Dona retrieves correct flight status from AviationStack |
| 10 | Simulate inbound flight 2-hour delay on Day 1 | Dona recalculates Day 1 plan, presents 2-3 triage options (PRD Section 19.5) |
| 11 | Ask about outbound flight timing on last day | Dona works backward: flight time → security → shuttle → car return → departure time from hotel |
| 12 | Confirm all Google Maps links open correctly on mobile | Links format: `https://www.google.com/maps/dir/?api=1&destination={lat},{lng}` |

---

## Milestone 4: Proactive Alerts & Daily Rituals

**Goal:** Dona speaks unprompted — proactive alerts when problems arise, morning briefings, end-of-day recaps, and budget tracking.

**Build:**

- Heartbeat engine (15-min cron): read GPS → update state → check ETA → check conditions → decide → act (PRD Section 7.1)
- Three operating modes: Autopilot (silent), Alert (surfaces options), On-Demand (already built in M3)
- Alert triggers: schedule drift, weather change at upcoming outdoor activity, no hotel past 5 PM, flight delay
- Morning briefing at 6:00 AM: day plan, weather, wardrobe nudge, sunset time, hard commitments, open slots, suggested departure (PRD Section 11.1)
- Late start follow-up: if GPS shows still at hotel past suggested departure, gentle nudge
- End-of-day recap on hotel arrival detection: driving time, activities done vs planned, budget summary, tomorrow preview (PRD Section 11.2)
- Budget tracking: daily reconciliation at hotel arrival ("Roughly how much on food today? Gas?"), category totals, running trip total vs budget (PRD Section 19.2)
- Budget-aware suggestions: over budget → shift to affordable options, under budget → suggest upgrades

**Test Cases:**

| # | Test | Expected Result |
|---|------|-----------------|
| 1 | Run heartbeat for 48 hours continuously | Fires every 15 min without gaps |
| 2 | Everything on track, no issues | Dona stays silent (Autopilot mode) |
| 3 | Simulate running 40 min behind with sunset activity ahead | Dona sends alert with 2-3 options (skip/shorten/change plans) |
| 4 | Set rain forecast at next outdoor activity | Dona suggests swapping with indoor alternative or rescheduling |
| 5 | It's 5:15 PM with no hotel booked tonight | Dona proactively sends hotel options with next-day positioning |
| 6 | Verify morning briefing at 6:00 AM | Correct content: plan, weather, wardrobe, sunset, hard commitments, open slots, departure time |
| 7 | GPS shows family still at hotel 30 min past suggested departure | Dona sends gentle follow-up: "Want me to adjust today's plan for a later start?" |
| 8 | GPS detects family arrived at hotel for the night | Dona sends end-of-day recap with correct stats |
| 9 | Report expenses: "Spent $50 on gas, $68 on food" | Dona logs under correct categories, confirms |
| 10 | Ask "How's the budget looking?" | Dona returns running total by category vs targets |
| 11 | Push budget over target | Dona's next suggestions shift toward more affordable options |
| 12 | Dona sends an alert, family doesn't respond | Dona does NOT repeat the alert (proactive, not naggy) |
| 13 | Dona sends an alert, conditions change before family responds | Dona sends updated alert reflecting new conditions |

---

## Milestone 5: Pattern Learning, Personality & End-to-End Dry Run

**Goal:** Dona learns from observed behavior, speaks with the right personality, and everything works together in a simulated trip.

**Build:**

- Pattern learning from single observations (PRD Section 19.3): late starts → adjust ETAs, food preferences → prioritize similar, pace at activities → adjust buffers
- Dona personality per PRD Section 14: calm, concise, family-friendly, proactive not naggy, honest about uncertainty
- Message formatting: emoji as anchors (1-2 per message), under 200 words, numbered options with tradeoffs, clear CTA
- Conflict resolution: multiple family members disagree → Dona waits, does not pick a winner (PRD Section 19.6)
- Error recovery: "That place was closed" → fast pivot, next-best alternative, no lengthy explanation

**Test Cases:**

| # | Test | Expected Result |
|---|------|-----------------|
| 1 | Family departs 20 min late on Day 1 | Day 2 morning briefing suggests departure time adjusted for observed pattern |
| 2 | Family chose casual dining twice | Dona prioritizes casual options in next dining suggestion |
| 3 | Family spent longer at a beach than planned | Dona adds buffer to next beach activity ETA |
| 4 | "That restaurant was closed" | Dona pivots immediately with next-best option, brief apology, no explanation |
| 5 | Two family members respond with different choices | Dona waits: "Seeing different votes — let me know when you've decided!" |
| 6 | Review all Dona messages for personality compliance | Concise, warm, no walls of text, emoji used sparingly, under 200 words, ends with clear next step |
| 7 | **Full dry run: 2-day simulated trip** — send itinerary, share location, simulate driving between stops, trigger on-demand requests, simulate schedule drift, trigger hotel nudge, get morning briefing, get end-of-day recap, log budget | All milestones function together without conflicts. Dona handles transitions between modes cleanly |
| 8 | Ask Dona a rapid series of different requests | Dona handles context switching without confusing trip state |
| 9 | Simulate a "plan collapse": "Kids are exhausted, skip everything, find hotel now" | Dona drops all remaining activities, immediately finds nearby hotels, presents options |

---

## Execution Notes

- **Sequence is strict:** M1 → M2 → M3 → M4 → M5. No skipping ahead.
- **Each milestone's test cases must all pass** before moving to the next milestone.
- **If a test fails:** fix it within the current milestone. Do not carry known issues forward.
- **Gmail filter setup:** Label = `RouteWise`, query = `is:unread`. Dona marks emails as read after processing.
- **API keys required before M2:** Google Cloud (Maps Platform), WeatherAPI.com, AviationStack.
- **Dry run (M5 Test 7) should happen at least 2 weeks before the actual trip.**
