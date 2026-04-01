/**
 * Shift management: week view and assign (admin or operator).
 * Shift types: weekday_morning (Tue–Fri 10–16), weekday_evening (Tue–Fri 16–21), weekend (Sat/Sun/Mon 10–17).
 */
import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth, requireAdminOrOperator } from '../middleware/auth.js';
import { roundJstWallTimeToNearestHour, roundTeacherShiftStartEnd } from '../lib/timezone.js';

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

function parseClock5(val) {
  const s = String(val || '').trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : '';
}

/** Presets are 1 hour when `end_time` is omitted. */
function endTimeOneHourAfterStart(startHHMM) {
  const start = parseClock5(startHHMM);
  if (!start) return '';
  const [h, m] = start.split(':').map(Number);
  let total = h * 60 + m + 60;
  if (total > 24 * 60) total = 24 * 60;
  if (total === 24 * 60) return '23:59';
  const eh = Math.floor(total / 60);
  const em = total % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

function parseWeekday(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n >= 0 && n <= 6 ? n : NaN;
}

function normalizeTeacherNameKey(s) {
  return String(s || '').trim().toLowerCase();
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

/** Expand recurring presets into date rows for week_start..+6 days (only if teacher has a shift that day). */
function expandBreakPresetsForWeek(weekStart, presets, shiftRows) {
  const namesByDate = {};
  for (const r of shiftRows || []) {
    const date = toDateStr(r.date);
    if (!date) continue;
    const tn = normalizeTeacherNameKey(r.teacher_name);
    if (!tn) continue;
    if (!namesByDate[date]) namesByDate[date] = new Set();
    namesByDate[date].add(tn);
  }
  const out = [];
  const startDate = new Date(`${weekStart}T12:00:00Z`);
  if (Number.isNaN(startDate.getTime())) return out;
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + i);
    const dow = d.getUTCDay();
    const date = d.toISOString().slice(0, 10);
    const onDay = namesByDate[date];
    for (const p of presets || []) {
      const pDow = parseInt(p.weekday, 10);
      if (!Number.isFinite(pDow) || pDow !== dow) continue;
      if (!onDay || !onDay.has(normalizeTeacherNameKey(p.teacher_name))) continue;
      const start = parseClock5(p.start_time);
      const end = parseClock5(p.end_time);
      if (!start || !end) continue;
      out.push({
        id: p.id,
        date,
        teacher_name: p.teacher_name,
        start_time: start,
        end_time: end,
        weekday: pDow,
        kind: 'preset_break',
      });
    }
  }
  return out;
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
      if (override?.start_time) {
        if (s.shift_type === 'weekday_evening' && override.start_time < '14:00') {
          // Ignore invalid evening override (e.g. 12:00 from stale link); keep default 16:00
        } else {
          startTime = override.start_time;
        }
      }
      if (override?.end_time) endTime = override.end_time;
      if (assigned?.start_time) startTime = assigned.start_time;
      if (assigned?.end_time) endTime = assigned.end_time;
      if (s.shift_type === 'weekend' && startTime === '16:00' && endTime === '21:00') {
        startTime = SHIFT_DEFAULTS.weekend.start;
        endTime = SHIFT_DEFAULTS.weekend.end;
      }
      const displayTimes = roundTeacherShiftStartEnd(startTime, endTime);
      return {
        date: s.date,
        shift_type: s.shift_type,
        row: rowByShiftType[s.shift_type] ?? 'am',
        default_start: s.start,
        default_end: s.end,
        staff_name: assigned?.staff_name ?? null,
        start_time: displayTimes.start_time,
        end_time: displayTimes.end_time,
      };
    });

    res.json({ week });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/shifts/teacher-calendar?week_start=YYYY-MM-DD - raw teacher_schedules for the week (for visualizer). */
router.get('/teacher-calendar', requireAuth, requireAdminOrOperator, async (req, res) => {
  try {
    const weekStart = req.query.week_start;
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({ error: 'Query week_start required (YYYY-MM-DD)' });
    }
    const [result, presetsResult] = await Promise.all([
      query(
        `SELECT date, teacher_name, start_time, end_time
         FROM teacher_schedules
         WHERE date >= $1::date AND date < $1::date + interval '7 days'
         ORDER BY teacher_name, date, start_time`,
        [weekStart]
      ),
      query(
        `SELECT id, teacher_name, weekday, start_time, end_time
         FROM teacher_break_presets
         WHERE active = TRUE`
      ),
    ]);
    const shiftEvents = result.rows.map((r) => {
      const date = toDateStr(r.date);
      const start0 = r.start_time ? String(r.start_time).slice(0, 5) : '';
      const end0 = r.end_time ? String(r.end_time).slice(0, 5) : '';
      if (!start0 || !end0) {
        return { date, teacher_name: r.teacher_name, start_time: start0, end_time: end0, kind: 'shift' };
      }
      const { start_time, end_time } = roundTeacherShiftStartEnd(start0, end0);
      return { date, teacher_name: r.teacher_name, start_time, end_time, kind: 'shift' };
    });
    const breakEvents = expandBreakPresetsForWeek(weekStart, presetsResult.rows, result.rows);
    const events = [...shiftEvents, ...breakEvents];
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/shifts/break-presets?teacher_name=&weekday= */
router.get('/break-presets', requireAuth, requireAdminOrOperator, async (req, res) => {
  try {
    const teacherName = String(req.query.teacher_name || '').trim();
    const weekdayRaw = req.query.weekday;
    const args = [];
    const where = [];
    if (teacherName) {
      args.push(teacherName);
      where.push(`teacher_name = $${args.length}`);
    }
    if (weekdayRaw != null && weekdayRaw !== '') {
      const weekday = parseWeekday(weekdayRaw);
      if (!Number.isFinite(weekday)) {
        return res.status(400).json({ error: 'weekday must be 0-6' });
      }
      args.push(weekday);
      where.push(`weekday = $${args.length}`);
    }
    const sql = `
      SELECT id, teacher_name, weekday, start_time, end_time, active
      FROM teacher_break_presets
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY teacher_name, weekday, start_time
    `;
    const result = await query(sql, args);
    const presets = result.rows.map((r) => ({
      id: r.id,
      teacher_name: r.teacher_name,
      weekday: parseInt(r.weekday, 10),
      start_time: parseClock5(r.start_time),
      end_time: parseClock5(r.end_time),
      active: r.active !== false,
    }));
    res.json({ presets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/shifts/break-presets */
router.post('/break-presets', requireAuth, requireAdminOrOperator, async (req, res) => {
  try {
    const teacherName = String(req.body?.teacher_name || '').trim();
    const weekday = parseWeekday(req.body?.weekday);
    const start = parseClock5(req.body?.start_time);
    let end = parseClock5(req.body?.end_time);
    if (!end) end = endTimeOneHourAfterStart(start);
    const active = req.body?.active !== false;
    if (!teacherName) return res.status(400).json({ error: 'teacher_name is required' });
    if (!Number.isFinite(weekday)) return res.status(400).json({ error: 'weekday must be 0-6' });
    if (!start || !end) return res.status(400).json({ error: 'start_time must be HH:MM' });
    if (!(end > start)) return res.status(400).json({ error: 'end_time must be after start_time' });

    const result = await query(
      `INSERT INTO teacher_break_presets (teacher_name, weekday, start_time, end_time, active)
       VALUES ($1, $2, $3::time, $4::time, $5)
       RETURNING id, teacher_name, weekday, start_time, end_time, active`,
      [teacherName, weekday, start, end, active]
    );
    const row = result.rows[0];
    res.status(201).json({
      preset: {
        id: row.id,
        teacher_name: row.teacher_name,
        weekday: parseInt(row.weekday, 10),
        start_time: parseClock5(row.start_time),
        end_time: parseClock5(row.end_time),
        active: row.active !== false,
      },
    });
  } catch (err) {
    if (String(err.message || '').includes('idx_teacher_break_presets_unique_window')) {
      return res.status(409).json({ error: 'Break preset already exists for that teacher/day/time.' });
    }
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/shifts/break-presets/:id */
router.put('/break-presets/:id', requireAuth, requireAdminOrOperator, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid preset id' });

    const current = await query('SELECT id FROM teacher_break_presets WHERE id = $1', [id]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Break preset not found' });

    const teacherName = String(req.body?.teacher_name || '').trim();
    const weekday = parseWeekday(req.body?.weekday);
    const start = parseClock5(req.body?.start_time);
    let end = parseClock5(req.body?.end_time);
    if (!end) end = endTimeOneHourAfterStart(start);
    const active = req.body?.active !== false;
    if (!teacherName) return res.status(400).json({ error: 'teacher_name is required' });
    if (!Number.isFinite(weekday)) return res.status(400).json({ error: 'weekday must be 0-6' });
    if (!start || !end) return res.status(400).json({ error: 'start_time must be HH:MM' });
    if (!(end > start)) return res.status(400).json({ error: 'end_time must be after start_time' });

    const result = await query(
      `UPDATE teacher_break_presets
       SET teacher_name = $1, weekday = $2, start_time = $3::time, end_time = $4::time, active = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING id, teacher_name, weekday, start_time, end_time, active`,
      [teacherName, weekday, start, end, active, id]
    );
    const row = result.rows[0];
    res.json({
      preset: {
        id: row.id,
        teacher_name: row.teacher_name,
        weekday: parseInt(row.weekday, 10),
        start_time: parseClock5(row.start_time),
        end_time: parseClock5(row.end_time),
        active: row.active !== false,
      },
    });
  } catch (err) {
    if (String(err.message || '').includes('idx_teacher_break_presets_unique_window')) {
      return res.status(409).json({ error: 'Break preset already exists for that teacher/day/time.' });
    }
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/shifts/break-presets/:id */
router.delete('/break-presets/:id', requireAuth, requireAdminOrOperator, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid preset id' });
    const result = await query('DELETE FROM teacher_break_presets WHERE id = $1', [id]);
    if ((result.rowCount || 0) === 0) return res.status(404).json({ error: 'Break preset not found' });
    res.json({ ok: true });
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

    let startTime = (typeof customStart === 'string' && customStart.trim()) ? customStart.trim().slice(0, 5) : defaults.start;
    let endTime = (typeof customEnd === 'string' && customEnd.trim()) ? customEnd.trim().slice(0, 5) : defaults.end;
    const roundedMain = roundTeacherShiftStartEnd(startTime, endTime);
    startTime = roundedMain.start_time;
    endTime = roundedMain.end_time;

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
      const handoverRaw = customEnd.trim().slice(0, 5);
      const eveningDefault = SHIFT_DEFAULTS.weekday_evening;
      const eveningEnd = eveningDefault.end;
      for (const row of existing.rows) {
        const st = row.start_time ? String(row.start_time).slice(0, 5) : '';
        const et = row.end_time ? String(row.end_time).slice(0, 5) : '';
        if (getShiftType(dow, st, et) === 'weekday_evening') {
          const rowEnd = et || eveningEnd;
          const { start_time: hoStart, end_time: hoEnd } = roundTeacherShiftStartEnd(handoverRaw, rowEnd);
          await query(
            'DELETE FROM teacher_schedules WHERE date = $1::date AND teacher_name = $2 AND start_time = $3::time',
            [dateStr, row.teacher_name, row.start_time]
          );
          await query(
            `INSERT INTO teacher_schedules (date, teacher_name, start_time, end_time) VALUES ($1::date, $2, $3::time, $4::time)`,
            [dateStr, row.teacher_name, hoStart, hoEnd]
          );
        }
      }
      const eveningOverride = roundTeacherShiftStartEnd(handoverRaw, eveningEnd);
      await query(
        `INSERT INTO shift_slot_overrides (date, shift_type, start_time, end_time)
         VALUES ($1::date, 'weekday_evening', $2::time, $3::time)
         ON CONFLICT (date, shift_type) DO UPDATE SET start_time = $2::time`,
        [dateStr, eveningOverride.start_time, eveningOverride.end_time]
      );
    }
    if (isWeekday && shiftType === 'weekday_evening' && (typeof customStart === 'string' && customStart.trim())) {
      const handoverRaw = customStart.trim().slice(0, 5);
      const handover = roundJstWallTimeToNearestHour(handoverRaw);
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
      const morningOverride = roundTeacherShiftStartEnd(morningStart, handover);
      await query(
        `INSERT INTO shift_slot_overrides (date, shift_type, start_time, end_time)
         VALUES ($1::date, 'weekday_morning', $2::time, $3::time)
         ON CONFLICT (date, shift_type) DO UPDATE SET end_time = $3::time`,
        [dateStr, morningOverride.start_time, morningOverride.end_time]
      );
    }

    res.json({ ok: true, date: dateStr, shift_type: shiftType, staff_name: teacherName, start_time: startTime, end_time: endTime });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
