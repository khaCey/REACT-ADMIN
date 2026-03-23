# Staff schedule fetch – GAS wiring

**Deploy / update / rotate keys:** [how-to-update-gas.md](how-to-update-gas.md) (same Google flow as the student poll; use this project’s Web App URL for `STAFF_SCHEDULE_GAS_URL`).

The **Fetch Staff Schedule** feature (single staff and bulk) calls a **separate** Google Apps Script (GAS) Web App that returns **teacher calendar events** (by `calendarId`). It must **not** use the same GAS as the **student schedule** (MonthlySchedule / `changed` / `diff`), or you will get 0 events or the wrong data.

## 1. Environment variables

In the project root `.env`:

- **`STAFF_SCHEDULE_GAS_URL`** – Full URL of the GAS Web App that **lists events for a given calendar ID** (teacher availability). This must be a different deployment from the student-schedule GAS. If unset, the app falls back to `CALENDAR_POLL_URL` (which is usually the student-schedule endpoint).
- **`STAFF_SCHEDULE_API_KEY`** – API key for that GAS (or use `CALENDAR_POLL_API_KEY` if you use the same key).

**Important:** `CALENDAR_POLL_URL` is used for **student schedule** (backfill, sync). If you use it for staff schedule too, the GAS may ignore `calendarId` and return `{ changed, diff }` with student lessons, and you will see “0 events”. Set **`STAFF_SCHEDULE_GAS_URL`** to a GAS that accepts `calendarId`, `timeMin`, `timeMax` and returns an **array of calendar events** for that calendar only.

## 2. What the GAS must support

The backend calls the GAS with a **GET** request and these **query parameters**:

| Parameter   | Description                                      |
|------------|---------------------------------------------------|
| `key`      | Your API key (from `STAFF_SCHEDULE_API_KEY` or `CALENDAR_POLL_API_KEY`) |
| `calendarId` | The staff’s Google Calendar ID (e.g. `xxx@group.calendar.google.com`) |
| `timeMin`  | Start of range, ISO 8601 (first instant of **current month** in Asia/Tokyo) |
| `timeMax`  | End of range, ISO 8601 (exclusive first instant of **month after next** in Tokyo, so the window covers **current + next** calendar month) |

The GAS must:

1. Validate `key` (if you use one).
2. Use **Calendar App** (or Calendar Advanced Service) to list events for `calendarId` between `timeMin` and `timeMax`.
3. Return **JSON** with one of:
   - A **raw array** of events, or  
   - An object with an **`events`** or **`items`** array.

Each event must have:

- **`start`** – ISO dateTime string or `{ dateTime: "..." }`
- **`end`** – ISO dateTime string or `{ dateTime: "..." }`

Example response (raw array):

```json
[
  {
    "id": "event-id",
    "summary": "Lesson",
    "start": { "dateTime": "2026-03-14T10:00:00+09:00" },
    "end": { "dateTime": "2026-03-14T10:45:00+09:00" }
  }
]
```

If the GAS returns an **object** (e.g. `{ "events": [...] }`), the backend will use `events` or `items`; a raw array is also supported.

## 3. Common reasons for 0 events

- **Using the student-schedule GAS** – If you use `CALENDAR_POLL_URL` (or leave `STAFF_SCHEDULE_GAS_URL` unset), the backend may call the **student** schedule GAS, which returns `{ changed, diff }` with student lessons. Set **`STAFF_SCHEDULE_GAS_URL`** to a **separate** GAS that only lists events by `calendarId` (teacher calendar).
- **Wrong URL** – The staff GAS must accept `calendarId`, `timeMin`, `timeMax` and return an array of events (or `{ events }` / `{ items }`). Deploy that script and set `STAFF_SCHEDULE_GAS_URL` to its **exec** URL.
- **GAS returns HTML or error** – e.g. 404 or “Authorization required”. Check the **server logs** or use **Test GAS** on the Admin page to see the response.
- **Calendar has no events** in the requested 31-day window.
- **Calendar ID** – The staff row’s `calendar_id` must be the correct Google Calendar ID (e.g. from Calendar settings > Integrate calendar).

## 4. Test GAS and server logs

On the **Admin** page, use **Test GAS** to call the staff-schedule URL with a staff calendar ID. You’ll see the response keys (e.g. `changed, diff` = student schedule; an array or `events` = teacher calendar). Set **`STAFF_SCHEDULE_GAS_URL`** to the GAS that returns teacher events.

When you trigger “Fetch schedule”, watch the **Node server console** for:

- `[fetch-staff-schedule/:id] GAS responded with 4xx/5xx ...` if the HTTP status is not OK.
- `[fetch-staff-schedule/:id] GAS response was not JSON` if the body isn’t valid JSON.
- `[fetch-staff-schedule/:id] GAS returned 0 events; response keys: ...` – if you see `changed, diff`, you are still hitting the student-schedule GAS; switch to `STAFF_SCHEDULE_GAS_URL`.
