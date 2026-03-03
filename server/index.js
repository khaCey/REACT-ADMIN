import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirnameServer = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirnameServer, '..', '.env'), override: true });

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
import notificationsRouter from './routes/notifications.js';
import { requireAuth } from './middleware/auth.js';

const app = express();
const PORT = process.env.API_PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.originalUrl === '/api/health') return next();
  return requireAuth(req, res, next);
});

app.get('/', (req, res) => {
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

    for (const yyyyMm of allYyyyMm) {
      const scheduleResult = await query(
        `SELECT m.event_id, to_char(m.date, 'YYYY-MM-DD') as date, m.start, m.status,
                (SELECT COUNT(*) FROM monthly_schedule m2 WHERE m2.event_id = m.event_id AND to_char(m2.date, 'YYYY-MM') = $2) AS student_count
         FROM monthly_schedule m
         WHERE m.student_name = $1 AND m.date IS NOT NULL
         AND to_char(m.date, 'YYYY-MM') = $2
         ORDER BY m.start ASC`,
        [studentName, yyyyMm]
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

/** Sync MonthlySchedule from GAS Calendar Webhook polling into PostgreSQL. */
app.post('/api/calendar-poll/sync', async (req, res) => {
  try {
    const { data } = req.body || {};
    if (!Array.isArray(data)) {
      return res.status(400).json({ error: 'Body must include { data: MonthlySchedule[] }' });
    }
    console.log('[calendar-poll/sync] received', data.length, 'rows');

    const months = new Set();
    for (const r of data) {
      const d = (r.date || '').toString().trim();
      if (/^\d{4}-\d{2}/.test(d)) months.add(d.slice(0, 7));
    }

    for (const yyyyMm of months) {
      await query(
        "DELETE FROM monthly_schedule WHERE to_char(date, 'YYYY-MM') = $1",
        [yyyyMm]
      );
    }

    let inserted = 0;
    for (const r of data) {
      const eventId = (r.eventID || r.event_id || '').toString().trim();
      const studentName = (r.studentName || r.student_name || '').toString().trim();
      if (!eventId || !studentName) continue;

      const dateStr = (r.date || '').toString().trim();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : null;

      let startTs = null;
      const startVal = r.start || '';
      if (startVal && date) {
        const m = String(startVal).trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/);
        if (m) startTs = `${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}:00`;
        else {
          const d = new Date(startVal);
          if (!isNaN(d.getTime())) startTs = d.toISOString();
        }
      } else if (startVal) {
        const d = new Date(startVal);
        if (!isNaN(d.getTime())) startTs = d.toISOString();
      }

      let endTs = null;
      const endVal = r.end || '';
      if (endVal && date) {
        const m = String(endVal).trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/);
        if (m) endTs = `${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}:00`;
        else {
          const d = new Date(endVal);
          if (!isNaN(d.getTime())) endTs = d.toISOString();
        }
      } else if (endVal) {
        const d = new Date(endVal);
        if (!isNaN(d.getTime())) endTs = d.toISOString();
      }

      const status = (r.status || 'scheduled').toString().trim() || 'scheduled';
      const isKids = (r.isKidsLesson || r.is_kids_lesson || '') === '子' ||
        r.isKidsLesson === true || r.is_kids_lesson === true;
      const title = (r.title || '').toString().trim();
      const teacherName = (r.teacherName || r.teacher_name || '').toString().trim();

      await query(
        `INSERT INTO monthly_schedule (event_id, title, date, start, "end", status, student_name, is_kids_lesson, teacher_name)
         VALUES ($1, $2, $3::date, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9)`,
        [eventId, title, date, startTs, endTs, status, studentName, isKids, teacherName]
      );
      inserted++;
    }

    console.log('[calendar-poll/sync] inserted', inserted, 'rows for months', Array.from(months).sort().join(', '));
    res.json({ ok: true, inserted, months: Array.from(months) });
  } catch (err) {
    console.error('[calendar-poll/sync] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found', path: req.originalUrl });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API running at http://localhost:${PORT} (network: http://0.0.0.0:${PORT})`);
  registerWatch().catch(() => {});
});
