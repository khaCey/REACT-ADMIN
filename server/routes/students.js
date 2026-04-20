import { Router } from 'express';
import { pool, query } from '../db/index.js';
import { logChange } from '../lib/changeLog.js';
import { isStudentGasSyncEnabled, syncStudentToGas } from '../lib/studentContactSync.js';

const router = Router();

function mapStudentRow(r) {
  return {
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
    is_child: !!r.is_child,
    google_contact_linked: Boolean(r.google_contact_resource_name),
  };
}

async function cleanupEmptyStudentGroups(client) {
  await client.query(
    `DELETE FROM student_groups sg
      WHERE NOT EXISTS (
        SELECT 1 FROM student_group_members sgm WHERE sgm.group_id = sg.id
      )`
  );
}

async function getStudentGroupPayload(studentId, db = query) {
  const studentResult = await db('SELECT * FROM students WHERE id = $1', [studentId]);
  if ((studentResult.rows || []).length === 0) {
    return null;
  }
  const studentRow = studentResult.rows[0];
  const groupResult = await db(
    `SELECT sg.id, sg.expected_size
       FROM student_group_members sgm
       INNER JOIN student_groups sg ON sg.id = sgm.group_id
      WHERE sgm.student_id = $1
      LIMIT 1`,
    [studentId]
  );
  const groupId = groupResult.rows[0]?.id ? Number(groupResult.rows[0].id) : null;
  const expectedSize =
    parseInt(groupResult.rows[0]?.expected_size, 10) ||
    parseInt(studentRow.group_size, 10) ||
    null;
  let members = [];
  if (groupId) {
    const memberResult = await db(
      `SELECT s.id, s.name, s.name_kanji, s.group_type, s.group_size, s.is_child, sgm.sort_order
         FROM student_group_members sgm
         INNER JOIN students s ON s.id = sgm.student_id
        WHERE sgm.group_id = $1
        ORDER BY sgm.sort_order ASC, s.id ASC`,
      [groupId]
    );
    members = memberResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      name_kanji: row.name_kanji,
      group_type: row.group_type,
      group_size: row.group_size,
      is_child: !!row.is_child,
      sort_order: parseInt(row.sort_order, 10) || 0,
    }));
  }
  return {
    student: mapStudentRow(studentRow),
    groupId,
    expectedSize,
    members,
  };
}

router.get('/', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM students ORDER BY id'
    );
    const students = result.rows.map(mapStudentRow);
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
    res.json(mapStudentRow(r));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/group', async (req, res) => {
  try {
    const studentId = Number(req.params.id);
    if (!Number.isFinite(studentId) || !Number.isInteger(studentId) || studentId < 0) {
      return res.status(400).json({ error: 'Invalid student id' });
    }
    const payload = await getStudentGroupPayload(studentId);
    if (!payload) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/group', async (req, res) => {
  let client;
  try {
    const studentId = Number(req.params.id);
    if (!Number.isFinite(studentId) || !Number.isInteger(studentId) || studentId < 0) {
      return res.status(400).json({ error: 'Invalid student id' });
    }
    const requestedIdsRaw = req.body?.member_ids ?? req.body?.memberIds;
    const requestedIds = Array.isArray(requestedIdsRaw)
      ? [
          ...new Set(
            requestedIdsRaw
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value) && Number.isInteger(value) && value >= 0)
          ),
        ]
      : [];
    if (!requestedIds.includes(studentId)) {
      return res.status(400).json({ error: 'The current student must be included in the group.' });
    }
    if (requestedIds.length < 2) {
      return res.status(400).json({ error: 'A group must contain at least 2 students.' });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    const studentResult = await client.query('SELECT * FROM students WHERE id = $1', [studentId]);
    if (studentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found' });
    }
    const studentRow = studentResult.rows[0];
    const expectedSize =
      Math.max(
        0,
        parseInt(req.body?.expected_size ?? req.body?.expectedSize, 10) ||
          parseInt(studentRow.group_size, 10) ||
          requestedIds.length
      ) || requestedIds.length;
    if (expectedSize > 0 && requestedIds.length !== expectedSize) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `This group requires exactly ${expectedSize} students.` });
    }

    const selectedStudents = await client.query(
      `SELECT id, name, is_child
         FROM students
        WHERE id = ANY($1::int[])
        ORDER BY array_position($1::int[], id)`,
      [requestedIds]
    );
    if (selectedStudents.rows.length !== requestedIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'One or more selected students do not exist.' });
    }
    const childKinds = new Set(selectedStudents.rows.map((row) => !!row.is_child));
    if (childKinds.size > 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Kids and adult students cannot be mixed in one linked group.' });
    }

    const existingGroup = await client.query(
      'SELECT group_id FROM student_group_members WHERE student_id = $1 LIMIT 1',
      [studentId]
    );
    let groupId = existingGroup.rows[0]?.group_id ? Number(existingGroup.rows[0].group_id) : null;
    if (!groupId) {
      const created = await client.query(
        `INSERT INTO student_groups (expected_size, updated_at)
         VALUES ($1, NOW())
         RETURNING id`,
        [expectedSize]
      );
      groupId = Number(created.rows[0].id);
    } else {
      await client.query(
        `UPDATE student_groups
            SET expected_size = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [groupId, expectedSize]
      );
    }

    await client.query(
      'DELETE FROM student_group_members WHERE student_id = ANY($1::int[]) AND group_id <> $2',
      [requestedIds, groupId]
    );
    await client.query('DELETE FROM student_group_members WHERE group_id = $1', [groupId]);
    for (let index = 0; index < requestedIds.length; index += 1) {
      await client.query(
        `INSERT INTO student_group_members (group_id, student_id, sort_order)
         VALUES ($1, $2, $3)`,
        [groupId, requestedIds[index], index + 1]
      );
    }
    await cleanupEmptyStudentGroups(client);
    await client.query('COMMIT');

    const payload = await getStudentGroupPayload(studentId, client.query.bind(client));
    res.json(payload);
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
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
    let googleContactSync = 'disabled';
    if (isStudentGasSyncEnabled()) {
      const sync = await syncStudentToGas('student_upsert', newRow);
      googleContactSync = sync.ok ? 'ok' : 'failed';
      if (!sync.ok) {
        console.error(`[StudentSync] GAS sync failed for student ${newRow.id}:`, sync.error || 'unknown error');
      }
    }
    await logChange(
      { entityType: 'students', entityKey: String(newRow.id), action: 'create', oldData: null, newData: newRow },
      req
    );
    res.status(201).json({
      id: newRow.id,
      googleContactCreated: googleContactSync === 'ok',
      googleContactSync,
    });
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
    const newRow = (await query('SELECT * FROM students WHERE id = $1', [id])).rows[0] || oldRow;
    let googleContactSync = 'disabled';
    if (isStudentGasSyncEnabled()) {
      const sync = await syncStudentToGas('student_upsert', newRow);
      googleContactSync = sync.ok ? 'ok' : 'failed';
      if (!sync.ok) {
        console.error(`[StudentSync] GAS sync failed for student ${id} update:`, sync.error || 'unknown error');
      }
    }
    await logChange(
      { entityType: 'students', entityKey: String(id), action: 'update', oldData: oldRow, newData: newRow },
      req
    );
    res.json({ ok: true, googleContactSync });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Manual one-student Google Contact upsert via GAS. */
router.post('/:id/google-contact-sync', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM students WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    if (!isStudentGasSyncEnabled()) {
      return res.status(400).json({
        ok: false,
        googleContactSync: 'disabled',
        error: 'Student contact sync is not configured (STUDENT_SYNC_GAS_URL / STUDENT_SYNC_API_KEY).',
      });
    }
    const studentRow = result.rows[0];
    const sync = await syncStudentToGas('student_upsert', studentRow);
    if (!sync.ok) {
      console.error(`[StudentSync] Manual sync failed for student ${id}:`, sync.error || 'unknown error');
      return res.status(502).json({
        ok: false,
        googleContactSync: 'failed',
        error: sync.error || 'Google Contact sync failed',
      });
    }
    return res.json({
      ok: true,
      googleContactSync: 'ok',
      actionTaken: sync.actionTaken || null,
      contactId: sync.contactId || null,
    });
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
