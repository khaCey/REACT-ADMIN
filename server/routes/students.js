import { Router } from 'express';
import { query } from '../db/index.js';
import { logChange } from '../lib/changeLog.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM students ORDER BY id'
    );
    const students = result.rows.map((r) => ({
      ID: r.id,
      Name: r.name,
      漢字: r.name_kanji,
      Email: r.email,
      Phone: r.phone,
      phone: r.phone_secondary,
      当日: r.same_day_cancel,
      Status: r.status,
      Payment: r.payment,
      Group: r.group_type,
      人数: r.group_size,
      子: r.is_child ? '子' : '',
    }));
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM students WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const r = result.rows[0];
    res.json({
      ID: r.id,
      Name: r.name,
      漢字: r.name_kanji,
      Email: r.email,
      Phone: r.phone,
      phone: r.phone_secondary,
      当日: r.same_day_cancel,
      Status: r.status,
      Payment: r.payment,
      Group: r.group_type,
      人数: r.group_size,
      子: r.is_child ? '子' : '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body;
    const result = await query(
      `INSERT INTO students (name, name_kanji, email, phone, phone_secondary, same_day_cancel, status, payment, group_type, group_size, is_child)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        body.Name || body.name || '',
        body.漢字 || body.name_kanji || '',
        body.Email || body.email || '',
        body.Phone || body.phone || '',
        body.phone || body.phone_secondary || '',
        body.当日 || body.same_day_cancel || '',
        body.Status || body.status || 'Active',
        body.Payment || body.payment || 'NEO',
        body.Group || body.group_type || 'Single',
        body.人数 ?? body.group_size ?? null,
        body.子 === '子' || body.is_child === true,
      ]
    );
    const newRow = result.rows[0];
    await logChange(
      { entityType: 'students', entityKey: String(newRow.id), action: 'create', oldData: null, newData: newRow },
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
    const oldResult = await query('SELECT * FROM students WHERE id = $1', [id]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const oldRow = oldResult.rows[0];
    let isChildParam = undefined;
    if (typeof body.is_child === 'boolean') isChildParam = body.is_child;
    else if (body.子 === '子') isChildParam = true;
    else if (body.子 === '') isChildParam = false;
    await query(
      `UPDATE students SET
        name = COALESCE($2, name),
        name_kanji = COALESCE($3, name_kanji),
        email = COALESCE($4, email),
        phone = COALESCE($5, phone),
        phone_secondary = COALESCE($6, phone_secondary),
        same_day_cancel = COALESCE($7, same_day_cancel),
        status = COALESCE($8, status),
        payment = COALESCE($9, payment),
        group_type = COALESCE($10, group_type),
        group_size = COALESCE($11, group_size),
        is_child = COALESCE($12, is_child),
        updated_at = NOW()
       WHERE id = $1`,
      [
        id,
        body.Name ?? body.name,
        body.漢字 ?? body.name_kanji,
        body.Email ?? body.email,
        body.Phone ?? body.phone,
        body.phone ?? body.phone_secondary,
        body.当日 ?? body.same_day_cancel,
        body.Status ?? body.status,
        body.Payment ?? body.payment,
        body.Group ?? body.group_type,
        body.人数 ?? body.group_size,
        isChildParam,
      ]
    );
    const newResult = await query('SELECT * FROM students WHERE id = $1', [id]);
    const newRow = newResult.rows[0] || oldRow;
    await logChange(
      { entityType: 'students', entityKey: String(id), action: 'update', oldData: oldRow, newData: newRow },
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
    const oldResult = await query('SELECT * FROM students WHERE id = $1', [id]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const oldRow = oldResult.rows[0];
    await query('DELETE FROM students WHERE id = $1', [id]);
    await logChange(
      { entityType: 'students', entityKey: String(id), action: 'delete', oldData: oldRow, newData: null },
      req
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
