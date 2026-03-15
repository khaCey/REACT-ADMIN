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
import { query } from './db/index.js';
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

    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const thisYyyyMm = `${thisMonth.getFullYear()}-${String(thisMonth.getMonth() + 1).padStart(2, '0')}`;
    const nextYyyyMm = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;

    const paymentsResult = await query(
      'SELECT month, date, year, amount FROM payments WHERE student_id = $1 ORDER BY month',
      [Number(id) || id]
    );
    const paidMonths = new Set();
    const paidLessonsByMonth = {};
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
        const year = match ? match[1] : String(p.year || now.getFullYear());
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
        paidLessonsByMonth[yyyyMm] = Math.max(paidLessonsByMonth[yyyyMm] || 0, amt);
      }
    }

    const allYyyyMm = [thisYyyyMm, nextYyyyMm];

    const latestByMonth = {};

    const normalizeName = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const normalizedVariants = nameVariants.map(normalizeName).filter(Boolean);

    for (const yyyyMm of allYyyyMm) {
      const scheduleResult = await query(
        `SELECT m.event_id, to_char(m.date, 'YYYY-MM-DD') as date, m.start, m.status, m.lesson_kind,
                (SELECT COUNT(*) FROM monthly_schedule m2 WHERE m2.event_id = m.event_id AND to_char(m2.date, 'YYYY-MM') = $2) AS student_count
         FROM monthly_schedule m
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
          isGroup: (r.student_count || 0) > 1,
          lessonKind: r.lesson_kind || 'regular',
        };
      });

      const isPaid = paidMonths.has(yyyyMm);
      const paidLessons = paidLessonsByMonth[yyyyMm] || 0;
      const scheduledCount = lessons.filter((l) => l.status !== 'unscheduled').length;
      const missingCount = Math.max(0, paidLessons - scheduledCount);
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
      const currentYear = now.getFullYear();
      const monthLabel = parseInt(y, 10) !== currentYear
        ? `${MONTH_NAMES[parseInt(mo, 10) - 1]} ${y}`
        : MONTH_NAMES[parseInt(mo, 10) - 1];
      latestByMonth[yyyyMm] = {
        Payment: isPaid ? '済' : '未',
        lessons,
        missingCount,
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

app.get('/api/schedule/week', async (req, res) => {
  try {
    const weekStart = req.query.week_start;
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({ error: 'Query week_start required (YYYY-MM-DD)' });
    }
    const [scheduleResult, teachersResult] = await Promise.all([
      query(
        `SELECT date, start, status FROM monthly_schedule
         WHERE date >= $1::date AND date < $1::date + interval '7 days'
         AND (status IS NULL OR status <> 'cancelled')
         ORDER BY date, start`,
        [weekStart]
      ),
      query(
        `SELECT date, teacher_name, start_time, end_time FROM teacher_schedules
         WHERE date >= $1::date AND date < $1::date + interval '7 days'
         ORDER BY date, teacher_name, start_time`,
        [weekStart]
      ),
    ]);
    const bySlot = {};
    const toDateStr = (val) => {
      if (!val) return '';
      if (val instanceof Date) {
        return `${val.getFullYear()}-${String(val.getMonth() + 1).padStart(2, '0')}-${String(val.getDate()).padStart(2, '0')}`;
      }
      const s = String(val).trim();
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
    };
    for (const r of scheduleResult.rows) {
      const dateStr = toDateStr(r.date);
      const s = r.start ? new Date(r.start) : null;
      const timeStr = s && !isNaN(s.getTime())
        ? `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`
        : '';
      if (!dateStr || !timeStr) continue;
      const key = `${dateStr}T${timeStr}`;
      bySlot[key] = (bySlot[key] || 0) + 1;
    }
    const teachersBySlot = {};
    const TIME_SLOTS = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
    for (const r of teachersResult.rows) {
      const dateStr = toDateStr(r.date);
      if (!dateStr) continue;
      const startT = r.start_time ? String(r.start_time).slice(0, 5) : '';
      const endT = r.end_time ? String(r.end_time).slice(0, 5) : '';
      if (!startT || !endT) continue;
      for (const timeStr of TIME_SLOTS) {
        if (timeStr >= startT && timeStr < endT) {
          const key = `${dateStr}T${timeStr}`;
          if (!teachersBySlot[key]) teachersBySlot[key] = [];
          teachersBySlot[key].push(r.teacher_name);
        }
      }
    }
    for (const k of Object.keys(teachersBySlot)) {
      teachersBySlot[k] = [...new Set(teachersBySlot[k])].sort();
    }
    if (teachersResult.rows.length > 0) {
      console.log(`[schedule/week] ${teachersResult.rows.length} teacher rows → ${Object.keys(teachersBySlot).length} slots with teachers`);
    }
    res.set('Cache-Control', 'no-store');
    res.json({ slots: bySlot, teachersBySlot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

/** Parse ISO dateTime to Asia/Tokyo date (YYYY-MM-DD) and time (HH:MM). */
function isoToTokyoDateAndTime(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
  const timeStr = `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
  return { date: dateStr, time: timeStr };
}

/** Normalize GAS response to an array of events (raw array or { events } or { items }). */
function normaliseGasEvents(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.events)) return json.events;
  if (json && Array.isArray(json.items)) return json.items;
  return [];
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

    const now = new Date();
    const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const timeMax = new Date(timeMin.getTime() + 31 * 24 * 60 * 60 * 1000);
    const timeMinISO = timeMin.toISOString();
    const timeMaxISO = timeMax.toISOString();
    const rangeStart = timeMinISO.slice(0, 10);
    const rangeEnd = timeMaxISO.slice(0, 10);

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
      for (const ev of events) {
        const start = ev.start?.dateTime || ev.start;
        const end = ev.end?.dateTime || ev.end;
        if (!start || !end) continue;
        const startParsed = isoToTokyoDateAndTime(typeof start === 'string' ? start : start.dateTime);
        const endParsed = isoToTokyoDateAndTime(typeof end === 'string' ? end : end.dateTime);
        if (!startParsed || !endParsed) continue;
        rows.push({
          date: startParsed.date,
          start_time: startParsed.time,
          end_time: endParsed.time,
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
    const now = new Date();
    const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const timeMax = new Date(timeMin.getTime() + 31 * 24 * 60 * 60 * 1000);
    const timeMinISO = timeMin.toISOString();
    const timeMaxISO = timeMax.toISOString();
    const rangeStart = timeMinISO.slice(0, 10);
    const rangeEnd = timeMaxISO.slice(0, 10);

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
    for (const ev of events) {
      const start = ev.start?.dateTime || ev.start;
      const end = ev.end?.dateTime || ev.end;
      if (!start || !end) continue;
      const startParsed = isoToTokyoDateAndTime(typeof start === 'string' ? start : start.dateTime);
      const endParsed = isoToTokyoDateAndTime(typeof end === 'string' ? end : end.dateTime);
      if (!startParsed || !endParsed) continue;
      rows.push({
        date: startParsed.date,
        start_time: startParsed.time,
        end_time: endParsed.time,
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

/** Sync MonthlySchedule from GAS Calendar Webhook polling into PostgreSQL. Upserts by (event_id, student_name); prior months are preserved. */
app.post('/api/calendar-poll/sync', async (req, res) => {
  try {
    const { data } = req.body || {};
    if (!Array.isArray(data)) {
      return res.status(400).json({ error: 'Body must include { data: MonthlySchedule[] }' });
    }
    console.log('[calendar-poll/sync] received', data.length, 'rows');
    const { upserted, months } = await upsertMonthlySchedule(data);
    console.log('[calendar-poll/sync] upserted', upserted, 'rows for months', months.sort().join(', '));
    res.json({ ok: true, upserted, months });
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
    console.log('[calendar-poll/backfill] upserted', upserted, 'rows for months', months.sort().join(', '));
    res.json({ ok: true, upserted, months, fetched: data.length, backfill: json.backfill });
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
    res.json({ ok: true, upserted, months, fetched: data.length });
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
