# RouteWise Build Status

## OpenClaw Integration — Completed 2026-02-18

### Summary
RouteWise is now wired into OpenClaw so that Telegram family group messages trigger
RouteWise intelligence and responses are delivered back to the group.

---

## What Was Built

### 1. `openclaw-integration.js` — Telegram Bridge
The single seam between OpenClaw and RouteWise. Exports:

| Function | Purpose |
|---|---|
| `processGroupMessage({ text, attachments, fromName, chatId })` | Route a group chat message through RouteWise and send the response to the group |
| `processLocationUpdate(lat, lon, timestamp)` | Handle a live-location GPS tick; update tripState + send any triggered alerts |
| `runHeartbeat()` | 15-min proactive check — silent unless trip is active AND an alert condition is detected |
| `runMorningBriefing()` | 6 AM daily briefing — silent unless trip is active with an itinerary |
| `sendToGroup(text)` | Send markdown text to the family group via Telegram Bot API (native https, no extra deps) |

**Smart silence:** Both `runHeartbeat()` and `runMorningBriefing()` require
`state.tripId` AND `state.itinerary.length > 0` before doing anything. This prevents
spurious alerts before the family sends their trip plan.

### 2. `.env` Updates
- `TELEGRAM_BOT_TOKEN` — populated from `openclaw.json` at build time
- `ROUTEWISE_GROUP_CHAT_ID` — left empty; set this when the family group is created

### 3. `src/memory/tripState.js` — `updateCurrentLocation()`
New function that persists `{ lat, lon, updatedAt }` into `state.currentLocation`
so the heartbeat and morning briefing can reference the last known GPS position.
Only persists when `tripId` is set (avoids auto-creating phantom trips on GPS pings).

### 4. Cron Jobs (OpenClaw)
| Job | Schedule | ID |
|---|---|---|
| RouteWise Heartbeat | Every 15 minutes | `b7080a63-c0cd-491f-b777-21a18df9cae6` |
| RouteWise Morning Briefing | 6:00 AM America/New_York daily | `d67f138c-6dd5-41fb-b7de-22acaf0365f8` |

Both jobs run in isolated sessions with no delivery (silent unless RouteWise
sends to the group directly via Bot API).

### 5. `package.json` Scripts
```bash
npm run heartbeat          # Run heartbeat manually
npm run morning-briefing   # Run morning briefing manually
npm test                   # Run all test suites
```

### 6. `test-integration.js` — Integration Smoke Test
```bash
node test-integration.js
```
Runs 4 scenarios without real Telegram (GROUP_CHAT_ID absent → logs only):
1. Pizza food query via `processGroupMessage`
2. GPS location update via `processLocationUpdate`
3. Heartbeat with no active trip (silent)
4. Morning briefing with no active trip (silent)

---

## Test Results

| Suite | Tests | Pass | Fail |
|---|---|---|---|
| M1 Intake | 8 | 8 | 0 |
| M2 Tracking | 10 | 10 | 0 |
| M3 Intelligence | 23 | 23 | 0 |
| M4 Proactive | 13 | 13 | 0 |
| M5 Patterns | 10 | 10 | 0 |
| E2E Integration | 10 | 9 | 1 ⚠️ |
| **Total** | **74** | **73** | **1** |

⚠️ **E2E test 7** ("Heartbeat again immediately → alert suppressed") was **already
failing before this integration work** — confirmed by running the test suite on the
unmodified `main` branch. Not introduced by this PR.

Root cause: the `alertLastSent` in-memory guard resets across heartbeat calls in
the E2E test because the hotel-nudge type fires on the second call (a different
alert type than schedule-drift, so noRepeatGuard doesn't suppress it). Tracked for
a future fix in the proactive module.

---

## How to Use

### When the family creates their Telegram group:
1. Add the bot to the group
2. Get the group's chat ID (send a message, fetch via `getUpdates`)
3. Set `ROUTEWISE_GROUP_CHAT_ID=<chat_id>` in `routewise/.env`
4. RouteWise will immediately start responding to group messages

### Message flow (production):
```
Family message → OpenClaw Telegram plugin
  → processGroupMessage({ text, fromName, chatId })
    → routewise.handleMessage({ text })
      → [intelligence routing]
        → sendToGroup(response)
          → Telegram Bot API → family group
```

### Heartbeat flow (every 15 min, during trip):
```
OpenClaw cron → isolated agent → node ./openclaw-integration runHeartbeat()
  → check tripId + itinerary (guard)
    → proactive.runHeartbeat(state, lat, lon)
      → [alert conditions evaluated]
        → sendToGroup(alert) [only if mode === 'alert']
```

### Morning briefing flow (6 AM ET, during trip):
```
OpenClaw cron → isolated agent → node ./openclaw-integration runMorningBriefing()
  → check tripId + itinerary (guard)
    → morningBriefing.generateBriefing(state, lat, lon, date)
      → sendToGroup(briefing)
```
