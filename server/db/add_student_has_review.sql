-- Run once on existing DBs (also in schema.sql for new installs).
ALTER TABLE students ADD COLUMN IF NOT EXISTS has_review BOOLEAN NOT NULL DEFAULT FALSE;
