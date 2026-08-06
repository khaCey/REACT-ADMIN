/**
 * Signed Up Tracker — demo lesson events (admin / khacey).
 */
import { Router } from 'express';
import { query } from '../db/index.js';
import { logChange } from '../lib/changeLog.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  upsertDemoLessonEvent,
  importPastDemoLessonsFromSchedule,
  mapDemoLessonEventRow,
} from '../lib/demoLessonEvents.js';

const router = Router();

router.use(requireAuth, requireAdmin);

function addDaysYyyyMmDd(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function mondayOfWeekContaining(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const utcDay = dt.getUTCDay();
  const mondayOffset = utcDay === 0 ? -6 : 1 - utcDay;
  return addDaysYyyyMmDd(dateStr, mondayOffset);
}

router.get('/', async (req, res) => {
  try {
    const year = String(req.query.year || '').trim();
    const month = String(req.query.month || '').trim();
    const weekStart = String(req.query.weekStart || '').trim();

    if (/^\d{4}$/.test(year)) {
      const y = Number(year);
      const start = `${y}-01-01`;
      const end = `${y + 1}-01-01`;
      const [aggResult, yearsResult] = await Promise.all([
        query(
          `SELECT
             COALESCE(NULLIF(TRIM(d.teacher_name), ''), 'Unassigned') AS teacher_name,
             COUNT(*)::int AS demos,
             COUNT(*) FILTER (WHERE d.signed_up)::int AS signed_up
           FROM demo_lesson_events d
           WHERE d.demo_date >= $1::date AND d.demo_date < $2::date
           GROUP BY 1
           ORDER BY demos DESC, signed_up DESC, teacher_name ASC`,
          [start, end]
        ),
        query(
          `SELECT DISTINCT EXTRACT(YEAR FROM demo_date)::int AS y
             FROM demo_lesson_events
            WHERE demo_date IS NOT NULL
            ORDER BY y DESC`
        ),
      ]);
      const teachers = (aggResult.rows || []).map((r) => {
        const demos = Number(r.demos) || 0;
        const signedUp = Number(r.signed_up) || 0;
        const rate = demos > 0 ? Math.round((100 * signedUp) / demos) : 0;
        return {
          teacher_name: r.teacher_name,
          demos,
          signed_up: signedUp,
          rate,
        };
      });
      teachers.sort((a, b) => {
        if (b.demos !== a.demos) return b.demos - a.demos;
        if (b.rate !== a.rate) return b.rate - a.rate;
        return String(a.teacher_name).localeCompare(String(b.teacher_name));
      });
      const total = teachers.reduce((s, t) => s + t.demos, 0);
      const signedUpTotal = teachers.reduce((s, t) => s + t.signed_up, 0);
      const yearsFromData = (yearsResult.rows || [])
        .map((r) => Number(r.y))
        .filter((n) => Number.isFinite(n));
      const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const currentY = jstNow.getUTCFullYear();
      const years = [...new Set([currentY, ...yearsFromData])]
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => b - a)
        .map(String);
      return res.json({
        mode: 'year',
        year: String(y),
        teachers,
        years,
        counts: {
          total,
          signed_up: signedUpTotal,
          not_signed_up: Math.max(0, total - signedUpTotal),
        },
      });
    }

    const params = [];
    let where = 'TRUE';
    if (/^\d{4}-\d{2}$/.test(month)) {
      params.push(`${month}-01`);
      where = `d.demo_date >= $1::date AND d.demo_date < ($1::date + INTERVAL '1 month')`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      const mon = mondayOfWeekContaining(weekStart);
      params.push(mon);
      where = `d.demo_date >= $1::date AND d.demo_date < ($1::date + INTERVAL '7 days')`;
    }

    const result = await query(
      `SELECT d.*, s.name AS student_name, s.name_kanji AS student_kanji, s.status AS student_status
         FROM demo_lesson_events d
         INNER JOIN students s ON s.id = d.student_id
        WHERE ${where}
        ORDER BY d.demo_date DESC, s.name ASC NULLS LAST, d.id DESC`,
      params
    );
    const rows = (result.rows || []).map((r) => mapDemoLessonEventRow(r));
    const signedUp = rows.filter((r) => r.signed_up).length;
    res.json({
      rows,
      counts: {
        total: rows.length,
        signed_up: signedUp,
        not_signed_up: rows.length - signedUp,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/import-past', async (req, res) => {
  try {
    const stats = await importPastDemoLessonsFromSchedule();
    res.json({ ok: true, ...stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const studentId = Number(body.student_id ?? body.studentId);
    const demoDate = String(body.demo_date ?? body.demoDate ?? '').trim().slice(0, 10);
    const teacherName = body.teacher_name ?? body.teacherName ?? null;
    if (!Number.isFinite(studentId) || studentId <= 0) {
      return res.status(400).json({ error: 'student_id is required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(demoDate)) {
      return res.status(400).json({ error: 'demo_date must be YYYY-MM-DD' });
    }
    const student = await query('SELECT id FROM students WHERE id = $1', [studentId]);
    if (student.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const id = await upsertDemoLessonEvent({
      studentId,
      demoDate,
      teacherName,
      sourceEventId: null,
    });
    const row = (
      await query(
        `SELECT d.*, s.name AS student_name, s.name_kanji AS student_kanji, s.status AS student_status
           FROM demo_lesson_events d
           INNER JOIN students s ON s.id = d.student_id
          WHERE d.id = $1`,
        [id]
      )
    ).rows[0];
    await logChange(
      {
        entityType: 'demo_lesson_events',
        entityKey: String(id),
        action: 'create',
        oldData: null,
        newData: row,
      },
      req
    );
    res.status(201).json({ ok: true, event: mapDemoLessonEventRow(row) });
  } catch (err) {
    if (String(err.message || '').includes('duplicate key')) {
      return res.status(409).json({ error: 'A demo event already exists for this student and date' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const oldResult = await query('SELECT * FROM demo_lesson_events WHERE id = $1', [id]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({ error: 'Demo event not found' });
    }
    const oldRow = oldResult.rows[0];
    const body = req.body || {};
    const updates = [];
    const params = [id];
    let idx = 2;

    if (body.signed_up !== undefined || body.signedUp !== undefined) {
      const v = body.signed_up !== undefined ? body.signed_up : body.signedUp;
      updates.push(`signed_up = $${idx}`);
      params.push(!!v);
      idx += 1;
    }
    if (body.teacher_name !== undefined || body.teacherName !== undefined) {
      const raw = body.teacher_name !== undefined ? body.teacher_name : body.teacherName;
      updates.push(`teacher_name = $${idx}`);
      params.push(raw == null || String(raw).trim() === '' ? null : String(raw).trim());
      idx += 1;
    }
    if (body.demo_date !== undefined || body.demoDate !== undefined) {
      const d = String(body.demo_date ?? body.demoDate ?? '').trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return res.status(400).json({ error: 'demo_date must be YYYY-MM-DD' });
      }
      updates.push(`demo_date = $${idx}::date`);
      params.push(d);
      idx += 1;
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    updates.push('updated_at = NOW()');
    await query(`UPDATE demo_lesson_events SET ${updates.join(', ')} WHERE id = $1`, params);

    const newRow = (
      await query(
        `SELECT d.*, s.name AS student_name, s.name_kanji AS student_kanji, s.status AS student_status
           FROM demo_lesson_events d
           INNER JOIN students s ON s.id = d.student_id
          WHERE d.id = $1`,
        [id]
      )
    ).rows[0];
    await logChange(
      {
        entityType: 'demo_lesson_events',
        entityKey: String(id),
        action: 'update',
        oldData: oldRow,
        newData: newRow,
      },
      req
    );
    res.json({ ok: true, event: mapDemoLessonEventRow(newRow) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const oldResult = await query('SELECT * FROM demo_lesson_events WHERE id = $1', [id]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({ error: 'Demo event not found' });
    }
    const oldRow = oldResult.rows[0];
    await query('DELETE FROM demo_lesson_events WHERE id = $1', [id]);
    await logChange(
      {
        entityType: 'demo_lesson_events',
        entityKey: String(id),
        action: 'delete',
        oldData: oldRow,
        newData: null,
      },
      req
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
