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
import messagesRouter from './routes/messages.js';
import { requireAuth, requireAdmin } from './middleware/auth.js';
import {
  bulkSyncCalendarsFromGasForStaffType,
  getCurrentAndNextMonthJapanRange,
  getMonthAndNextMonthJapanRange,
  getStaffScheduleGasConfig,
  normaliseGasEvents,
  syncOneStaffCalendarFromGas,
} from './lib/staffScheduleGasSync.js';
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

/** Node fetch often throws TypeError("fetch failed") with real reason in err.cause */
function formatFetchError(err) {
  if (!err) return 'Unknown error';
  if (err.name === 'AbortError') {
    return 'Request timed out (GAS did not respond in time)';
  }
  const parts = [];
  const msg = err.message || String(err);
  if (msg && msg !== 'fetch failed') parts.push(msg);
  let c = err.cause;
  let depth = 0;
  while (c && depth < 4) {
    const cm = c.message || c.code || String(c);
    if (cm) parts.push(cm);
    c = c.cause;
    depth += 1;
  }
  if (parts.length === 0) return 'fetch failed';
  return parts.join(' — ');
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
    /** DATE or string → YYYY-MM-DD for API / Notes */
    const snapDateToYmd = (v) => {
      if (v == null || v === '') return null;
      if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
      return null;
    };

    for (const yyyyMm of allYyyyMm) {
      const studentIdForJoin = Number(id) || id;
      const scheduleResult = await query(
        `SELECT m.event_id, m.lesson_uuid, to_char(m.date, 'YYYY-MM-DD') as date, m.start, m.status, m.lesson_kind,
                m.awaiting_reschedule_date,
                m.calendar_sync_status, m.calendar_sync_error,
                m.reschedule_snapshot_to_date, m.reschedule_snapshot_to_time,
                m.reschedule_snapshot_from_date, m.reschedule_snapshot_from_time,
                EXISTS (
                  SELECT 1
                  FROM lesson_notes ln
                  WHERE ln.lesson_uuid = m.lesson_uuid
                ) AS has_lesson_note,
                COALESCE(
                  mt.event_id,
                  (SELECT x.event_id FROM monthly_schedule x
                   WHERE rt.to_event_id IS NOT NULL
                     AND REGEXP_REPLACE(TRIM(x.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                       = REGEXP_REPLACE(TRIM(rt.to_event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                     AND (x.student_id = $3::integer OR REGEXP_REPLACE(TRIM(x.student_name), '\\s+', ' ', 'g') = ANY($1::text[]))
                   LIMIT 1),
                  rt.to_event_id
                ) AS rescheduled_to_event_id,
                COALESCE(
                  to_char(mt.date, 'YYYY-MM-DD'),
                  (SELECT to_char(x.date, 'YYYY-MM-DD') FROM monthly_schedule x
                   WHERE rt.to_event_id IS NOT NULL
                     AND REGEXP_REPLACE(TRIM(x.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                       = REGEXP_REPLACE(TRIM(rt.to_event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                     AND (x.student_id = $3::integer OR REGEXP_REPLACE(TRIM(x.student_name), '\\s+', ' ', 'g') = ANY($1::text[]))
                   LIMIT 1)
                ) AS rescheduled_to_date,
                COALESCE(
                  to_char(mt.start AT TIME ZONE 'Asia/Tokyo', 'HH24:MI'),
                  (SELECT to_char(x.start AT TIME ZONE 'Asia/Tokyo', 'HH24:MI') FROM monthly_schedule x
                   WHERE rt.to_event_id IS NOT NULL
                     AND REGEXP_REPLACE(TRIM(x.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                       = REGEXP_REPLACE(TRIM(rt.to_event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                     AND (x.student_id = $3::integer OR REGEXP_REPLACE(TRIM(x.student_name), '\\s+', ' ', 'g') = ANY($1::text[]))
                   LIMIT 1)
                ) AS rescheduled_to_time,
                COALESCE(
                  mf.event_id,
                  (SELECT y.event_id FROM monthly_schedule y
                   WHERE rf.from_event_id IS NOT NULL
                     AND REGEXP_REPLACE(TRIM(y.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                       = REGEXP_REPLACE(TRIM(rf.from_event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                     AND (y.student_id = $3::integer OR REGEXP_REPLACE(TRIM(y.student_name), '\\s+', ' ', 'g') = ANY($1::text[]))
                   LIMIT 1),
                  rf.from_event_id
                ) AS rescheduled_from_event_id,
                COALESCE(
                  to_char(mf.date, 'YYYY-MM-DD'),
                  (SELECT to_char(y.date, 'YYYY-MM-DD') FROM monthly_schedule y
                   WHERE rf.from_event_id IS NOT NULL
                     AND REGEXP_REPLACE(TRIM(y.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                       = REGEXP_REPLACE(TRIM(rf.from_event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                     AND (y.student_id = $3::integer OR REGEXP_REPLACE(TRIM(y.student_name), '\\s+', ' ', 'g') = ANY($1::text[]))
                   LIMIT 1)
                ) AS rescheduled_from_date,
                COALESCE(
                  to_char(mf.start AT TIME ZONE 'Asia/Tokyo', 'HH24:MI'),
                  (SELECT to_char(y.start AT TIME ZONE 'Asia/Tokyo', 'HH24:MI') FROM monthly_schedule y
                   WHERE rf.from_event_id IS NOT NULL
                     AND REGEXP_REPLACE(TRIM(y.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                       = REGEXP_REPLACE(TRIM(rf.from_event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                     AND (y.student_id = $3::integer OR REGEXP_REPLACE(TRIM(y.student_name), '\\s+', ' ', 'g') = ANY($1::text[]))
                   LIMIT 1)
                ) AS rescheduled_from_time,
                (SELECT COUNT(*) FROM monthly_schedule m2 WHERE m2.event_id = m.event_id AND to_char(m2.date, 'YYYY-MM') = $2) AS student_count
         FROM monthly_schedule m
         INNER JOIN students canst ON canst.id = $3::integer
         LEFT JOIN reschedules rt ON REGEXP_REPLACE(TRIM(rt.from_event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                                   = REGEXP_REPLACE(TRIM(m.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
           AND (
             REGEXP_REPLACE(TRIM(rt.from_student_name), '\\s+', ' ', 'g') = REGEXP_REPLACE(TRIM(canst.name), '\\s+', ' ', 'g')
             OR REGEXP_REPLACE(TRIM(rt.from_student_name), '\\s+', ' ', 'g') = ANY($1::text[])
           )
         LEFT JOIN monthly_schedule mt ON REGEXP_REPLACE(TRIM(mt.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                                       = REGEXP_REPLACE(TRIM(rt.to_event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
           AND (
             mt.student_id = $3::integer
             OR REGEXP_REPLACE(TRIM(mt.student_name), '\\s+', ' ', 'g') = REGEXP_REPLACE(TRIM(canst.name), '\\s+', ' ', 'g')
             OR REGEXP_REPLACE(TRIM(mt.student_name), '\\s+', ' ', 'g') = ANY($1::text[])
           )
         LEFT JOIN reschedules rf ON REGEXP_REPLACE(TRIM(rf.to_event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                                   = REGEXP_REPLACE(TRIM(m.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
           AND (
             REGEXP_REPLACE(TRIM(rf.to_student_name), '\\s+', ' ', 'g') = REGEXP_REPLACE(TRIM(canst.name), '\\s+', ' ', 'g')
             OR REGEXP_REPLACE(TRIM(rf.to_student_name), '\\s+', ' ', 'g') = ANY($1::text[])
           )
         LEFT JOIN monthly_schedule mf ON REGEXP_REPLACE(TRIM(mf.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
                                       = REGEXP_REPLACE(TRIM(rf.from_event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '')
           AND (
             mf.student_id = $3::integer
             OR REGEXP_REPLACE(TRIM(mf.student_name), '\\s+', ' ', 'g') = REGEXP_REPLACE(TRIM(canst.name), '\\s+', ' ', 'g')
             OR REGEXP_REPLACE(TRIM(mf.student_name), '\\s+', ' ', 'g') = ANY($1::text[])
           )
         WHERE (m.student_id = $3::integer OR REGEXP_REPLACE(TRIM(m.student_name), '\\s+', ' ', 'g') = ANY($1::text[]))
         AND m.date IS NOT NULL
         AND to_char(m.date, 'YYYY-MM') = $2
         ORDER BY m.start ASC`,
        [normalizedVariants, yyyyMm, studentIdForJoin]
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
          lessonUUID: r.lesson_uuid || null,
          hasNote: !!r.has_lesson_note,
          awaitingRescheduleDate: !!r.awaiting_reschedule_date,
          calendarSyncStatus: (r.calendar_sync_status || 'synced').toLowerCase(),
          calendarSyncError: r.calendar_sync_error || null,
          isGroup: (r.student_count || 0) > 1,
          lessonKind: r.lesson_kind || 'regular',
          rescheduledTo: (() => {
            const id = r.rescheduled_to_event_id || null;
            const date = r.rescheduled_to_date || snapDateToYmd(r.reschedule_snapshot_to_date) || null;
            const time = r.rescheduled_to_time || r.reschedule_snapshot_to_time || null;
            if (!id && !date && !time) return null;
            return { eventID: id, date, time };
          })(),
          rescheduledFrom: (() => {
            const id = r.rescheduled_from_event_id || null;
            const date = r.rescheduled_from_date || snapDateToYmd(r.reschedule_snapshot_from_date) || null;
            const time = r.rescheduled_from_time || r.reschedule_snapshot_from_time || null;
            if (!id && !date && !time) return null;
            return { eventID: id, date, time };
          })(),
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
app.use('/api/messages', messagesRouter);

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

/** Admin: browse monthly_schedule rows with filters. */
app.get('/api/admin/monthly-schedule', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rawStudentId = String(req.query?.studentId ?? '').trim();
    const rawSyncStatus = String(req.query?.syncStatus ?? '').trim().toLowerCase();
    const rawStatus = String(req.query?.status ?? '').trim().toLowerCase();
    const rawQ = String(req.query?.q ?? '').trim();
    const limit = Math.max(1, Math.min(500, parseInt(String(req.query?.limit ?? '100'), 10) || 100));
    const offset = Math.max(0, parseInt(String(req.query?.offset ?? '0'), 10) || 0);
    const studentId = rawStudentId === '' ? null : Number(rawStudentId);
    if (rawStudentId !== '' && !Number.isFinite(studentId)) {
      return res.status(400).json({ error: 'studentId must be a number when provided' });
    }

    const filterSql = `
      FROM monthly_schedule ms
      WHERE ($1::integer IS NULL OR ms.student_id = $1::integer)
        AND ($2::text = '' OR LOWER(COALESCE(ms.calendar_sync_status, '')) = $2::text)
        AND ($3::text = '' OR LOWER(COALESCE(ms.status, '')) = $3::text)
        AND (
          $4::text = ''
          OR ms.event_id ILIKE '%' || $4::text || '%'
          OR COALESCE(ms.student_name, '') ILIKE '%' || $4::text || '%'
          OR COALESCE(ms.title, '') ILIKE '%' || $4::text || '%'
        )
    `;

    const params = [studentId, rawSyncStatus, rawStatus, rawQ];
    const totalResult = await query(`SELECT COUNT(*)::integer AS total ${filterSql}`, params);
    const rowsResult = await query(
      `SELECT ms.event_id, ms.student_name, ms.student_id, ms.title, ms.date, ms.start, ms.status,
              ms.calendar_sync_status, ms.calendar_sync_error, ms.awaiting_reschedule_date
       ${filterSql}
       ORDER BY ms.date DESC NULLS LAST, ms.start DESC NULLS LAST, ms.student_name ASC, ms.event_id ASC
       LIMIT $5 OFFSET $6`,
      [...params, limit, offset]
    );

    res.json({
      items: rowsResult.rows || [],
      total: totalResult.rows[0]?.total || 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[admin/monthly-schedule:list]', err.message);
    res.status(500).json({ error: err.message || 'Failed to load monthly schedule rows' });
  }
});

/** Admin: delete one monthly_schedule row and related reschedule links. */
app.delete('/api/admin/monthly-schedule/:eventId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const eventId = decodeURIComponent(String(req.params?.eventId || '').trim());
    const studentName = String(req.query?.studentName || '').trim();
    if (!eventId) return res.status(400).json({ error: 'eventId is required' });
    if (!studentName) return res.status(400).json({ error: 'studentName is required' });

    const deleted = await query(
      `DELETE FROM monthly_schedule
       WHERE event_id = $1 AND student_name = $2
       RETURNING event_id, student_name`,
      [eventId, studentName]
    );
    if ((deleted.rows || []).length === 0) {
      return res.status(404).json({ error: 'monthly_schedule row not found' });
    }

    await query(
      `DELETE FROM reschedules
       WHERE (from_event_id = $1 AND from_student_name = $2)
          OR (to_event_id = $1 AND to_student_name = $2)`,
      [eventId, studentName]
    );

    res.json({
      ok: true,
      event_id: deleted.rows[0].event_id,
      student_name: deleted.rows[0].student_name,
    });
  } catch (err) {
    console.error('[admin/monthly-schedule:delete]', err.message);
    res.status(500).json({ error: err.message || 'Failed to delete monthly schedule row' });
  }
});

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

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

  const result = await bulkSyncCalendarsFromGasForStaffType('english_teacher', range);

  lastTeacherScheduleAutoFetchAtByMonth.set(yyyyMm, Date.now());
  return {
    ok: true,
    yyyyMm,
    staffProcessed: result.staffProcessed,
    eventsStored: result.eventsStored,
    errors: result.errors,
  };
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
    const result = await bulkSyncCalendarsFromGasForStaffType('english_teacher');
    res.json({
      ok: true,
      staffProcessed: result.staffProcessed,
      eventsStored: result.eventsStored,
      errors: result.errors,
    });
  } catch (err) {
    console.error('[admin/fetch-staff-schedule]', err.message);
    const msg = err.message || 'Failed to fetch schedules';
    if (/STAFF_SCHEDULE|CALENDAR_POLL/i.test(msg)) {
      return res.status(400).json({
        error:
          'Set STAFF_SCHEDULE_GAS_URL and STAFF_SCHEDULE_API_KEY in .env (or CALENDAR_POLL_*). Use STAFF_SCHEDULE_* for calendar fetch by calendarId.',
      });
    }
    res.status(500).json({ error: msg });
  }
});

/** Admin: fetch Japanese staff (and legacy untyped) schedules from GAS; same GAS + teacher_schedules storage as teachers. */
app.post('/api/admin/fetch-japanese-staff-schedule', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await bulkSyncCalendarsFromGasForStaffType('japanese_staff');
    res.json({
      ok: true,
      staffProcessed: result.staffProcessed,
      eventsStored: result.eventsStored,
      errors: result.errors,
    });
  } catch (err) {
    console.error('[admin/fetch-japanese-staff-schedule]', err.message);
    const msg = err.message || 'Failed to fetch schedules';
    if (/STAFF_SCHEDULE|CALENDAR_POLL/i.test(msg)) {
      return res.status(400).json({
        error:
          'Set STAFF_SCHEDULE_GAS_URL and STAFF_SCHEDULE_API_KEY in .env (or CALENDAR_POLL_*). Use STAFF_SCHEDULE_* for calendar fetch by calendarId.',
      });
    }
    res.status(500).json({ error: msg });
  }
});

/** Admin: fetch one staff member's schedule from GAS and store in teacher_schedules. */
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

    const staffResult = await query('SELECT id, name, calendar_id FROM staff WHERE id = $1', [staffId]);
    const staff = staffResult.rows[0];
    if (!staff) return res.status(404).json({ error: 'Staff not found' });

    const calendarId = String(staff.calendar_id || '').trim();
    if (!calendarId) {
      return res.status(400).json({
        error: 'Staff has no calendar ID set. Add a calendar ID and save, then fetch schedule.',
      });
    }

    const teacherName = staff.name;
    const { timeMinISO, timeMaxISO, rangeStart, rangeEnd } = getCurrentAndNextMonthJapanRange();

    const result = await syncOneStaffCalendarFromGas({
      teacherName,
      calendarId,
      url,
      key,
      timeMinISO,
      timeMaxISO,
      rangeStart,
      rangeEnd,
      logFirstEvent: true,
    });

    if (!result.ok) {
      return res.status(400).json({ error: result.error || 'Failed to fetch schedule' });
    }

    res.json({
      ok: true,
      staffId,
      teacherName,
      eventsStored: result.eventsStored,
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
    const { upserted, months, deletedOrphans } = await upsertMonthlySchedule(data, {
      removed: removed || [],
      // Incremental polls must be treated as deltas; never reconcile by "missing from this payload"
      // because incremental payloads may omit rows that were not changed in this poll.
      reconcile: false,
    });

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
    let fetchRes;
    try {
      fetchRes = await fetch(gasUrl);
    } catch (err) {
      const detail = formatFetchError(err);
      throw new Error(`Failed to reach Calendar GAS: ${detail}`);
    }
    const json = await fetchRes.json().catch(() => ({}));
    if (!fetchRes.ok) {
      const msg = json?.error || `GAS responded with ${fetchRes.status}`;
      return res.status(502).json({ error: msg });
    }
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
    const detail = formatFetchError(err);
    console.error('[calendar-poll/backfill] error:', detail);
    res.status(500).json({ error: detail });
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
