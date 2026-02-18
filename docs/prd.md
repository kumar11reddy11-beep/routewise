**ROUTEWISE**

Road Trip Co-Pilot

Powered by Dona (OpenClaw)

Product Requirements Document \| Agent Behavior Specification

Version 1.0 \| February 2026

Trip Window: 1--2 Months Out

Platform: OpenClaw on AWS \| Interface: Telegram \| Navigation: Google Maps

**CONFIDENTIAL**

**1. Product Vision & Problem Statement**

**1.1 Problem**

Road trips with families are plagued by decision fatigue. At any given moment, the driver and passengers face a cascade of micro-decisions: Should we stop for gas now or later? Will we make sunset at the beach? Where should we eat? Is the weather going to ruin our hike? Where are we sleeping tonight? These decisions compound over a multi-day trip, draining energy and creating friction --- especially with young children in the car.

**1.2 Solution**

RouteWise is a real-time trip orchestrator --- an AI-powered co-pilot capability built inside Dona (an OpenClaw AI agent). It ingests a pre-planned itinerary and actively manages it as reality unfolds. RouteWise monitors the family's GPS position, weather, daylight, traffic, and schedule adherence, then proactively surfaces options when the plan needs to change. When the family has an ad-hoc need ("we're hungry"), RouteWise responds with route-aware, context-aware suggestions that respect the overall trip plan.

**1.3 Core Principle**

RouteWise eliminates decision fatigue by reducing every complex, multi-variable travel decision into a simple choice between 2--3 curated options. Dona (via RouteWise) never makes decisions for the family --- it presents the best options and lets the family choose.

**1.4 What RouteWise Is NOT**

- RouteWise is not a navigation app. Google Maps handles turn-by-turn directions.

- RouteWise is not a trip planner. The itinerary is created before the trip starts.

- RouteWise is not a booking engine. It suggests and provides links; the family books.

- RouteWise is not an autonomous agent that takes actions without approval. It always presents options.

**2. User Persona & Trip Profile**

**2.1 Primary User**

**Family:** Parents + one child (age 7)

**Trip Type:** Multi-day road trip, American West Coast (Oregon/California coast)

**Duration:** 5--7 days

**Vehicle:** Honda CR-V (\~350 miles on full tank, gasoline)

**Driving Preference:** No more than 5--6 hours of driving per day

**Budget:** \$150--200/night hotels, \$50--80/meal, total trip budget set in advance

**2.2 Interaction Model**

The entire family communicates with Dona via a shared Telegram group chat. All three family members plus the Dona bot are in the group. Any family member can message Dona. Dona responds to the group. The driver focuses on the road; the passenger (co-driver) manages the Telegram interaction. All input and output is text-based.

**3. System Architecture**

**3.1 Stack Overview**

RouteWise runs as a capability inside Dona, an OpenClaw AI agent hosted on AWS. Dona connects to the family via Telegram and to external services via APIs. Navigation is fully delegated to Google Maps.

|               |                            |                                                                   |
|---------------|----------------------------|-------------------------------------------------------------------|
| **Component** | **Technology**             | **Role**                                                          |
| AI Agent      | OpenClaw on AWS            | Core brain --- LLM reasoning, memory, scheduling                  |
| LLM Layer     | Multi-LLM (pre-configured) | Heavy reasoning (Claude/GPT-4o) + quick tasks (Haiku/GPT-4o-mini) |
| Interface     | Telegram Bot API           | All family communication + live location reading                  |
| Navigation    | Google Maps                | Turn-by-turn directions via deep links                            |
| Email         | Gmail API                  | Parse forwarded booking confirmations                             |
| Memory        | OpenClaw Persistent Memory | Trip state, preferences, patterns, documents                      |
| Scheduling    | OpenClaw Heartbeat (Cron)  | 15-minute passive monitoring cycle                                |

**3.2 Data Flow**

1.  Family shares live location in Telegram (continuous).

2.  Every 15 minutes, RouteWise's heartbeat reads GPS, checks conditions, updates trip state.

3.  If conditions require action, Dona messages the Telegram group with options.

4.  Family responds; RouteWise updates the plan and Dona sends a Google Maps link if needed.

5.  For on-demand requests, family messages Dona directly, and RouteWise processes and responds immediately.

**4. Trip Intake & Document Storage**

**4.1 Trip Briefing**

Before the trip, the user provides Dona with a Trip Briefing --- a natural language message that establishes all trip context. Dona stores this in persistent memory and references it throughout the trip.

**Trip Briefing Contents:**

- **Itinerary:** Natural language description of each day's plan, including activities, destinations, and driving legs.

- **Budget:** Total trip budget + per-category targets (gas, food, hotels, activities, misc).

- **Vehicle:** Car type, fuel capacity/range.

- **Family Preferences:** Driving limits, food preferences, pace preference.

- **Hard Bookings:** Any pre-booked hotels, restaurants, tours with confirmation details.

- **Flight Details:** Inbound and outbound flight numbers, times, airports.

- **Car Rental:** Pickup/drop-off times, locations, car type.

**4.2 Email Parsing**

Dona has access to a dedicated Gmail account. The user can forward booking confirmation emails (flights, hotels, car rental) to this address. Dona parses these emails and extracts: confirmation numbers, dates/times, addresses, and booking details. This information is stored in persistent memory and is recallable on demand.

**4.3 Document & Photo Storage**

The user can send photos and documents to Dona via Telegram (e.g., car license plate photo, hotel confirmation screenshots). Dona stores these and recalls them on request. Example: "Dona, what's our license plate number?" --- Dona retrieves the stored photo or extracted text.

**4.4 Dual Intake**

Trip intake works in two parts:

- **Automated:** "Dona, check your email. I've forwarded all my bookings." Dona parses and builds the logistics skeleton (flights, car rental, booked hotels).

- **Manual:** User adds activities and soft plans in natural language. "Day 2 we want to hit Oregon Dunes and catch sunset at Bandon Beach."

Dona merges both into a unified trip plan.

**5. Itinerary Classification**

Every item in the itinerary is classified into one of three categories. This classification drives how RouteWise handles scheduling pressure and trade-offs.

|                 |                                                                                    |                                                                                                               |
|-----------------|------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| **Category**    | **Description**                                                                    | **RouteWise's Behavior**                                                                                      |
| Hard Commitment | Hotel booked, restaurant reservation, ferry/tour with fixed time, flight departure | RouteWise works BACKWARD from these. Never suggests skipping. Protects buffer time.                           |
| Soft Goal       | Visit a beach, see a viewpoint, catch sunset, do a hike                            | Can be reordered, shortened, or skipped. Dona offers alternatives. Always presents options, never auto-skips. |
| Open Slot       | \"Find a hotel somewhere near Gold Beach.\" \"Lunch on the way.\"                  | RouteWise actively solves these using route-aware search. Triggers hotel nudge after 5 PM.                    |

When schedule pressure builds, RouteWise sacrifices Soft Goals to protect Hard Commitments. Open Slots are resolved dynamically based on real-time conditions.

**6. Three Operating Modes**

**6.1 Mode 1: Autopilot**

**Trigger:** Everything is on track. No issues detected.

RouteWise is silently monitoring. GPS is tracked, ETAs are calculated, activities are auto-marked as done when the family leaves the area. Dona stays quiet unless spoken to. The only scheduled output in this mode is the morning briefing (6:00 AM).

**6.2 Mode 2: Alert**

**Trigger:** Reality diverges from plan (weather, timing, daylight, schedule drift).

Dona proactively messages the Telegram group with 2--3 options. Examples:

- "Running 40 min behind --- skip the overlook and head to dinner?"

- "Rain forecast at 3 PM at your next outdoor activity --- swap with tomorrow's indoor activity?"

- "Won't make sunset at Bandon at current pace --- here are alternatives."

- "It's 5 PM, no hotel booked tonight --- here are options positioned for tomorrow."

- "Flight delay detected --- adjusting Day 1 plan accordingly."

**6.3 Mode 3: On-Demand**

**Trigger:** A family member messages Dona with a request.

Someone in the group sends a message like "we're hungry, find pizza on the way" or "need gas, 30 miles left." Dona responds with route-aware, context-aware options. Dona correlates needs when possible (e.g., gas station near the restaurant).

**7. Heartbeat Engine**

RouteWise's cron job (OpenClaw Heartbeat) runs every 15 minutes. This is the passive monitoring engine that powers Autopilot and Alert modes.

**7.1 Heartbeat Cycle**

6.  Read GPS --- Get family's live location from Telegram.

7.  Update State --- Mark activities as done/in-progress based on location proximity and time spent.

8.  Check ETA --- Calculate arrival times for remaining activities via Google Directions API.

9.  Check Conditions --- Weather, sunset/golden hour, traffic for upcoming stops via WeatherAPI.com.

10. Decide --- Everything OK? Stay silent (Autopilot). Problem detected? Prepare options (Alert).

11. Act --- Send alert message to Telegram group, or remain silent.

**7.2 Activity Detection Logic**

RouteWise uses GPS to automatically detect activity status:

- **Arrived:** Family's location is within proximity of the activity coordinates.

- **In Progress:** Family has been at the activity location for a sustained period.

- **Completed:** Family has left the activity area and is back on a highway/road.

- **Uncertain:** Family is near but not clearly at the activity (e.g., parked at a gas station nearby). Dona asks rather than assumes.

**7.3 Deferred Request Handling**

When a family member defers a need ("lunch in one hour"), RouteWise sets an internal reminder and Dona re-raises it at the specified time based on the family's location at that moment. RouteWise recalculates options fresh when the reminder fires, since the family's position will have changed.

**8. Core Intelligence**

**8.1 Route-Aware Search**

This is the foundational capability behind all on-demand requests and proactive suggestions. When searching for anything (restaurants, gas, hotels, attractions), RouteWise does not search by proximity alone. It searches within a corridor along the family's current route to their next destination.

**Detour Budget:**

- **Default:** 20 minutes total round-trip (10 minutes off-route + 10 minutes back to route).

- User-adjustable per request ("find something, we don't mind a longer detour").

- If no options exist within the detour budget, Dona flags the extra time required and lets the family decide.

**8.2 Dining Intelligence**

RouteWise adapts its dining suggestions based on schedule pressure and context:

- **Popular/upscale dinner:** Suggest making a reservation. Provide the restaurant's phone number.

- **Casual lunch + tight schedule:** Suggest calling in a takeout order and eating on the road. "Order ahead, pick up at 1:15 PM, eat in the car, save 30 minutes."

- **Relaxed schedule:** Sit-down dining is fine. No rush flagged.

- Always correlate dining with nearby gas stations when fuel is a factor.

**8.3 Hotel Intelligence**

Hotel suggestions are not just about finding the nearest available room. RouteWise considers:

- **Next-day positioning:** Always factor in tomorrow's first activity. Present the tradeoff: "Stay in Gold Beach (closer now, longer drive tomorrow) vs. Brookings (30 min further tonight, 35 min head start tomorrow)."

- **Budget filtering:** Only show options within the user's per-night budget range.

- **5 PM trigger:** If no hotel is booked for tonight and it's past 5 PM, Dona proactively raises lodging options.

- **Availability awareness:** In popular areas during peak season, Dona warns about thinning availability and encourages earlier booking.

- Provide booking links, not just names. The family clicks and books themselves.

**8.4 Fuel Correlation**

RouteWise tracks fuel state based on manual reports from the family ("30 miles left in tank"). It correlates fuel needs with other stops:

- "Your next activity is 6 miles away and there's a gas station right next to it --- no need for an extra stop."

- "The restaurant I'm suggesting has a Chevron across the street --- knock out lunch and gas in one stop."

- When fuel is low and no correlated stop exists, Dona finds the closest gas station on-route within the detour budget.

**8.5 Golden Hour & Photo Timing**

For scenic stops and outdoor activities, RouteWise calculates golden hour (the period \~30--60 minutes before sunset when lighting is ideal for photography). Instead of just providing sunset time, Dona says:

- "Golden hour at Bandon Beach starts at 7:15 PM. Arrive by then for the best light at Face Rock."

- RouteWise uses this to set arrival targets for scenic activities, working backward to calculate when the family needs to leave their current location.

**8.6 Weather Intelligence**

Weather data feeds into multiple decisions:

- **Activity scheduling:** Rain forecast at an outdoor activity? Suggest swapping with an indoor alternative or rescheduling.

- **Morning briefing:** Include weather overview and wardrobe nudge. "Crater Lake will be 45°F this morning --- pack layers."

- **Driving conditions:** Flag fog, heavy rain, or wind advisories that may affect coastal driving.

**8.7 Flight Monitoring**

RouteWise monitors inbound and outbound flights using AviationStack API:

- **Inbound:** If the arrival flight is delayed, RouteWise adjusts Day 1's plan accordingly. Dona messages: "Flight delayed 90 minutes. Adjusting today's plan --- you'll still make dinner but I'd suggest skipping the first stop."

- **Outbound:** RouteWise works backward from the departure flight. Accounts for: drive to airport + car rental return + shuttle to terminal + security + buffer. "Your flight is at 3 PM from SFO. Accounting for car return and security, you need to leave your hotel by 10:30 AM."

- RouteWise checks flight status on the morning of flight days and again 3 hours before departure.

**8.8 Safety**

In remote areas (common on the West Coast), RouteWise maintains awareness of the nearest hospital/emergency room. If asked, Dona provides the name, address, distance, and a Google Maps link. Dona does not proactively message about this unless specifically relevant to the situation.

**9. Budget Tracking System**

**9.1 Setup**

During the Trip Briefing, the user sets:

- **Total trip budget:** e.g., \$2,500

- **Category targets:** Gas (\$300), Food (\$500), Hotels (\$1,200), Activities (\$300), Misc (\$200)

**9.2 Logging**

Budget entries are logged bidirectionally:

- **Dona asks:** After detecting the family left a restaurant or hotel (via GPS), Dona prompts: "How much was lunch?"

- **User volunteers:** "Just spent \$50 on gas." RouteWise logs it immediately under the correct category.

RouteWise categorizes each expense into: Gas, Food, Hotels, Activities, or Misc.

**9.3 Intelligence**

Budget data influences RouteWise's suggestions:

- If running over budget, Dona subtly shifts toward more affordable options.

- If under budget, Dona may suggest upgrades: "You've got room in the budget --- the ocean view room is only \$30 more."

- Budget status is included in the End of Day Recap.

**10. Trip Memory & Pattern Learning**

RouteWise uses OpenClaw's persistent memory to learn family patterns across the trip:

- **Schedule patterns:** "This family consistently runs 20 minutes behind in the morning." RouteWise bakes this into future ETA estimates.

- **Preferences:** "They always want coffee first thing." Dona starts including coffee shops in morning briefings.

- **Pace:** "They spend longer at beach activities than planned." RouteWise adds buffer to beach stops.

- **Food:** "They chose casual dining 4 out of 5 times." Dona prioritizes casual options.

RouteWise does not explicitly announce that it's learning. It simply gets better and more personalized as the trip progresses. If the family notices and asks, Dona can explain what patterns it's observed.

**11. Daily Rituals**

**11.1 Morning Briefing (6:00 AM Auto-Send)**

Every morning at 6:00 AM, Dona sends a day overview to the Telegram group:

- Today's planned activities and driving legs with estimated times

- Weather overview for the day's locations

- Wardrobe nudge if temperatures are notable ("Pack layers for Crater Lake --- 45°F this morning")

- Sunset/golden hour time for scenic activities

- Any hard commitments with fixed times

- Open slots that still need resolving (hotel, meals)

- Suggested departure time based on the day's plan

**Late Start Follow-Up:**

If the family hasn't departed by the suggested time and GPS shows they're still at the hotel, Dona sends a gentle follow-up: "Hey, looks like you're still at the hotel. Want me to adjust today's plan for a later start?" This respects the family's pace while keeping the plan realistic.

**11.2 End of Day Recap**

When the family arrives at their hotel for the night (detected via GPS), Dona sends a day summary:

- Total driving time today

- Activities completed vs. planned

- Budget spent today by category (Gas, Food, Hotels, Activities, Misc)

- Running trip total vs. budget

- Tomorrow's preview: first activity, drive time from hotel, suggested departure

- Any open items for tomorrow (hotel not booked, activities TBD)

**12. Document Recall**

RouteWise stores all trip-related documents, photos, and booking details in persistent memory. Any family member can ask Dona for any stored information at any time:

- "Dona, what's our hotel confirmation number?"

- "Dona, what's our license plate?" (retrieves stored photo or extracted text)

- "Dona, when's our return flight?"

- "Dona, what's the car rental drop-off location?"

- "Dona, how much have we spent on food so far?"

This turns RouteWise into the family's single source of truth for all trip logistics.

**13. Interaction Design**

**13.1 Message Format**

All Dona messages (powered by RouteWise) in Telegram should follow these principles:

- **Concise:** No walls of text. Short, scannable messages. Use emoji sparingly for visual anchoring.

- **Structured options:** Always numbered (1, 2, 3). Each option shows: name, key detail (rating, price, distance), and the tradeoff.

- **Actionable:** Every suggestion ends with a clear call to action ("Which one?" or "Want me to find alternatives?").

- **Google Maps links:** Always provide a direct Google Maps link when a location is selected. Format: https://www.google.com/maps/dir/?api=1&destination={lat},{lng}

**13.2 Option Presentation Rules**

- Always present 2--3 options. Never just one ("take it or leave it"). Never more than 4 (decision overload).

- Each option should represent a meaningfully different choice, not minor variations.

- Include the relevant tradeoff for each option (time, cost, quality, distance).

- When relevant, flag Dona's observation: "Option 2 also has gas nearby" or "Option 3 gives you a 35-min head start tomorrow."

**13.3 Group Chat Dynamics**

Multiple family members may respond. RouteWise does not designate a "trip leader." When the family agrees, Dona proceeds. If there's a conflict ("I want pizza" / "I want something healthier"), Dona presents options that try to satisfy multiple preferences and lets the family sort it out. Dona does not mediate.

**13.4 Error Recovery**

When RouteWise's suggestion doesn't work out (restaurant is closed, gas station doesn't exist), the family reports it in chat: "That place was closed." Dona immediately acknowledges, apologizes briefly, and provides the next-best alternative. No lengthy explanations --- just a fast pivot.

**14. Dona Personality & Prompt Specification**

Dona is the voice of RouteWise --- the personality the family interacts with in Telegram. Below are the personality traits, communication style, and decision principles that define how Dona communicates RouteWise's intelligence.

**14.1 Personality Traits**

- **Calm & Confident:** Dona speaks like an experienced road trip buddy who's done this route before. Never anxious or uncertain.

- **Concise:** Short messages. No filler. Respects the family's attention bandwidth.

- **Family-Friendly:** Appropriate for a 7-year-old to read. Warm but not overly cute.

- **Proactive, Not Naggy:** Dona surfaces important information once. If the family doesn't respond, Dona waits. Dona does not repeat alerts unless conditions change.

- **Context-Aware:** Every message references the current trip state. Dona never gives generic advice.

- **Honest About Uncertainty:** If Dona doesn't know something or a suggestion might be wrong, it says so. "Google shows this place as open, but hours might have changed --- maybe call ahead."

**14.2 Communication Style**

- Use emoji sparingly as visual anchors (1--2 per message).

- Never use ALL CAPS except for a single-word emphasis.

- Keep messages under 200 words. If more detail is needed, split into two messages.

- Always end with a clear next step or question.

- When things go wrong (closed restaurant, bad suggestion), be brief: "Oops, sorry about that. Here's the next best option."

**14.3 Decision Principles**

When RouteWise evaluates options and Dona constructs suggestions, the following principles apply in priority order:

12. Safety first --- never suggest anything that compromises driving safety or puts the family at risk.

13. Protect hard commitments --- work backward from fixed bookings and flights.

14. Respect the detour budget --- 20-minute round-trip default unless overridden.

15. Correlate needs --- always look for opportunities to combine stops (gas + food, hotel + tomorrow's positioning).

16. Budget awareness --- filter options by budget; nudge toward savings when over budget.

17. Maximize experience --- golden hour timing, scenic opportunities, local favorites over chains.

**19 RouteWise PRD - Refinements & Clarifications

## 1. Activity Detection Thresholds (TBD)

Need to define concrete values:
- **Proximity radius:** 1000 meters (for "arrived" detection)
- **Sustained period:** 20 minutes (for "in progress" detection)
- **Departure buffer:** 1000 meters from activity before marking "completed"

> ⚠️ These values need real-world testing to calibrate.

---

## 2. Budget Tracking

**Approach:** Daily reconciliation + approximate guidance

- **End-of-day prompt:** One consolidated ask at hotel arrival: "Quick budget check - roughly how much on food today? Gas? Activities?"
- **Expectation setting:** Budget tracker is directional, not accounting. "Roughly on track" vs. exact ledger.
- **No per-stop logging friction.**

---

## 3. Pattern Learning

**Rule:** Single instance = learned pattern.

- Dona adapts immediately after one observation.
- No threshold required (not "3 occurrences to establish pattern").
- Examples:
  - Family leaves 20 min late once → Dona factors this into future ETAs.
  - Family chooses casual dining once → Dona notes preference.

---

## 4. Deferred Request Handling

**Rule:** Same category = override. Different category = stack.

| Scenario | Behavior |
|----------|----------|
| "Lunch in 1 hour" then "Lunch in 30 min" | Second request overrides first |
| "Lunch in 1 hour" then "Coffee in 30 min" | Both reminders stack (different needs) |

---

## 5. Flight Delay Cascade Logic

**Trigger:** Inbound flight delay impacts Day 1 plan.

**Process:**
1. **Anchor on hard commitments** - Work backward from fixed times (dinner reservation, hotel check-in deadline).
2. **Calculate the squeeze** - Original plan had X hours. Now have X minus delay. What fits?
3. **Triage soft goals:**
   - Can any be shortened? (1-hour stop → 20-min stop)
   - Can any move to another day? (activity is on tomorrow's route anyway)
   - What must be cut entirely?
4. **Present 2-3 options to family** - Dona shows the math, family chooses.

**Example Message:**
> "Flight delay ate 2 hours. Options:
> 1. Skip overlook, relaxed drive to dinner ✅
> 2. Quick 20-min overlook stop, tighter but doable ⚠️
> 3. Push dinner reservation back 1 hour - want me to find their number to call?
>
> Which works?"

**Edge Case:** If delay threatens hard commitments:
> "Even skipping everything, you'd arrive 30 min late to dinner. Want me to find the restaurant's number so you can call ahead?"

---

## 6. Conflict Resolution

**Rule:** Family resolves conflicts, not Dona.

- If multiple family members respond with different choices, Dona waits for them to sort it out.
- Dona does not pick a "winner" or implement first-response-wins.
- Dona may prompt: "Seeing different votes - let me know when you've decided!"

**15. Technical Stack & API Reference**

**15.1 Infrastructure**

|                   |                                                                                                                                |
|-------------------|--------------------------------------------------------------------------------------------------------------------------------|
| **Component**     | **Details**                                                                                                                    |
| Agent Platform    | OpenClaw (open-source autonomous AI agent)                                                                                     |
| Hosting           | AWS (always-on during trip)                                                                                                    |
| LLM Configuration | Multi-LLM, pre-configured in OpenClaw. Heavy reasoning tasks route to Claude/GPT-4o; quick lookups route to Haiku/GPT-4o-mini. |
| Memory            | OpenClaw Persistent Memory (trip state, patterns, documents)                                                                   |
| Scheduler         | OpenClaw Heartbeat (cron job, 15-minute interval)                                                                              |
| Interface         | Telegram Bot in family group chat                                                                                              |
| Email             | Gmail API (Dona's dedicated Gmail account)                                                                                     |

**15.2 Required APIs**

The following API keys must be obtained and configured in Dona before the trip:

|                     |                      |                                                            |                                     |
|---------------------|----------------------|------------------------------------------------------------|-------------------------------------|
| **API**             | **Provider**         | **Purpose**                                                | **Key Type**                        |
| Directions API      | Google Maps Platform | ETA calculation, route planning, detour time               | Google Cloud API Key                |
| Places API          | Google Maps Platform | Restaurants, gas, hotels, attractions, ratings, hours      | Google Cloud API Key (same project) |
| Geocoding API       | Google Maps Platform | Location name to coordinates conversion                    | Google Cloud API Key (same project) |
| Distance Matrix API | Google Maps Platform | Compare drive times to multiple options                    | Google Cloud API Key (same project) |
| Weather + Astronomy | WeatherAPI.com       | Forecast, current conditions, sunrise, sunset, golden hour | WeatherAPI Key                      |
| Flight Status       | AviationStack        | Real-time flight tracking and delay detection              | AviationStack Key (free tier)       |
| Telegram Bot        | Telegram             | Send/receive messages, read live location                  | Already configured                  |
| Gmail               | Google               | Parse forwarded booking confirmations                      | Already configured                  |

Note: All Google Maps Platform APIs can be enabled under a single Google Cloud project with one API key. This means you need a total of 3 new API keys: Google Cloud, WeatherAPI.com, and AviationStack.

**15.3 API Cost Estimates**

For a 7-day road trip with 15-minute heartbeat intervals and on-demand requests, estimated API usage:

- **Google Maps Platform:** \~\$15--30 for the trip (Directions + Places + Distance Matrix). Google offers \$200/month free credit.

- **WeatherAPI.com:** Free tier (1M calls/month). Trip will use \~2,000 calls.

- **AviationStack:** Free tier (100 calls/month). Trip needs \~10--20 calls.

**16. Pre-Trip Testing Checklist**

Complete all items at least 2 weeks before departure. This ensures RouteWise is battle-tested before the family relies on it.

**16.1 Infrastructure Tests**

- Verify Dona is running on AWS and accessible via Telegram 24/7

- Test Heartbeat/Cron reliability over 48 hours --- confirm it fires every 15 minutes without gaps

- Test persistent memory --- store trip data, restart Dona, confirm RouteWise data persists

**16.2 Telegram Tests**

- Create family group chat with all members + Dona bot

- Test live location sharing --- confirm Dona can read GPS coordinates from shared location

- Test photo/document sharing --- send license plate photo, confirm Dona stores and recalls it

- Confirm all family members can message Dona and receive responses

**16.3 API Tests**

- Google Maps: Test Directions API (calculate ETA between two points)

- Google Maps: Test Places API (search for restaurants near a location)

- Google Maps: Test Distance Matrix API (compare drive times to 3 hotels)

- WeatherAPI.com: Test forecast retrieval for a West Coast location

- AviationStack: Test flight status lookup with a real flight number

- Gmail: Forward a test booking email and confirm Dona parses it correctly

**16.4 End-to-End Dry Run**

- Send Dona a sample 2-day itinerary in natural language

- Share live location and confirm Dona can track your position

- Simulate an on-demand request: "find pizza on the way to \[destination\]"

- Confirm Google Maps links open correctly on all family members' phones

- Test the morning briefing --- does it send at 6 AM with correct content?

- Test budget logging: report a spend, ask Dona for the running total

- Test error recovery: tell Dona "that place was closed" and confirm it pivots

**17. V2 Roadmap**

The following features are explicitly out of scope for RouteWise V1 but are captured here for future development:

|                       |                                                                                                                                                      |              |
|-----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| **Feature**           | **Description**                                                                                                                                      | **Priority** |
| Dona Calls Ahead      | Voice API integration (Twilio/Bland.ai) for Dona to call restaurants to confirm hours, make reservations, or place takeout orders.                   | High         |
| Partial Plan Changes  | Natural language plan modifications mid-trip: "Add wine tasting today" or "Swap the hike for a beach day." RouteWise reflows the remaining schedule. | High         |
| Kid-Aware Suggestions | Factor in playgrounds, kid-friendly menus, stroller-accessible trails, rest stops with family facilities.                                            | Medium       |
| Return Trip Memory    | If passing near a skipped activity on the return leg, Dona suggests: "You missed the lighthouse on Day 2 --- want to stop today?"                    | Medium       |
| Smart Fuel Learning   | RouteWise learns the car's fuel consumption pattern over multiple fill-ups and proactively predicts when gas will be needed.                         | Low          |
| Multi-Trip Learning   | RouteWise carries family preference data across trips: "Last trip you loved seafood restaurants --- want me to prioritize those?"                    | Low          |

**18. Appendix: Sample Interactions**

**A. Morning Briefing**

"☀️ Good morning! Here's your Day 2 rundown:

📍 You're at Lincoln City

🗓 Today's plan: 1) Oregon Dunes (\~2hr 15min drive, 1.5--2hrs exploring) 2) Bandon Beach for sunset (Face Rock) 3) Find hotel near Gold Beach/Brookings

🌤 Weather: 68°F, partly cloudy, no rain. Crater Lake tomorrow will be 45°F in the morning --- pack layers!

🌅 Sunset at 8:12 PM. Golden hour starts \~7:15 PM.

⛽ How's the tank looking?

Suggested departure: 10:30 AM to keep things comfortable. No rush!"

**B. On-Demand: Hungry + Gas**

User: "We're hungry find pizza, also need gas"

Dona: "🍕 Found 3 pizza spots on your route to Bandon:

1\. Luigi's --- 4.4★ --- 8 min ahead, right off 101

2\. Coos Bay Pizza --- 4.2★ --- 15 min ahead, ⛽ Chevron across the street

3\. Bandon Pizza --- 4.5★ --- 55 min ahead, in Bandon itself

Option 2 knocks out gas and pizza in one stop. All keep you on track for sunset. Which one?"

**C. Proactive Alert: Behind Schedule**

Dona: "⚠️ Heads up --- you're running \~40 min behind. At current pace, you'd arrive at Bandon Beach around 8:05 PM. Sunset is 8:12 PM --- cutting it close.

A. Skip the scenic overlook, head straight to Bandon --- arrive \~7:25 PM ✅

B. Quick 15-min stop at overlook, arrive Bandon \~7:50 PM ⚠️

C. Skip Bandon sunset, enjoy a relaxed evening --- find hotel early 🏨

What sounds right?"

**D. Hotel Nudge: Next-Day Aware**

Dona: "🏨 It's 5:15 PM and no hotel tonight. Tomorrow's first stop is Redwood National Park, so I found hotels on that route:

1\. Pacific Reef --- Gold Beach --- \$165 --- 4.3★ \| 1hr 45min to Redwoods tomorrow

2\. Wild Rivers Inn --- Brookings --- \$145 --- 4.1★ \| 1hr 10min to Redwoods ⭐ Best head start

3\. Beachfront Inn --- Brookings --- \$189 --- 4.5★ ocean view \| 1hr 10min to Redwoods

Brookings saves \~35 min tomorrow morning. Availability thinning. Want to lock one in?"

**E. Plan Collapse**

User: "Kids are exhausted. Skip everything. Find us a hotel now."

Dona: "Totally get it. Skipping Bandon, going straight to rest. 🛏 You're near Coos Bay:

1\. Best Western --- \$155 --- 4.0★ --- 5 min away

2\. Mill Casino Hotel --- \$179 --- 4.2★ --- 8 min, has a pool 🏊

3\. Edgewater Inn --- \$139 --- 3.8★ --- 3 min away

Option 2 has a pool --- might perk the kids up. Which one?"

**F. End of Day Recap**

Dona: "🌙 Day 2 wrap-up:

🚗 Drove 4.5 hours today

✅ Oregon Dunes --- done \| ✅ Bandon Beach sunset --- done \| ❌ Scenic overlook --- skipped

💰 Today's spend: Gas \$52 \| Food \$68 \| Hotel \$189 \| Total: \$309

📊 Trip running total: \$847 of \$2,500 budget (34%)

🗓 Tomorrow: Redwood National Park (Stout Grove trail). 1hr 10min from your hotel. Suggest leaving by 8:30 AM for a cool morning hike.

Great day! Sleep well. 😴"

*End of Document*

*ROUTEWISE Road Trip Co-Pilot PRD v1.0 \| Powered by Dona (OpenClaw)*
