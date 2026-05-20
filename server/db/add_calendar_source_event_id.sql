-- Exact Google Calendar event id from poll (before DB date/time disambiguation suffix).
ALTER TABLE monthly_schedule ADD COLUMN IF NOT EXISTS calendar_source_event_id TEXT;
CREATE INDEX IF NOT EXISTS idx_monthly_schedule_calendar_source_event_id
  ON monthly_schedule(calendar_source_event_id)
  WHERE calendar_source_event_id IS NOT NULL;
