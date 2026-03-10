/**
 * Auth routes: login (shift start), logout (shift end), me, staff list, add staff
 */
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query } from '../db/index.js';
import { requireAuth, requireAdminOrOperator } from '../middleware/auth.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'student-admin-secret-change-in-production';
const DEFAULT_STAFF_PASSWORD = 'staff123';

/** GET /api/auth/staff-list - staff names for login dropdown (no auth required) */
router.get('/staff-list', async (req, res) => {
  try {
    const result = await query('SELECT id, name FROM staff ORDER BY name ASC');
    res.json({ staff: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/auth/staff - add new staff (admin or operator only) */
router.post('/staff', requireAuth, requireAdminOrOperator, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '').trim() || DEFAULT_STAFF_PASSWORD;
    if (!name) {
      return res.status(400).json({ error: 'Name required' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO staff (name, password_hash, is_admin, is_operator, staff_type, active)
       VALUES ($1, $2, FALSE, FALSE, 'japanese_staff', TRUE)
       ON CONFLICT (name) DO NOTHING
       RETURNING id, name`,
      [name, hash]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Staff with this name already exists' });
    }
    res.status(201).json({ staff: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Staff with this name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) {
      return res.status(400).json({ error: 'Name required' });
    }
    const result = await query(
      'SELECT id, name, is_admin, is_operator FROM staff WHERE name = $1',
      [String(name).trim()]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid staff' });
    }
    const staff = result.rows[0];
    await query(
      'INSERT INTO staff_shifts (staff_id, started_at) VALUES ($1, NOW())',
      [staff.id]
    );
    const token = jwt.sign(
      { id: staff.id, name: staff.name, is_admin: !!staff.is_admin, is_operator: !!staff.is_operator },
      JWT_SECRET
    );
    res.json({ token, staff: { id: staff.id, name: staff.name, is_admin: !!staff.is_admin, is_operator: !!staff.is_operator } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  try {
    const staffId = req.staff.id;
    await query(
      `UPDATE staff_shifts SET ended_at = NOW()
       WHERE id = (
         SELECT id FROM staff_shifts
         WHERE staff_id = $1 AND ended_at IS NULL
         ORDER BY started_at DESC
         LIMIT 1
       )`,
      [staffId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/auth/shifts - recent staff shift log (for sidebar). Requires auth. */
router.get('/shifts', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT s.id, s.staff_id, st.name AS staff_name, s.started_at, s.ended_at
       FROM staff_shifts s
       JOIN staff st ON st.id = s.staff_id
       ORDER BY s.started_at DESC
       LIMIT 50`
    );
    res.json({ shifts: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const payload = jwt.verify(token, JWT_SECRET);
    const result = await query('SELECT id, name, is_admin, is_operator FROM staff WHERE id = $1', [payload.id]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Staff not found' });
    }
    const row = result.rows[0];
    res.json({
      staff: {
        id: row.id,
        name: row.name,
        is_admin: !!row.is_admin,
        is_operator: !!row.is_operator,
      },
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
