import { Router } from 'express';
import { query } from '../db/index.js';
import { logChange } from '../lib/changeLog.js';

const router = Router();

/** Test route: GET /api/schedule returns 200 so the mount can be verified */
router.get('/', (req, res) => res.json({ ok: true, message: 'Schedule API' }));

/** Get scheduled events and teacher shifts for a week (booking calendar). week_start = YYYY-MM-DD (Monday). */
router.get('/week', async (req, res) => {
  try {
    const weekStart = req.query.week_start;
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({ error: 'Query week_start required (YYYY-MM-DD)' });
    }
    const [scheduleResult, teachersResult] = await Promise.all([
      query(
        `SELECT date, start, status FROM monthly_schedule
         WHERE date >= $1::date AND date < $1::date + interval '7 days'
         AND (status IS NULL OR status <> 'cancelled')
         ORDER BY date, start`,
        [weekStart]
      ),
      query(
        `SELECT date, teacher_name, start_time, end_time FROM teacher_schedules
         WHERE date >= $1::date AND date < $1::date + interval '7 days'
         ORDER BY date, teacher_name, start_time`,
        [weekStart]
      ),
    ]);
    const bySlot = {};
    for (const r of scheduleResult.rows) {
      const dateStr = r.date ? String(r.date).trim().slice(0, 10) : '';
      const s = r.start ? new Date(r.start) : null;
      const timeStr = s && !isNaN(s.getTime())
        ? `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`
        : '';
      if (!dateStr || !timeStr) continue;
      const key = `${dateStr}T${timeStr}`;
      bySlot[key] = (bySlot[key] || 0) + 1;
    }
    const teachersBySlot = {};
    const TIME_SLOTS = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
    for (const r of teachersResult.rows) {
      const dateStr = r.date ? String(r.date).trim().slice(0, 10) : '';
      if (!dateStr) continue;
      const startT = r.start_time ? String(r.start_time).slice(0, 5) : '';
      const endT = r.end_time ? String(r.end_time).slice(0, 5) : '';
      if (!startT || !endT) continue;
      for (const timeStr of TIME_SLOTS) {
        if (timeStr >= startT && timeStr < endT) {
          const key = `${dateStr}T${timeStr}`;
          if (!teachersBySlot[key]) teachersBySlot[key] = [];
          teachersBySlot[key].push(r.teacher_name);
        }
      }
    }
    for (const k of Object.keys(teachersBySlot)) {
      teachersBySlot[k] = [...new Set(teachersBySlot[k])].sort();
    }
    res.json({ slots: bySlot, teachersBySlot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/schedule/booking-warning?date=YYYY-MM-DD&time=HH:MM&student_id= - warn if this booking would leave a teacher with no break in 5+ hours. Does not block. */
router.get('/booking-warning', async (req, res) => {
  try {
    const { date: dateQ, time: timeQ, student_id: studentId } = req.query || {};
    if (!dateQ || !timeQ) {
      return res.json({ warn: false });
    }
    // Stub: per-lesson teacher assignment and shift data are TBD; when available, check if any teacher would have 5+ hours without break.
    res.json({ warn: false, message: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/schedule/teachers?date=YYYY-MM-DD - list teachers with shifts and extensions for a date. */
router.get('/teachers', async (req, res) => {
  try {
    const dateStr = req.query.date;
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: 'Query date required (YYYY-MM-DD)' });
    }
    const shifts = await query(
      `SELECT t.teacher_name, t.start_time, t.end_time,
              COALESCE(e.extend_before_minutes, 0) AS extend_before_minutes,
              COALESCE(e.extend_after_minutes, 0) AS extend_after_minutes
       FROM teacher_schedules t
       LEFT JOIN teacher_shift_extensions e ON e.date = t.date AND e.teacher_name = t.teacher_name
       WHERE t.date = $1::date
       ORDER BY t.teacher_name, t.start_time`,
      [dateStr]
    );
    res.json({ teachers: shifts.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/schedule/extend?date=YYYY-MM-DD&teacher_name= - get shift extension for a teacher on a date. */
router.get('/extend', async (req, res) => {
  try {
    const { date: dateStr, teacher_name: teacherName } = req.query || {};
    if (!dateStr || !teacherName) {
      return res.status(400).json({ error: 'Query date and teacher_name required' });
    }
    const r = await query(
      'SELECT extend_before_minutes, extend_after_minutes FROM teacher_shift_extensions WHERE date = $1::date AND teacher_name = $2',
      [dateStr, teacherName]
    );
    if (r.rows.length === 0) {
      return res.json({ extend_before_minutes: 0, extend_after_minutes: 0 });
    }
    const row = r.rows[0];
    res.json({
      extend_before_minutes: parseInt(row.extend_before_minutes, 10) || 0,
      extend_after_minutes: parseInt(row.extend_after_minutes, 10) || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/schedule/extend - set shift extension (up to 120 minutes before/after). Creates row if teacher has a shift on that date. */
router.put('/extend', async (req, res) => {
  try {
    const { date: dateStr, teacher_name: teacherName, extend_before_minutes, extend_after_minutes } = req.body || {};
    if (!dateStr || !teacherName) {
      return res.status(400).json({ error: 'Body date and teacher_name required' });
    }
    const before = Math.min(120, Math.max(0, parseInt(extend_before_minutes, 10) || 0));
    const after = Math.min(120, Math.max(0, parseInt(extend_after_minutes, 10) || 0));
    const hasShift = await query(
      'SELECT 1 FROM teacher_schedules WHERE date = $1::date AND teacher_name = $2 LIMIT 1',
      [dateStr, teacherName]
    );
    if (hasShift.rows.length === 0) {
      return res.status(400).json({ error: 'No shift found for this teacher on this date. Add a base shift first.' });
    }
    await query(
      `INSERT INTO teacher_shift_extensions (date, teacher_name, extend_before_minutes, extend_after_minutes)
       VALUES ($1::date, $2, $3, $4)
       ON CONFLICT (date, teacher_name) DO UPDATE SET extend_before_minutes = $3, extend_after_minutes = $4`,
      [dateStr, teacherName, before, after]
    );
    res.json({ ok: true, extend_before_minutes: before, extend_after_minutes: after });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Book a new lesson: insert into monthly_schedule. */
router.post('/book', async (req, res) => {
  try {
    const { student_id, date, time, duration_minutes } = req.body || {};
    if (!student_id || !date || !time) {
      return res.status(400).json({ error: 'Missing student_id, date, or time' });
    }
    const studentResult = await query(
      'SELECT id, name, is_child FROM students WHERE id = $1',
      [student_id]
    );
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const student = studentResult.rows[0];
    const studentName = (student.name || '').trim();
    if (!studentName) {
      return res.status(400).json({ error: 'Student has no name' });
    }
    const duration = Math.min(120, Math.max(30, Number(duration_minutes) || 50));
    const dateStr = String(date).trim().slice(0, 10);
    const [hh, mm] = String(time).trim().split(/[:\s]/).map((x) => parseInt(x, 10) || 0);
    const startIso = `${dateStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
    const startDate = new Date(startIso);
    if (isNaN(startDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date or time' });
    }
    const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

    // Advance booking limit: max 90 days
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const bookingDay = new Date(startDate);
    bookingDay.setHours(0, 0, 0, 0);
    const daysAhead = Math.round((bookingDay - today) / (24 * 60 * 60 * 1000));
    if (daysAhead > 90) {
      return res.status(400).json({
        error: 'Cannot book more than 90 days in advance. Please choose a date within the next 90 days.',
      });
    }

    // Kids vs adults separation: no mixing in the same time slot
    const existingResult = await query(
      `SELECT is_kids_lesson FROM monthly_schedule
       WHERE (status IS NULL OR status <> 'cancelled')
         AND start < $2::timestamptz AND "end" > $1::timestamptz`,
      [startDate.toISOString(), endDate.toISOString()]
    );
    const isChild = !!student.is_child;
    for (const row of existingResult.rows) {
      const existingIsKids = !!row.is_kids_lesson;
      if (isChild && !existingIsKids) {
        return res.status(400).json({
          error: 'Cannot book a kids lesson in a time slot that contains adult lessons. Kids and adults must be kept separate.',
        });
      }
      if (!isChild && existingIsKids) {
        return res.status(400).json({
          error: 'Cannot book an adult lesson in a time slot that contains kids lessons. Kids and adults must be kept separate.',
        });
      }
    }

    // Max simultaneous lessons = teachers available in that slot (including shift extensions up to 2h before/after)
    const slotMinutes = startDate.getHours() * 60 + startDate.getMinutes();
    const teacherRows = await query(
      `SELECT t.teacher_name, t.start_time, t.end_time,
              COALESCE(e.extend_before_minutes, 0) AS extend_before_minutes,
              COALESCE(e.extend_after_minutes, 0) AS extend_after_minutes
       FROM teacher_schedules t
       LEFT JOIN teacher_shift_extensions e ON e.date = t.date AND e.teacher_name = t.teacher_name
       WHERE t.date = $1::date`,
      [dateStr]
    );
    const teacherSet = new Set();
    for (const r of teacherRows.rows) {
      const s = r.start_time ? new Date(`1970-01-01T${r.start_time}`) : null;
      const e = r.end_time ? new Date(`1970-01-01T${r.end_time}`) : null;
      const startMin = s ? s.getHours() * 60 + s.getMinutes() : 0;
      const endMin = e ? e.getHours() * 60 + e.getMinutes() : 24 * 60;
      const before = Math.min(120, parseInt(r.extend_before_minutes, 10) || 0);
      const after = Math.min(120, parseInt(r.extend_after_minutes, 10) || 0);
      const effectiveStart = startMin - before;
      const effectiveEnd = endMin + after;
      if (slotMinutes >= effectiveStart && slotMinutes < effectiveEnd) teacherSet.add(r.teacher_name);
    }
    let teacherCount = teacherSet.size;
    if (teacherCount === 0) teacherCount = 1;
    const lessonCountResult = await query(
      `SELECT COUNT(DISTINCT event_id) AS cnt FROM monthly_schedule
       WHERE (status IS NULL OR status <> 'cancelled')
         AND start < $2::timestamptz AND "end" > $1::timestamptz`,
      [startDate.toISOString(), endDate.toISOString()]
    );
    const currentLessonCount = parseInt(lessonCountResult.rows[0]?.cnt, 10) || 0;
    if (currentLessonCount >= teacherCount) {
      return res.status(400).json({
        error: `No availability: this slot has ${teacherCount} teacher(s) and ${currentLessonCount} lesson(s) already booked.`,
      });
    }

    const eventId = `booked-${Date.now()}-${student_id}`;
    const title = `${studentName}${student.is_child ? ' 子' : ''} (Lesson)`;
    const insertResult = await query(
      `INSERT INTO monthly_schedule (event_id, title, date, start, "end", status, student_name, is_kids_lesson, teacher_name)
       VALUES ($1, $2, $3::date, $4::timestamptz, $5::timestamptz, 'scheduled', $6, $7, NULL)
       RETURNING *`,
      [
        eventId,
        title,
        dateStr,
        startDate.toISOString(),
        endDate.toISOString(),
        studentName,
        !!student.is_child,
      ]
    );
    const newRow = insertResult.rows[0];
    if (newRow) {
      await logChange(
        {
          entityType: 'monthly_schedule',
          entityKey: `${eventId}_${studentName}`,
          action: 'create',
          oldData: null,
          newData: newRow,
        },
        req
      );
    }
    res.status(201).json({
      ok: true,
      event_id: eventId,
      date: dateStr,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Extract eventId from path (handles @ and dots). Express regex capture group index can vary. */
function getEventIdFromPath(path, suffix) {
  const match = path && path.match(new RegExp(`^/(.+)/${suffix}`));
  const raw = match ? match[1] : '';
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

/** Cancel a scheduled lesson (set status to cancelled). eventId can contain @ and dots (e.g. email_date). */
router.patch(/^\/(.+)\/cancel\/?$/, async (req, res) => {
  try {
    const eventId = getEventIdFromPath(req.path, 'cancel') || decodeURIComponent((req.params[0] || req.params[1] || '').trim());
    const oldRows = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [eventId])).rows;
    if (oldRows.length === 0) {
      return res.status(404).json({ error: 'Event not found', event_id: eventId });
    }
    await query(`UPDATE monthly_schedule SET status = 'cancelled' WHERE event_id = $1`, [eventId]);
    const newRows = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [eventId])).rows;
    for (let i = 0; i < oldRows.length; i++) {
      const oldRow = oldRows[i];
      const newRow = newRows.find((r) => r.student_name === oldRow.student_name) || oldRow;
      await logChange(
        {
          entityType: 'monthly_schedule',
          entityKey: `${eventId}_${oldRow.student_name}`,
          action: 'update',
          oldData: oldRow,
          newData: newRow,
        },
        req
      );
    }
    res.json({ ok: true, event_id: eventId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Uncancel a lesson (set status back to scheduled). eventId can contain @ and dots. */
router.patch(/^\/(.+)\/uncancel\/?$/, async (req, res) => {
  try {
    const eventId = getEventIdFromPath(req.path, 'uncancel') || decodeURIComponent((req.params[0] || req.params[1] || '').trim());
    const oldRows = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [eventId])).rows;
    if (oldRows.length === 0) {
      return res.status(404).json({ error: 'Event not found', event_id: eventId });
    }
    await query(`UPDATE monthly_schedule SET status = 'scheduled' WHERE event_id = $1`, [eventId]);
    const newRows = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [eventId])).rows;
    for (let i = 0; i < oldRows.length; i++) {
      const oldRow = oldRows[i];
      const newRow = newRows.find((r) => r.student_name === oldRow.student_name) || oldRow;
      await logChange(
        {
          entityType: 'monthly_schedule',
          entityKey: `${eventId}_${oldRow.student_name}`,
          action: 'update',
          oldData: oldRow,
          newData: newRow,
        },
        req
      );
    }
    res.json({ ok: true, event_id: eventId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Reschedule a lesson (update date and/or start/end time). eventId can contain @ and dots. */
router.patch(/^\/(.+)\/reschedule\/?$/, async (req, res) => {
  try {
    const eventId = getEventIdFromPath(req.path, 'reschedule') || decodeURIComponent((req.params[0] || req.params[1] || '').trim());
    const { date, start, end } = req.body || {};
    const oldRows = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [eventId])).rows;
    if (oldRows.length === 0) {
      return res.status(404).json({ error: 'Event not found', event_id: eventId });
    }
    const updates = [];
    const values = [];
    let i = 1;
    if (date != null && date !== '') {
      updates.push(`date = $${i}::date`);
      values.push(date);
      i++;
    }
    if (start != null && start !== '') {
      updates.push(`start = $${i}::timestamptz`);
      values.push(start);
      i++;
    }
    if (end != null && end !== '') {
      updates.push(`"end" = $${i}::timestamptz`);
      values.push(end);
      i++;
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Provide at least one of date, start, end' });
    }
    values.push(eventId);
    await query(
      `UPDATE monthly_schedule SET ${updates.join(', ')} WHERE event_id = $${i}`,
      values
    );
    const newRows = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [eventId])).rows;
    for (let j = 0; j < oldRows.length; j++) {
      const oldRow = oldRows[j];
      const newRow = newRows.find((r) => r.student_name === oldRow.student_name) || oldRow;
      await logChange(
        {
          entityType: 'monthly_schedule',
          entityKey: `${eventId}_${oldRow.student_name}`,
          action: 'update',
          oldData: oldRow,
          newData: newRow,
        },
        req
      );
    }
    res.json({ ok: true, event_id: eventId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Remove a lesson (delete from monthly_schedule). eventId can contain @ and dots. */
router.delete(/^\/(.+)\/?$/, async (req, res) => {
  try {
    const rawPath = (req.path || req.url || '').replace(/\?.*$/, '');
    const m = rawPath.match(/^\/(.+)\/?$/);
    const eventId = (m ? decodeURIComponent(m[1]).trim() : '') || decodeURIComponent((req.params[0] || req.params[1] || '').trim());
    const oldRows = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [eventId])).rows;
    if (oldRows.length === 0) {
      return res.status(404).json({ error: 'Event not found', event_id: eventId });
    }
    await query('DELETE FROM monthly_schedule WHERE event_id = $1', [eventId]);
    for (const oldRow of oldRows) {
      await logChange(
        {
          entityType: 'monthly_schedule',
          entityKey: `${eventId}_${oldRow.student_name}`,
          action: 'delete',
          oldData: oldRow,
          newData: null,
        },
        req
      );
    }
    res.json({ ok: true, event_id: eventId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
