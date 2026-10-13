/**
 * Staff management routes: list (admin/operator), update, delete (admin only for delete)
 */
import { Router } from 'express';
import { pool, query } from '../db/index.js';
import { requireAuth, requireAdmin, requireAdminOrOperator } from '../middleware/auth.js';

const router = Router();

/** GET /api/staff - full staff list for Staff page (admin or operator only) */
router.get('/', requireAuth, requireAdminOrOperator, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, name, is_admin, is_operator, calendar_id, staff_type, active, calendar_color_id FROM staff ORDER BY name ASC'
    );
    res.json({
      staff: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        is_admin: !!r.is_admin,
        is_operator: !!r.is_operator,
        calendar_id: r.calendar_id ?? '',
        staff_type: r.staff_type ?? 'japanese_staff',
        active: r.active !== false,
        calendar_color_id: r.calendar_color_id != null && String(r.calendar_color_id).trim() !== '' ? String(r.calendar_color_id).trim() : '',
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/staff/:id - update calendar_id; is_operator only if requester is admin */
router.patch('/:id', requireAuth, requireAdminOrOperator, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid staff id' });
    }
    const { calendar_id, is_operator, is_admin, staff_type, active, calendar_color_id } = req.body || {};
    const isAdmin = !!req.staff.is_admin || String(req.staff.name || '').trim().toLowerCase() === 'khacey';

    const updates = [];
    const values = [];
    let idx = 1;

    if (calendar_id !== undefined) {
      updates.push(`calendar_id = $${idx}`);
      values.push(typeof calendar_id === 'string' ? calendar_id.trim() || null : null);
      idx++;
    }

    if (is_admin !== undefined && isAdmin) {
      updates.push(`is_admin = $${idx}`);
      values.push(!!is_admin);
      idx++;
    }

    if (is_operator !== undefined && isAdmin) {
      updates.push(`is_operator = $${idx}`);
      values.push(!!is_operator);
      idx++;
    }

    const validStaffTypes = ['japanese_staff', 'english_teacher'];
    if (staff_type !== undefined && validStaffTypes.includes(staff_type)) {
      updates.push(`staff_type = $${idx}`);
      values.push(staff_type);
      idx++;
    }

    if (active !== undefined) {
      updates.push(`active = $${idx}`);
      values.push(!!active);
      idx++;
    }

    if (calendar_color_id !== undefined) {
      const raw = calendar_color_id == null ? '' : String(calendar_color_id).trim();
      let normalizedColor = null;
      if (raw !== '') {
        if (/^([1-9]|10|11)$/.test(raw)) {
          normalizedColor = raw;
        } else if (/^#[0-9A-Fa-f]{6}$/.test(raw)) {
          normalizedColor = `#${raw.slice(1).toLowerCase()}`;
        } else {
          return res.status(400).json({
            error: 'calendar_color_id must be empty, a Google Calendar color id (1–11), or #RRGGBB hex',
          });
        }
      }
      updates.push(`calendar_color_id = $${idx}`);
      values.push(normalizedColor);
      idx++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(id);
    const result = await query(
      `UPDATE staff SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, name, is_admin, is_operator, calendar_id, staff_type, active, calendar_color_id`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Staff not found' });
    }
    const r = result.rows[0];
    res.json({
      staff: {
        id: r.id,
        name: r.name,
        is_admin: !!r.is_admin,
        is_operator: !!r.is_operator,
        calendar_id: r.calendar_id ?? '',
        staff_type: r.staff_type ?? 'japanese_staff',
        active: r.active !== false,
        calendar_color_id:
          r.calendar_color_id != null && String(r.calendar_color_id).trim() !== ''
            ? String(r.calendar_color_id).trim()
            : '',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/staff/:id - deactivate staff without destroying historical records (admin only). */
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid staff id' });
  }
  if (id === req.staff.id) {
    return res.status(403).json({ error: 'You cannot delete your own account' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT id, name, active FROM staff WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Staff not found' });
    }
    const staff = existing.rows[0];
    if (String(staff.name || '').trim().toLowerCase() === 'khacey') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'The owner account cannot be deleted' });
    }
    if (staff.active === false) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Staff account is already inactive' });
    }

    // Keep historical lessons, conversations, notifications, shifts and audit records.
    // Both fresh logins and authenticated requests are blocked for inactive staff.
    await client.query('UPDATE staff SET active = FALSE WHERE id = $1', [id]);
    await client.query(
      'UPDATE staff_shifts SET ended_at = NOW() WHERE staff_id = $1 AND ended_at IS NULL',
      [id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, staff: { id: staff.id, name: staff.name, active: false } });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ }
    }
    res.status(500).json({ error: err.message });
  } finally {
    client?.release();
  }
});

export default router;
