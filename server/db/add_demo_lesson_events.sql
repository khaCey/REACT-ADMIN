-- Run once on existing DBs (also in schema.sql for new installs).
CREATE TABLE IF NOT EXISTS demo_lesson_events (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_name VARCHAR(255),
  demo_date DATE NOT NULL,
  signed_up BOOLEAN NOT NULL DEFAULT FALSE,
  source_event_id VARCHAR(512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, demo_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_lesson_events_source_event
  ON demo_lesson_events (source_event_id)
  WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_demo_lesson_events_demo_date ON demo_lesson_events (demo_date DESC);
