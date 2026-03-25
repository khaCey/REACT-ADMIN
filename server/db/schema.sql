-- Student Admin - PostgreSQL Schema
-- Canonical month key: YYYY-MM

-- Students
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  name_kanji VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(100),
  phone_secondary VARCHAR(100),
  same_day_cancel VARCHAR(50),
  status VARCHAR(50),
  payment VARCHAR(50),
  group_type VARCHAR(50),
  group_size INTEGER,
  is_child BOOLEAN DEFAULT FALSE,
  google_contact_resource_name VARCHAR(512),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Existing DBs (before this column existed)
ALTER TABLE students ADD COLUMN IF NOT EXISTS google_contact_resource_name VARCHAR(512);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  transaction_id VARCHAR(100) PRIMARY KEY,
  student_id INTEGER REFERENCES students(id),
  year VARCHAR(4),
  month VARCHAR(7),
  amount NUMERIC(12,2),
  discount NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2),
  date DATE,
  method VARCHAR(50),
  staff VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_student_month ON payments(student_id, year, month);

-- Notes
CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES students(id),
  staff VARCHAR(255),
  date TIMESTAMPTZ DEFAULT NOW(),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_student ON notes(student_id);

-- Lessons (monthly totals)
CREATE TABLE IF NOT EXISTS lessons (
  student_id INTEGER REFERENCES students(id),
  month VARCHAR(7),
  lessons INTEGER DEFAULT 0,
  PRIMARY KEY (student_id, month)
);

CREATE INDEX IF NOT EXISTS idx_lessons_student ON lessons(student_id);

-- Monthly schedule (cached events). Composite PK allows group lessons: one row per student per event.
CREATE TABLE IF NOT EXISTS monthly_schedule (
  event_id VARCHAR(255) NOT NULL,
  title VARCHAR(500),
  date DATE,
  start TIMESTAMPTZ,
  "end" TIMESTAMPTZ,
  status VARCHAR(50),
  student_name VARCHAR(255) NOT NULL,
  is_kids_lesson BOOLEAN DEFAULT FALSE,
  teacher_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (event_id, student_name)
);

-- Migrate existing table from single-column PK to composite (idempotent)
ALTER TABLE monthly_schedule DROP CONSTRAINT IF EXISTS monthly_schedule_pkey;
ALTER TABLE monthly_schedule ADD CONSTRAINT monthly_schedule_pkey PRIMARY KEY (event_id, student_name);

CREATE INDEX IF NOT EXISTS idx_monthly_schedule_date ON monthly_schedule(date);

ALTER TABLE monthly_schedule ADD COLUMN IF NOT EXISTS lesson_kind VARCHAR(20) NOT NULL DEFAULT 'regular';
ALTER TABLE monthly_schedule ADD COLUMN IF NOT EXISTS student_id INTEGER REFERENCES students(id);
ALTER TABLE monthly_schedule ADD COLUMN IF NOT EXISTS lesson_mode VARCHAR(20) NOT NULL DEFAULT 'unknown';

-- Teacher schedules
CREATE TABLE IF NOT EXISTS teacher_schedules (
  date DATE,
  teacher_name VARCHAR(255),
  start_time TIME,
  end_time TIME,
  PRIMARY KEY (date, teacher_name, start_time)
);

-- Shift slot time overrides (custom start/end when no staff assigned, or to show adjusted times)
CREATE TABLE IF NOT EXISTS shift_slot_overrides (
  date DATE,
  shift_type VARCHAR(50),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  PRIMARY KEY (date, shift_type)
);

-- Teacher shift extensions: up to 2 hours before/after base shift (minutes, max 120 each)
CREATE TABLE IF NOT EXISTS teacher_shift_extensions (
  date DATE NOT NULL,
  teacher_name VARCHAR(255) NOT NULL,
  extend_before_minutes INTEGER DEFAULT 0 CHECK (extend_before_minutes >= 0 AND extend_before_minutes <= 120),
  extend_after_minutes INTEGER DEFAULT 0 CHECK (extend_after_minutes >= 0 AND extend_after_minutes <= 120),
  PRIMARY KEY (date, teacher_name)
);

-- Stats
CREATE TABLE IF NOT EXISTS stats (
  month VARCHAR(7) PRIMARY KEY,
  lessons INTEGER DEFAULT 0,
  students INTEGER DEFAULT 0
);

-- Config
CREATE TABLE IF NOT EXISTS config (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT
);

-- Feature flags
CREATE TABLE IF NOT EXISTS feature_flags (
  name VARCHAR(100) PRIMARY KEY,
  enabled BOOLEAN DEFAULT FALSE,
  description TEXT
);

-- Seed feature flags
INSERT INTO feature_flags (name, enabled, description) VALUES
  ('notifications', false, 'Notification system'),
  ('unpaidStudents', true, 'Unpaid students button'),
  ('unscheduledLessons', false, 'Unscheduled lessons button'),
  ('codePage', true, 'Code management page'),
  ('lessonBooking', true, 'Lesson booking calendar'),
  ('lessonActions', true, 'Cancel/Reschedule/Remove lesson actions')
ON CONFLICT (name) DO NOTHING;

-- Seed config
INSERT INTO config (key, value) VALUES ('staff', 'Staff')
ON CONFLICT (key) DO NOTHING;

-- Staff (for login when starting shift)
CREATE TABLE IF NOT EXISTS staff (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_operator BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS calendar_id TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS staff_type VARCHAR(50) NOT NULL DEFAULT 'japanese_staff';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_staff_name ON staff(name);

-- Staff-created notifications
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  kind VARCHAR(50) NOT NULL DEFAULT 'general',
  slug VARCHAR(150),
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_staff_id INTEGER NOT NULL REFERENCES staff(id),
  target_staff_id INTEGER REFERENCES staff(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS target_staff_id INTEGER REFERENCES staff(id);
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS kind VARCHAR(50) NOT NULL DEFAULT 'general';
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS slug VARCHAR(150);
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created_by ON notifications(created_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_notifications_target_staff_id ON notifications(target_staff_id);
CREATE INDEX IF NOT EXISTS idx_notifications_kind ON notifications(kind);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_slug_unique ON notifications(slug);

-- Per-staff read tracking for notifications
CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (notification_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_reads_staff_id ON notification_reads(staff_id);

-- Staff shift log: login = shift start, logout = shift end
CREATE TABLE IF NOT EXISTS staff_shifts (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_shifts_staff_id ON staff_shifts(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_shifts_started_at ON staff_shifts(started_at);

-- Change log (audit trail for undo)
CREATE TABLE IF NOT EXISTS change_log (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,
  entity_key VARCHAR(255) NOT NULL,
  action VARCHAR(20) NOT NULL,
  old_data JSONB,
  new_data JSONB,
  source_change_id INTEGER REFERENCES change_log(id),
  staff_id INTEGER REFERENCES staff(id),
  staff_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE change_log ADD COLUMN IF NOT EXISTS source_change_id INTEGER REFERENCES change_log(id);
CREATE INDEX IF NOT EXISTS idx_change_log_entity ON change_log(entity_type, entity_key);
CREATE INDEX IF NOT EXISTS idx_change_log_created ON change_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_log_source_change_id ON change_log(source_change_id);

-- Backups (metadata for DB backups stored in Google Drive)
CREATE TABLE IF NOT EXISTS backups (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  file_name VARCHAR(255) NOT NULL,
  drive_file_id VARCHAR(255),
  web_view_link TEXT,
  size_bytes BIGINT,
  source VARCHAR(50) NOT NULL DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS idx_backups_created_at ON backups(created_at DESC);

-- Removed currently-unused tables
DROP TABLE IF EXISTS booking_availability;
DROP TABLE IF EXISTS teacher_calendars;
DROP TABLE IF EXISTS lesson_actions;
DROP TABLE IF EXISTS manual_tally;
DROP TABLE IF EXISTS lessons_month;
DROP TABLE IF EXISTS lessons_today;
DROP TABLE IF EXISTS unpaid;
