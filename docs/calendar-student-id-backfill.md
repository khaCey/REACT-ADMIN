# Calendar Student ID Backfill

## Purpose

Safely attach reliable student-number metadata to existing Google Calendar lesson events.

Canonical format:

```text
[GS_STUDENT_IDS:123]
```

Group lesson:

```text
[GS_STUDENT_IDS:123,456,789]
```

Student IDs are treated as strings.

## Architecture

REACT-ADMIN does **not** need to know the Green Square Calendar IDs and does not directly mutate Google Calendar for this feature.

```text
REACT-ADMIN monthly_schedule
        ↓
event ID / occurrence + student_id
        ↓
dedicated Student Number Tag GAS
        ↓
GAS searches known regular/demo/owner calendars
        ↓
exact existing event/occurrence
        ↓
description-only tag patch
```

The dedicated GAS lives on the `student-number-tags` branch of `khaCey/calendarAPI` and must be deployed to its **own Apps Script project**. It must not replace the live `calendarAPI` Apps Script project used by the Teacher Calendar App.

## REACT-ADMIN isolation

Only this Admin feature uses the dedicated tag API:

```text
/admin/calendar-student-id-backfill
```

Endpoints:

```text
GET  /api/calendar/student-id-backfill/preview?month=YYYY-MM
POST /api/calendar/student-id-backfill/apply
```

All other REACT-ADMIN booking, polling, Calendar, teacher schedule, LINE and other API behavior remains unchanged.

Server configuration:

```text
STUDENT_NUMBER_TAG_GAS_URL=https://script.google.com/macros/s/.../exec
STUDENT_NUMBER_TAG_API_KEY=...
```

## Matching strategy

Do not parse Calendar titles to determine the student.

`monthly_schedule` supplies the existing relationship between:

- Calendar event / occurrence ID
- `student_id`
- student name
- lesson date/time
- lesson kind

Group lessons are aggregated so one Calendar event can map to multiple student IDs.

REACT-ADMIN sends event identity and occurrence time to the dedicated GAS. GAS owns Calendar routing and searches the configured regular/demo/owner calendars.

## Existing metadata formats

The transition parser understands:

```text
[GS_STUDENT_IDS:123,456]
StudentIds: 123,456
StudentId: 123
```

New writes use only:

```text
[GS_STUDENT_IDS:123,456]
```

## Preview classifications

### `safe_to_tag`

- Exact Calendar event/occurrence found.
- `monthly_schedule` contains student ID(s).
- No student-ID metadata is present in the Calendar description.

Only these rows are eligible for automatic backfill.

### `already_tagged`

Calendar metadata already contains the same student ID set as `monthly_schedule`.

### `tag_mismatch`

Calendar metadata contains student IDs that differ from `monthly_schedule`.

Never auto-overwrite.

### `calendar_missing`

No exact event/occurrence could be resolved.

Skip.

### `ambiguous_calendar_match`

The event identity is not safe enough for an automatic write, including unresolved recurring occurrences.

Skip.

### `api_error`

The dedicated tag API could not complete the lookup.

Skip.

### `not_synced`

At least one related `monthly_schedule` row is not `calendar_sync_status=synced`.

Skip.

### `local_only`

The schedule row has a local/optimistic ID rather than a confirmed Calendar event ID.

Skip.

### `missing_student_id`

No usable `student_id` exists in the matched DB rows.

Skip.

## Apply safety

Clicking **Tag safe events** does not blindly use the old preview.

The server:

1. Re-runs the full preview immediately before writing.
2. Selects only rows that are still `safe_to_tag`.
3. Sends those exact event identities and student IDs to the dedicated GAS.
4. GAS re-resolves the exact event/occurrence.
5. GAS refuses any conflicting existing student ID.
6. GAS patches only the `description` field.

The dedicated GAS has no HTTP actions for:

- deleting events
- creating events
- moving events
- changing title
- changing color
- changing location
- changing attendees
- changing recurrence

The Calendar patch body is intentionally limited to:

```js
{ description: nextDescription }
```

Existing description text is preserved and the canonical tag is appended/replaced.
