# Prompt / spec: Google Apps Script — MonthlySchedule calendar poll Web App

Use this document as the **system or task prompt** when implementing or auditing the Apps Script project that backs **student MonthlySchedule** polling (the URL in `CALENDAR_POLL_URL` / `VITE_CALENDAR_POLL_URL`).  
The **REACT-ADMIN** SPA and Node API depend on the shapes below.

**Operational steps (deploy new version, rotate API key):** [how-to-update-gas.md](how-to-update-gas.md)

---

## Role of the Web App

Deploy as a **Web app** (Execute as: typically the account that can read the shared calendar; Who has access: anyone with the link, or as you prefer). The script:

1. Validates a shared secret: query parameter **`key`** must match the configured poll API key (same as `CALENDAR_POLL_API_KEY` on the server / `POLL_API_KEY` in GAS `Config` if you use that pattern).
2. Serves **two modes**:
   - **Full snapshot** — `full=1` (initial load / refresh).
   - **Incremental poll** — no `full` (or `full` absent); returns whether the cache changed and a **diff** to apply on top of the client’s in-memory list.

3. Optionally supports **backfill** query params used by the Node server (`month=YYYY-MM`, `year=YYYY`) — same JSON shape as full mode for the filtered range.

---

## HTTP contract

- **Method:** `GET` (the React client uses `fetch(url)` only).
- **Query parameters (required unless noted):**
  - **`key`** (required) — API secret; reject with `{ "error": "..." }` if wrong or missing.
  - **`full=1`** (optional) — return full `data` array + `cacheVersion` + `lastUpdated`.
  - **`month=YYYY-MM`** (optional) — restrict range for backfill (server-side `POST /api/calendar-poll/backfill`).
  - **`year=YYYY`** (optional) — restrict range for backfill.

**Response:** always JSON. On error: `{ "error": "human-readable message" }` and appropriate status if you set it (client reads JSON body).

---

## Stable row identity (critical)

Each lesson row in **`data`** / diff arrays must include:

- **`eventID`** — **Stable Google Calendar event identifier** for that occurrence (the same string the client and DB will key on). Prefer the Calendar API **`id`** for the event (or whatever you already store in MonthlySchedule).  
  - Do **not** put `|` in `eventID` (the client builds keys as `eventID + '|' + studentName`).
- **`studentName`** — Display name string, trimmed; should match student names in the admin DB when possible (spacing normalized on the server).

**Removed lessons:** When an event disappears from the calendar (deleted or no longer matches your filter), the poll response **must** list it under **`diff.removed`** using the **exact same key string** the client would use:

```text
<eventID>|<studentName>
```

Example: `abc123@google.com_20260321T090000Z|Tarou Tanaka` — only if that was the `eventID` and `studentName` you emitted while the row existed.

The Node server also accepts `{ eventID, studentName }` in `removed[]` on `POST /api/calendar-poll/sync`, which the SPA derives by splitting that key. If `removed` is wrong or empty, deletions may not reach PostgreSQL until a reconcile runs for that month.

---

## Full snapshot response (`?key=...&full=1`)

Return JSON:

```json
{
  "cacheVersion": 42,
  "lastUpdated": "2026-03-21T12:34:56.789Z",
  "data": [ /* array of lesson objects */ ]
}
```

- **`cacheVersion`** — Integer (or numeric) monotonically increased **whenever** your cached MonthlySchedule changes (any add/update/delete you care about). The client stores it; polls compare implicitly via `changed` + diff.
- **`lastUpdated`** — ISO 8601 string (UTC recommended).
- **`data`** — Complete current list of lessons (for the scope you define: e.g. rolling window, current + next month, etc.). **Consistency:** same rules as poll diff for field names and semantics.

### Lesson object fields (camelCase preferred; server accepts snake_case aliases)

| Field | Required | Notes |
|--------|----------|--------|
| `eventID` | yes | Stable id (see above). |
| `studentName` | yes | Student name on the lesson. |
| `date` | strongly recommended | `YYYY-MM-DD` (lesson date in **Japan / Asia–Tokyo** intent). |
| `start` | recommended | Start time; ISO string or `YYYY-MM-DD HH:mm` JST-style (server parses both patterns). |
| `end` | recommended | End time; same formats. |
| `title` | optional | Event title. |
| `status` | optional | `scheduled`, `cancelled`, `reserved`, `rescheduled`, `demo` (see GAS MonthlyCache color/title rules); drives DB `status`. Invalid values → `scheduled`. |
| `awaitingRescheduleDate` | optional | Boolean (or `awaiting_reschedule_date` snake_case). When the calendar event description contains the Student Admin block `---student-admin---` with `awaiting_reschedule_date=1` or `=0`, GAS should emit `true` / `false`. Omit the field when unknown (Node preserves existing DB `awaiting_reschedule_date` on upsert). |
| `teacherName` | optional | |
| `isKidsLesson` | optional | boolean or flag per your convention. |
| `lessonKind` | optional | `regular` / `demo` / `owner` (invalid → `regular`). |
| `lessonMode` | optional | `cafe` / `online` / `unknown` (server can infer from title/location). |
| `location` | optional | Helps infer `lessonMode`. |

Times are interpreted as **Japan-facing** where ambiguous; the Node app stores **UTC** in PostgreSQL.

**Calendar description (Student Admin):** Booking sync may append a block so Graphite cancel vs “awaiting new date” is distinguishable after poll sync:

```text
---student-admin---
awaiting_reschedule_date=1
```

(`=0` clears the flag.) The MonthlySchedule sheet column `AwaitingRescheduleDate` and poll JSON `awaitingRescheduleDate` should reflect this.

---

## Poll response (no `full`, or incremental)

Return JSON:

```json
{
  "changed": true,
  "diff": {
    "added": [ /* lesson objects */ ],
    "updated": [ /* lesson objects — same identity keys as before */ ],
    "removed": [ "eventID|studentName", "otherId|Other Student" ],
    "lastUpdated": "2026-03-21T12:34:56.789Z",
    "cacheVersion": 43
  }
}
```

- **`changed`:** `false` → client may ignore `diff` (you may omit `diff` or send empty arrays).
- **`changed`:** `true` → **`diff` must be present** and consistent:
  - **`added`:** New rows (full objects).
  - **`updated`:** Changed rows (full objects; same `eventID` + `studentName` identity as before).
  - **`removed`:** Array of **strings**, each exactly **`eventID|studentName`** for rows that left the calendar/cache.
- Include **`diff.cacheVersion`** and **`diff.lastUpdated`** aligned with your AppState / version bump when you detected a change.

Client applies the diff in order conceptually: `added` → `removed` → `updated` (implementation uses a map; **removed keys must match** `eventID|studentName`).

---

## Caching and change detection (recommended pattern)

Typical GAS design:

1. Maintain a **sheet or Properties** cache of serialized MonthlySchedule rows (or a hash / `cacheVersion`).
2. On schedule (time-driven trigger) or via Calendar API push (advanced), refresh from Google Calendar, compare to previous fingerprint, **bump `cacheVersion`** when different.
3. **Full** request: rebuild or read cache, return full `data`.
4. **Poll** request: if version unchanged, return `{ "changed": false }`. If changed, compute **`added` / `updated` / `removed`** against the **previous** snapshot you had when the version was last read, or return full `data` equivalent via diff (removed = keys only in old set, etc.).

---

## Security

- Never log the raw `key` in production logs.
- Treat the Web App URL + key like a **shared secret**; restrict deployment visibility if possible.
- The React app sends **`key`** in the query string; HTTPS only in production.

---

## Quick checklist before go-live

- [ ] `GET ?key=…&full=1` returns `data`, `cacheVersion`, `lastUpdated`.
- [ ] Poll returns `{ changed: false }` when nothing changed.
- [ ] Deleting a calendar event yields `changed: true` and the correct **`removed: ["eventID|studentName"]`** entries.
- [ ] `eventID` is stable and **does not contain `|`**.
- [ ] `studentName` matches admin DB names where possible.
- [ ] Backfill: `month` / `year` params return the same JSON shape as full mode for that range (used by Node `backfill`).

---

## Copy-paste prompt (for an LLM coding the script)

```text
Implement a Google Apps Script Web App (doGet) that:

1. Requires query param "key" matching a secret; return JSON { error: "..." } if invalid.

2. If query has full=1 (or month=YYYY-MM or year=YYYY for range): return JSON {
     cacheVersion: number,
     lastUpdated: ISO string,
     data: [ { eventID, studentName, date (YYYY-MM-DD), start, end, title?, status?, teacherName?, isKidsLesson?, lessonKind?, lessonMode?, location? } ]
   } for all lessons in scope (from Google Calendar / sheet pipeline).

3. Otherwise (poll): maintain a monotonic cacheVersion when the lesson set changes. Return either { changed: false } or {
     changed: true,
     diff: {
       added: [ lesson objects ],
       updated: [ lesson objects ],
       removed: [ "<eventID>|<studentName>", ... ],
       lastUpdated: ISO string,
       cacheVersion: number
     }
   }.

Rules: eventID must be stable and must not contain "|". removed entries must exactly match the client row key eventID + "|" + studentName. Times are Japan-facing; fields may use camelCase.

Reject invalid input clearly. Use ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON).
```

---

## Related repo code

- Client polling: `client/src/api/pollingApi.js`, `client/src/hooks/useCalendarPolling.js`, `client/src/context/CalendarPollingContext.jsx`
- Server sync / deletes: `server/lib/calendarSync.js`, `POST /api/calendar-poll/sync`, `POST /api/calendar-poll/backfill`

The **`Calendar API/`** folder in this workspace (if present) is a **separate** GAS project for reference only and is not committed per `.gitignore`; copy any changes into your live Apps Script project manually.
