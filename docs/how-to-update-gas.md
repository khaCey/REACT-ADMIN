# How to update Google Apps Script (GAS) deployments

This repo describes **what** your Web Apps must implement in [`gas-calendar-poll-prompt.md`](gas-calendar-poll-prompt.md) and [`staff-schedule-gas.md`](staff-schedule-gas.md). This page covers **how** to publish changes in Google and keep secrets in sync.

---

## 1. Student schedule (MonthlySchedule / calendar poll)

**Env vars:** `CALENDAR_POLL_URL`, `CALENDAR_POLL_API_KEY` (server `.env`); often `VITE_CALENDAR_POLL_URL` / `VITE_CALENDAR_POLL_API_KEY` (client `.env` if the browser calls GAS directly).

### Update the script code

1. Open [script.google.com](https://script.google.com) and select the project bound to your **student schedule** Web App (or open the project from the spreadsheet/container it is attached to).
2. Edit `Code.gs` (and any included files). If you keep a local copy (e.g. a `Calendar API/` folder), paste or sync changes into the online project—**that folder is not committed**; see note at the bottom of [`gas-calendar-poll-prompt.md`](gas-calendar-poll-prompt.md).
3. **Deploy a new version** (required for the live URL to run new code):
   - **Deploy** → **Manage deployments**
   - Click the **pencil** on the active **Web app** deployment
   - Under **Version**, choose **New version**
   - **Deploy**
4. The **Web app URL** (ends with `/exec`) should stay the **same** as long as you edit that deployment and do not create a second Web app deployment. If the URL ever changes, update `CALENDAR_POLL_URL` and any `VITE_CALENDAR_POLL_*` to match.

### Verify

- Open the Admin UI **Test GAS** (staff URL) only applies to staff GAS; for the poll URL, use a browser or `curl` with your secret, e.g.  
  `GET <CALENDAR_POLL_URL>?key=YOUR_KEY&full=1`
- Check server logs when the app triggers backfill/sync if something fails.

---

## 2. Staff schedule (teacher calendars)

**Env vars:** `STAFF_SCHEDULE_GAS_URL`, `STAFF_SCHEDULE_API_KEY` (or fallback to `CALENDAR_POLL_*`—see [`staff-schedule-gas.md`](staff-schedule-gas.md)).

Use the **same deployment steps** as above, but on the **separate** Apps Script project used only for listing events by `calendarId`. Do **not** reuse the student MonthlySchedule deployment for staff fetch, or you will get wrong JSON shapes (`changed` / `diff` instead of events).

**Verify:** Admin page **Test GAS** with a staff `calendarId`.

---

## 3. Rotating the poll API key (`key` query param)

1. Choose a new random secret (long, unguessable).
2. **In GAS:** update wherever you validate the key (e.g. `Config.POLL_API_KEY` or hard-coded check in `doGet`) so it matches the new value.
3. **Deploy** a **new version** of the Web app (step 1.3)—old deployments may still run old code until you do.
4. **In this app’s `.env` (and `client/.env` if used):**
   - `CALENDAR_POLL_API_KEY=<new>`
   - `VITE_CALENDAR_POLL_API_KEY=<new>` (only if the client calls GAS directly)
5. Rebuild the client if you changed `VITE_*`: `npm run build` (production) or restart Vite (dev).
6. Restart the Node server / PM2 so `CALENDAR_POLL_API_KEY` is picked up.

For **staff** GAS, rotate **`STAFF_SCHEDULE_API_KEY`** (and deploy new GAS version) in the same way.

---

## 4. Common issues

| Symptom | Check |
|--------|--------|
| Changes not visible | You saved in the editor but did **not** deploy a **New version** for the Web app. |
| 401 / “wrong key” | Key mismatch between GAS and `.env`; or client still using old built bundle. |
| Wrong data shape | Student vs staff URL mixed up—see [`staff-schedule-gas.md`](staff-schedule-gas.md). |

---

## Related docs

- [`POLLING_API_SPEC.md`](../POLLING_API_SPEC.md) — short API summary + link to full prompt
- [`docs/gas-calendar-poll-prompt.md`](gas-calendar-poll-prompt.md) — full HTTP contract and LLM prompt
- [`docs/staff-schedule-gas.md`](staff-schedule-gas.md) — staff GAS contract
