# Calendar poll API (GAS Web App)

The React app and Node server expect a **Google Apps Script Web App** to expose the MonthlySchedule poll/snapshot API.

**Full specification and LLM-ready prompt:** [`docs/gas-calendar-poll-prompt.md`](docs/gas-calendar-poll-prompt.md)

**Deploy / update / rotate keys in Google:** [`docs/how-to-update-gas.md`](docs/how-to-update-gas.md)

**Summary**

- **GET** with `key=<secret>` (required).
- **Full load:** `full=1` → JSON `{ cacheVersion, lastUpdated, data: Lesson[] }`.
- **Poll:** no `full` → JSON `{ changed: boolean, diff?: { added, updated, removed, lastUpdated, cacheVersion } }`.
- **Row key:** `eventID|studentName` (no `|` inside `eventID`). **`diff.removed`** must use these exact strings so deletions sync to PostgreSQL.
- **Incremental polls:** GAS should persist the previous poll’s row keys (e.g. Script Properties `POLL_PREVIOUS_ROW_KEYS`) and emit keys that disappeared from the current sheet snapshot in `diff.removed`. After `full=1`, reset that cache from the returned `data` so the next poll does not emit spurious removals.

See the doc above for field lists, backfill query params, and a copy-paste prompt for implementing the script.
