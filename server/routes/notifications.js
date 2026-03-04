import { Router } from 'express';
import { query } from '../db/index.js';

const router = Router();

async function isStaffAdmin(staffId) {
  if (!staffId) return false;
  const result = await query('SELECT is_admin FROM staff WHERE id = $1', [staffId]);
  return !!result.rows[0]?.is_admin;
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

router.post('/', async (req, res) => {
  try {
    const staffId = req.staff?.id;
    const title = String(req.body?.title || '').trim();
    const message = String(req.body?.message || '').trim();
    const rawTargetStaffId = req.body?.target_staff_id;
    const hasTargetStaffId = rawTargetStaffId !== undefined && rawTargetStaffId !== null && rawTargetStaffId !== '';
    const targetStaffId = hasTargetStaffId ? Number.parseInt(rawTargetStaffId, 10) : null;

    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });
    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!message) return res.status(400).json({ error: 'Message is required' });
    if (hasTargetStaffId && (!Number.isFinite(targetStaffId) || targetStaffId <= 0)) {
      return res.status(400).json({ error: 'Invalid target staff id' });
    }
    if (targetStaffId !== null) {
      const targetExists = await query('SELECT id FROM staff WHERE id = $1', [targetStaffId]);
      if (targetExists.rows.length === 0) {
        return res.status(400).json({ error: 'Target staff not found' });
      }
    }

    const result = await query(
      `INSERT INTO notifications (title, message, created_by_staff_id, target_staff_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, message, kind, slug, is_system, created_by_staff_id, target_staff_id, created_at`,
      [title, message, staffId, targetStaffId]
    );

    res.status(201).json({ notification: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/unread', async (req, res) => {
  try {
    const staffId = req.staff?.id;
    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });

    const limit = Math.min(100, toPositiveInt(req.query.limit, 20));
    const [itemsResult, countResult] = await Promise.all([
      query(
        `SELECT n.id, n.title, n.message, n.created_at,
                n.kind, n.slug, n.is_system,
                n.created_by_staff_id,
                n.target_staff_id,
                s.name AS created_by_name
         FROM notifications n
         LEFT JOIN staff s ON s.id = n.created_by_staff_id
         LEFT JOIN notification_reads nr
           ON nr.notification_id = n.id
          AND nr.staff_id = $1
         WHERE nr.notification_id IS NULL
           AND COALESCE(n.kind, 'general') <> 'guide'
           AND (n.target_staff_id IS NULL OR n.target_staff_id = $1)
         ORDER BY n.is_system DESC, n.created_at DESC
         LIMIT $2`,
        [staffId, limit]
      ),
      query(
        `SELECT COUNT(*)::int AS unread_count
         FROM notifications n
         LEFT JOIN notification_reads nr
           ON nr.notification_id = n.id
          AND nr.staff_id = $1
         WHERE nr.notification_id IS NULL
           AND COALESCE(n.kind, 'general') <> 'guide'
           AND (n.target_staff_id IS NULL OR n.target_staff_id = $1)`,
        [staffId]
      ),
    ]);

    res.json({
      unreadCount: countResult.rows[0]?.unread_count || 0,
      notifications: itemsResult.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/read', async (req, res) => {
  try {
    const staffId = req.staff?.id;
    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });

    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid notification id' });

    const exists = await query('SELECT id FROM notifications WHERE id = $1', [id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await query(
      `INSERT INTO notification_reads (notification_id, staff_id)
       VALUES ($1, $2)
       ON CONFLICT (notification_id, staff_id) DO NOTHING`,
      [id, staffId]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/unread', async (req, res) => {
  try {
    const staffId = req.staff?.id;
    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });

    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid notification id' });

    const exists = await query('SELECT id FROM notifications WHERE id = $1', [id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await query(
      `DELETE FROM notification_reads
       WHERE notification_id = $1 AND staff_id = $2`,
      [id, staffId]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/staff', async (req, res) => {
  try {
    const staffId = req.staff?.id;
    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });

    const result = await query(
      `SELECT id, name
       FROM staff
       ORDER BY name ASC`
    );

    res.json({ staff: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const staffId = req.staff?.id;
    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });

    const limit = Math.min(100, toPositiveInt(req.query.limit, 50));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);

    const [itemsResult, totalResult] = await Promise.all([
      query(
        `SELECT n.id, n.title, n.message, n.created_at, n.created_by_staff_id, n.target_staff_id,
                n.kind, n.slug, n.is_system,
                s.name AS created_by_name,
                (nr.notification_id IS NOT NULL) AS is_read,
                nr.read_at
         FROM notifications n
         LEFT JOIN staff s ON s.id = n.created_by_staff_id
         LEFT JOIN notification_reads nr
           ON nr.notification_id = n.id
          AND nr.staff_id = $1
         WHERE (n.target_staff_id IS NULL OR n.target_staff_id = $1)
           AND COALESCE(n.kind, 'general') <> 'guide'
         ORDER BY n.is_system DESC, n.created_at DESC
         LIMIT $2 OFFSET $3`,
        [staffId, limit, offset]
      ),
      query(
        `SELECT COUNT(*)::int AS total
         FROM notifications
         WHERE (target_staff_id IS NULL OR target_staff_id = $1)
           AND COALESCE(kind, 'general') <> 'guide'`,
        [staffId]
      ),
    ]);

    res.json({
      notifications: itemsResult.rows,
      total: totalResult.rows[0]?.total || 0,
      limit,
      offset,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const staffId = req.staff?.id;
    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });
    const admin = await isStaffAdmin(staffId);

    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid notification id' });

    const title = String(req.body?.title || '').trim();
    const message = String(req.body?.message || '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const existing = await query(
      'SELECT id, created_by_staff_id, is_system, kind FROM notifications WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const ownerId = existing.rows[0].created_by_staff_id;
    const isSystemGuide = existing.rows[0].is_system || existing.rows[0].kind === 'guide';
    if (!admin) {
      if (isSystemGuide) {
        return res.status(403).json({ error: 'System guide notifications cannot be edited' });
      }
      if (ownerId !== staffId) {
        return res.status(403).json({ error: 'You can only edit notifications you created' });
      }
    }

    const result = await query(
      `UPDATE notifications
       SET title = $2, message = $3
       WHERE id = $1
       RETURNING id, title, message, kind, slug, is_system, created_by_staff_id, target_staff_id, created_at`,
      [id, title, message]
    );
    res.json({ notification: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const staffId = req.staff?.id;
    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });
    const admin = await isStaffAdmin(staffId);

    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid notification id' });

    const existing = await query(
      'SELECT id, created_by_staff_id, is_system, kind FROM notifications WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const ownerId = existing.rows[0].created_by_staff_id;
    const isSystemGuide = existing.rows[0].is_system || existing.rows[0].kind === 'guide';
    if (!admin && isSystemGuide) {
      return res.status(403).json({ error: 'System guide notifications cannot be deleted' });
    }
    if (!admin && ownerId !== staffId) {
      return res.status(403).json({ error: 'You can only delete notifications you created' });
    }

    await query('DELETE FROM notifications WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
