-- Exact Google Calendar occurrence identity for the rebuilt Calendar mirror/tagging flow.
-- Additive only: existing event_id and calendar_source_event_id remain unchanged.
ALTER TABLE monthly_schedule
  ADD COLUMN IF NOT EXISTS calendar_google_event_id TEXT;

CREATE INDEX IF NOT EXISTS idx_monthly_schedule_calendar_google_event_id
  ON monthly_schedule(calendar_google_event_id)
  WHERE calendar_google_event_id IS NOT NULL;
