/**
 * Change log API - list changes and undo
 */
import { Router } from 'express';
import { query } from '../db/index.js';
import { logChange } from '../lib/changeLog.js';

const router = Router();

function buildChangeSummary(oldData, newData, action) {
  const parts = [];
  const oldObj = oldData && typeof oldData === 'object' ? oldData : {};
  const newObj = newData && typeof newData === 'object' ? newData : {};
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  const skipKeys = new Set(['created_at', 'updated_at']);
  const labelMap = {
    name: 'Name',
    name_kanji: '漢字',
    email: 'Email',
    phone: 'Phone',
    phone_secondary: 'Phone (secondary)',
    same_day_cancel: '当日',
    status: 'Status',
    payment: 'Payment',
    group_type: 'Group',
    group_size: '人数',
    is_child: 'Child',
    student_id: 'Student ID',
    transaction_id: 'Transaction ID',
    year: 'Year',
    month: 'Month',
    amount: 'Amount',
    discount: 'Discount',
    total: 'Total',
    date: 'Date',
    method: 'Method',
    staff: 'Staff',
    note: 'Note',
    lessons: 'Lessons',
    event_id: 'Event ID',
    title: 'Title',
    start: 'Start',
    end: 'End',
    student_name: 'Student',
    is_kids_lesson: 'Kids lesson',
    teacher_name: 'Teacher',
  };
  for (const k of allKeys) {
    if (skipKeys.has(k)) continue;
    const ov = oldObj[k];
    const nv = newObj[k];
    const oStr = ov === null || ov === undefined ? '' : String(ov);
    const nStr = nv === null || nv === undefined ? '' : String(nv);
    const label = labelMap[k] || k;
    if (action === 'create') {
      if (nStr) parts.push(`${label}: ${nStr}`);
    } else if (action === 'delete') {
      if (oStr) parts.push(`${label}: ${oStr}`);
    } else if (oStr !== nStr) {
      parts.push(`${label}: ${oStr || '(empty)'} → ${nStr || '(empty)'}`);
    }
  }
  return parts.length ? parts.join('; ') : (action === 'delete' ? 'Record deleted' : 'Record created');
}

function formatPaymentMonthYear(month, year) {
  const m = String(month || '').trim();
  const y = String(year || '').trim();
  if (!m && !y) return '';
  if (/^\d{4}-\d{2}$/.test(m)) {
    const [, mm] = m.split('-');
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[parseInt(mm, 10) - 1] || mm;
    return `${monthName} ${y || m.split('-')[0]}`;
  }
  if (m && y) return `${m} ${y}`.trim();
  return m || y;
}

async function getToggleStateMap(baseIds) {
  if (!baseIds || baseIds.length === 0) return new Map();
  try {
    const result = await query(
      `SELECT DISTINCT ON (source_change_id) source_change_id, action
       FROM change_log
       WHERE source_change_id = ANY($1) AND action IN ('undo', 'redo')
       ORDER BY source_change_id, created_at DESC, id DESC`,
      [baseIds]
    );
    return new Map(result.rows.map((r) => [r.source_change_id, r.action]));
  } catch (err) {
    // DB may not have source_change_id yet.
    if (err?.code !== '42703') throw err;
    return new Map();
  }
}

function normalizeJsonForCompare(value) {
  if (Array.isArray(value)) return value.map(normalizeJsonForCompare);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        acc[k] = normalizeJsonForCompare(value[k]);
        return acc;
      }, {});
  }
  return value;
}

function sameJson(a, b) {
  return JSON.stringify(normalizeJsonForCompare(a ?? null)) === JSON.stringify(normalizeJsonForCompare(b ?? null));
}

function toggleMatchesBase(base, toggle) {
  if (!base || !toggle) return false;
  if (base.entity_type !== toggle.entity_type || base.entity_key !== toggle.entity_key) return false;
  const isUndoShape = sameJson(toggle.old_data, base.new_data) && sameJson(toggle.new_data, base.old_data);
  const isRedoShape = sameJson(toggle.old_data, base.old_data) && sameJson(toggle.new_data, base.new_data);
  return isUndoShape || isRedoShape;
}

async function getLegacyToggleStateMap(baseRows) {
  if (!baseRows || baseRows.length === 0) return new Map();
  const pairs = [...new Set(baseRows.map((r) => `${r.entity_type}||${r.entity_key}`))];
  const where = pairs.map((_, idx) => `(entity_type = $${idx * 2 + 1} AND entity_key = $${idx * 2 + 2})`).join(' OR ');
  const params = [];
  for (const pair of pairs) {
    const [entityType, entityKey] = pair.split('||');
    params.push(entityType, entityKey);
  }

  const togglesResult = await query(
    `SELECT id, entity_type, entity_key, action, old_data, new_data, created_at
     FROM change_log
     WHERE action IN ('undo', 'redo') AND (${where})
     ORDER BY created_at DESC, id DESC`,
    params
  );

  const stateMap = new Map();
  for (const base of baseRows) {
    const latest = togglesResult.rows.find((t) => toggleMatchesBase(base, t));
    if (latest) stateMap.set(base.id, latest.action);
  }
  return stateMap;
}

async function getToggleStateMapFromRows(baseRows) {
  if (!baseRows || baseRows.length === 0) return new Map();
  const bySourceId = await getToggleStateMap(baseRows.map((r) => r.id));
  if (bySourceId.size > 0) return bySourceId;
  return getLegacyToggleStateMap(baseRows);
}

async function applyUpdate(entity_type, data) {
  if (!data) return;
  if (entity_type === 'students') {
    const o = data;
    const hasGoogleContact = Object.prototype.hasOwnProperty.call(o, 'google_contact_resource_name');
    await query(
      `UPDATE students SET name = $2, name_kanji = $3, email = $4, phone = $5, phone_secondary = $6,
        same_day_cancel = $7, status = $8, payment = $9, group_type = $10, group_size = $11, is_child = $12,
        google_contact_resource_name = CASE WHEN $14::boolean THEN $13 ELSE google_contact_resource_name END,
        updated_at = NOW()
       WHERE id = $1`,
      [
        o.id,
        o.name ?? '',
        o.name_kanji ?? '',
        o.email ?? '',
        o.phone ?? '',
        o.phone_secondary ?? '',
        o.same_day_cancel ?? '',
        o.status ?? '',
        o.payment ?? '',
        o.group_type ?? '',
        o.group_size ?? null,
        o.is_child ?? false,
        o.google_contact_resource_name ?? null,
        hasGoogleContact,
      ]
    );
  } else if (entity_type === 'payments') {
    const o = data;
    await query(
      `UPDATE payments SET student_id = $2, year = $3, month = $4, amount = $5, discount = $6,
        total = $7, date = $8, method = $9, staff = $10 WHERE transaction_id = $1`,
      [
        o.transaction_id,
        o.student_id,
        o.year ?? '',
        o.month ?? '',
        o.amount ?? 0,
        o.discount ?? 0,
        o.total ?? 0,
        o.date,
        o.method ?? '',
        o.staff ?? '',
      ]
    );
  } else if (entity_type === 'notes') {
    const o = data;
    await query(
      `UPDATE notes SET student_id = $2, staff = $3, note = $4, date = $5 WHERE id = $1`,
      [o.id, o.student_id, o.staff ?? '', o.note ?? '', o.date]
    );
  } else if (entity_type === 'lessons') {
    const o = data;
    await query(
      `INSERT INTO lessons (student_id, month, lessons) VALUES ($1, $2, $3)
       ON CONFLICT (student_id, month) DO UPDATE SET lessons = EXCLUDED.lessons`,
      [o.student_id, o.month, o.lessons ?? 0]
    );
  } else if (entity_type === 'monthly_schedule') {
    const o = data;
    await query(
      `UPDATE monthly_schedule SET title = $3, date = $4::date, start = $5::timestamptz, "end" = $6::timestamptz,
        status = $7, is_kids_lesson = $8, teacher_name = $9, lesson_kind = $10, student_id = $11, lesson_mode = $12,
        calendar_sync_status = $13, calendar_sync_error = $14, calendar_sync_key = $15,
        calendar_sync_attempted_at = $16::timestamptz, calendar_synced_at = $17::timestamptz,
        awaiting_reschedule_date = COALESCE($18::boolean, FALSE)
       WHERE event_id = $1 AND student_name = $2`,
      [
        o.event_id,
        o.student_name,
        o.title ?? '',
        o.date,
        o.start,
        o.end,
        o.status ?? 'scheduled',
        o.is_kids_lesson ?? false,
        o.teacher_name ?? '',
        o.lesson_kind ?? 'regular',
        o.student_id ?? null,
        o.lesson_mode ?? 'unknown',
        o.calendar_sync_status ?? 'synced',
        o.calendar_sync_error ?? null,
        o.calendar_sync_key ?? null,
        o.calendar_sync_attempted_at ?? null,
        o.calendar_synced_at ?? null,
        o.awaiting_reschedule_date ?? false,
      ]
    );
  }
}

async function applyCreate(entity_type, data) {
  if (!data) return;
  if (entity_type === 'students') {
    const o = data;
    await query(
      `INSERT INTO students (id, name, name_kanji, email, phone, phone_secondary, same_day_cancel, status, payment, group_type, group_size, is_child, google_contact_resource_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, name_kanji = EXCLUDED.name_kanji, email = EXCLUDED.email,
         phone = EXCLUDED.phone, phone_secondary = EXCLUDED.phone_secondary, same_day_cancel = EXCLUDED.same_day_cancel,
         status = EXCLUDED.status, payment = EXCLUDED.payment, group_type = EXCLUDED.group_type, group_size = EXCLUDED.group_size,
         is_child = EXCLUDED.is_child, google_contact_resource_name = EXCLUDED.google_contact_resource_name, updated_at = NOW()`,
      [
        o.id,
        o.name ?? '',
        o.name_kanji ?? '',
        o.email ?? '',
        o.phone ?? '',
        o.phone_secondary ?? '',
        o.same_day_cancel ?? '',
        o.status ?? '',
        o.payment ?? '',
        o.group_type ?? '',
        o.group_size ?? null,
        o.is_child ?? false,
        o.google_contact_resource_name ?? null,
      ]
    );
  } else if (entity_type === 'payments') {
    const o = data;
    await query(
      `INSERT INTO payments (transaction_id, student_id, year, month, amount, discount, total, date, method, staff)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (transaction_id) DO UPDATE SET
         student_id = EXCLUDED.student_id, year = EXCLUDED.year, month = EXCLUDED.month,
         amount = EXCLUDED.amount, discount = EXCLUDED.discount, total = EXCLUDED.total,
         date = EXCLUDED.date, method = EXCLUDED.method, staff = EXCLUDED.staff`,
      [
        o.transaction_id,
        o.student_id,
        o.year ?? '',
        o.month ?? '',
        o.amount ?? 0,
        o.discount ?? 0,
        o.total ?? 0,
        o.date,
        o.method ?? '',
        o.staff ?? '',
      ]
    );
  } else if (entity_type === 'notes') {
    const o = data;
    await query(
      `INSERT INTO notes (id, student_id, staff, note, date) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         student_id = EXCLUDED.student_id, staff = EXCLUDED.staff, note = EXCLUDED.note, date = EXCLUDED.date`,
      [o.id, o.student_id, o.staff ?? '', o.note ?? '', o.date]
    );
    await query("SELECT setval('notes_id_seq', (SELECT COALESCE(MAX(id), 1) FROM notes))");
  } else if (entity_type === 'lessons') {
    const o = data;
    await query(
      `INSERT INTO lessons (student_id, month, lessons) VALUES ($1, $2, $3)
       ON CONFLICT (student_id, month) DO UPDATE SET lessons = EXCLUDED.lessons`,
      [o.student_id, o.month, o.lessons ?? 0]
    );
  } else if (entity_type === 'monthly_schedule') {
    const o = data;
    await query(
      `INSERT INTO monthly_schedule
        (event_id, title, date, start, "end", status, student_name, is_kids_lesson, teacher_name, lesson_kind, student_id, lesson_mode,
         calendar_sync_status, calendar_sync_error, calendar_sync_key, calendar_sync_attempted_at, calendar_synced_at, awaiting_reschedule_date,
         reschedule_snapshot_to_date, reschedule_snapshot_to_time, reschedule_snapshot_from_date, reschedule_snapshot_from_time, lesson_uuid)
       VALUES ($1, $2, $3::date, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::timestamptz, $17::timestamptz, COALESCE($18::boolean, FALSE),
         NULL, NULL, NULL, NULL, COALESCE($19::uuid, gen_random_uuid()))
       ON CONFLICT (event_id, student_name) DO UPDATE SET
         lesson_uuid = COALESCE(monthly_schedule.lesson_uuid, EXCLUDED.lesson_uuid),
         title = EXCLUDED.title, date = EXCLUDED.date, start = EXCLUDED.start, "end" = EXCLUDED."end",
         status = EXCLUDED.status, is_kids_lesson = EXCLUDED.is_kids_lesson, teacher_name = EXCLUDED.teacher_name, lesson_kind = EXCLUDED.lesson_kind,
         student_id = EXCLUDED.student_id, lesson_mode = EXCLUDED.lesson_mode, calendar_sync_status = EXCLUDED.calendar_sync_status,
         calendar_sync_error = EXCLUDED.calendar_sync_error, calendar_sync_key = EXCLUDED.calendar_sync_key,
         calendar_sync_attempted_at = EXCLUDED.calendar_sync_attempted_at, calendar_synced_at = EXCLUDED.calendar_synced_at,
         awaiting_reschedule_date = EXCLUDED.awaiting_reschedule_date,
         reschedule_snapshot_to_date = monthly_schedule.reschedule_snapshot_to_date,
         reschedule_snapshot_to_time = monthly_schedule.reschedule_snapshot_to_time,
         reschedule_snapshot_from_date = monthly_schedule.reschedule_snapshot_from_date,
         reschedule_snapshot_from_time = monthly_schedule.reschedule_snapshot_from_time`,
      [
        o.event_id,
        o.title ?? '',
        o.date,
        o.start,
        o.end,
        o.status ?? 'scheduled',
        o.student_name,
        o.is_kids_lesson ?? false,
        o.teacher_name ?? '',
        o.lesson_kind ?? 'regular',
        o.student_id ?? null,
        o.lesson_mode ?? 'unknown',
        o.calendar_sync_status ?? 'synced',
        o.calendar_sync_error ?? null,
        o.calendar_sync_key ?? null,
        o.calendar_sync_attempted_at ?? null,
        o.calendar_synced_at ?? null,
        o.awaiting_reschedule_date ?? false,
        o.lesson_uuid ?? null,
      ]
    );
  }
}

async function applyDelete(entity_type, data) {
  if (!data) return;
  if (entity_type === 'students') {
    await query('DELETE FROM students WHERE id = $1', [data.id]);
  } else if (entity_type === 'payments') {
    await query('DELETE FROM payments WHERE transaction_id = $1', [data.transaction_id]);
  } else if (entity_type === 'notes') {
    await query('DELETE FROM notes WHERE id = $1', [data.id]);
  } else if (entity_type === 'lessons') {
    await query('DELETE FROM lessons WHERE student_id = $1 AND month = $2', [data.student_id, data.month]);
  } else if (entity_type === 'monthly_schedule') {
    await query(
      'DELETE FROM monthly_schedule WHERE event_id = $1 AND student_name = $2',
      [data.event_id, data.student_name]
    );
  }
}

/** GET /api/change-log - list changes */
router.get('/', async (req, res) => {
  try {
    const { entity_type, entity_key, limit = 100, offset = 0 } = req.query;
    let sql = `
      SELECT id, entity_type, entity_key, action, old_data, new_data, staff_name, created_at
      FROM change_log
      WHERE action IN ('create', 'update', 'delete')
    `;
    const params = [];
    let i = 1;
    if (entity_type) {
      sql += ` AND entity_type = $${i++}`;
      params.push(entity_type);
    }
    if (entity_key) {
      sql += ` AND entity_key = $${i++}`;
      params.push(entity_key);
    }
    sql += ` ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`;
    params.push(parseInt(limit, 10) || 100, parseInt(offset, 10) || 0);

    const result = await query(sql, params);
    const studentIds = new Set();
    for (const r of result.rows) {
      if (r.entity_type === 'students') {
        const id = parseInt(r.entity_key, 10);
        if (!isNaN(id)) studentIds.add(id);
      }
      for (const data of [r.old_data, r.new_data]) {
        if (data?.student_id) studentIds.add(parseInt(data.student_id, 10));
      }
    }
    let nameMap = {};
    if (studentIds.size > 0) {
      const ids = [...studentIds].filter((x) => !isNaN(x));
      if (ids.length > 0) {
        const namesResult = await query(
          'SELECT id, name FROM students WHERE id = ANY($1)',
          [ids]
        );
        for (const row of namesResult.rows) {
          nameMap[row.id] = row.name || '';
        }
      }
    }

    const toggleMap = await getToggleStateMapFromRows(result.rows);

    const rows = result.rows.map((r) => {
      let entity_label = null;
      if (r.entity_type === 'students') {
        entity_label = r.old_data?.name ?? r.new_data?.name ?? nameMap[parseInt(r.entity_key, 10)] ?? r.entity_key;
      } else if (r.entity_type === 'monthly_schedule') {
        entity_label = r.old_data?.student_name ?? r.new_data?.student_name ?? r.entity_key;
      } else if (r.entity_type === 'payments') {
        const data = r.old_data ?? r.new_data;
        const sid = data?.student_id;
        const studentName = sid ? (nameMap[parseInt(sid, 10)] || '') : '';
        const month = data?.month ?? '';
        const year = data?.year ?? '';
        const monthYear = formatPaymentMonthYear(month, year);
        entity_label = [studentName, monthYear].filter(Boolean).join(' - ') || r.entity_key;
      } else if (['notes', 'lessons'].includes(r.entity_type)) {
        const sid = r.old_data?.student_id ?? r.new_data?.student_id;
        if (sid) entity_label = nameMap[parseInt(sid, 10)] ?? r.entity_key;
      }
      return {
        id: r.id,
        entity_type: r.entity_type,
        entity_key: r.entity_key,
        entity_label: entity_label || r.entity_key,
        action: r.action,
        old_data: r.old_data,
        new_data: r.new_data,
        staff_name: r.staff_name,
        created_at: r.created_at,
        change_summary: buildChangeSummary(r.old_data, r.new_data, r.action) || r.action,
        is_undone: toggleMap.get(r.id) === 'undo',
      };
    });
    res.json({ changes: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/change-log/:id/undo - revert a change */
router.post('/:id/undo', async (req, res) => {
  try {
    const changeId = parseInt(req.params.id, 10);
    const changeResult = await query(
      'SELECT id, entity_type, entity_key, action, old_data, new_data FROM change_log WHERE id = $1',
      [changeId]
    );
    if (changeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Change not found' });
    }
    const change = changeResult.rows[0];
    const { entity_type, entity_key, action, old_data, new_data } = change;

    if (action === 'undo' || action === 'redo') {
      return res.status(400).json({ error: `Cannot undo a ${action}` });
    }

    const toggleMap = await getToggleStateMapFromRows([change]);
    if (toggleMap.get(changeId) === 'undo') {
      return res.status(400).json({ error: 'Change is already undone' });
    }

    if (action === 'update' && old_data) {
      await applyUpdate(entity_type, old_data);
    } else if (action === 'create' && new_data) {
      await applyDelete(entity_type, new_data);
    } else if (action === 'delete' && old_data) {
      await applyCreate(entity_type, old_data);
    }

    await logChange(
      {
        entityType: entity_type,
        entityKey: entity_key,
        action: 'undo',
        oldData: new_data,
        newData: old_data,
        sourceChangeId: changeId,
      },
      req
    );

    res.json({ ok: true, message: 'Change undone' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/change-log/:id/redo - reapply a previously undone change */
router.post('/:id/redo', async (req, res) => {
  try {
    const changeId = parseInt(req.params.id, 10);
    const changeResult = await query(
      'SELECT id, entity_type, entity_key, action, old_data, new_data FROM change_log WHERE id = $1',
      [changeId]
    );
    if (changeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Change not found' });
    }

    const change = changeResult.rows[0];
    const { entity_type, entity_key, action, old_data, new_data } = change;

    if (action === 'undo' || action === 'redo') {
      return res.status(400).json({ error: `Cannot redo a ${action}` });
    }

    const toggleMap = await getToggleStateMapFromRows([change]);
    if (toggleMap.get(changeId) !== 'undo') {
      return res.status(400).json({ error: 'Change is not currently undone' });
    }

    if (action === 'update' && new_data) {
      await applyUpdate(entity_type, new_data);
    } else if (action === 'create' && new_data) {
      await applyCreate(entity_type, new_data);
    } else if (action === 'delete' && old_data) {
      await applyDelete(entity_type, old_data);
    }

    await logChange(
      {
        entityType: entity_type,
        entityKey: entity_key,
        action: 'redo',
        oldData: old_data,
        newData: new_data,
        sourceChangeId: changeId,
      },
      req
    );

    res.json({ ok: true, message: 'Change redone' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
