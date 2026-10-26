# Independent 固定 appointments (dev)

## Behaviour

- Edit Student → **固定: months reserved ahead** sets 0–12 months per student (default 1). A shared group uses its smallest member setting.
- **Create 固定** creates separate temporary appointments in the selected month, one per matching weekday. It does not create a recurring series or extend future months yet.
- **Confirm schedule / Confirm all** confirms the selected appointments. Existing independent appointments keep their Calendar IDs and lesson UUIDs. Legacy recurring placeholders are converted to new independent appointments; the old Google events are left untouched.
- Only when all appointments for that pattern/month have been confirmed and synchronised does the system create temporary appointments in months +1 through +N. November is updated in place when confirmed; confirming November then fills any missing months through November +N.
- There is no rolling background extension, payment deadline or grace-period task. Payment alone does not generate events: staff use monthly confirmation after checking payment. Without another confirmation, the reservation window stops extending.
- Changing the horizon does not delete existing appointments. **Retry future 固定** uses the last confirmed month, never today's month, so retries cannot extend an unpaid student's window.
- A one-off date change updates the same independent event and preserves its lesson UUID. It does not change the weekly pattern used for later months. A shared appointment moves all its members together.
- Conflicting future slots are reported, not overwritten. The retry action can fill them after the conflict is resolved. Failed Calendar creates/updates remain visible with a Sync with Calendar action.
- Explicitly removed appointments have retained occurrence-ledger entries and are not automatically recreated. Change History undo/redo is blocked for managed appointment snapshots; use the lesson actions to preserve Calendar and ledger consistency.

## Preventing the June–October incident

Monthly confirmation and reserved-date changes no longer call Calendar deletion or series-deletion operations. New events have deterministic independent Calendar IDs. Confirming or retrying an appointment cannot create a recurring series or modify a foreign/recurring event.

The one-time conversion changes only the selected month's Admin rows. Old Calendar events remain for manual review. **Do not delete an entire old series until historical occurrences have been checked and preserved/recovered.** Remove only the future duplicate placeholders if deleting the series would remove history. This change does not restore already missing June–October Calendar events.

Admin owns generated appointment state. Polling cannot overwrite their moved dates, confirmation state or pending errors, remove their history, or re-import converted legacy placeholders while staff finish manual Calendar cleanup.

## Development integration (not deployed)

1. Start the dev backend with a test PostgreSQL database. The normal migration runner applies `server/db/add_individual_fixed_schedules.sql` after the existing schema. It is additive and idempotent.
2. In a **test copy** of the Calendar GAS project, add `gas/FixedSchedule.js`. This handler uses the existing `getBookingApiKey_()` and `getCalendarIdForKind_()` booking helpers and the Advanced Calendar service.
3. In `doPost`, immediately after parsing the JSON body and before the other action branches, add:

   ```js
   if (body && body.action === 'fixed_schedule_upsert') {
     return fixedScheduleUpsert_(e, body);
   }
   ```

4. Deploy a new **test** GAS Web App version. Set dev `FIXED_SCHEDULE_GAS_URL` to that deployment and `BOOKING_API_KEY` to its existing booking key. Existing `BOOKING_GAS_URL` / `CALENDAR_POLL_URL` are fallbacks; do not point dev at production Calendars for acceptance tests. No secrets are committed here.
5. Use test Calendars configured by the GAS booking helpers. The new action uses the Advanced Calendar API's deterministic event IDs and ownership properties. If the deployment does not support the action, Admin reports a sync failure; it never falls back to destructive legacy confirmation.

No GAS deployment, production database migration or live Calendar write was performed during implementation. Changes belong on `dev`, not `main`.

## Verification

```sh
npm ci
cd client && npm ci && cd ..
npm run test:fixed
node --experimental-test-module-mocks --test server/lib/booking/__tests__/*.test.js server/lib/__tests__/*.test.js server/routes/__tests__/*.test.js
npm run build
```

New database tests execute the schema and actual service SQL in isolated PGlite PostgreSQL instances. Calendar calls are simulated. GAS tests execute the handler with a fake Calendar API and reject recurring/foreign events. Polling tests run the real importer against the isolated database. These tests do not replace live PostgreSQL multi-session concurrency or a test-GAS/browser acceptance run.

For acceptance, retain a test series spanning June–December, convert October, verify June–September are unchanged, and verify all generated events have no recurrence. Confirm November and verify its IDs remain unchanged. Repeat confirmation/retry, move one date across a month boundary, and interrupt Calendar access during future generation. Check for duplicate appointments and confirm no extra months appear without another monthly confirmation.
