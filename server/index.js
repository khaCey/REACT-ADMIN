import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirnameServer = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirnameServer, '..', '.env'), override: true });
const clientDistDir = join(__dirnameServer, '..', 'client', 'dist');
const hasClientDist = existsSync(clientDistDir);

// Keep server running on unhandled errors (log instead of exit)
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at', promise, 'reason:', reason);
});

import express from 'express';
import cors from 'cors';
import { query, runMigrations } from './db/index.js';
import { upsertMonthlySchedule } from './lib/calendarSync.js';
import { fetchMonthlyScheduleFromSheet } from './lib/googleSheets.js';
import studentsRouter from './routes/students.js';
import paymentsRouter from './routes/payments.js';
import notesRouter from './routes/notes.js';
import lessonsRouter from './routes/lessons.js';
import dashboardRouter from './routes/dashboard.js';
import configRouter from './routes/config.js';
import scheduleRouter from './routes/schedule.js';
import changeLogRouter from './routes/changeLog.js';
import calendarRouter, { registerWatch } from './routes/calendar.js';
import authRouter from './routes/auth.js';
import staffRouter from './routes/staff.js';
import shiftsRouter from './routes/shifts.js';
import notificationsRouter from './routes/notifications.js';
import { requireAuth, requireAdmin } from './middleware/auth.js';
import { roundTeacherShiftStartEnd } from './lib/timezone.js';
import { runBackup, cleanupBackupsOlderThan, runRestore } from './lib/backup.js';
import cron from 'node-cron';

const app = express();
const PORT = process.env.API_PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth', authRouter);

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.originalUrl === '/api/health') return next();
  return requireAuth(req, res, next);
});

app.get('/', (req, res) => {
  if (process.env.NODE_ENV === 'production' && hasClientDist) {
    return res.sendFile(join(clientDistDir, 'index.html'));
  }
  res.json({
    message: 'Student Admin API',
    health: '/api/health',
    docs: 'Use the React app at http://localhost:5173/ for the UI. API routes are under /api/* (e.g. /api/students).',
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Student Admin API' });
});

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const LATEST_BY_MONTH_JST_MS = 9 * 60 * 60 * 1000;
function yyyyMmJstNow() {
  const jst = new Date(Date.now() + LATEST_BY_MONTH_JST_MS);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}
function yyyyMmAddOne(yyyyMm) {
  const [ys, ms] = String(yyyyMm).split('-');
  const y = parseInt(ys, 10);
  const mo = parseInt(ms, 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return null;
  let ny = y;
  let nm = mo + 1;
  if (nm > 12) {
    nm = 1;
    ny += 1;
  }
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

app.get('/api/students/:id/latest-by-month', async (req, res) => {
  try {
    const { id } = req.params;
    const studentResult = await query('SELECT id, name FROM students WHERE id = $1', [id]);
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const studentName = (studentResult.rows[0].name || '').trim();
    const parts = studentName.split(/\s+/).filter(Boolean);
    const nameVariants = [studentName];
    if (parts.length >= 2) {
      const swapped = [...parts.slice(-1), ...parts.slice(0, -1)].join(' ');
      if (swapped !== studentName) nameVariants.push(swapped);
    }

    const jstNow = new Date(Date.now() + LATEST_BY_MONTH_JST_MS);
    const defaultPaymentYear = jstNow.getUTCFullYear();
    const thisYyyyMm = yyyyMmJstNow();
    const nextYyyyMm = yyyyMmAddOne(thisYyyyMm);

    const paymentsResult = await query(
      'SELECT month, date, year, amount FROM payments WHERE student_id = $1 ORDER BY month',
      [Number(id) || id]
    );
    const paidMonths = new Set();
    /** Sum of payment `amount` (lesson credits) per calendar month. */
    const paidLessonsSumByMonth = {};
    /** Largest single `amount` in that month (legacy / alternate reading). */
    const paidLessonsMaxByMonth = {};
    const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    for (const p of paymentsResult.rows) {
      let m = (p.month || '').trim();
      let yyyyMm = null;
      if (/^\d{4}-\d{2}$/.test(m)) {
        yyyyMm = m;
        paidMonths.add(m);
      } else if (/^\d{4}-\d{1}$/.test(m)) {
        yyyyMm = m.replace(/-(\d)$/, '-0$1');
        paidMonths.add(yyyyMm);
      } else if (m) {
        const match = m.match(/(\d{4})/);
        const year = match ? match[1] : String(p.year || defaultPaymentYear);
        const mn = m.toLowerCase().replace(/\d{4}/g, '').trim();
        const idx = monthNames.findIndex((n) => mn.startsWith(n) || n.startsWith(mn.slice(0, 3)));
        if (idx >= 0) {
          yyyyMm = `${year}-${String(idx + 1).padStart(2, '0')}`;
          paidMonths.add(yyyyMm);
        }
      }
      if (p.date) {
        const d = new Date(p.date);
        if (!isNaN(d.getTime())) {
          const dm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          paidMonths.add(dm);
          if (!yyyyMm) yyyyMm = dm;
        }
      }
      if (yyyyMm) {
        const amt = Math.max(0, parseInt(p.amount, 10) || 0);
        paidLessonsSumByMonth[yyyyMm] = (paidLessonsSumByMonth[yyyyMm] || 0) + amt;
        paidLessonsMaxByMonth[yyyyMm] = Math.max(paidLessonsMaxByMonth[yyyyMm] || 0, amt);
      }
    }

    const allYyyyMm = [thisYyyyMm, nextYyyyMm].filter(Boolean);

    const latestByMonth = {};

    const normalizeName = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const normalizedVariants = nameVariants.map(normalizeName).filter(Boolean);

    for (const yyyyMm of allYyyyMm) {
      const scheduleResult = await query(
        `SELECT m.event_id, to_char(m.date, 'YYYY-MM-DD') as date, m.start, m.status, m.lesson_kind,
                m.awaiting_reschedule_date,
                m.calendar_sync_status, m.calendar_sync_error,
                rt.to_event_id AS rescheduled_to_event_id,
                to_char(mt.date, 'YYYY-MM-DD') AS rescheduled_to_date,
                to_char(mt.start AT TIME ZONE 'Asia/Tokyo', 'HH24:MI') AS rescheduled_to_time,
                rf.from_event_id AS rescheduled_from_event_id,
                to_char(mf.date, 'YYYY-MM-DD') AS rescheduled_from_date,
                to_char(mf.start AT TIME ZONE 'Asia/Tokyo', 'HH24:MI') AS rescheduled_from_time,
                (SELECT COUNT(*) FROM monthly_schedule m2 WHERE m2.event_id = m.event_id AND to_char(m2.date, 'YYYY-MM') = $2) AS student_count
         FROM monthly_schedule m
         LEFT JOIN reschedules rt ON rt.from_event_id = m.event_id
           AND REGEXP_REPLACE(TRIM(rt.from_student_name), '\\s+', ' ', 'g') = REGEXP_REPLACE(TRIM(m.student_name), '\\s+', ' ', 'g')
         LEFT JOIN monthly_schedule mt ON mt.event_id = rt.to_event_id
           AND REGEXP_REPLACE(TRIM(mt.student_name), '\\s+', ' ', 'g') = REGEXP_REPLACE(TRIM(rt.to_student_name), '\\s+', ' ', 'g')
         LEFT JOIN reschedules rf ON rf.to_event_id = m.event_id
           AND REGEXP_REPLACE(TRIM(rf.to_student_name), '\\s+', ' ', 'g') = REGEXP_REPLACE(TRIM(m.student_name), '\\s+', ' ', 'g')
         LEFT JOIN monthly_schedule mf ON mf.event_id = rf.from_event_id
           AND REGEXP_REPLACE(TRIM(mf.student_name), '\\s+', ' ', 'g') = REGEXP_REPLACE(TRIM(rf.from_student_name), '\\s+', ' ', 'g')
         WHERE REGEXP_REPLACE(TRIM(m.student_name), '\\s+', ' ', 'g') = ANY($1::text[])
         AND m.date IS NOT NULL
         AND to_char(m.date, 'YYYY-MM') = $2
         ORDER BY m.start ASC`,
        [normalizedVariants, yyyyMm]
      );

      const lessons = scheduleResult.rows.map((r) => {
        const dateStr = r.date ? String(r.date).trim() : '';
        const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        const day = dateMatch ? dateMatch[3] : '--';
        const s = r.start ? new Date(r.start) : null;
        const time = s && !isNaN(s.getTime())
          ? `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`
          : '--';
        return {
          day,
          time,
          status: (r.status || 'scheduled').toLowerCase(),
          eventID: r.event_id,
          awaitingRescheduleDate: !!r.awaiting_reschedule_date,
          calendarSyncStatus: (r.calendar_sync_status || 'synced').toLowerCase(),
          calendarSyncError: r.calendar_sync_error || null,
          isGroup: (r.student_count || 0) > 1,
          lessonKind: r.lesson_kind || 'regular',
          rescheduledTo: r.rescheduled_to_event_id
            ? {
                eventID: r.rescheduled_to_event_id,
                date: r.rescheduled_to_date || null,
                time: r.rescheduled_to_time || null,
              }
            : null,
          rescheduledFrom: r.rescheduled_from_event_id
            ? {
                eventID: r.rescheduled_from_event_id,
                date: r.rescheduled_from_date || null,
                time: r.rescheduled_from_time || null,
              }
            : null,
        };
      });

      const isPaid = paidMonths.has(yyyyMm);
      const sumPaid = paidLessonsSumByMonth[yyyyMm] || 0;
      const maxPaid = paidLessonsMaxByMonth[yyyyMm] || 0;
      let paidLessons = Math.max(sumPaid, maxPaid);
      const lessonPackRes = await query(
        'SELECT lessons FROM lessons WHERE student_id = $1 AND month = $2',
        [Number(id) || id, yyyyMm]
      );
      const storedPack = parseInt(lessonPackRes.rows[0]?.lessons, 10) || 0;
      if (storedPack > 0) {
        paidLessons = storedPack;
      }
      // Rows from DB only (before unscheduled placeholders).
      // Rescheduled-source lessons (`rescheduledTo` exists) do not consume monthly count.
      const countedLessons = lessons.filter((l) => !l.rescheduledTo).length;
      const bookedLessonsCount = countedLessons;
      const missingCount = Math.max(0, paidLessons - countedLessons);
      for (let i = 0; i < missingCount; i++) {
        lessons.push({
          day: '--',
          time: '--',
          status: 'unscheduled',
          eventID: `unscheduled-${yyyyMm}-${i}`,
          isGroup: false,
          lessonKind: 'regular',
        });
      }
      const [y, mo] = yyyyMm.split('-');
      const currentYear = jstNow.getUTCFullYear();
      const monthLabel = parseInt(y, 10) !== currentYear
        ? `${MONTH_NAMES[parseInt(mo, 10) - 1]} ${y}`
        : MONTH_NAMES[parseInt(mo, 10) - 1];
      latestByMonth[yyyyMm] = {
        Payment: isPaid ? '済' : '未',
        lessons,
        missingCount,
        /** Lesson pack size: `lessons` table override if set, else payment-derived (sum vs max). */
        paidLessonsCount: paidLessons,
        /** Non-cancelled lesson rows this month (before unscheduled placeholders). */
        bookedLessonsCount,
        year: parseInt(y, 10),
        monthIndex: parseInt(mo, 10) - 1,
        label: monthLabel,
      };
    }

    res.json({ latestByMonth });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/students', studentsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/notes', notesRouter);
app.use('/api/lessons', lessonsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/config', configRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/staff', staffRouter);
app.use('/api/shifts', shiftsRouter);

app.use('/api/schedule', scheduleRouter);
app.use('/api/change-log', changeLogRouter);
app.use('/api/notifications', notificationsRouter);

/** Admin: create backup (pg_dump + Drive upload). Admin only. */
app.post('/api/admin/backup', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { fileId, fileName, webViewLink } = await runBackup({ source: 'manual' });
    res.status(201).json({ ok: true, fileId, fileName, webViewLink });
  } catch (err) {
    console.error('[admin/backup]', err.message);
    const code = err.message?.includes('not configured') ? 503 : 500;
    res.status(code).json({ error: err.message || 'Backup failed' });
  }
});

/** Admin: list backups from last 30 days. Admin only. */
app.get('/api/admin/backups', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, created_at, file_name, drive_file_id, web_view_link, size_bytes, source
       FROM backups
       WHERE created_at >= NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/backups]', err.message);
    res.status(500).json({ error: err.message || 'Failed to list backups' });
  }
});

/** Admin: restore database from a backup (by id). Downloads from Drive, runs psql. Admin only. */
app.post('/api/admin/restore', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { backupId } = req.body || {};
    const { fileName } = await runRestore(backupId);
    res.json({ ok: true, fileName });
  } catch (err) {
    console.error('[admin/restore]', err.message);
    const status = err.message?.includes('not found') ? 404 : err.message?.includes('Invalid') ? 400 : 500;
    res.status(status).json({ error: err.message || 'Restore failed' });
  }
});

const ADMIN_CLEARABLE_TABLES = new Set([
  'backups',
  'change_log',
  'feature_flags',
  'lessons',
  'monthly_schedule',
  'notification_reads',
  'notifications',
  'notes',
  'payments',
  'staff_shifts',
  'stats',
  'teacher_shift_extensions',
  'teacher_schedules',
  'teacher_break_presets',
]);

/** Admin: empty a table (TRUNCATE). Admin only. */
app.post('/api/admin/clear-table', requireAuth, requireAdmin, async (req, res) => {
  try {
    const table = String(req.body?.table || '').trim().toLowerCase();
    if (!table) return res.status(400).json({ error: 'Table is required' });
    if (!ADMIN_CLEARABLE_TABLES.has(table)) {
      return res.status(400).json({ error: 'Table is not allowed to be cleared' });
    }
    await query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
    res.json({ ok: true, table });
  } catch (err) {
    console.error('[admin/clear-table]', err.message);
    res.status(500).json({ error: err.message || 'Failed to clear table' });
  }
});

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Normalize ISO string: if it has no timezone (Z or +HH:MM), treat as JST so we never depend on server local time. */
function normalizeIsoToUtc(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const s = iso.trim();
  if (!s) return null;
  const hasTz = /Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
  const toParse = hasTz ? s : s.replace(/\.\d{3}$/, '') + '+09:00';
  const utcMs = new Date(toParse).getTime();
  return Number.isNaN(utcMs) ? null : utcMs;
}

/** Parse ISO dateTime to Asia/Tokyo calendar date (YYYY-MM-DD) and time (HH:MM). Uses instant + 9h then day boundary so the date is correct for Japan. */
function isoToTokyoDateAndTime(iso) {
  const utcMs = normalizeIsoToUtc(iso);
  if (utcMs == null) return null;
  const jstMs = utcMs + JST_OFFSET_MS;
  const jstDay = Math.floor(jstMs / MS_PER_DAY);
  const d = new Date(jstDay * MS_PER_DAY);
  const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const hours = Math.floor((jstMs % MS_PER_DAY) / (60 * 60 * 1000));
  const minutes = Math.floor((jstMs % (60 * 60 * 1000)) / (60 * 1000));
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return { date: dateStr, time: timeStr };
}

/**
 * Current + next calendar month in Japan (Asia/Tokyo) for teacher schedule GAS fetch.
 * - timeMin/timeMax: first instant of current month JST through exclusive start of month-after-next (Calendar API style).
 * - rangeStart/rangeEnd: inclusive YYYY-MM-DD bounds for DELETE/replace in teacher_schedules.
 */
function getCurrentAndNextMonthJapanRange() {
  const now = new Date();
  const jstMs = now.getTime() + JST_OFFSET_MS;
  const jstDay = Math.floor(jstMs / MS_PER_DAY);
  const d = new Date(jstDay * MS_PER_DAY);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const timeMinUTC = Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - JST_OFFSET_MS;
  const timeMaxUTC = Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - JST_OFFSET_MS;
  const timeMinISO = new Date(timeMinUTC).toISOString();
  const timeMaxISO = new Date(timeMaxUTC).toISOString();
  const rangeStart = `${year}-${String(month).padStart(2, '0')}-01`;
  let nYear = year;
  let nMonth = month + 1;
  if (nMonth > 12) {
    nMonth = 1;
    nYear += 1;
  }
  const lastDayNext = new Date(Date.UTC(nYear, nMonth, 0)).getUTCDate();
  const rangeEnd = `${nYear}-${String(nMonth).padStart(2, '0')}-${String(lastDayNext).padStart(2, '0')}`;
  return { timeMinISO, timeMaxISO, rangeStart, rangeEnd };
}

/**
 * Month + next-month in JST for teacher schedule GAS fetch.
 * @param {string} yyyyMm - YYYY-MM
 */
function getMonthAndNextMonthJapanRange(yyyyMm) {
  if (!/^\d{4}-\d{2}$/.test(String(yyyyMm || '').trim())) {
    return null;
  }
  const [yStr, mStr] = String(yyyyMm).split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10); // 1-12
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;

  // Calendar API style: timeMax is exclusive. For month M (1-based), the exclusive bound for M + next (2 months)
  // is start of (M + 2). Since Date.UTC month is 0-based, that's (month + 1).
  const timeMinUTC = Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - JST_OFFSET_MS;
  const timeMaxUTC = Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - JST_OFFSET_MS;
  const timeMinISO = new Date(timeMinUTC).toISOString();
  const timeMaxISO = new Date(timeMaxUTC).toISOString();

  const rangeStart = `${year}-${String(month).padStart(2, '0')}-01`;
  let nYear = year;
  let nMonth = month + 1; // next month (1-based)
  if (nMonth > 12) {
    nMonth = 1;
    nYear += 1;
  }
  const lastDayNext = new Date(Date.UTC(nYear, nMonth, 0)).getUTCDate();
  const rangeEnd = `${nYear}-${String(nMonth).padStart(2, '0')}-${String(lastDayNext).padStart(2, '0')}`;
  return { timeMinISO, timeMaxISO, rangeStart, rangeEnd };
}

// Avoid calling GAS for all teachers repeatedly (e.g. multiple bookings in short bursts).
const TEACHER_SCHEDULE_AUTO_FETCH_TTL_MS = 60 * 60 * 1000; // 1 hour
const lastTeacherScheduleAutoFetchAtByMonth = new Map();

async function refreshTeacherSchedulesFromGASForMonth(yyyyMm) {
  const range = getMonthAndNextMonthJapanRange(yyyyMm);
  if (!range) throw new Error(`Invalid yyyyMm for teacher schedule refresh: ${yyyyMm}`);

  const now = Date.now();
  const lastAt = lastTeacherScheduleAutoFetchAtByMonth.get(yyyyMm);
  if (lastAt != null && now - lastAt < TEACHER_SCHEDULE_AUTO_FETCH_TTL_MS) {
    return { ok: true, skipped: true, reason: 'throttled', yyyyMm };
  }

  const { url, key } = getStaffScheduleGasConfig();
  if (!url || !key) {
    throw new Error('Missing STAFF_SCHEDULE_GAS_URL / STAFF_SCHEDULE_API_KEY for teacher schedule refresh');
  }

  const staffResult = await query(
    `SELECT id, name, calendar_id FROM staff
     WHERE staff_type = 'english_teacher'
       AND calendar_id IS NOT NULL AND TRIM(calendar_id) != ''
     ORDER BY name ASC`
  );
  const staffList = staffResult.rows;

  let totalStored = 0;
  const errors = [];

  for (const staff of staffList) {
    const calendarId = String(staff.calendar_id || '').trim();
    const teacherName = staff.name;
    if (!calendarId) continue;

    const gasUrl = `${url}?key=${encodeURIComponent(key)}&calendarId=${encodeURIComponent(calendarId)}&timeMin=${encodeURIComponent(
      range.timeMinISO
    )}&timeMax=${encodeURIComponent(range.timeMaxISO)}`;

    let json;
    try {
      const fetchRes = await fetch(gasUrl);
      json = await fetchRes.json().catch(() => ({}));
      if (!fetchRes.ok) {
        errors.push({ staff: teacherName, error: `GAS responded with ${fetchRes.status}` });
        continue;
      }
    } catch (err) {
      errors.push({ staff: teacherName, error: err.message });
      continue;
    }

    if (json?.error) {
      errors.push({ staff: teacherName, error: json.error });
      continue;
    }

    const events = normaliseGasEvents(json);
    const rows = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const startRaw = ev.start?.dateTime || ev.start;
      const endRaw = ev.end?.dateTime || ev.end;
      if (!startRaw || !endRaw) continue;

      const startStr = typeof startRaw === 'string' ? startRaw : startRaw?.dateTime ?? String(startRaw);
      const endStr = typeof endRaw === 'string' ? endRaw : endRaw?.dateTime ?? String(endRaw);
      const startParsed = isoToTokyoDateAndTime(startStr);
      const endParsed = isoToTokyoDateAndTime(endStr);
      if (!startParsed || !endParsed) continue;
      if (isBreakEvent(ev)) continue;
      if (isShortEvent(startParsed.time, endParsed.time)) continue;

      const { start_time, end_time } = roundTeacherShiftStartEnd(startParsed.time, endParsed.time);
      rows.push({ date: startParsed.date, start_time, end_time });
    }

    await query(
      `DELETE FROM teacher_schedules
       WHERE teacher_name = $1
         AND date >= $2::date
         AND date <= $3::date`,
      [teacherName, range.rangeStart, range.rangeEnd]
    );

    for (const row of rows) {
      await query(
        `INSERT INTO teacher_schedules (date, teacher_name, start_time, end_time)
         VALUES ($1::date, $2, $3::time, $4::time)
         ON CONFLICT (date, teacher_name, start_time) DO UPDATE SET end_time = $4::time`,
        [row.date, teacherName, row.start_time, row.end_time]
      );
      totalStored++;
    }
  }

  lastTeacherScheduleAutoFetchAtByMonth.set(yyyyMm, Date.now());
  return {
    ok: true,
    yyyyMm,
    staffProcessed: staffList.length,
    eventsStored: totalStored,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/** Normalize GAS response to an array of events (raw array or { events } or { items }). */
function normaliseGasEvents(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.events)) return json.events;
  if (json && Array.isArray(json.items)) return json.items;
  return [];
}

/** Skip past break events (~1h) when storing teacher schedules. Summary contains "break" (case-insensitive). */
function isBreakEvent(ev) {
  const s = (ev.summary || '').trim().toLowerCase();
  return s.includes('break');
}

/** Skip events that are 1 hour or less (likely breaks/short blocks) when storing teacher schedules. */
function isShortEvent(startTime, endTime) {
  const toMins = (t) => {
    if (!t || typeof t !== 'string') return NaN;
    const parts = String(t).trim().split(':').map(Number);
    if (parts.length < 2) return NaN;
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  };
  const startM = toMins(startTime);
  const endM = toMins(endTime);
  if (Number.isNaN(startM) || Number.isNaN(endM)) return false;
  let duration = endM - startM;
  if (duration < 0) duration += 24 * 60;
  return duration <= 65;
}

/** URL and key for staff-schedule GAS only. Use STAFF_SCHEDULE_GAS_URL so you do not call the student-schedule GAS (CALENDAR_POLL_URL). */
function getStaffScheduleGasConfig() {
  const url = (process.env.STAFF_SCHEDULE_GAS_URL || process.env.CALENDAR_POLL_URL || process.env.VITE_CALENDAR_POLL_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.STAFF_SCHEDULE_API_KEY || process.env.CALENDAR_POLL_API_KEY || process.env.VITE_CALENDAR_POLL_API_KEY || '').trim();
  return { url, key };
}

/** Admin: test GAS staff-schedule endpoint – returns URL, status, and response preview (no DB writes). */
app.get('/api/admin/test-gas', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { url: baseUrl, key } = getStaffScheduleGasConfig();
    if (!baseUrl || !key) {
      return res.status(400).json({
        error: 'Set STAFF_SCHEDULE_GAS_URL and STAFF_SCHEDULE_API_KEY in .env (or CALENDAR_POLL_*). Use STAFF_SCHEDULE_* for a GAS that returns teacher calendar events, not the student schedule.',
      });
    }

    let calendarId = (req.query.calendarId || '').toString().trim();
    if (!calendarId) {
      const row = await query(
        `SELECT calendar_id FROM staff WHERE calendar_id IS NOT NULL AND TRIM(calendar_id) != '' LIMIT 1`
      );
      if (row.rows[0]) calendarId = String(row.rows[0].calendar_id).trim();
    }
    if (!calendarId) {
      return res.status(400).json({
        error: 'Pass calendarId in query (e.g. ?calendarId=xxx@group.calendar.google.com) or ensure at least one staff has a calendar_id set.',
      });
    }

    const now = new Date();
    const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const timeMax = new Date(timeMin.getTime() + 31 * 24 * 60 * 60 * 1000);
    const timeMinISO = timeMin.toISOString();
    const timeMaxISO = timeMax.toISOString();

    const gasUrl = `${baseUrl}?key=${encodeURIComponent(key)}&calendarId=${encodeURIComponent(calendarId)}&timeMin=${encodeURIComponent(timeMinISO)}&timeMax=${encodeURIComponent(timeMaxISO)}`;
    const fetchRes = await fetch(gasUrl);
    const contentType = fetchRes.headers.get('content-type') || '';
    const body = await fetchRes.text();
    const bodyPreview = body.length > 500 ? body.slice(0, 500) + '...' : body;

    let json = null;
    let eventCount = 0;
    let responseKeys = null;
    try {
      json = JSON.parse(body);
      responseKeys = json !== null && typeof json === 'object' ? Object.keys(json) : [];
      eventCount = normaliseGasEvents(json).length;
    } catch {
      // not JSON
    }

    res.json({
      url: gasUrl,
      status: fetchRes.status,
      ok: fetchRes.ok,
      contentType,
      bodyPreview,
      isJson: json !== null,
      responseKeys,
      eventCount,
      message: fetchRes.ok
        ? (eventCount > 0 ? `GAS returned ${eventCount} events.` : 'GAS returned 0 events or wrong format. Use STAFF_SCHEDULE_GAS_URL to a GAS that lists teacher calendar events by calendarId (not the student-schedule GAS).')
        : `GAS responded with ${fetchRes.status}. Check URL and deployment.`,
    });
  } catch (err) {
    console.error('[admin/test-gas]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Admin: fetch English teachers' schedules from GAS (by calendarId) and store in teacher_schedules. */
app.post('/api/admin/fetch-staff-schedule', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { url, key } = getStaffScheduleGasConfig();
    if (!url || !key) {
      return res.status(400).json({
        error: 'Set STAFF_SCHEDULE_GAS_URL and STAFF_SCHEDULE_API_KEY in .env (or CALENDAR_POLL_*). Use STAFF_SCHEDULE_* for teacher calendar fetch, not the student-schedule endpoint.',
      });
    }

    const staffResult = await query(
      `SELECT id, name, calendar_id FROM staff
       WHERE staff_type = 'english_teacher'
         AND calendar_id IS NOT NULL AND TRIM(calendar_id) != ''
       ORDER BY name ASC`
    );
    const staffList = staffResult.rows;

    const { timeMinISO, timeMaxISO, rangeStart, rangeEnd } = getCurrentAndNextMonthJapanRange();

    let totalStored = 0;
    const errors = [];

    for (const staff of staffList) {
      const calendarId = String(staff.calendar_id || '').trim();
      const teacherName = staff.name;
      if (!calendarId) continue;

      const gasUrl = `${url}?key=${encodeURIComponent(key)}&calendarId=${encodeURIComponent(calendarId)}&timeMin=${encodeURIComponent(timeMinISO)}&timeMax=${encodeURIComponent(timeMaxISO)}`;
      let json;
      try {
        const fetchRes = await fetch(gasUrl);
        json = await fetchRes.json().catch(() => ({}));
      } catch (err) {
        errors.push({ staff: teacherName, error: err.message });
        continue;
      }
      if (json.error) {
        errors.push({ staff: teacherName, error: json.error });
        continue;
      }
      const events = normaliseGasEvents(json);
      if (events.length === 0 && !Array.isArray(json)) {
        console.warn('[fetch-staff-schedule] GAS returned 0 events for', teacherName, '; response keys:', Object.keys(json || {}).join(', '), '- use STAFF_SCHEDULE_GAS_URL for a GAS that returns teacher calendar events by calendarId');
      }
      const rows = [];
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const startRaw = ev.start?.dateTime || ev.start;
        const endRaw = ev.end?.dateTime || ev.end;
        if (!startRaw || !endRaw) continue;
        const startStr = typeof startRaw === 'string' ? startRaw : startRaw?.dateTime ?? String(startRaw);
        const endStr = typeof endRaw === 'string' ? endRaw : endRaw?.dateTime ?? String(endRaw);
        const startParsed = isoToTokyoDateAndTime(startStr);
        const endParsed = isoToTokyoDateAndTime(endStr);
        if (!startParsed || !endParsed) continue;
        if (isBreakEvent(ev)) continue;
        if (isShortEvent(startParsed.time, endParsed.time)) continue;
        if (rows.length === 0) {
          console.log('[fetch-staff-schedule]', teacherName, 'first event: rawStart=', startStr, '-> parsed', startParsed.date, startParsed.time);
        }
        const { start_time, end_time } = roundTeacherShiftStartEnd(startParsed.time, endParsed.time);
        rows.push({
          date: startParsed.date,
          start_time,
          end_time,
        });
      }

      await query(
        `DELETE FROM teacher_schedules WHERE teacher_name = $1 AND date >= $2::date AND date <= $3::date`,
        [teacherName, rangeStart, rangeEnd]
      );
      for (const row of rows) {
        await query(
          `INSERT INTO teacher_schedules (date, teacher_name, start_time, end_time)
           VALUES ($1::date, $2, $3::time, $4::time)
           ON CONFLICT (date, teacher_name, start_time) DO UPDATE SET end_time = $4::time`,
          [row.date, teacherName, row.start_time, row.end_time]
        );
        totalStored++;
      }
    }

    res.json({
      ok: true,
      staffProcessed: staffList.length,
      eventsStored: totalStored,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('[admin/fetch-staff-schedule]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Admin/operator: fetch one staff member's schedule from GAS and store in teacher_schedules. */
app.post('/api/admin/fetch-staff-schedule/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    if (Number.isNaN(staffId)) return res.status(400).json({ error: 'Invalid staff id' });

    const { url, key } = getStaffScheduleGasConfig();
    if (!url || !key) {
      return res.status(400).json({
        error: 'Set STAFF_SCHEDULE_GAS_URL and STAFF_SCHEDULE_API_KEY in .env (or CALENDAR_POLL_*). Use STAFF_SCHEDULE_* for teacher calendar fetch, not the student-schedule endpoint.',
      });
    }

    const staffResult = await query(
      'SELECT id, name, calendar_id FROM staff WHERE id = $1',
      [staffId]
    );
    const staff = staffResult.rows[0];
    if (!staff) return res.status(404).json({ error: 'Staff not found' });

    const calendarId = String(staff.calendar_id || '').trim();
    if (!calendarId) {
      return res.status(400).json({ error: 'Staff has no calendar ID set. Add a calendar ID and save, then fetch schedule.' });
    }

    const teacherName = staff.name;
    const { timeMinISO, timeMaxISO, rangeStart, rangeEnd } = getCurrentAndNextMonthJapanRange();

    const gasUrl = `${url}?key=${encodeURIComponent(key)}&calendarId=${encodeURIComponent(calendarId)}&timeMin=${encodeURIComponent(timeMinISO)}&timeMax=${encodeURIComponent(timeMaxISO)}`;
    const fetchRes = await fetch(gasUrl);
    const contentType = fetchRes.headers.get('content-type') || '';
    if (!fetchRes.ok) {
      const body = await fetchRes.text();
      console.warn('[fetch-staff-schedule/:id] GAS responded with', fetchRes.status, body.slice(0, 200));
      return res.status(400).json({ error: `GAS returned ${fetchRes.status}. Use STAFF_SCHEDULE_GAS_URL for a Web App that lists teacher calendar events by calendarId (not the student-schedule GAS).` });
    }
    const json = await fetchRes.json().catch((e) => {
      console.warn('[fetch-staff-schedule/:id] GAS response was not JSON:', e.message);
      return {};
    });
    if (json.error) {
      return res.status(400).json({ error: json.error });
    }
    const events = normaliseGasEvents(json);
    if (events.length === 0 && !Array.isArray(json)) {
      console.warn('[fetch-staff-schedule/:id] GAS returned 0 events; response keys:', Object.keys(json || {}).join(', '), '- use STAFF_SCHEDULE_GAS_URL for a GAS that returns teacher calendar events by calendarId');
    }
    const rows = [];
    events.forEach((ev, i) => {
      const startRaw = ev.start?.dateTime || ev.start;
      const endRaw = ev.end?.dateTime || ev.end;
      if (!startRaw || !endRaw) return;
      const startStr = typeof startRaw === 'string' ? startRaw : startRaw?.dateTime ?? String(startRaw);
      const endStr = typeof endRaw === 'string' ? endRaw : endRaw?.dateTime ?? String(endRaw);
      const startParsed = isoToTokyoDateAndTime(startStr);
      const endParsed = isoToTokyoDateAndTime(endStr);
      if (!startParsed || !endParsed) return;
      if (isBreakEvent(ev)) return;
      if (isShortEvent(startParsed.time, endParsed.time)) return;
      if (rows.length === 0) {
        console.log('[fetch-staff-schedule/:id]', teacherName, 'first event: rawStart=', startStr, '-> parsed', startParsed.date, startParsed.time);
      }
      const { start_time, end_time } = roundTeacherShiftStartEnd(startParsed.time, endParsed.time);
      rows.push({ date: startParsed.date, start_time, end_time });
    });

    await query(
      `DELETE FROM teacher_schedules WHERE teacher_name = $1 AND date >= $2::date AND date <= $3::date`,
      [teacherName, rangeStart, rangeEnd]
    );
    for (const row of rows) {
      await query(
        `INSERT INTO teacher_schedules (date, teacher_name, start_time, end_time)
         VALUES ($1::date, $2, $3::time, $4::time)
         ON CONFLICT (date, teacher_name, start_time) DO UPDATE SET end_time = $4::time`,
        [row.date, teacherName, row.start_time, row.end_time]
      );
    }

    res.json({
      ok: true,
      staffId,
      teacherName,
      eventsStored: rows.length,
    });
  } catch (err) {
    console.error('[admin/fetch-staff-schedule/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Sync MonthlySchedule from GAS Calendar Webhook polling into PostgreSQL. Upserts by (event_id, student_name); optional removed[] + reconcile drop stale rows. */
app.post('/api/calendar-poll/sync', async (req, res) => {
  try {
    const { data, removed } = req.body || {};
    if (!Array.isArray(data)) {
      return res.status(400).json({ error: 'Body must include { data: MonthlySchedule[] }' });
    }
    if (removed != null && !Array.isArray(removed)) {
      return res.status(400).json({ error: 'removed must be an array when present' });
    }
    console.log('[calendar-poll/sync] received', data.length, 'rows,', (removed || []).length, 'removed');
    const { upserted, months, deletedOrphans } = await upsertMonthlySchedule(data, { removed: removed || [] });

    // Keep teacher_schedules aligned with lesson updates so booking UI capacity constraints are correct.
    // We refresh only when lesson months touch the current JST month or the next JST month.
    let teacherSchedulesRefresh = null;
    try {
      const jstNow = new Date(Date.now() + JST_OFFSET_MS);
      const curYyyyMm = `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}`;
      const nextDate = new Date(jstNow.getTime());
      nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
      const nextYyyyMm = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}`;

      const intersectsCurOrNext = Array.isArray(months) && months.some((m) => m === curYyyyMm || m === nextYyyyMm);
      if (intersectsCurOrNext) {
        teacherSchedulesRefresh = await refreshTeacherSchedulesFromGASForMonth(curYyyyMm);
      }
    } catch (err) {
      console.warn('[calendar-poll/sync] teacher schedule refresh failed:', err.message);
      teacherSchedulesRefresh = { ok: false, error: err.message };
    }

    console.log(
      '[calendar-poll/sync] upserted',
      upserted,
      'rows for months',
      months.sort().join(', '),
      deletedOrphans ? `; reconciled (deleted ${deletedOrphans} orphan row(s))` : ''
    );
    res.json({ ok: true, upserted, months, deletedOrphans: deletedOrphans || 0, teacherSchedulesRefresh });
  } catch (err) {
    console.error('[calendar-poll/sync] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Server-side backfill: fetch from GAS Calendar Webhook and sync to DB. Uses CALENDAR_POLL_URL and CALENDAR_POLL_API_KEY from .env (no client rebuild needed). */
app.post('/api/calendar-poll/backfill', async (req, res) => {
  try {
    const url = (process.env.CALENDAR_POLL_URL || process.env.VITE_CALENDAR_POLL_URL || '').trim().replace(/\/$/, '');
    const key = (process.env.CALENDAR_POLL_API_KEY || process.env.VITE_CALENDAR_POLL_API_KEY || '').trim();
    if (!url || !key) {
      return res.status(400).json({
        error: 'Set CALENDAR_POLL_URL and CALENDAR_POLL_API_KEY in .env (project root)',
      });
    }
    const { month, year } = req.body || {};
    let gasUrl = `${url}?key=${encodeURIComponent(key)}&full=1`;
    if (month && /^\d{4}-\d{2}$/.test(String(month))) {
      gasUrl += `&month=${encodeURIComponent(month)}`;
    } else if (year && /^\d{4}$/.test(String(year))) {
      gasUrl += `&year=${encodeURIComponent(year)}`;
    } else {
      return res.status(400).json({ error: 'Body must include month (YYYY-MM) or year (YYYY)' });
    }
    const fetchRes = await fetch(gasUrl);
    const json = await fetchRes.json().catch(() => ({}));
    if (json.error) {
      return res.status(400).json({ error: json.error });
    }
    const data = Array.isArray(json.data) ? json.data : [];
    console.log('[calendar-poll/backfill] fetched', data.length, 'rows from GAS');
    const { upserted, months } = await upsertMonthlySchedule(data);

    // Keep teacher_schedules in sync so booking UI has correct capacity/constraints.
    // (Booking grid calls GET /schedule/week which reads teacher_schedules from DB.)
    let teacherSchedulesRefresh = null;
    if (month && /^\d{4}-\d{2}$/.test(String(month))) {
      try {
        teacherSchedulesRefresh = await refreshTeacherSchedulesFromGASForMonth(String(month));
      } catch (err) {
        console.warn('[calendar-poll/backfill] teacher schedule refresh failed:', err.message);
        teacherSchedulesRefresh = { ok: false, error: err.message };
      }
    }
    console.log('[calendar-poll/backfill] upserted', upserted, 'rows for months', months.sort().join(', '));
    res.json({
      ok: true,
      upserted,
      months,
      fetched: data.length,
      backfill: json.backfill,
      teacherSchedulesRefresh,
    });
  } catch (err) {
    console.error('[calendar-poll/backfill] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Sync MonthlySchedule from Google Sheets (Admin spreadsheet) into PostgreSQL. Fetches directly from Sheets API. */
app.post('/api/calendar-poll/sync-from-sheet', async (req, res) => {
  try {
    const data = await fetchMonthlyScheduleFromSheet();
    if (data.length === 0) {
      return res.status(400).json({ error: 'No data from sheet. Ensure GOOGLE_ADMIN_SHEET_ID is set and the spreadsheet is shared with the service account.', fetched: 0 });
    }
    console.log('[calendar-poll/sync-from-sheet] fetched', data.length, 'rows from Sheets');
    const { upserted, months } = await upsertMonthlySchedule(data);
    console.log('[calendar-poll/sync-from-sheet] upserted', upserted, 'rows for months', months.sort().join(', '));

    // Best-effort: refresh teacher schedules for the current month (and next month) in JST.
    // This keeps booking UI constraints aligned after a bulk lessons sync.
    let teacherSchedulesRefresh = null;
    try {
      const nowJst = new Date(Date.now() + JST_OFFSET_MS);
      const yyyyMm = `${nowJst.getUTCFullYear()}-${String(nowJst.getUTCMonth() + 1).padStart(2, '0')}`;
      teacherSchedulesRefresh = await refreshTeacherSchedulesFromGASForMonth(yyyyMm);
    } catch (err) {
      console.warn('[calendar-poll/sync-from-sheet] teacher schedule refresh failed:', err.message);
      teacherSchedulesRefresh = { ok: false, error: err.message };
    }

    res.json({ ok: true, upserted, months, fetched: data.length, teacherSchedulesRefresh });
  } catch (err) {
    console.error('[calendar-poll/sync-from-sheet] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

if (process.env.NODE_ENV === 'production' && hasClientDist) {
  app.use(express.static(clientDistDir));
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(join(clientDistDir, 'index.html'));
  });
}

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found', path: req.originalUrl });
});

runMigrations()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`API running at http://localhost:${PORT} (network: http://0.0.0.0:${PORT})`);
      registerWatch().catch(() => {});

      const cronExpr = process.env.BACKUP_SCHEDULE_CRON || '0 12 * * *';
      const tz = process.env.BACKUP_SCHEDULE_TZ || 'Asia/Tokyo';
      cron.schedule(
        cronExpr,
        () => {
          runBackup({ source: 'scheduled' })
            .then((r) => {
              console.log('[backup] scheduled backup ok:', r.fileName);
              return cleanupBackupsOlderThan(30);
            })
            .then((deleted) => { if (deleted > 0) console.log('[backup] cleaned up', deleted, 'backup(s) older than 30 days'); })
            .catch((err) => console.error('[backup] scheduled backup failed:', err.message));
        },
        { timezone: tz }
      );
    });
  })
  .catch((err) => {
    console.error('Failed to run DB migrations:', err);
    process.exit(1);
  });
