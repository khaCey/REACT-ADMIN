CREATE TABLE IF NOT EXISTS calendar_event_recoveries (
  old_event_id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL,
  google_event_id TEXT NOT NULL UNIQUE,
  new_event_id TEXT,
  state TEXT NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','linked')),
  snapshot JSONB NOT NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  linked_at TIMESTAMPTZ
);
