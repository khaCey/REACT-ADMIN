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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- Unpaid list
CREATE TABLE IF NOT EXISTS unpaid (
  id SERIAL PRIMARY KEY,
  student_name VARCHAR(255),
  student_id INTEGER REFERENCES students(id)
);

-- Teacher schedules
CREATE TABLE IF NOT EXISTS teacher_schedules (
  date DATE,
  teacher_name VARCHAR(255),
  start_time TIME,
  end_time TIME,
  PRIMARY KEY (date, teacher_name, start_time)
);

-- Teacher shift extensions: up to 2 hours before/after base shift (minutes, max 120 each)
CREATE TABLE IF NOT EXISTS teacher_shift_extensions (
  date DATE NOT NULL,
  teacher_name VARCHAR(255) NOT NULL,
  extend_before_minutes INTEGER DEFAULT 0 CHECK (extend_before_minutes >= 0 AND extend_before_minutes <= 120),
  extend_after_minutes INTEGER DEFAULT 0 CHECK (extend_after_minutes >= 0 AND extend_after_minutes <= 120),
  PRIMARY KEY (date, teacher_name)
);

-- Teacher calendars
CREATE TABLE IF NOT EXISTS teacher_calendars (
  calendar_id VARCHAR(255) PRIMARY KEY,
  teacher_name VARCHAR(255)
);

-- Booking availability cache
CREATE TABLE IF NOT EXISTS booking_availability (
  date DATE,
  time TIME,
  teacher_count INTEGER DEFAULT 0,
  lesson_count INTEGER DEFAULT 0,
  available_slots INTEGER DEFAULT 0,
  teachers TEXT,
  has_kids_lesson BOOLEAN DEFAULT FALSE,
  has_adult_lesson BOOLEAN DEFAULT FALSE,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (date, time)
);

CREATE INDEX IF NOT EXISTS idx_booking_availability_date ON booking_availability(date);

-- Lesson actions audit
CREATE TABLE IF NOT EXISTS lesson_actions (
  action_id VARCHAR(100) PRIMARY KEY,
  student_id INTEGER,
  event_id VARCHAR(255),
  action_type VARCHAR(50),
  old_date_time TIMESTAMPTZ,
  new_date_time TIMESTAMPTZ,
  reason TEXT,
  staff_member VARCHAR(255),
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Stats
CREATE TABLE IF NOT EXISTS stats (
  month VARCHAR(7) PRIMARY KEY,
  lessons INTEGER DEFAULT 0,
  students INTEGER DEFAULT 0
);

-- Manual tally
CREATE TABLE IF NOT EXISTS manual_tally (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(255),
  title VARCHAR(500),
  start TIMESTAMPTZ,
  "end" TIMESTAMPTZ,
  student_name VARCHAR(255),
  is_kids_lesson BOOLEAN DEFAULT FALSE
);

-- Lessons month (unscheduled)
CREATE TABLE IF NOT EXISTS lessons_month (
  id SERIAL PRIMARY KEY,
  student_name VARCHAR(255),
  student_id INTEGER REFERENCES students(id)
);

-- Lessons today
CREATE TABLE IF NOT EXISTS lessons_today (
  id SERIAL PRIMARY KEY,
  student_id INTEGER,
  student_name VARCHAR(255),
  title VARCHAR(500),
  start TIMESTAMPTZ,
  "end" TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_name ON staff(name);

-- Staff-created notifications
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  created_by_staff_id INTEGER NOT NULL REFERENCES staff(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created_by ON notifications(created_by_staff_id);

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
  staff_id INTEGER REFERENCES staff(id),
  staff_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_change_log_entity ON change_log(entity_type, entity_key);
CREATE INDEX IF NOT EXISTS idx_change_log_created ON change_log(created_at DESC);
