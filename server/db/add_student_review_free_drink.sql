-- Run once on existing DBs (also in schema.sql for new installs).
ALTER TABLE students ADD COLUMN IF NOT EXISTS review_free_drink BOOLEAN NOT NULL DEFAULT FALSE;
