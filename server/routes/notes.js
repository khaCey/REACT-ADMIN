import { Router } from 'express';
import { query, pool } from '../db/index.js';
import { randomUUID } from 'crypto';
import { logChange } from '../lib/changeLog.js';

const router = Router();

function parseBodyStudentId(raw) {
  if (raw == null || raw === '') return NaN;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return NaN;
  return Math.trunc(n);
}

/**
 * Other members of the payer's linked group (same group_id), excluding the payer.
 * @param {number} payerStudentId
 * @param {number | null | undefined} preferredGroupId
 */
async function resolveReplicationTargets(payerStudentId, preferredGroupId = null, db = query) {
  let groupId = null;
  const pref =
    preferredGroupId != null && preferredGroupId !== ''
      ? parseBodyStudentId(preferredGroupId)
      : NaN;
  if (Number.isInteger(pref) && pref > 0) {
    const member = await db(
      `SELECT 1 FROM student_group_members WHERE group_id = $1 AND student_id = $2 LIMIT 1`,
      [pref, payerStudentId]
    );
    if (member.rows.length > 0) {
      groupId = pref;
    }
  }
  if (groupId == null) {
    const g = await db(
      `SELECT group_id FROM student_group_members WHERE student_id = $1 ORDER BY group_id ASC LIMIT 1`,
      [payerStudentId]
    );
    if (g.rows.length === 0) return { groupId: null, peerIds: [] };
    groupId = g.rows[0].group_id;
  }
  const m = await db(
    `SELECT student_id FROM student_group_members WHERE group_id = $1 AND student_id <> $2 ORDER BY student_id`,
    [groupId, payerStudentId]
  );
  return { groupId, peerIds: m.rows.map((r) => r.student_id) };
}

async function getLinkedNoteGroupId(noteId, db = query) {
  const result = await db(
    `SELECT note_group_id
       FROM note_group_items
      WHERE note_id = $1
      LIMIT 1`,
    [noteId]
  );
  return result.rows[0]?.note_group_id ?? null;
}

async function getNotesByGroupId(noteGroupId, db = query) {
  const result = await db(
    `SELECT n.*
       FROM notes n
       INNER JOIN note_group_items ngi ON ngi.note_id = n.id
      WHERE ngi.note_group_id = $1
      ORDER BY n.id ASC`,
    [noteGroupId]
  );
  return result.rows;
}

router.get('/', async (req, res) => {
  try {
    const { student_id } = req.query;
    let sql = 'SELECT * FROM notes';
    const params = [];
    if (student_id) {
      sql += ' WHERE student_id = $1';
      params.push(student_id);
    }
    sql += ' ORDER BY date DESC, id DESC';
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
    const replicate =
      body.replicate_to_linked_group === true || body.replicateToLinkedGroup === true;
    const payerId = parseBodyStudentId(body['Student ID'] ?? body.student_id);
    const preferredGroupRaw = body.linked_group_id ?? body.linkedGroupId;
    const noteText = body.Note ?? body.note ?? '';
    const staff = body.Staff ?? body.staff ?? '';
    const replicationTargets =
      replicate && Number.isInteger(payerId) && payerId >= 0
        ? await resolveReplicationTargets(payerId, preferredGroupRaw)
        : { groupId: null, peerIds: [] };
    const peerIds = replicationTargets.peerIds;

    if (!replicate || peerIds.length === 0) {
      const result = await query(
        `INSERT INTO notes (student_id, staff, note, date)
         VALUES ($1, $2, $3, NOW())
         RETURNING *`,
        [body['Student ID'] ?? body.student_id, staff, noteText]
      );
      const newRow = result.rows[0];
      await logChange(
        {
          entityType: 'notes',
          entityKey: String(newRow.id),
          action: 'create',
          oldData: null,
          newData: newRow,
        },
        req
      );
      return res.status(201).json({ id: newRow.id, replicated_note_ids: [] });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const primaryResult = await client.query(
        `INSERT INTO notes (student_id, staff, note, date)
         VALUES ($1, $2, $3, NOW())
         RETURNING *`,
        [payerId, staff, noteText]
      );
      const primaryRow = primaryResult.rows[0];
      await logChange(
        {
          entityType: 'notes',
          entityKey: String(primaryRow.id),
          action: 'create',
          oldData: null,
          newData: primaryRow,
        },
        req,
        client
      );

      const replicatedIds = [];
      const linkedNotes = [{ id: primaryRow.id, studentId: payerId, isPrimary: true }];
      for (const otherStudentId of peerIds) {
        const replicaResult = await client.query(
          `INSERT INTO notes (student_id, staff, note, date)
           VALUES ($1, $2, $3, NOW())
           RETURNING *`,
          [otherStudentId, staff, noteText]
        );
        const repRow = replicaResult.rows[0];
        await logChange(
          {
            entityType: 'notes',
            entityKey: String(repRow.id),
            action: 'create',
            oldData: null,
            newData: repRow,
          },
          req,
          client
        );
        replicatedIds.push(repRow.id);
        linkedNotes.push({ id: repRow.id, studentId: otherStudentId, isPrimary: false });
      }

      const noteGroupId = randomUUID();
      await client.query(
        `INSERT INTO note_groups (id, source_group_id)
         VALUES ($1, $2)`,
        [noteGroupId, replicationTargets.groupId]
      );
      for (const linkedNote of linkedNotes) {
        await client.query(
          `INSERT INTO note_group_items (note_group_id, note_id, student_id, is_primary)
           VALUES ($1, $2, $3, $4)`,
          [noteGroupId, linkedNote.id, linkedNote.studentId, linkedNote.isPrimary]
        );
      }

      await client.query('COMMIT');
      return res.status(201).json({ id: primaryRow.id, replicated_note_ids: replicatedIds });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;
    const linkedGroupId = await getLinkedNoteGroupId(id);
    if (linkedGroupId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const oldRows = await getNotesByGroupId(linkedGroupId, client.query.bind(client));
        if (oldRows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Note not found' });
        }
        const updateResult = await client.query(
          `UPDATE notes n
              SET staff = COALESCE($2, n.staff),
                  note = COALESCE($3, n.note)
             FROM note_group_items ngi
            WHERE ngi.note_group_id = $1
              AND n.id = ngi.note_id
          RETURNING n.*`,
          [linkedGroupId, body.Staff ?? body.staff, body.Note ?? body.note]
        );
        const newRowsById = new Map(updateResult.rows.map((row) => [row.id, row]));
        for (const oldRow of oldRows) {
          const newRow = newRowsById.get(oldRow.id);
          if (!newRow) continue;
          await logChange(
            {
              entityType: 'notes',
              entityKey: String(oldRow.id),
              action: 'update',
              oldData: oldRow,
              newData: newRow,
            },
            req,
            client
          );
        }
        await client.query('COMMIT');
        return res.json({ ok: true, propagated: true, affected_count: updateResult.rows.length });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    const oldResult = await query('SELECT * FROM notes WHERE id = $1', [id]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }
    const oldRow = oldResult.rows[0];
    await query(
      `UPDATE notes SET staff = COALESCE($2, staff), note = COALESCE($3, note)
       WHERE id = $1`,
      [id, body.Staff ?? body.staff, body.Note ?? body.note]
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
    const linkedGroupId = await getLinkedNoteGroupId(id);
    if (linkedGroupId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const oldRows = await getNotesByGroupId(linkedGroupId, client.query.bind(client));
        if (oldRows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Note not found' });
        }
        await client.query(
          `DELETE FROM notes n
            USING note_group_items ngi
           WHERE ngi.note_group_id = $1
             AND n.id = ngi.note_id`,
          [linkedGroupId]
        );
        for (const oldRow of oldRows) {
          await logChange(
            {
              entityType: 'notes',
              entityKey: String(oldRow.id),
              action: 'delete',
              oldData: oldRow,
              newData: null,
            },
            req,
            client
          );
        }
        await client.query('COMMIT');
        return res.json({ ok: true, propagated: true, deleted_count: oldRows.length });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
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
