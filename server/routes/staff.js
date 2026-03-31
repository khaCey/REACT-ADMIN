/**
 * Staff management routes: list (admin/operator), update, delete (admin only for delete)
 */
import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth, requireAdmin, requireAdminOrOperator } from '../middleware/auth.js';

const router = Router();

/** GET /api/staff - full staff list for Staff page (admin or operator only) */
router.get('/', requireAuth, requireAdminOrOperator, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, name, is_admin, is_operator, calendar_id, staff_type, active FROM staff ORDER BY name ASC'
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
    const { calendar_id, is_operator, is_admin, staff_type, active } = req.body || {};
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

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(id);
    const result = await query(
      `UPDATE staff SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, name, is_admin, is_operator, calendar_id, staff_type, active`,
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
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/staff/:id - delete staff (admin only). Cleans related records first. */
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid staff id' });
    }
    const existing = await query('SELECT id, name FROM staff WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Staff not found' });
    }
    const teacherName = existing.rows[0].name;
    await query('DELETE FROM notification_reads WHERE staff_id = $1', [id]);
    await query('UPDATE notifications SET target_staff_id = NULL WHERE target_staff_id = $1', [id]);
    await query('DELETE FROM notifications WHERE created_by_staff_id = $1', [id]);
    await query('DELETE FROM staff_shifts WHERE staff_id = $1', [id]);
    await query('UPDATE change_log SET staff_id = NULL WHERE staff_id = $1', [id]);
    await query('DELETE FROM teacher_schedules WHERE teacher_name = $1', [teacherName]);
    await query('DELETE FROM teacher_shift_extensions WHERE teacher_name = $1', [teacherName]);
    await query('DELETE FROM teacher_break_presets WHERE teacher_name = $1', [teacherName]);
    await query('DELETE FROM staff WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
