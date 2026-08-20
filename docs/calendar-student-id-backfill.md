# Calendar Student ID Backfill

## Purpose

Safely prepare existing Google Calendar lesson events for reliable student-number matching.

The target metadata format is:

```text
[GS_STUDENT_IDS:123]
```

For a group lesson:

```text
[GS_STUDENT_IDS:123,456,789]
```

Student IDs must be treated as strings when parsing metadata.

## Current phase: read-only preview only

The current implementation on `dev` does **not** modify Google Calendar.

It adds an Admin page:

```text
/admin/calendar-student-id-backfill
```

and a read-only API endpoint:

```text
GET /api/calendar/student-id-backfill/preview?month=YYYY-MM
```

The endpoint authenticates to Google Calendar using the `calendar.readonly` OAuth scope.

There are no Calendar create, patch, update, or delete calls in this feature.

## Matching strategy

Do not parse Calendar titles to determine the student.

The preview uses `monthly_schedule` as the existing relationship between:

- Calendar event / occurrence ID
- `student_id`
- student name
- lesson date/time

Group lessons are aggregated so one Calendar event can map to multiple student IDs.

Existing event-ID helpers are reused so recurring occurrences can be matched to the correct Google Calendar instance rather than blindly using a recurring-series master.

## Existing metadata formats

The preview understands all of these during the transition:

```text
[GS_STUDENT_IDS:123,456]
StudentIds: 123,456
StudentId: 123
```

The new canonical format for future migration work is:

```text
[GS_STUDENT_IDS:123,456]
```

## Preview classifications

### `safe_to_tag`

- Exact Calendar event/occurrence found.
- `monthly_schedule` contains student ID(s).
- No existing student-ID metadata is present in the Calendar description.

These are the only rows that should automatically qualify for a later write phase.

### `already_tagged`

Calendar metadata already contains the same student ID set as `monthly_schedule`.

### `tag_mismatch`

Calendar metadata contains student IDs, but they differ from `monthly_schedule`.

Must be reviewed. Never auto-overwrite.

### `calendar_missing`

No exact Calendar event/occurrence could be matched.

Skip.

### `ambiguous_calendar_match`

More than one Calendar candidate matched.

Skip.

### `not_synced`

At least one related `monthly_schedule` row is not `calendar_sync_status=synced`.

Skip.

### `local_only`

The schedule row has a local/optimistic event ID rather than a confirmed Google Calendar ID.

Skip.

### `missing_student_id`

No usable `student_id` exists in the matched DB rows.

Skip.

## Future write phase — not implemented yet

The future migration writer must remain narrowly scoped.

It must:

1. Re-read the exact Calendar event immediately before mutation.
2. Verify the event/occurrence identity still matches the preview candidate.
3. Preserve the complete existing description.
4. Merge only the canonical `[GS_STUDENT_IDS:...]` line.
5. Patch **description only**.
6. Read the event again and verify the tag.
7. Audit old description, new description, student IDs, event ID, occurrence start, actor, timestamp, and result.

It must never:

- delete Calendar events
- recreate Calendar events
- modify title
- modify start/end
- modify color
- modify location
- modify attendees
- modify recurrence
- silently overwrite mismatched student-ID tags

Apply operations should be batched conservatively and ambiguous/mismatched rows must always remain skipped.
