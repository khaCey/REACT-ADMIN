/**
 * Shift management: week view and assign (admin or operator).
 * Shift types: weekday_morning (Tue–Fri 10–16), weekday_evening (Tue–Fri 16–21), weekend (Sat/Sun/Mon 10–17).
 */
import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth, requireAdminOrOperator } from '../middleware/auth.js';

const router = Router();

const SHIFT_DEFAULTS = {
  weekday_morning: { start: '10:00', end: '16:00' },
  weekday_evening: { start: '16:00', end: '21:00' },
  weekend: { start: '10:00', end: '17:00' },
};

/** Normalize to YYYY-MM-DD (node-pg may return Date objects). */
function toDateStr(val) {
  if (val == null) return '';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const s = String(val).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/** 0=Sun, 1=Mon, ..., 6=Sat. Weekday = Tue–Fri (2–5), Weekend = Sat/Sun/Mon (0,1,6). Relaxed ranges so custom times (e.g. 10–17, 17–21) still classify. */
function getShiftType(dow, startStr, endStr) {
  const start = (startStr || '').slice(0, 5);
  const end = (endStr || '').slice(0, 5);
  if ([0, 1, 6].includes(dow)) {
    return 'weekend';
  }
  if ([2, 3, 4, 5].includes(dow)) {
    if (start >= '06:00' && start <= '12:00' && end >= '12:00' && end <= '20:00') return 'weekday_morning';
    if (start >= '12:00' && start <= '20:00' && end >= '18:00' && end <= '23:00') return 'weekday_evening';
  }
  return null;
}

/** GET /api/shifts/week?week_start=YYYY-MM-DD - shifts for the week (Monday = week_start) */
router.get('/week', requireAuth, requireAdminOrOperator, async (req, res) => {
  try {
    const weekStart = req.query.week_start;
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({ error: 'Query week_start required (YYYY-MM-DD)' });
    }
    const startDate = new Date(weekStart + 'T12:00:00Z');
    if (isNaN(startDate.getTime())) {
      return res.status(400).json({ error: 'Invalid week_start date' });
    }

    const [schedResult, overridesResult] = await Promise.all([
      query(
        `SELECT date, teacher_name, start_time, end_time
         FROM teacher_schedules
         WHERE date >= $1::date AND date < $1::date + interval '7 days'
         ORDER BY date, start_time`,
        [weekStart]
      ),
      query(
        `SELECT date, shift_type, start_time, end_time
         FROM shift_slot_overrides
         WHERE date >= $1::date AND date < $1::date + interval '7 days'`,
        [weekStart]
      ),
    ]);
    const result = schedResult;

    const overridesByKey = {};
    for (const row of overridesResult.rows) {
      const dateStr = toDateStr(row.date);
      if (!dateStr) continue;
      const key = `${dateStr}:${row.shift_type}`;
      overridesByKey[key] = {
        start_time: row.start_time ? String(row.start_time).slice(0, 5) : null,
        end_time: row.end_time ? String(row.end_time).slice(0, 5) : null,
      };
    }

    const slots = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setUTCDate(d.getUTCDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const dow = d.getUTCDay();
      if ([2, 3, 4, 5].includes(dow)) {
        slots.push({ date: dateStr, shift_type: 'weekday_morning', ...SHIFT_DEFAULTS.weekday_morning });
        slots.push({ date: dateStr, shift_type: 'weekday_evening', ...SHIFT_DEFAULTS.weekday_evening });
      } else {
        slots.push({ date: dateStr, shift_type: 'weekend', ...SHIFT_DEFAULTS.weekend });
      }
    }

    const byKey = {};
    for (const row of result.rows) {
      const dateStr = toDateStr(row.date);
      if (!dateStr) continue;
      const d = new Date(dateStr + 'T12:00:00Z');
      const dow = d.getUTCDay();
      const startStr = row.start_time ? String(row.start_time).slice(0, 5) : '';
      const endStr = row.end_time ? String(row.end_time).slice(0, 5) : '';
      const shiftType = getShiftType(dow, startStr, endStr);
      if (!shiftType) continue;
      const key = `${dateStr}:${shiftType}`;
      byKey[key] = {
        date: dateStr,
        shift_type: shiftType,
        staff_name: row.teacher_name,
        start_time: startStr || SHIFT_DEFAULTS[shiftType].start,
        end_time: endStr || SHIFT_DEFAULTS[shiftType].end,
      };
    }

    const rowByShiftType = { weekend: 'am', weekday_morning: 'am', weekday_evening: 'pm' };
    const week = slots.map((s) => {
      const key = `${s.date}:${s.shift_type}`;
      const assigned = byKey[key];
      const override = overridesByKey[key];
      let startTime = s.start;
      let endTime = s.end;
      if (override?.start_time) startTime = override.start_time;
      if (override?.end_time) endTime = override.end_time;
      if (assigned?.start_time) startTime = assigned.start_time;
      if (assigned?.end_time) endTime = assigned.end_time;
      if (s.shift_type === 'weekend' && startTime === '16:00' && endTime === '21:00') {
        startTime = SHIFT_DEFAULTS.weekend.start;
        endTime = SHIFT_DEFAULTS.weekend.end;
      }
      return {
        date: s.date,
        shift_type: s.shift_type,
        row: rowByShiftType[s.shift_type] ?? 'am',
        default_start: s.start,
        default_end: s.end,
        staff_name: assigned?.staff_name ?? null,
        start_time: startTime,
        end_time: endTime,
      };
    });

    res.json({ week });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/shifts/assign - assign staff to a (date, shift_type); optional start_time/end_time override */
router.put('/assign', requireAuth, requireAdminOrOperator, async (req, res) => {
  try {
    const { date: dateStr, shift_type: shiftType, staff_id, staff_name, start_time: customStart, end_time: customEnd } = req.body || {};
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: 'Body date required (YYYY-MM-DD)' });
    }
    const validTypes = ['weekday_morning', 'weekday_evening', 'weekend'];
    if (!shiftType || !validTypes.includes(shiftType)) {
      return res.status(400).json({ error: 'Body shift_type required (weekday_morning, weekday_evening, weekend)' });
    }

    let teacherName = null;
    if (staff_id != null && staff_id !== '') {
      const id = parseInt(staff_id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid staff_id' });
      const r = await query('SELECT name FROM staff WHERE id = $1', [id]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Staff not found' });
      teacherName = r.rows[0].name;
    } else if (typeof staff_name === 'string' && staff_name.trim()) {
      teacherName = staff_name.trim();
    }
    // teacherName remains null to clear assignment

    const d = new Date(dateStr + 'T12:00:00Z');
    const dow = d.getUTCDay();
    const defaults = SHIFT_DEFAULTS[shiftType];
    if (!defaults) return res.status(400).json({ error: 'Invalid shift_type' });

    const dayOk = (shiftType === 'weekend' && [0, 1, 6].includes(dow)) ||
      (shiftType !== 'weekend' && [2, 3, 4, 5].includes(dow));
    if (!dayOk) {
      return res.status(400).json({ error: `Shift type ${shiftType} does not apply to this day` });
    }

    const startTime = (typeof customStart === 'string' && customStart.trim()) ? customStart.trim().slice(0, 5) : defaults.start;
    const endTime = (typeof customEnd === 'string' && customEnd.trim()) ? customEnd.trim().slice(0, 5) : defaults.end;

    const existing = await query(
      `SELECT date, teacher_name, start_time, end_time FROM teacher_schedules
       WHERE date = $1::date`,
      [dateStr]
    );

    for (const row of existing.rows) {
      const st = row.start_time ? String(row.start_time).slice(0, 5) : '';
      const et = row.end_time ? String(row.end_time).slice(0, 5) : '';
      const existingType = getShiftType(dow, st, et);
      if (existingType === shiftType) {
        await query(
          'DELETE FROM teacher_schedules WHERE date = $1::date AND teacher_name = $2 AND start_time = $3::time',
          [dateStr, row.teacher_name, row.start_time]
        );
      }
    }

    if (teacherName) {
      await query(
        `INSERT INTO teacher_schedules (date, teacher_name, start_time, end_time)
         VALUES ($1::date, $2, $3::time, $4::time)
         ON CONFLICT (date, teacher_name, start_time) DO UPDATE SET end_time = $4::time`,
        [dateStr, teacherName, startTime, endTime]
      );
      await query(
        'DELETE FROM shift_slot_overrides WHERE date = $1::date AND shift_type = $2',
        [dateStr, shiftType]
      );
    } else if (customStart || customEnd) {
      await query(
        `INSERT INTO shift_slot_overrides (date, shift_type, start_time, end_time)
         VALUES ($1::date, $2, $3::time, $4::time)
         ON CONFLICT (date, shift_type) DO UPDATE SET start_time = $3::time, end_time = $4::time`,
        [dateStr, shiftType, startTime, endTime]
      );
    }

    const isWeekday = [2, 3, 4, 5].includes(dow);
    if (isWeekday && shiftType === 'weekday_morning' && (typeof customEnd === 'string' && customEnd.trim())) {
      const handover = customEnd.trim().slice(0, 5);
      const eveningDefault = SHIFT_DEFAULTS.weekday_evening;
      const eveningEnd = eveningDefault.end;
      for (const row of existing.rows) {
        const st = row.start_time ? String(row.start_time).slice(0, 5) : '';
        const et = row.end_time ? String(row.end_time).slice(0, 5) : '';
        if (getShiftType(dow, st, et) === 'weekday_evening') {
          const rowEnd = et || eveningEnd;
          await query(
            'DELETE FROM teacher_schedules WHERE date = $1::date AND teacher_name = $2 AND start_time = $3::time',
            [dateStr, row.teacher_name, row.start_time]
          );
          await query(
            `INSERT INTO teacher_schedules (date, teacher_name, start_time, end_time) VALUES ($1::date, $2, $3::time, $4::time)`,
            [dateStr, row.teacher_name, handover, rowEnd]
          );
        }
      }
      await query(
        `INSERT INTO shift_slot_overrides (date, shift_type, start_time, end_time)
         VALUES ($1::date, 'weekday_evening', $2::time, $3::time)
         ON CONFLICT (date, shift_type) DO UPDATE SET start_time = $2::time`,
        [dateStr, handover, eveningEnd]
      );
    }
    if (isWeekday && shiftType === 'weekday_evening' && (typeof customStart === 'string' && customStart.trim())) {
      const handover = customStart.trim().slice(0, 5);
      const morningDefault = SHIFT_DEFAULTS.weekday_morning;
      const morningStart = morningDefault.start;
      for (const row of existing.rows) {
        const st = row.start_time ? String(row.start_time).slice(0, 5) : '';
        const et = row.end_time ? String(row.end_time).slice(0, 5) : '';
        if (getShiftType(dow, st, et) === 'weekday_morning') {
          await query(
            'UPDATE teacher_schedules SET end_time = $1::time WHERE date = $2::date AND teacher_name = $3 AND start_time = $4::time',
            [handover, dateStr, row.teacher_name, row.start_time]
          );
        }
      }
      await query(
        `INSERT INTO shift_slot_overrides (date, shift_type, start_time, end_time)
         VALUES ($1::date, 'weekday_morning', $2::time, $3::time)
         ON CONFLICT (date, shift_type) DO UPDATE SET end_time = $3::time`,
        [dateStr, morningStart, handover]
      );
    }

    res.json({ ok: true, date: dateStr, shift_type: shiftType, staff_name: teacherName, start_time: startTime, end_time: endTime });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
