# Schedule booking — open slots and rules

## What the week grid shows

`GET /api/schedule/week?week_start=YYYY-MM-DD` (Monday) returns:

- Optional query **`student_id`**: when set to a numeric student id, the response includes **`studentBookedSlots`**: map of the same slot keys → `true` for hours where **that student** already has a non-cancelled lesson (matches `student_id`, or legacy rows with null `student_id` and the same trimmed name, case-insensitive). Used by **`BookLessonModal`** to disable “double booking” the same hour.
- Optional query **`duration_minutes`** (30–120, default **50**, same clamp as **`POST /book`**): length of the hypothetical new lesson used for **owner’s-course overlap** preview (`ownerCourseConflictBlocked`). **`BookLessonModal`** sends **50** to match its booking payload.
- **`slots`**: map of `YYYY-MM-DDTHH:MM` → **number of booked “lessons”** in that **JST hour** slot.
  - Each **distinct `event_id`** counts as **one** booking (group lessons with several students on the same calendar event count once).
  - Rows without a usable `event_id` fall back to one count per `(student_name, date, hour)` key.
  - Rows whose **`student_id`** is in the server **booking-disabled** set (see `server/lib/bookingExclusions.js`, e.g. students excluded from in-app booking) are **omitted** from `slots`, `slotTypes`, and `slotMix` so they do not reduce capacity for others. Rows with **`student_id` null** are still included (legacy data).
  - Rows with **`lesson_kind = 'staff_break'`** are **omitted** from `slots`, `slotTypes`, and `slotMix` (they do not consume teacher capacity).
- **`teachersBySlot`**: same keys → list of teacher names on shift for that date/hour (from `teacher_schedules`, including `teacher_shift_extensions`). Extensions are set on **Staff → Extend shift (app only)**; they do not change Google Calendar.
- **`slotTypes`**: `kids` if only kids lessons in that hour, `adult` if only non-kids, `mixed` if both (for UI hint).
- **`slotMix`**: same keys → `{ hasKids, hasAdult }` so the client can disable bookings that **`POST /book`** would reject (kid vs adult separation, hour-bucket approximation).
- **`breakRuleBlocked`**: map of slot keys → `true` when the slot has **spare capacity** (`booked < number of teachers on shift`) but **no** on-shift teacher could accept **one more regular lesson** at that hour without creating a run of **more than 5 consecutive JST clock hours** with a counting lesson. Logic lives in `server/lib/teacherBreakRules.js` and matches **`POST /book`** assignment. **`BookLessonModal`** disables these cells and shows “Break needed”.
- **`staffBreakBySlot`**: map of slot keys → array of `{ teacher_name, title }` for non-cancelled rows with **`lesson_kind = 'staff_break'`** (for muted “break” cards in the grid). These rows are informational and do not block capacity.

Hour buckets use **Asia/Tokyo** (`start AT TIME ZONE 'Asia/Tokyo'`), aligned with `BookLessonModal` (`10:00`–`20:00`).

## Teacher consecutive-hour (break) rule

- Per **calendar day (JST)** and per **teacher**, consider the set of **clock hours** (`HH:00`) where that teacher has at least one **counting** lesson: `lesson_kind` is **`regular`** or null/empty (legacy). **`staff_break`** does **not** count (treated as a gap). Other kinds (e.g. **`demo`**) occupy overlap capacity but **do not** extend the teaching streak.
- **Streak**: maximal contiguous run of such hours (e.g. 10:00–11:00–12:00 = length 3). A **gap hour** with no counting lesson resets the run.
- **Legacy `teacher_name` null**: if **exactly one** distinct teacher has a **shift** that day, NULL-teacher rows are attributed to that teacher for streak math. If **multiple** teachers have shifts that day, NULL rows are **not** attributed (streak state may be incomplete until rows are backfilled; new bookings still get an assigned `teacher_name` when possible).
- **`POST /book`** picks an on-shift teacher who passes the streak check (fewest counting hours that day, then lexicographic name). If **none** qualify → **400**. If there is **no** shift data for the slot (`teacherSet` empty), the server skips this check and inserts **`teacher_name` null** (legacy behavior).

## When a slot is **open** (student can book)

In **`BookLessonModal`** a cell is clickable (“Book”) when **all** of:

1. **Not past** — slot start in JST is after “now” (`isSlotPastJst`).
2. **Teacher capacity** — `teachersBySlot[key]` is non-empty (at least one teacher on shift for that date/hour window).
3. **Room under capacity** — `booked < capacity`, where `capacity = teachers.length` and `booked` comes from `slots[key]` (distinct events per hour).
4. **Kids / adults** — using `slotMix[key]` and the student’s child flag (`子` / `is_child` from the student record): a **child** cannot book an hour that already has a **non-kids** lesson (`hasAdult`); a **non-child** cannot book an hour that already has a **kids** lesson (`hasKids`). Empty hours allow either (server still validates overlap on submit).
5. **Break rule** — `breakRuleBlocked[key]` is not true.
6. **Already this student’s slot** — `studentBookedSlots[key]` is true → cell shows “Yours” and is disabled (server also rejects overlapping bookings for the same student).

Disabled states:

- **Past** → “Past”
- **No teachers** → “—”
- **`booked >= capacity`** → full (amber); label shows booked count
- **Wrong audience for this student** → slate styling; “Adult slot” or “Kids slot”
- **`breakRuleBlocked`** → amber styling; “Break needed”
- **Student already booked this hour** → violet styling; “Yours”

Staff break cards (from `staffBreakBySlot`) appear above the slot button when present; they are non-interactive.

## `POST /api/schedule/book` (server checks)

Additional rules enforced on submit:

| Rule | Detail |
|------|--------|
| Body | `student_id`, `date` (YYYY-MM-DD), `time` (HH:MM), optional `duration_minutes` (30–120, default 50) |
| Advance limit | Date at most **90 days** ahead of today (JST calendar comparison) |
| Kids / adults | Cannot overlap an existing non-cancelled lesson in the same **time range** if one side is kids and the other is adult (booking-disabled students’ rows are ignored; **`staff_break`** rows are ignored) |
| Same student / same time | Cannot overlap an existing non-cancelled lesson for the **same student** (`student_id`, or null `student_id` with same name case-insensitive); **`staff_break`** rows ignored |
| Capacity | `COUNT(DISTINCT event_id)` of overlapping non-cancelled lessons must be **&lt;** number of teachers whose extended shift covers that instant; booking-disabled students’ rows excluded; **`staff_break`** rows excluded |
| Consecutive-hour rule | When at least one teacher is on shift for the slot, at least one must be assignable without exceeding **5** consecutive JST counting hours; chosen teacher stored in **`teacher_name`** |
| Student | Must exist and have a non-empty name |

`GET /api/schedule/booking-warning` is currently a stub (`warn: false`); it does not block booking.

## Confirm Schedule — reserved → scheduled (weekly)

For **reserved** (`monthly_schedule.status = 'reserved'`) lessons that are already **calendar-synced**, staff can **confirm the schedule** for a full **calendar month** from the lesson details modal (**Confirm schedule**). The UI calls the API **once per week** (oldest first); each card moves **Pending** → **Scheduled** as its request completes. **No** next-month recurring reserved hold is created.

### `POST /api/schedule/confirm-reserved`

Each request confirms **one** reserved week (`event_id` = that occurrence’s row id; group lessons share one `event_id` per slot).

| Field | Detail |
|--------|--------|
| Body | `event_id` (that week’s reserved row), optional `confirm_month` (`YYYY-MM`; default from the row’s date), optional `pack_total` (override for `n/total` titles) |
| Title `n/total` | Optional `pack_total`, else payments / `lessons` pack for the month if set; otherwise **`total = max(that pack, other lessons in month + reserved weeks in the batch)`** |
| Preconditions | Row is `reserved`, `student_id` set, `calendar_sync_status = synced`, not a `local-booking-` row; GAS booking URL + API key configured |
| Batch scope | All **reserved** rows in `confirm_month` sharing the same recurring series (`calendar_source_event_id` or stripped `event_id` base) as the anchor — used for overlap exclusion and lesson numbering |

**Per-request order:**

1. **Create** one normal Calendar lesson for that week via GAS `lesson_book_create` (same overlap / capacity / break checks as `POST /book`; all batch `event_id`s still excluded from overlap counts).
2. **Delete** that week’s yellow placeholder via `lesson_book_delete` (instance lookup + reserved-hold slot sweep; **`excludeEventIds`** includes the new lesson; **`strictDelete`** so “not found” does not count as success). Deploy GAS revision `2026-05-21-confirm-week-placeholder` or newer.
3. **Update DB** for that week: `reserved` → `scheduled`, new `event_id` / `calendar_source_event_id`, title; rewrite `reschedules` FKs for that old `event_id`.
4. When **no** reserved rows remain in the month for that series, **once**: `lesson_book_delete_series` on the empty recurring shell.

**Response (example):** `ok`, `event_id`, `new_event_id`, `week_index`, `weeks_total`, `series_cleaned_up`.

**UI:** Client loops sorted weeks; only the current week shows **Pending**; earlier weeks are already **Scheduled**; later weeks stay **Reserved** until their turn.

**Failure modes:**

- **`lesson_book_create`** or placeholder **delete** fails → rollback **that week’s** new GAS event only; **502**; DB unchanged for that week. Earlier weeks already confirmed stay scheduled.
- **DB** fails after Calendar steps → rollback that week’s GAS create; **500**.
- **Series cleanup** fails after DB commit for the last week → **502** (week is scheduled; series may need manual cleanup).

**Related code:** `server/routes/schedule.js` (`assertBookableSlotForConfirm`, `POST /confirm-reserved`, `deleteReservedPlaceholderForWeek`, `persistConfirmReservedWeek`), `server/lib/bookingCalendarSync.js` (`deleteReservedCalendarSeriesInGas`), GAS `calendarAPI/Code.js` (`lesson_book_create`, `lesson_book_delete`, `lesson_book_delete_series`), UI `client/src/components/LessonDetailsModal.jsx` / `LessonsThisMonth.jsx`, `client/src/api.js` (`confirmReservedSchedule`).

## Related code

- Week data: `server/routes/schedule.js` → `GET /week`
- Book: `server/routes/schedule.js` → `POST /book`
- Break rule math: `server/lib/teacherBreakRules.js`
- UI: `client/src/components/BookLessonModal.jsx`
