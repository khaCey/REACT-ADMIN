import { Router } from 'express';
import { query } from '../db/index.js';
import { logChange } from '../lib/changeLog.js';
import { parseJstToUtc, getTodayJstDateStr, getJstMinutesOfDay } from '../lib/timezone.js';
import {
  BOOKING_DISABLED_STUDENT_IDS,
  bookingDisabledStudentIdsArray,
} from '../lib/bookingExclusions.js';
import {
  buildTeachingHoursByTeacher,
  findAssignableTeachers,
  jstHourLabelFromUtc,
  pickTeacherForBooking,
} from '../lib/teacherBreakRules.js';

const router = Router();

const GRID_TIME_SLOTS = [
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
  '19:00',
  '20:00',
];

/** Exclude break placeholder rows from capacity / overlap / mix (PostgreSQL). */
const SQL_NOT_STAFF_BREAK = `(m.lesson_kind IS NULL OR m.lesson_kind <> 'staff_break')`;

function addDaysToYyyyMmDd(dateStr, n) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

/** Test route: GET /api/schedule returns 200 so the mount can be verified */
router.get('/', (req, res) => res.json({ ok: true, message: 'Schedule API' }));

/**
 * Week grid for booking UI: booked counts + teacher capacity per hour slot (JST).
 *
 * Open slot (bookable) requirements — see also POST /book and docs/schedule-booking.md:
 * - Not in the past (client).
 * - At least one teacher on shift for that JST date/hour (teacher_schedules, with extensions).
 * - Booked lesson count for that hour < teacher count. Lessons are counted by distinct
 *   calendar event (event_id), so a group lesson (multiple students, same event_id) = 1.
 * - POST /book also enforces: max 90 days ahead, kids/adult separation in overlapping
 *   time range, overlap capacity using COUNT(DISTINCT event_id), and no duplicate
 *   overlapping lesson for the same student.
 * - Optional `student_id`: response includes `studentBookedSlots` (slot keys this student
 *   already occupies in the week) for booking UI.
 * - Rows for students in BOOKING_DISABLED_STUDENT_IDS are omitted (not counted in slots/slotMix).
 * - `breakRuleBlocked`: slot keys where spare capacity exists but no on-shift teacher can take another
 *   regular lesson without exceeding 5 consecutive JST teaching hours (see teacherBreakRules).
 * - `staffBreakBySlot`: keys -> [{ teacher_name, title }] for rows with lesson_kind staff_break (UI cards).
 */
router.get('/week', async (req, res) => {
  try {
    const weekStart = req.query.week_start;
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({ error: 'Query week_start required (YYYY-MM-DD)' });
    }
    const excludedStudentIds = bookingDisabledStudentIdsArray();
    const studentIdParam = req.query.student_id;
    const studentIdNum =
      studentIdParam != null && studentIdParam !== '' ? Number(studentIdParam) : NaN;
    let studentNameForGrid = null;
    if (Number.isFinite(studentIdNum)) {
      const sn = await query('SELECT name FROM students WHERE id = $1', [studentIdNum]);
      studentNameForGrid = (sn.rows[0]?.name || '').trim() || null;
    }
    const [scheduleResult, teachersResult] = await Promise.all([
      query(
        `SELECT
           to_char(m.start AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS date_jst,
           to_char(m.start AT TIME ZONE 'Asia/Tokyo', 'HH24') || ':00' AS time_jst,
           m.is_kids_lesson,
           m.event_id,
           m.student_name,
           m.student_id,
           m.lesson_kind,
           m.teacher_name,
           m.title
         FROM monthly_schedule m
         WHERE m.date >= $1::date AND m.date < $1::date + interval '7 days'
         AND (m.status IS NULL OR m.status <> 'cancelled')
         AND (m.student_id IS NULL OR NOT (m.student_id = ANY($2::int[])))
         ORDER BY m.date, m.start`,
        [weekStart, excludedStudentIds]
      ),
      query(
        `SELECT date, teacher_name, start_time, end_time FROM teacher_schedules
         WHERE date >= $1::date AND date < $1::date + interval '7 days'
         ORDER BY date, teacher_name, start_time`,
        [weekStart]
      ),
    ]);
    /** key -> bucket: distinct events + kids/adult flags for booking UI (matches POST /book mixing rules) */
    const slotBuckets = new Map();
    /** Slot keys -> list of { teacher_name, title } for lesson_kind staff_break (UI cards). */
    const staffBreakBySlot = {};
    for (const r of scheduleResult.rows) {
      const dateStr = r.date_jst ? String(r.date_jst).trim().slice(0, 10) : '';
      const timeStr = r.time_jst ? String(r.time_jst).trim().slice(0, 5) : '';
      if (!dateStr || !timeStr) continue;
      const kind = String(r.lesson_kind || '').trim();
      if (kind === 'staff_break') {
        const key = `${dateStr}T${timeStr}`;
        const tn = (r.teacher_name != null ? String(r.teacher_name).trim() : '') || 'Staff';
        if (!staffBreakBySlot[key]) staffBreakBySlot[key] = [];
        staffBreakBySlot[key].push({
          teacher_name: tn,
          title: (r.title != null ? String(r.title).trim() : '') || null,
        });
        continue;
      }
      const key = `${dateStr}T${timeStr}`;
      if (!slotBuckets.has(key)) {
        slotBuckets.set(key, { lessonKeys: new Set(), hasKids: false, hasAdult: false });
      }
      const bucket = slotBuckets.get(key);
      const eidRaw = r.event_id != null ? String(r.event_id).trim() : '';
      const dedupeKey = eidRaw
        ? `e:${eidRaw}`
        : `s:${String(r.student_name || '').trim()}:${dateStr}T${timeStr}`;
      bucket.lessonKeys.add(dedupeKey);
      if (r.is_kids_lesson) bucket.hasKids = true;
      else bucket.hasAdult = true;
    }
    const bySlot = {};
    const slotTypes = {};
    /** Per slot: which audience already has a lesson (hour bucket, JST). Client disables incompatible student type. */
    const slotMix = {};
    for (const [key, bucket] of slotBuckets) {
      bySlot[key] = bucket.lessonKeys.size;
      const { hasKids, hasAdult } = bucket;
      slotMix[key] = { hasKids, hasAdult };
      if (hasKids && hasAdult) slotTypes[key] = 'mixed';
      else if (hasKids) slotTypes[key] = 'kids';
      else slotTypes[key] = 'adult';
    }
    const teachersBySlot = {};
    for (const r of teachersResult.rows) {
      const dateStr = r.date ? String(r.date).trim().slice(0, 10) : '';
      if (!dateStr) continue;
      const startT = r.start_time ? String(r.start_time).slice(0, 5) : '';
      const endT = r.end_time ? String(r.end_time).slice(0, 5) : '';
      if (!startT || !endT) continue;
      for (const timeStr of GRID_TIME_SLOTS) {
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

    const teachersByJstDate = new Map();
    for (const r of teachersResult.rows) {
      const dateStr = r.date ? String(r.date).trim().slice(0, 10) : '';
      if (!dateStr) continue;
      if (!teachersByJstDate.has(dateStr)) teachersByJstDate.set(dateStr, new Set());
      teachersByJstDate.get(dateStr).add(r.teacher_name);
    }
    const scheduleRowsByJstDate = new Map();
    for (const r of scheduleResult.rows) {
      const dateStr = r.date_jst ? String(r.date_jst).trim().slice(0, 10) : '';
      if (!dateStr) continue;
      if (!scheduleRowsByJstDate.has(dateStr)) scheduleRowsByJstDate.set(dateStr, []);
      scheduleRowsByJstDate.get(dateStr).push(r);
    }
    const breakRuleBlocked = {};
    for (let di = 0; di < 7; di += 1) {
      const dateStr = addDaysToYyyyMmDd(weekStart, di);
      const dayRows = scheduleRowsByJstDate.get(dateStr) || [];
      const tset = teachersByJstDate.get(dateStr);
      const distinctTeachers = tset ? [...tset].sort() : [];
      const teachingMap = buildTeachingHoursByTeacher(dayRows, distinctTeachers);
      for (const timeStr of GRID_TIME_SLOTS) {
        const key = `${dateStr}T${timeStr}`;
        const teachers = teachersBySlot[key] || [];
        const booked = bySlot[key] || 0;
        if (teachers.length === 0 || booked >= teachers.length) continue;
        const assignable = findAssignableTeachers(teachers, teachingMap, timeStr);
        if (assignable.length === 0) breakRuleBlocked[key] = true;
      }
    }

    /** When `student_id` query is set, keys where that student already has a lesson this hour (JST bucket). */
    const studentBookedSlots = {};
    if (Number.isFinite(studentIdNum)) {
      for (const r of scheduleResult.rows) {
        const dateStr = r.date_jst ? String(r.date_jst).trim().slice(0, 10) : '';
        const timeStr = r.time_jst ? String(r.time_jst).trim().slice(0, 5) : '';
        if (!dateStr || !timeStr) continue;
        const key = `${dateStr}T${timeStr}`;
        const rowSid = r.student_id != null ? Number(r.student_id) : NaN;
        const rowName = (r.student_name || '').trim();
        const matchesId = Number.isFinite(rowSid) && rowSid === studentIdNum;
        const matchesLegacyName =
          !Number.isFinite(rowSid) &&
          studentNameForGrid &&
          rowName.toLowerCase() === studentNameForGrid.toLowerCase();
        if (matchesId || matchesLegacyName) studentBookedSlots[key] = true;
      }
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      slots: bySlot,
      teachersBySlot,
      slotTypes,
      slotMix,
      studentBookedSlots,
      breakRuleBlocked,
      staffBreakBySlot,
    });
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
    const dateStrRaw = date != null ? String(date).trim() : '';
    const timeStrRaw = time != null ? String(time).trim() : '';
    const missingStudent =
      student_id === undefined || student_id === null || student_id === '';
    if (missingStudent || !dateStrRaw || !timeStrRaw) {
      return res.status(400).json({ error: 'Missing student_id, date, or time' });
    }
    const studentIdNum = Number(student_id);
    if (Number.isFinite(studentIdNum) && BOOKING_DISABLED_STUDENT_IDS.has(studentIdNum)) {
      return res.status(403).json({ error: 'Booking is not available for this student.' });
    }
    const studentResult = await query(
      'SELECT id, name, is_child FROM students WHERE id = $1',
      [studentIdNum]
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
    const dateStr = dateStrRaw.slice(0, 10);
    const [hh, mm] = timeStrRaw.split(/[:\s]/).map((x) => parseInt(x, 10) || 0);
    const startDate = parseJstToUtc(dateStr, hh, mm);
    if (!startDate) {
      return res.status(400).json({ error: 'Invalid date or time' });
    }
    const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

    // Advance booking limit: max 90 days (compare calendar dates in JST)
    const todayJst = getTodayJstDateStr();
    const daysAhead = Math.round(
      (new Date(dateStr + 'T12:00:00Z') - new Date(todayJst + 'T12:00:00Z')) / (24 * 60 * 60 * 1000)
    );
    if (daysAhead > 90) {
      return res.status(400).json({
        error: 'Cannot book more than 90 days in advance. Please choose a date within the next 90 days.',
      });
    }

    const excludedStudentIds = bookingDisabledStudentIdsArray();

    // Kids vs adults separation: no mixing in the same time slot (ignore booking-disabled students' rows)
    const existingResult = await query(
      `SELECT is_kids_lesson FROM monthly_schedule m
       WHERE (m.status IS NULL OR m.status <> 'cancelled')
         AND ${SQL_NOT_STAFF_BREAK}
         AND m.start < $2::timestamptz AND m."end" > $1::timestamptz
         AND (m.student_id IS NULL OR NOT (m.student_id = ANY($3::int[])))`,
      [startDate.toISOString(), endDate.toISOString(), excludedStudentIds]
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

    const dupResult = await query(
      `SELECT 1 FROM monthly_schedule m
       WHERE (m.status IS NULL OR m.status <> 'cancelled')
         AND ${SQL_NOT_STAFF_BREAK}
         AND m.start < $2::timestamptz AND m."end" > $1::timestamptz
         AND (
           m.student_id = $3
           OR (
             m.student_id IS NULL
             AND LOWER(TRIM(COALESCE(m.student_name, ''))) = LOWER(TRIM($4))
           )
         )
       LIMIT 1`,
      [startDate.toISOString(), endDate.toISOString(), studentIdNum, studentName]
    );
    if (dupResult.rows.length > 0) {
      return res.status(400).json({
        error:
          'This student already has a lesson overlapping this time. Cancel or reschedule the existing lesson first.',
      });
    }

    // Max simultaneous lessons = teachers available in that slot (including shift extensions up to 2h before/after). Slot time in JST to match teacher_schedules.
    const slotMinutes = getJstMinutesOfDay(startDate);
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
      `SELECT COUNT(DISTINCT m.event_id) AS cnt FROM monthly_schedule m
       WHERE (m.status IS NULL OR m.status <> 'cancelled')
         AND ${SQL_NOT_STAFF_BREAK}
         AND m.start < $2::timestamptz AND m."end" > $1::timestamptz
         AND (m.student_id IS NULL OR NOT (m.student_id = ANY($3::int[])))`,
      [startDate.toISOString(), endDate.toISOString(), excludedStudentIds]
    );
    const currentLessonCount = parseInt(lessonCountResult.rows[0]?.cnt, 10) || 0;
    if (currentLessonCount >= teacherCount) {
      return res.status(400).json({
        error: `No availability: this slot has ${teacherCount} teacher(s) and ${currentLessonCount} lesson(s) already booked.`,
      });
    }

    let assignedTeacherName = null;
    if (teacherSet.size > 0) {
      const [distinctTeachersResult, dayBreakRows] = await Promise.all([
        query(
          `SELECT DISTINCT teacher_name FROM teacher_schedules WHERE date = $1::date ORDER BY teacher_name`,
          [dateStr]
        ),
        query(
          `SELECT
             to_char(m.start AT TIME ZONE 'Asia/Tokyo', 'HH24') || ':00' AS time_jst,
             m.teacher_name,
             m.lesson_kind
           FROM monthly_schedule m
           WHERE m.date = $1::date
           AND (m.status IS NULL OR m.status <> 'cancelled')
           AND (m.student_id IS NULL OR NOT (m.student_id = ANY($2::int[])))`,
          [dateStr, excludedStudentIds]
        ),
      ]);
      const distinctTeachersOnDay = distinctTeachersResult.rows
        .map((r) => r.teacher_name)
        .filter((n) => n != null && String(n).trim() !== '');
      const teachingMap = buildTeachingHoursByTeacher(dayBreakRows.rows, distinctTeachersOnDay);
      const hourLabel = jstHourLabelFromUtc(startDate);
      const teachersOnSlot = [...teacherSet];
      const assignable = findAssignableTeachers(teachersOnSlot, teachingMap, hourLabel);
      if (assignable.length === 0) {
        return res.status(400).json({
          error:
            'No teacher can take this slot without exceeding 5 teaching hours in a row; add a break hour or choose another time.',
        });
      }
      assignedTeacherName = pickTeacherForBooking(assignable, teachingMap);
    }

    const eventId = `booked-${Date.now()}-${studentIdNum}`;
    const title = `${studentName}${student.is_child ? ' 子' : ''} (Lesson)`;
    const insertResult = await query(
      `INSERT INTO monthly_schedule (event_id, title, date, start, "end", status, student_name, is_kids_lesson, teacher_name, lesson_kind, lesson_mode, student_id)
       VALUES ($1, $2, $3::date, $4::timestamptz, $5::timestamptz, 'scheduled', $6, $7, $8, 'regular', 'unknown', $9)
       RETURNING *`,
      [
        eventId,
        title,
        dateStr,
        startDate.toISOString(),
        endDate.toISOString(),
        studentName,
        !!student.is_child,
        assignedTeacherName,
        studentIdNum,
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
