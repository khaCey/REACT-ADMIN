# Calendar Webhook (Apps Script)

Apps Script webhook for **Google Calendar API push notifications**. When calendar events are created or updated, Google POSTs to the deployed Web App; we fetch events and update the `lessons_today` sheet and **MonthlySchedule** / **NextMonthSchedule** sheets. The same deployment also serves **polling** for the Admin react-app so it can sync schedule data into PostgreSQL.

## Architecture

- **Code.js** — Entry point: `doGet` (polling API), `doPost` (webhook), `registerCalendarWatch`
- **Polling.js** — Reads MonthlySchedule/NextMonthSchedule, serves JSON for react-app; `bumpScheduleCacheVersion` when cache is updated
- **MonthlyCache.js** — Writes current/next month to Admin sheet; calls `bumpScheduleCacheVersion` after write
- **Functions.js** — `fetchAndCacheTodayLessons` (lessons_today), AppState, etc.
- **Config.js** — `WEBHOOK_URL`, `POLL_API_KEY`, spreadsheet/calendar IDs
- **appsscript.json** — Calendar API v3 advanced service enabled

## Setup

1. **Deploy as Web App**
   - In the script editor: Deploy > New deployment > Web app
   - Execute as: **Me**
   - Who has access: **Anyone** (so Google can POST to the webhook and the react-app can GET)
   - Copy the deployment URL (e.g. `https://script.google.com/macros/s/XXX/exec`)

2. **Enable Calendar API**
   - Resources > Advanced Google services > Enable "Google Calendar API"

3. **Register the watch**
   - Run `registerCalendarWatch(webhookUrl)` from the script editor, passing your deployment URL
   - Re-run every ~6 days (channels expire)

4. **Polling API (Admin react-app)**
   - Set `POLL_API_KEY` in `Config.js` to a shared secret (or set script property `POLL_API_KEY` in Project Settings > Script Properties).
   - In the react-app, set `VITE_CALENDAR_POLL_URL` to this deployment URL and `VITE_CALENDAR_POLL_API_KEY` to the same secret.
   - **GET** `?key=YOUR_KEY` — returns `{ changed, diff: { updated, lastUpdated, cacheVersion } }` (full schedule in `diff.updated`).
   - **GET** `?key=YOUR_KEY&full=1` — returns `{ cacheVersion, lastUpdated, data }` for initial load. The react-app client will sync `data` to the server’s `POST /api/calendar-poll/sync` and thus into PostgreSQL.

5. **Optional: remove 15‑minute trigger**
   - If using webhooks, you may no longer need `scheduledLessonCacheUpdate` every 15 min
