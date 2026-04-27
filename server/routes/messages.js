import { Router } from 'express';
import { pool, query } from '../db/index.js';

const router = Router();

function toPositiveInt(value, fallback, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, parsed);
}

async function ensureParticipant(conversationId, staffId, db = query) {
  const result = await db(
    `SELECT 1
       FROM message_conversation_participants
      WHERE conversation_id = $1::uuid
        AND staff_id = $2
        AND left_at IS NULL
      LIMIT 1`,
    [conversationId, staffId]
  );
  return result.rows.length > 0;
}

router.get('/staff', async (req, res) => {
  try {
    const staffId = req.staff?.id;
    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });
    const result = await query(
      `SELECT id, name
         FROM staff
        WHERE active = TRUE
        ORDER BY name ASC`
    );
    res.json({ staff: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/conversations', async (req, res) => {
  let client;
  try {
    const staffId = req.staff?.id;
    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });

    const subject = String(req.body?.subject || '').trim();
    const body = String(req.body?.message || req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Message body is required' });

    const rawParticipantIds = Array.isArray(req.body?.participant_ids) ? req.body.participant_ids : [];
    const participantIds = [
      ...new Set(
        rawParticipantIds
          .map((id) => Number.parseInt(id, 10))
          .filter((id) => Number.isFinite(id) && id > 0)
      ),
    ];
    if (!participantIds.includes(staffId)) participantIds.push(staffId);
    if (participantIds.length < 2) {
      return res.status(400).json({ error: 'At least one other participant is required' });
    }

    const staffResult = await query(
      `SELECT id
         FROM staff
        WHERE active = TRUE
          AND id = ANY($1::int[])`,
      [participantIds]
    );
    const validIds = new Set(staffResult.rows.map((r) => Number(r.id)));
    const invalid = participantIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Invalid participant ids: ${invalid.join(', ')}` });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    const convResult = await client.query(
      `INSERT INTO message_conversations (subject, created_by_staff_id)
       VALUES ($1, $2)
       RETURNING id, subject, created_by_staff_id, created_at, updated_at`,
      [subject || null, staffId]
    );
    const conversation = convResult.rows[0];

    await client.query(
      `INSERT INTO message_conversation_participants (conversation_id, staff_id)
       SELECT $1::uuid, unnest($2::int[])`,
      [conversation.id, participantIds]
    );

    const messageResult = await client.query(
      `INSERT INTO message_items (conversation_id, sender_staff_id, body)
       VALUES ($1::uuid, $2, $3)
       RETURNING id, conversation_id, sender_staff_id, body, created_at`,
      [conversation.id, staffId, body]
    );
    const firstMessage = messageResult.rows[0];

    await client.query(
      `INSERT INTO message_participant_reads (conversation_id, staff_id, last_read_message_id, updated_at)
       VALUES ($1::uuid, $2, $3, NOW())
       ON CONFLICT (conversation_id, staff_id)
       DO UPDATE SET
         last_read_message_id = EXCLUDED.last_read_message_id,
         updated_at = NOW()`,
      [conversation.id, staffId, firstMessage.id]
    );

    await client.query(
      `UPDATE message_conversations SET updated_at = NOW() WHERE id = $1::uuid`,
      [conversation.id]
    );
    await client.query('COMMIT');

    res.status(201).json({
      conversation: {
        ...conversation,
        participant_ids: participantIds,
      },
      first_message: firstMessage,
    });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
});

router.get('/conversations', async (req, res) => {
  try {
    const staffId = req.staff?.id;
    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });
    const limit = toPositiveInt(req.query.limit, 50, 100);
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);

    const result = await query(
      `SELECT c.id,
              c.subject,
              c.created_by_staff_id,
              c.created_at,
              c.updated_at,
              lm.id AS last_message_id,
              lm.body AS last_message_body,
              lm.created_at AS last_message_at,
              lm.sender_staff_id AS last_message_sender_staff_id,
              s.name AS last_message_sender_name,
              COALESCE(pr.last_read_message_id, 0) AS last_read_message_id,
              (
                SELECT COUNT(*)::int
                FROM message_items miu
                WHERE miu.conversation_id = c.id
                  AND miu.id > COALESCE(pr.last_read_message_id, 0)
                  AND miu.sender_staff_id <> $1
              ) AS unread_count
         FROM message_conversations c
         INNER JOIN message_conversation_participants cp
            ON cp.conversation_id = c.id
           AND cp.staff_id = $1
           AND cp.left_at IS NULL
         LEFT JOIN message_participant_reads pr
            ON pr.conversation_id = c.id
           AND pr.staff_id = $1
         LEFT JOIN LATERAL (
            SELECT mi.id, mi.body, mi.created_at, mi.sender_staff_id
            FROM message_items mi
            WHERE mi.conversation_id = c.id
            ORDER BY mi.id DESC
            LIMIT 1
         ) lm ON TRUE
         LEFT JOIN staff s ON s.id = lm.sender_staff_id
         WHERE c.archived_at IS NULL
         ORDER BY COALESCE(lm.created_at, c.updated_at, c.created_at) DESC
         LIMIT $2 OFFSET $3`,
      [staffId, limit, offset]
    );

    const totalResult = await query(
      `SELECT COUNT(*)::int AS total
       FROM message_conversations c
       INNER JOIN message_conversation_participants cp
         ON cp.conversation_id = c.id
        AND cp.staff_id = $1
        AND cp.left_at IS NULL
       WHERE c.archived_at IS NULL`,
      [staffId]
    );

    res.json({
      conversations: result.rows.map((row) => ({
        ...row,
        is_unread: Number(row.unread_count || 0) > 0,
      })),
      total: totalResult.rows[0]?.total || 0,
      limit,
      offset,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/conversations/:id', async (req, res) => {
  try {
    const staffId = req.staff?.id;
    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });
    const conversationId = String(req.params.id || '').trim();
    const allowed = await ensureParticipant(conversationId, staffId);
    if (!allowed) return res.status(403).json({ error: 'Conversation access denied' });

    const conversationResult = await query(
      `SELECT id, subject, created_by_staff_id, created_at, updated_at, archived_at
       FROM message_conversations
       WHERE id = $1::uuid`,
      [conversationId]
    );
    if (conversationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const participantsResult = await query(
      `SELECT cp.staff_id, cp.joined_at, cp.left_at, s.name
       FROM message_conversation_participants cp
       INNER JOIN staff s ON s.id = cp.staff_id
       WHERE cp.conversation_id = $1::uuid
       ORDER BY s.name ASC`,
      [conversationId]
    );

    res.json({
      conversation: conversationResult.rows[0],
      participants: participantsResult.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/conversations/:id/items', async (req, res) => {
  try {
    const staffId = req.staff?.id;
    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });
    const conversationId = String(req.params.id || '').trim();
    const allowed = await ensureParticipant(conversationId, staffId);
    if (!allowed) return res.status(403).json({ error: 'Conversation access denied' });

    const limit = toPositiveInt(req.query.limit, 50, 200);
    const before = req.query.before != null ? Number.parseInt(req.query.before, 10) : null;
    const hasBefore = Number.isFinite(before) && before > 0;

    const itemsResult = await query(
      `SELECT mi.id, mi.conversation_id, mi.sender_staff_id, mi.body, mi.created_at, mi.edited_at, mi.deleted_at,
              s.name AS sender_name
       FROM message_items mi
       INNER JOIN staff s ON s.id = mi.sender_staff_id
       WHERE mi.conversation_id = $1::uuid
         AND ($2::bigint IS NULL OR mi.id < $2::bigint)
       ORDER BY mi.id DESC
       LIMIT $3`,
      [conversationId, hasBefore ? before : null, limit]
    );
    const items = [...itemsResult.rows].reverse();

    res.json({
      items,
      has_more: itemsResult.rows.length >= limit,
      next_before: items.length > 0 ? items[0].id : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/conversations/:id/items', async (req, res) => {
  try {
    const staffId = req.staff?.id;
    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });
    const conversationId = String(req.params.id || '').trim();
    const allowed = await ensureParticipant(conversationId, staffId);
    if (!allowed) return res.status(403).json({ error: 'Conversation access denied' });

    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Message body is required' });

    const itemResult = await query(
      `INSERT INTO message_items (conversation_id, sender_staff_id, body)
       VALUES ($1::uuid, $2, $3)
       RETURNING id, conversation_id, sender_staff_id, body, created_at, edited_at, deleted_at`,
      [conversationId, staffId, body]
    );

    await query(
      `UPDATE message_conversations
          SET updated_at = NOW()
        WHERE id = $1::uuid`,
      [conversationId]
    );

    await query(
      `INSERT INTO message_participant_reads (conversation_id, staff_id, last_read_message_id, updated_at)
       VALUES ($1::uuid, $2, $3, NOW())
       ON CONFLICT (conversation_id, staff_id)
       DO UPDATE SET
         last_read_message_id = EXCLUDED.last_read_message_id,
         updated_at = NOW()`,
      [conversationId, staffId, itemResult.rows[0].id]
    );

    const withSender = await query(
      `SELECT mi.id, mi.conversation_id, mi.sender_staff_id, mi.body, mi.created_at, mi.edited_at, mi.deleted_at,
              s.name AS sender_name
       FROM message_items mi
       INNER JOIN staff s ON s.id = mi.sender_staff_id
       WHERE mi.id = $1`,
      [itemResult.rows[0].id]
    );
    res.status(201).json({ item: withSender.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/conversations/:id/read', async (req, res) => {
  try {
    const staffId = req.staff?.id;
    if (!staffId) return res.status(401).json({ error: 'Not authenticated' });
    const conversationId = String(req.params.id || '').trim();
    const allowed = await ensureParticipant(conversationId, staffId);
    if (!allowed) return res.status(403).json({ error: 'Conversation access denied' });

    const rawId = req.body?.last_read_message_id;
    let lastReadMessageId = Number.parseInt(rawId, 10);
    if (!Number.isFinite(lastReadMessageId) || lastReadMessageId <= 0) {
      const latestResult = await query(
        `SELECT id
         FROM message_items
         WHERE conversation_id = $1::uuid
         ORDER BY id DESC
         LIMIT 1`,
        [conversationId]
      );
      lastReadMessageId = Number(latestResult.rows[0]?.id || 0) || null;
    } else {
      const validateResult = await query(
        `SELECT id
         FROM message_items
         WHERE id = $1
           AND conversation_id = $2::uuid`,
        [lastReadMessageId, conversationId]
      );
      if (validateResult.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid last_read_message_id for this conversation' });
      }
    }

    await query(
      `INSERT INTO message_participant_reads (conversation_id, staff_id, last_read_message_id, updated_at)
       VALUES ($1::uuid, $2, $3, NOW())
       ON CONFLICT (conversation_id, staff_id)
       DO UPDATE SET
         last_read_message_id = EXCLUDED.last_read_message_id,
         updated_at = NOW()`,
      [conversationId, staffId, lastReadMessageId]
    );

    res.json({ ok: true, last_read_message_id: lastReadMessageId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
