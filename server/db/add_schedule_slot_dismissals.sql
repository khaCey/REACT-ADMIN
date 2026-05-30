-- Run once on existing DBs (also in schema.sql for new installs).
-- Prevents calendar poll from re-inserting lessons staff removed while the event is already gone from Google Calendar.
CREATE TABLE IF NOT EXISTS schedule_slot_dismissals (
  student_name TEXT NOT NULL,
  lesson_date DATE NOT NULL,
  start_time_utc TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (student_name, lesson_date, start_time_utc)
);

CREATE INDEX IF NOT EXISTS idx_schedule_slot_dismissals_date
  ON schedule_slot_dismissals (lesson_date);
