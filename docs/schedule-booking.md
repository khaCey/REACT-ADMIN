# Schedule booking — open slots and rules

## What the week grid shows

`GET /api/schedule/week?week_start=YYYY-MM-DD` (Monday) returns:

- **`slots`**: map of `YYYY-MM-DDTHH:MM` → **number of booked “lessons”** in that **JST hour** slot.
  - Each **distinct `event_id`** counts as **one** booking (group lessons with several students on the same calendar event count once).
  - Rows without a usable `event_id` fall back to one count per `(student_name, date, hour)` key.
- **`teachersBySlot`**: same keys → list of teacher names on shift for that date/hour (from `teacher_schedules`, including `teacher_shift_extensions`).
- **`slotTypes`**: `kids` if only kids lessons in that hour, `adult` if only non-kids, `mixed` if both (for UI hint).
- **`slotMix`**: same keys → `{ hasKids, hasAdult }` so the client can disable bookings that **`POST /book`** would reject (kid vs adult separation, hour-bucket approximation).

Hour buckets use **Asia/Tokyo** (`start AT TIME ZONE 'Asia/Tokyo'`), aligned with `BookLessonModal` (`10:00`–`20:00`).

## When a slot is **open** (student can book)

In **`BookLessonModal`** a cell is clickable (“Book”) when **all** of:

1. **Not past** — slot start in JST is after “now” (`isSlotPastJst`).
2. **Teacher capacity** — `teachersBySlot[key]` is non-empty (at least one teacher on shift for that date/hour window).
3. **Room under capacity** — `booked < capacity`, where `capacity = teachers.length` and `booked` comes from `slots[key]` (distinct events per hour).
4. **Kids / adults** — using `slotMix[key]` and the student’s child flag (`子` / `is_child` from the student record): a **child** cannot book an hour that already has a **non-kids** lesson (`hasAdult`); a **non-child** cannot book an hour that already has a **kids** lesson (`hasKids`). Empty hours allow either (server still validates overlap on submit).

Disabled states:

- **Past** → “Past”
- **No teachers** → “—”
- **`booked >= capacity`** → full (amber); label shows booked count
- **Wrong audience for this student** → slate styling; “Adult slot” or “Kids slot”

## `POST /api/schedule/book` (server checks)

Additional rules enforced on submit:

| Rule | Detail |
|------|--------|
| Body | `student_id`, `date` (YYYY-MM-DD), `time` (HH:MM), optional `duration_minutes` (30–120, default 50) |
| Advance limit | Date at most **90 days** ahead of today (JST calendar comparison) |
| Kids / adults | Cannot overlap an existing non-cancelled lesson in the same **time range** if one side is kids and the other is adult |
| Capacity | `COUNT(DISTINCT event_id)` of overlapping non-cancelled lessons must be **&lt;** number of teachers whose extended shift covers that instant (same logic as shift + extensions as the week grid) |
| Student | Must exist and have a non-empty name |

`GET /api/schedule/booking-warning` is currently a stub (`warn: false`); it does not block booking.

## Related code

- Week data: `server/routes/schedule.js` → `GET /week`
- Book: `server/routes/schedule.js` → `POST /book`
- UI: `client/src/components/BookLessonModal.jsx`
