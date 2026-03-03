import { Router } from 'express';
import { query } from '../db/index.js';
import { logChange } from '../lib/changeLog.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { student_id } = req.query;
    let sql = 'SELECT * FROM notes';
    const params = [];
    if (student_id) {
      sql += ' WHERE student_id = $1';
      params.push(student_id);
    }
    sql += ' ORDER BY date DESC';
    const result = await query(sql, params);
    res.json(result.rows.map((r) => ({
      ID: r.id,
      'Student ID': r.student_id,
      Staff: r.staff,
      Date: r.date,
      Note: r.note,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body;
    const result = await query(
      `INSERT INTO notes (student_id, staff, note, date)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()))
       RETURNING *`,
      [
        body['Student ID'] ?? body.student_id,
        body.Staff ?? body.staff ?? '',
        body.Note ?? body.note ?? '',
        body.Date ?? body.date ?? null,
      ]
    );
    const newRow = result.rows[0];
    await logChange(
      { entityType: 'notes', entityKey: String(newRow.id), action: 'create', oldData: null, newData: newRow },
      req
    );
    res.status(201).json({ id: newRow.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;
    const oldResult = await query('SELECT * FROM notes WHERE id = $1', [id]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }
    const oldRow = oldResult.rows[0];
    await query(
      `UPDATE notes SET staff = COALESCE($2, staff), note = COALESCE($3, note), date = COALESCE($4::timestamptz, date)
       WHERE id = $1`,
      [id, body.Staff ?? body.staff, body.Note ?? body.note, body.Date ?? body.date]
    );
    const newRow = (await query('SELECT * FROM notes WHERE id = $1', [id])).rows[0];
    await logChange(
      { entityType: 'notes', entityKey: String(id), action: 'update', oldData: oldRow, newData: newRow },
      req
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const oldResult = await query('SELECT * FROM notes WHERE id = $1', [id]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }
    const oldRow = oldResult.rows[0];
    await query('DELETE FROM notes WHERE id = $1', [id]);
    await logChange(
      { entityType: 'notes', entityKey: String(id), action: 'delete', oldData: oldRow, newData: null },
      req
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
