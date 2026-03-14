---
name: Dashboard same-hour layout and time
overview: Fix Taiju/Hisayo same-hour grouping and multi-lesson layout; add project rule to use UTC for all time-related logic.
todos:
  - id: utc-rule
    content: Add project rule / documentation that all time-related system logic must use UTC (store and compute in UTC; convert to local/Asia-Tokyo only for display)
    status: pending
  - id: backend-timezone
    content: In calendarSync (and any other ingest), interpret source times as Asia/Tokyo and store as UTC in DB so today-lessons API returns correct hour for all students
    status: pending
  - id: layout-split
    content: In Dashboard today-lessons, when an hour has 2+ lessons and no group lesson, set col-span so cards sit side-by-side (e.g. 2 lessons = col-span-2 each)
    status: pending
isProject: false
---

# Dashboard: same-hour grouping, multi-lesson layout, and UTC rule

## Rule: Use UTC for any time-related system

**Add to project conventions / Cursor rules:**

- **Store and compute in UTC.** All server-side timestamps (e.g. `monthly_schedule.start`, logs, cron) should be stored and compared in UTC (e.g. PostgreSQL `TIMESTAMPTZ`).
- **Convert only for display.** Convert to a local timezone (e.g. Asia/Tokyo) only when presenting to the user (API response, UI).
- **Ingest with explicit timezone.** When reading from external sources (CSV, Sheets, Google Calendar), interpret datetime strings in the source’s intended timezone (e.g. Asia/Tokyo for Japan-facing data), then normalize to UTC before writing to the DB.

This avoids ambiguous “server local” interpretation and keeps behavior consistent across environments.

---

## 1. Why Taiju appears in 14:00 instead of 13:00

The frontend groups by **hour only**: `getHourLabel` returns `"13:00"` for any `start_time` like `"13:00"` or `"13:50"`. So if Taiju is rendered in the **14:00** row, the API must be returning `start_time` as **14:xx** for him.

**Causes:** Wrong data in DB, or CSV/source times interpreted in server local time instead of Asia/Tokyo, then stored as timestamptz without correct UTC conversion.

**Fix (align with UTC rule):** In `server/lib/calendarSync.js`, when building `startTs` from date+time that is Japan local (e.g. CSV/Sheets), interpret as Asia/Tokyo and convert to UTC before insert (e.g. `2026-03-14 13:00` JST → store as that moment in UTC). The today-lessons query already uses `AT TIME ZONE 'Asia/Tokyo'` for display; with correct UTC storage, both Taiju and Hisayo will show 13:00 when their lesson is at 13:00 JST.

---

## 2. Lesson cards “cut in half” when more than one in the same hour

**Current:** Column span is reduced only when a lesson in that hour has `group_type === 'group'`. When there is no group lesson, every card gets `col-span-4`, so 2 lessons stack vertically.

**Fix:** In `client/src/pages/Dashboard.jsx`, when `lessons.length > 1` and there is no group lesson in that hour, set column spans so cards share the row (e.g. 2 lessons → `col-span-2` each; 3–4 lessons → appropriate split so they sit side-by-side).

---

## Summary

| Item | Action |
|------|--------|
| **UTC rule** | Document: store/compute in UTC; convert to local only for display; ingest with explicit timezone (e.g. Asia/Tokyo → UTC). |
| **Taiju in 14:00** | Ensure calendarSync (and any ingest) writes `start` as UTC derived from source time in Asia/Tokyo. |
| **Cards not split** | When an hour has 2+ lessons and no group lesson, use smaller col-spans (e.g. 2 → col-span-2 each). |
