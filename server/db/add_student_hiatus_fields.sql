-- Run once on existing DBs (also in schema.sql for new installs).
ALTER TABLE students ADD COLUMN IF NOT EXISTS hiatus_contacted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS hiatus_expected_return DATE NULL;
