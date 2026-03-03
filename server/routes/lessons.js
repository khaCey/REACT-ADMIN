import { Router } from 'express';
import { query } from '../db/index.js';
import { logChange } from '../lib/changeLog.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { student_id, month } = req.query;
    let sql = 'SELECT * FROM lessons WHERE 1=1';
    const params = [];
    let i = 1;
    if (student_id) {
      sql += ` AND student_id = $${i++}`;
      params.push(student_id);
    }
    if (month) {
      sql += ` AND month = $${i++}`;
      params.push(month);
    }
    sql += ' ORDER BY month DESC';
    const result = await query(sql, params);
    res.json(result.rows.map((r) => ({
      'Student ID': r.student_id,
      Month: r.month,
      Lessons: r.lessons,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body;
    const studentId = body['Student ID'] ?? body.student_id;
    const month = body.Month ?? body.month;
    const lessonsVal = body.Lessons ?? body.lessons ?? 0;
    const entityKey = `${studentId}_${month}`;

    const oldResult = await query(
      'SELECT * FROM lessons WHERE student_id = $1 AND month = $2',
      [studentId, month]
    );
    const oldRow = oldResult.rows[0] || null;

    await query(
      `INSERT INTO lessons (student_id, month, lessons)
       VALUES ($1, $2, $3)
       ON CONFLICT (student_id, month) DO UPDATE SET lessons = EXCLUDED.lessons`,
      [studentId, month, lessonsVal]
    );
    const newRow = (await query('SELECT * FROM lessons WHERE student_id = $1 AND month = $2', [studentId, month]))
      .rows[0];
    const action = oldRow ? 'update' : 'create';
    await logChange(
      {
        entityType: 'lessons',
        entityKey,
        action,
        oldData: oldRow,
        newData: newRow,
      },
      req
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
