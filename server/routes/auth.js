/**
 * Auth routes: login (shift start), logout (shift end), me
 */
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'student-admin-secret-change-in-production';

router.post('/login', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) {
      return res.status(400).json({ error: 'Name required' });
    }
    const result = await query(
      'SELECT id, name FROM staff WHERE name = $1',
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
      { id: staff.id, name: staff.name },
      JWT_SECRET
    );
    res.json({ token, staff: { id: staff.id, name: staff.name } });
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
    const result = await query('SELECT id, name FROM staff WHERE id = $1', [payload.id]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Staff not found' });
    }
    res.json({ staff: { id: result.rows[0].id, name: result.rows[0].name } });
  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
