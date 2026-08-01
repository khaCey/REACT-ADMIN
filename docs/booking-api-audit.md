# Booking API audit (staff today → student/LINE later)

**Status:** Living doc for solidifying the booking domain without interrupting the admin React app.  
**Non-goals here:** LINE Login, LIFF, `line_accounts`, public `/api/student/*` routes.

Related: [schedule-booking.md](./schedule-booking.md), [weekly-confirm-schedule-reference.md](./weekly-confirm-schedule-reference.md).

---

## 1. Auth model

| Layer | Behavior |
|-------|----------|
| Global | `app.use('/api', requireAuth)` in [`server/index.js`](../server/index.js) (except `/api/health`, `/api/auth/*` public login) |
| Staff | JWT Bearer → [`server/middleware/auth.js`](../server/middleware/auth.js) reloads `staff` (`active`, `is_admin`, `is_operator`) |
| Schedule | **All** `/api/schedule/*` require staff JWT. **No** public booking route today. |
| Admin extras | `requireAdmin` for purge / monthly-schedule admin tools |

**Staff-only assumptions baked into handlers:** change-log actor from `req.staff`, no “linked student ownership” check (any staff can book any student id).

---

## 2. Endpoint inventory (booking-related)

### `/api/schedule` — [`server/routes/schedule.js`](../server/routes/schedule.js)

| Method | Path | Role |
|--------|------|------|
| GET | `/` | Ping |
| GET | `/week` | Week grid availability |
| GET | `/booking-warning` | Stub (`warn: false`) |
| GET | `/teachers` | Teacher list helper |
| POST | `/book` | Create lesson(s) + local row; client may `POST /sync` |
| POST | `/confirm-reserved` | Reserved → scheduled (Confirm one/all) |
| POST | `/renumber-month-titles` | Pack upsert + DB/Calendar title `i/N` |
| POST | `/sync` | Push local booking to Google Calendar |
| POST | `/:eventId/reschedule-awaiting-date` | Graphite / awaiting date |
| PATCH | `/:eventId/cancel` | Cancel |
| PATCH | `/:eventId/uncancel` | Restore |
| PATCH | `/:eventId/reschedule` | **Legacy / unused by client** |
| POST | `/reschedule-linked` | Live reschedule path |
| POST | `/unreschedule-linked` | Undo linked reschedule |
| DELETE | `/:eventId` | Remove (reserved = one occurrence) |

### Related

| Path | Role |
|------|------|
| `GET /api/students/:id/latest-by-month` | Month lesson cards for Lessons This Month |
| `POST /api/lessons` | Pack size upsert |
| Shift extend / teachers | Capacity for book grid |
| Admin monthly-schedule / purge-reserved | Ops only |

### Primary clients

- [`BookLessonModal.jsx`](../client/src/components/BookLessonModal.jsx) — week + book + sync + renumber
- [`LessonsThisMonth.jsx`](../client/src/components/LessonsThisMonth.jsx) — cancel / confirm / remove / renumber

---

## 3. Availability flow (`GET /week`)

**Input:** `week_start=YYYY-MM-DD` (Monday), optional `student_id`, optional `duration_minutes` (default 50).

**Frozen response keys (do not rename):**

`slots`, `teachersBySlot`, `slotTypes`, `slotMix`, `breakRuleBlocked`, `staffBreakBySlot`, `studentBookedSlots` (when student_id set), `ownerShamBlocked`, `ownerCourseConflictBlocked`, plus any other keys currently returned by the handler.

**Computation (today inline in route):**

1. Load week `monthly_schedule` (exclude cancelled/rescheduled; omit booking-disabled student ids from capacity counts).
2. Load English-teacher shifts + extensions; break presets.
3. Bucket by JST hour → booked distinct `event_id`, kids/adult mix, staff breaks.
4. Apply break-rule preview via [`teacherBreakRules.js`](../server/lib/teacherBreakRules.js).
5. Optional student booked slots / owner-course conflict previews.

Hour buckets: `Asia/Tokyo`. Aligns with BookLessonModal `10:00`–`20:00`.

---

## 4. Create flow (`POST /book`)

**Body:** `student_id` or `group_id`, `date`, `time`, optional `duration_minutes`, `pack_total`, `location`.

**Backend rules:** 90-day advance limit; kids/adults separation; owner-course overlap; same-student overlap; capacity vs teachers on shift (+ extensions); consecutive-hour break rule; demo/owner/regular group mixing; booking-disabled students rejected; pack total required for non-demo titles.

**Write:** Insert `monthly_schedule` with `local-booking-*` event id, `calendar_sync_status=pending`, then client often calls `POST /sync` → GAS `lesson_book_create`.

**Shared confirm validation:** `assertBookableSlotForConfirm` used by confirm-reserved (excludes batch event ids).

---

## 5. Cancel / reschedule / remove / confirm / renumber

| Action | Notes |
|--------|--------|
| Cancel / uncancel | GAS title/color update when synced; ambiguous recurring master skipped |
| Reschedule | Prefer `POST /reschedule-linked`; PATCH reschedule is dead |
| Remove | Reserved = single occurrence cancel in Calendar; never series wipe on normal remove |
| Confirm-reserved | Create green + delete placeholder; `finalize_series` gates series delete + next-month hold; renumber after persist |
| Renumber | DB titles by `start` + best-effort Calendar title patch |

---

## 6. Rules: backend vs frontend-only

| Rule | Backend | Frontend (BookLessonModal) |
|------|---------|----------------------------|
| Past slot | Soft (90-day max; past not strictly blocked on book) | Disables past cells |
| Capacity / teachers | Yes | Yes (from week grid) |
| Kids / adults | Yes (range overlap) | Yes (hour-bucket `slotMix`) |
| Break rule | Yes on book | Yes via `breakRuleBlocked` |
| Student already booked | Yes | Yes via `studentBookedSlots` |
| Pack total | Yes (non-demo) | Yes (prompts 月の回数) |
| Demo kind | Derived from student status | Cannot spoof |

**Gap:** past-slot hard block is UI-only; student/LINE API should enforce “not in the past” on the server.

---

## 7. Frozen contracts (admin unbroken)

Do **not** change without a coordinated client release:

1. All `/api/schedule/*` paths above.
2. `GET /week` field names and slot key format `YYYY-MM-DDTHH:MM`.
3. Book success shape including `event_id` / sync handoff expectations.
4. `latest-by-month` camelCase lesson card fields (`eventID`, `calendarSyncStatus`, `status`, …).
5. Status strings: `scheduled`, `reserved`, `cancelled`, `rescheduled` (+ awaiting-reschedule markers).
6. Confirm body: `event_id`, `confirm_month`, `finalize_series`, `pack_total`.
7. Regex eventId routes (IDs may contain `@` / dots) — keep encoding behavior.

Refactor pattern: **extract service → thin route wrapper → same JSON**.

---

## 8. Gaps for student / LINE (later)

- No LINE token auth; no `line_accounts` / link tokens / opaque access IDs.
- Staff can act on any `student_id`; student API must verify link ownership every call.
- Internal numeric student ids exposed to staff UI (OK for staff; not for LIFF).
- `booking-warning` is a stub.
- Parallel book races: strengthen with transactions when extracting `bookLessonService`.
- Idempotency keys: design later; not required for staff.

**Proposed later mount:** `/api/student/*` with separate middleware; call same services with `actor: { type: 'line', lineUserId, accessId }`. Staff routes keep `actor: { type: 'staff', staffId }`.

---

## 9. Recommended service split

| Module | Owns |
|--------|------|
| `server/lib/booking/availabilityService.js` | `GET /week` computation |
| `server/lib/booking/bookLessonService.js` | `POST /book` |
| `server/lib/booking/slotValidation.js` | `assertBookableSlotForConfirm` + shared overlap/capacity checks |
| `server/lib/booking/cancelRescheduleService.js` | cancel / uncancel / reschedule-awaiting / linked reschedule |
| `server/lib/booking/removeLessonService.js` | DELETE |
| `server/lib/booking/confirmReservedService.js` | confirm-reserved |
| `server/lib/booking/titleRenumberService.js` | renumber (+ Calendar patch) |
| `server/lib/booking/constants.js` | SQL fragments, sync status constants used by booking |
| `server/lib/booking/contracts.js` | Frozen key lists for characterization tests |

Keep GAS in [`bookingCalendarSync.js`](../server/lib/bookingCalendarSync.js).

---

## 10. Implementation order

1. This audit (done).
2. Extract book + slot validation + tests. **Done** — `bookLessonService.js`, `slotValidation.js`, `npm run test:booking`.
3. Extract week availability + tests. **Done** — `availabilityService.js`.
4. Extract cancel / reschedule / remove. **Done** — `cancelRescheduleService.js`, `removeLessonService.js`.
5. Extract confirm-reserved + renumber. **Done** — `confirmReservedService.js`, `titleRenumberService.js`.
6. **Stop** before public student routes until services + tests exist.

Staff routes live in thin [`server/routes/schedule.js`](../server/routes/schedule.js); shared helpers in `domainInternals.js`.

---

## 11. Verification (admin unbroken)

After each extract: staff login → Book lesson week grid → book → sync; Lessons This Month cancel / remove reserved one / Confirm one|all / 月回数変更; Staff extend shift. Spot-check `GET /week` and `latest-by-month` JSON keys unchanged.
