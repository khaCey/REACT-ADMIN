import { Router } from 'express';
import { query } from '../db/index.js';

const router = Router();

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

    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });
    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const result = await query(
      `INSERT INTO notifications (title, message, created_by_staff_id)
       VALUES ($1, $2, $3)
       RETURNING id, title, message, created_by_staff_id, created_at`,
      [title, message, staffId]
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
                n.created_by_staff_id,
                s.name AS created_by_name
         FROM notifications n
         LEFT JOIN staff s ON s.id = n.created_by_staff_id
         LEFT JOIN notification_reads nr
           ON nr.notification_id = n.id
          AND nr.staff_id = $1
         WHERE nr.notification_id IS NULL
         ORDER BY n.created_at DESC
         LIMIT $2`,
        [staffId, limit]
      ),
      query(
        `SELECT COUNT(*)::int AS unread_count
         FROM notifications n
         LEFT JOIN notification_reads nr
           ON nr.notification_id = n.id
          AND nr.staff_id = $1
         WHERE nr.notification_id IS NULL`,
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

router.get('/', async (req, res) => {
  try {
    const staffId = req.staff?.id;
    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });

    const limit = Math.min(100, toPositiveInt(req.query.limit, 50));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);

    const [itemsResult, totalResult] = await Promise.all([
      query(
        `SELECT n.id, n.title, n.message, n.created_at, n.created_by_staff_id,
                s.name AS created_by_name,
                (nr.notification_id IS NOT NULL) AS is_read,
                nr.read_at
         FROM notifications n
         LEFT JOIN staff s ON s.id = n.created_by_staff_id
         LEFT JOIN notification_reads nr
           ON nr.notification_id = n.id
          AND nr.staff_id = $1
         ORDER BY n.created_at DESC
         LIMIT $2 OFFSET $3`,
        [staffId, limit, offset]
      ),
      query('SELECT COUNT(*)::int AS total FROM notifications'),
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

export default router;
