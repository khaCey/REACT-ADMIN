-- Run once on existing DBs (also in schema.sql for new installs).
ALTER TABLE monthly_schedule ADD COLUMN IF NOT EXISTS reschedule_snapshot_to_date DATE;
ALTER TABLE monthly_schedule ADD COLUMN IF NOT EXISTS reschedule_snapshot_to_time VARCHAR(16);
ALTER TABLE monthly_schedule ADD COLUMN IF NOT EXISTS reschedule_snapshot_from_date DATE;
ALTER TABLE monthly_schedule ADD COLUMN IF NOT EXISTS reschedule_snapshot_from_time VARCHAR(16);
