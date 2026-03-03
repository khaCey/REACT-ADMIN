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

/** GET /api/change-log - list changes */
router.get('/', async (req, res) => {
  try {
    const { entity_type, entity_key, limit = 100, offset = 0 } = req.query;
    let sql = `
      SELECT id, entity_type, entity_key, action, old_data, new_data, staff_name, created_at
      FROM change_log
      WHERE action <> 'undo'
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

    if (action === 'undo') {
      return res.status(400).json({ error: 'Cannot undo an undo' });
    }

    if (action === 'update' && old_data) {
      if (entity_type === 'students') {
        const o = old_data;
        await query(
          `UPDATE students SET name = $2, name_kanji = $3, email = $4, phone = $5, phone_secondary = $6,
            same_day_cancel = $7, status = $8, payment = $9, group_type = $10, group_size = $11, is_child = $12, updated_at = NOW()
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
          ]
        );
      } else if (entity_type === 'payments') {
        const o = old_data;
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
        const o = old_data;
        await query(
          `UPDATE notes SET student_id = $2, staff = $3, note = $4, date = $5 WHERE id = $1`,
          [o.id, o.student_id, o.staff ?? '', o.note ?? '', o.date]
        );
      } else if (entity_type === 'lessons') {
        const o = old_data;
        await query(
          `INSERT INTO lessons (student_id, month, lessons) VALUES ($1, $2, $3)
           ON CONFLICT (student_id, month) DO UPDATE SET lessons = EXCLUDED.lessons`,
          [o.student_id, o.month, o.lessons ?? 0]
        );
      } else if (entity_type === 'monthly_schedule') {
        const o = old_data;
        await query(
          `UPDATE monthly_schedule SET title = $3, date = $4::date, start = $5::timestamptz, "end" = $6::timestamptz,
            status = $7, is_kids_lesson = $8, teacher_name = $9
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
          ]
        );
      }
    } else if (action === 'create' && new_data) {
      if (entity_type === 'students') {
        const n = new_data;
        await query('DELETE FROM students WHERE id = $1', [n.id]);
      } else if (entity_type === 'payments') {
        const n = new_data;
        await query('DELETE FROM payments WHERE transaction_id = $1', [n.transaction_id]);
      } else if (entity_type === 'notes') {
        const n = new_data;
        await query('DELETE FROM notes WHERE id = $1', [n.id]);
      } else if (entity_type === 'lessons') {
        const n = new_data;
        await query('DELETE FROM lessons WHERE student_id = $1 AND month = $2', [n.student_id, n.month]);
      } else if (entity_type === 'monthly_schedule') {
        const n = new_data;
        await query(
          'DELETE FROM monthly_schedule WHERE event_id = $1 AND student_name = $2',
          [n.event_id, n.student_name]
        );
      }
    } else if (action === 'delete' && old_data) {
      if (entity_type === 'students') {
        const o = old_data;
        await query(
          `INSERT INTO students (id, name, name_kanji, email, phone, phone_secondary, same_day_cancel, status, payment, group_type, group_size, is_child)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
          ]
        );
      } else if (entity_type === 'payments') {
        const o = old_data;
        await query(
          `INSERT INTO payments (transaction_id, student_id, year, month, amount, discount, total, date, method, staff)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
        const o = old_data;
        await query(
          `INSERT INTO notes (id, student_id, staff, note, date) VALUES ($1, $2, $3, $4, $5)`,
          [o.id, o.student_id, o.staff ?? '', o.note ?? '', o.date]
        );
        await query("SELECT setval('notes_id_seq', (SELECT COALESCE(MAX(id), 1) FROM notes))");
      } else if (entity_type === 'lessons') {
        const o = old_data;
        await query(
          `INSERT INTO lessons (student_id, month, lessons) VALUES ($1, $2, $3)`,
          [o.student_id, o.month, o.lessons ?? 0]
        );
      } else if (entity_type === 'monthly_schedule') {
        const o = old_data;
        await query(
          `INSERT INTO monthly_schedule (event_id, title, date, start, "end", status, student_name, is_kids_lesson, teacher_name)
           VALUES ($1, $2, $3::date, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9)`,
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
          ]
        );
      }
    }

    await logChange(
      {
        entityType: entity_type,
        entityKey: entity_key,
        action: 'undo',
        oldData: new_data,
        newData: old_data,
      },
      req
    );

    res.json({ ok: true, message: 'Change undone' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
