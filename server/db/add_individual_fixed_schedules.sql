-- Independent Calendar appointments. No recurring series is created or deleted.
ALTER TABLE students ADD COLUMN IF NOT EXISTS fixed_months_ahead INTEGER NOT NULL DEFAULT 1
  CHECK (fixed_months_ahead BETWEEN 0 AND 12);
CREATE TABLE IF NOT EXISTS fixed_schedules (
  id TEXT PRIMARY KEY,
  student_ids INTEGER[] NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  time TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'Cafe',
  lesson_kind TEXT NOT NULL DEFAULT 'regular',
  teacher_name TEXT,
  confirmed_through TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS fixed_schedule_occurrences (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES fixed_schedules(id),
  nominal_date DATE NOT NULL,
  event_id TEXT NOT NULL,
  calendar_event_id TEXT NOT NULL UNIQUE,
  lesson_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  start TIMESTAMPTZ NOT NULL,
  "end" TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'scheduled')),
  title TEXT NOT NULL,
  legacy_event_id TEXT,
  legacy_calendar_source_event_id TEXT,
  UNIQUE (schedule_id, nominal_date)
);
ALTER TABLE monthly_schedule ADD COLUMN IF NOT EXISTS fixed_schedule_id TEXT;
ALTER TABLE monthly_schedule ADD COLUMN IF NOT EXISTS fixed_occurrence_id TEXT;
CREATE INDEX IF NOT EXISTS idx_schedule_fixed ON monthly_schedule(fixed_schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_fixed_occurrence ON monthly_schedule(fixed_occurrence_id);

ALTER TABLE fixed_schedule_occurrences ADD COLUMN IF NOT EXISTS legacy_calendar_source_event_id TEXT;
