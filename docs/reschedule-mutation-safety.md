# Lesson mutation safeguards

Cancellation, date-pending rescheduling, linked rescheduling, undo, uncancel and the legacy move endpoint validate state within a database transaction. They share PostgreSQL transaction advisory lock `(1936941420, 1)` with normal lesson booking. Source rows are locked before their status is checked; rejected operations roll back and release their connections. These locks coordinate this API's requests, not unrelated direct database writers.

- A source with an outgoing replacement link cannot be cancelled, restored directly, or marked date pending. Use Undo reschedule.
- For A → B → C, undo B → C before undoing A → B. Undo retains the restored lesson's incoming movement history and notes.
- The shared slot validator checks student overlap, capacity, kids/adults, owner's-course and teacher-break rules before moving or restoring a lesson. The legacy endpoint accepts only unlinked active lessons and keeps date-only moves consistent with the stored timestamps.
- Cancelled lessons and pending reschedules retain regular lesson credits. Linked source lessons do not; demo lessons remain excluded.

## Calendar failure and retry

Database changes remain valid when Calendar is unavailable. Before committing a Calendar-bound status change, the API records a retry marker in `calendar_sync_error` beginning `[calendar-style] ` and sets `calendar_sync_status` to `failed`. The subsequent attempt updates the existing event's title, colour, time and pending-date description. It never creates a second event. Success clears the error. Failure is returned to the client and displayed in lesson details.

The existing Sync with Calendar action retries this update, including for cancelled or rescheduled source lessons. Calendar polling preserves the pending local title, status and pending-date flag until a successful retry; it cannot erase the failure by rereading the old Calendar state. Ambiguous recurring series masters retain the existing protection against styling a whole series accidentally.

No schema migration is required. Existing error/status columns are reused. Changes do not repair pre-existing orphan reschedule links automatically.

## Verification

Run the regression suite on Node 22.3+ (module mocking needs Node's experimental flag):

```sh
npm run test:reschedule
node --experimental-test-module-mocks --test server/lib/booking/__tests__/*.test.js server/lib/__tests__/*.test.js server/routes/__tests__/*.test.js
npm run build
```

Regression tests invoke the actual handlers with isolated database and Calendar mocks. They cover chain undo, incoming history, linked status guards, slot rejection, competing requests, normal booking versus rescheduling, persisted Calendar failures and retry, legacy moves, and invalid date/time rollover. The concurrency fixture models PostgreSQL advisory lock sequencing; it does not substitute for a live PostgreSQL concurrency check. Without the module-mocking flag, this additional suite is skipped by the ordinary booking test command.

Live PostgreSQL, GAS and browser verification must still be performed before deployment. No production data is changed by these tests.
