# Staff schedule fetch – GAS wiring

The **Fetch Staff Schedule** feature (single staff and bulk) calls a Google Apps Script (GAS) Web App. If you get **0 events**, check the following.

## 1. Environment variables

In the project root `.env`:

- **`CALENDAR_POLL_URL`** – Full URL of the **deployed** GAS Web App (e.g. `https://script.google.com/macros/s/.../exec`). Do not use the “dev” URL; use **Deploy > Test deployments** or **Deploy > Deploy as web app** and copy the **exec** URL.
- **`CALENDAR_POLL_API_KEY`** – API key string that the GAS expects in the `key` query parameter (if your GAS checks it).

## 2. What the GAS must support

The backend calls the GAS with a **GET** request and these **query parameters**:

| Parameter   | Description                                      |
|------------|---------------------------------------------------|
| `key`      | Your API key (from `CALENDAR_POLL_API_KEY`)        |
| `calendarId` | The staff’s Google Calendar ID (e.g. `xxx@group.calendar.google.com`) |
| `timeMin`  | Start of range, ISO 8601 (e.g. `2026-03-14T00:00:00.000Z`) |
| `timeMax`  | End of range, ISO 8601                            |

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

- **Wrong URL** – `CALENDAR_POLL_URL` points to a different GAS (e.g. one that only supports `full=1` / MonthlySchedule) and does not handle `calendarId` / `timeMin` / `timeMax`. Deploy the script that implements the staff-calendar endpoint and use its **exec** URL.
- **GAS returns HTML or error** – e.g. 404 or “Authorization required”. Check the **server logs** when you click “Fetch schedule”; the backend logs a short message when the response is not OK or not a valid event array.
- **Calendar has no events** in the requested 31-day window.
- **Calendar ID** – The staff row’s `calendar_id` must be the correct Google Calendar ID (e.g. from Calendar settings > Integrate calendar).

## 4. Check server logs

When you trigger “Fetch schedule”, watch the **Node server console**. You’ll see:

- `[fetch-staff-schedule/:id] GAS responded with 4xx/5xx ...` if the HTTP status is not OK.
- `[fetch-staff-schedule/:id] GAS response was not JSON` if the body isn’t valid JSON.
- `[fetch-staff-schedule/:id] GAS returned 0 events; response keys: ...` if the parsed JSON is not an array and has no `events`/`items` (helps confirm the URL points to the right endpoint).

Use these to confirm the request reaches the correct GAS and the response shape matches the contract above.
