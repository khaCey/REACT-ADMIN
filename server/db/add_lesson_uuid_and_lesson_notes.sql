CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE monthly_schedule
  ADD COLUMN IF NOT EXISTS lesson_uuid UUID;

WITH seeded AS (
  SELECT event_id, gen_random_uuid() AS generated_uuid
  FROM (
    SELECT DISTINCT event_id
    FROM monthly_schedule
    WHERE lesson_uuid IS NULL
  ) dedup
)
UPDATE monthly_schedule m
SET lesson_uuid = seeded.generated_uuid
FROM seeded
WHERE m.lesson_uuid IS NULL
  AND m.event_id = seeded.event_id;

ALTER TABLE monthly_schedule
  ALTER COLUMN lesson_uuid SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_monthly_schedule_lesson_uuid
  ON monthly_schedule(lesson_uuid);

CREATE TABLE IF NOT EXISTS lesson_notes (
  id SERIAL PRIMARY KEY,
  lesson_uuid UUID NOT NULL,
  staff VARCHAR(255),
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lesson_notes_lesson_uuid
  ON lesson_notes(lesson_uuid);
CREATE INDEX IF NOT EXISTS idx_lesson_notes_created_at
  ON lesson_notes(created_at DESC);
