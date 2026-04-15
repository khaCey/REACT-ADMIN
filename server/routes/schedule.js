import { Router } from 'express';
import { randomUUID } from 'crypto';
import { pool, query } from '../db/index.js';
import { logChange } from '../lib/changeLog.js';
import {
  parseJstToUtc,
  getTodayJstDateStr,
  getJstMinutesOfDay,
  roundTeacherShiftStartEnd,
} from '../lib/timezone.js';
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
import {
  bookingEventColorId,
  createBookedLessonEventInGas,
  deleteBookedLessonEventInGas,
  updateBookedLessonEventInGas,
  isBookingGasEnabled
} from '../lib/bookingCalendarSync.js';

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

function dayOrdinalSuffix(n) {
  const k = n % 100;
  const j = n % 10;
  if (k >= 11 && k <= 13) return 'th';
  if (j === 1) return 'st';
  if (j === 2) return 'nd';
  if (j === 3) return 'rd';
  return 'th';
}

/** YYYY-MM-DD -> "8th" (ordinal day only; no month, no time). */
function formatOrdinalCalendarDay(yyyyMmDd) {
  const s = String(yyyyMmDd || '').trim();
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const dayNum = parseInt(match[3], 10);
  if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) return '';
  return `${dayNum}${dayOrdinalSuffix(dayNum)}`;
}

/** Exclude break placeholder rows from capacity / overlap / mix (PostgreSQL). */
const SQL_NOT_STAFF_BREAK = `(m.lesson_kind IS NULL OR m.lesson_kind <> 'staff_break')`;
const LOCAL_BOOKING_EVENT_ID_PREFIX = 'local-booking-';
const CALENDAR_SYNC_STATUS_PENDING = 'pending';
const CALENDAR_SYNC_STATUS_SYNCED = 'synced';
const CALENDAR_SYNC_STATUS_FAILED = 'failed';

function isOwnerCoursePayment(payment) {
  return String(payment || '').toLowerCase().includes('owner');
}

function normalizeTeacherNameForOwner(s) {
  return String(s || '').trim().toLowerCase();
}

/** Staff id from OWNER_COURSE_STAFF_ID; resolves `staff.name` to match `teacher_schedules.teacher_name`. */
async function resolveOwnerCourseTeacherName() {
  // Product rule: owner's course is strictly tied to Sham's shift.
  // Keep this explicit so env misconfiguration cannot widen availability.
  return 'Sham';
}

function deriveLessonKindFromStudent(student) {
  const payment = String(student?.payment || '').toLowerCase();
  if (payment.includes('owner')) return 'owner';
  const status = String(student?.status || '').toLowerCase();
  if (status.includes('demo') || status.includes('trial')) return 'demo';
  return 'regular';
}

function normalizeCalendarSyncStatus(val) {
  const v = String(val || '').trim().toLowerCase();
  return v || CALENDAR_SYNC_STATUS_SYNCED;
}

function buildLocalBookingEventId() {
  return `${LOCAL_BOOKING_EVENT_ID_PREFIX}${randomUUID()}`;
}

function buildCalendarSyncKey() {
  return `booking-sync-${randomUUID()}`;
}

function buildMonthlyEventId(rawEventId, lessonDate, startTs) {
  const raw = String(rawEventId || '').trim();
  const date = String(lessonDate || '').trim();
  if (!raw) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return raw;
  const start = startTs ? new Date(startTs) : null;
  if (!start || Number.isNaN(start.getTime())) return `${raw}_${date}`;
  const timeSuffix = start.toISOString().slice(11, 19).replace(/:/g, '-');
  return `${raw}_${date}_${timeSuffix}`;
}

function lessonModeToLocationLabel(lessonMode) {
  return String(lessonMode || '').trim().toLowerCase() === 'online' ? 'Online' : 'Cafe';
}

function shouldSyncCalendarForRows(rows) {
  return (rows || []).some(
    (r) =>
      normalizeCalendarSyncStatus(r?.calendar_sync_status) === CALENDAR_SYNC_STATUS_SYNCED &&
      !String(r?.event_id || '').startsWith(LOCAL_BOOKING_EVENT_ID_PREFIX)
  );
}

async function syncBookedLessonEventToCalendar(localEventId) {
  const result = await query(
    `SELECT m.event_id, m.student_name, m.student_id, m.title, to_char(m.date, 'YYYY-MM-DD') AS lesson_date, m.start, m."end", m.status,
            m.teacher_name, m.lesson_kind, m.lesson_mode, m.calendar_sync_status,
            m.calendar_sync_error, m.calendar_sync_key,
            s.name AS canonical_student_name, s.status AS student_status,
            s.payment AS student_payment, s.is_child AS student_is_child
       FROM monthly_schedule m
       LEFT JOIN students s ON s.id = m.student_id
      WHERE m.event_id = $1
      LIMIT 1`,
    [localEventId]
  );
  const row = result.rows[0];
  if (!row) return { ok: false, error: 'Pending lesson not found' };

  const studentName = String(row.canonical_student_name || row.student_name || '').trim();
  const bookingKey =
    String(row.calendar_sync_key || '').trim() || `${String(row.event_id || '').trim() || buildCalendarSyncKey()}`;
  if (String(row.status || '').toLowerCase() === 'cancelled') {
    await query(
      `UPDATE monthly_schedule
          SET calendar_sync_status = $3,
              calendar_sync_error = $4,
              calendar_sync_attempted_at = NOW()
        WHERE event_id = $1 AND student_name = $2`,
      [row.event_id, row.student_name, CALENDAR_SYNC_STATUS_FAILED, 'Cancelled before calendar sync']
    );
    return { ok: false, error: 'Cancelled before calendar sync' };
  }

  await query(
    `UPDATE monthly_schedule
        SET calendar_sync_status = $3,
            calendar_sync_error = NULL,
            calendar_sync_attempted_at = NOW(),
            calendar_sync_key = COALESCE(calendar_sync_key, $4)
      WHERE event_id = $1 AND student_name = $2`,
    [row.event_id, row.student_name, CALENDAR_SYNC_STATUS_PENDING, bookingKey]
  );

  const gasRes = await createBookedLessonEventInGas({
    student: {
      id: row.student_id,
      name: studentName,
      status: row.student_status,
      payment: row.student_payment,
      is_child: !!row.student_is_child,
    },
    startIso: row.start ? new Date(row.start).toISOString() : null,
    endIso: row.end ? new Date(row.end).toISOString() : null,
    assignedTeacherName: row.teacher_name,
    title: row.title || '',
    location: String(row.lesson_kind || '').trim() === 'demo' ? '' : lessonModeToLocationLabel(row.lesson_mode),
    lessonKind: row.lesson_kind,
    bookingKey,
  });
  if (!gasRes.ok || !gasRes.eventId) {
    await query(
      `UPDATE monthly_schedule
          SET calendar_sync_status = $3,
              calendar_sync_error = $4,
              calendar_sync_attempted_at = NOW()
        WHERE event_id = $1 AND student_name = $2`,
      [row.event_id, row.student_name, CALENDAR_SYNC_STATUS_FAILED, gasRes.error || 'Failed to sync with calendar']
    );
    return { ok: false, error: gasRes.error || 'Failed to sync with calendar' };
  }

  const syncedMonthlyEventId = buildMonthlyEventId(gasRes.eventId, row.lesson_date, row.start);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updateResult = await client.query(
      `UPDATE monthly_schedule
          SET event_id = $1,
              calendar_sync_status = $4,
              calendar_sync_error = NULL,
              calendar_sync_attempted_at = NOW(),
              calendar_synced_at = NOW(),
              calendar_sync_key = COALESCE(calendar_sync_key, $5)
        WHERE event_id = $2 AND student_name = $3
          AND COALESCE(status, 'scheduled') <> 'cancelled'`,
      [syncedMonthlyEventId, row.event_id, row.student_name, CALENDAR_SYNC_STATUS_SYNCED, bookingKey]
    );
    if ((updateResult.rowCount || 0) === 0) {
      await client.query('ROLLBACK');
      try {
        await deleteBookedLessonEventInGas(gasRes.eventId);
      } catch {}
      await query(
        `UPDATE monthly_schedule
            SET calendar_sync_status = $3,
                calendar_sync_error = $4,
                calendar_sync_attempted_at = NOW()
          WHERE event_id = $1 AND student_name = $2`,
        [row.event_id, row.student_name, CALENDAR_SYNC_STATUS_FAILED, 'Lesson changed before calendar sync completed']
      );
      return { ok: false, error: 'Lesson changed before calendar sync completed' };
    }
    await client.query(
      `UPDATE reschedules SET from_event_id = $1 WHERE from_event_id = $2 AND from_student_name = $3`,
      [syncedMonthlyEventId, row.event_id, row.student_name]
    );
    await client.query(
      `UPDATE reschedules SET to_event_id = $1 WHERE to_event_id = $2 AND to_student_name = $3`,
      [syncedMonthlyEventId, row.event_id, row.student_name]
    );
    await client.query('COMMIT');
    return {
      ok: true,
      eventId: syncedMonthlyEventId,
      calendarId: gasRes.calendarId,
      actionTaken: gasRes.actionTaken,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    await query(
      `UPDATE monthly_schedule
          SET calendar_sync_status = $3,
              calendar_sync_error = $4,
              calendar_sync_attempted_at = NOW()
        WHERE event_id = $1 AND student_name = $2`,
      [row.event_id, row.student_name, CALENDAR_SYNC_STATUS_FAILED, err.message || 'Failed to update sync result']
    );
    return { ok: false, error: err.message || 'Failed to update sync result' };
  } finally {
    client.release();
  }
}

function queueBookedLessonEventSync(localEventId) {
  setTimeout(() => {
    syncBookedLessonEventToCalendar(localEventId).catch((err) => {
      console.error('[schedule/book background sync] failed:', err?.message || err);
    });
  }, 0);
}

function parsePackTotalFromTitle(title) {
  const m = String(title || '').match(/\/\s*(\d+)\s*$/);
  const n = m ? parseInt(m[1], 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function addDaysToYyyyMmDd(dateStr, n) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

function parseClock5(val) {
  const s = String(val || '').trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : '';
}

function normalizeTeacherNameKey(s) {
  return String(s || '').trim().toLowerCase();
}

/** Calendar / GAS often stores titles like "Preset break 12:00-13:00"; use "{Name}'s Break". */
function displayBreakTitleFromCalendar(teacherName, rawTitle) {
  const tn = String(teacherName || '').trim() || 'Staff';
  const t = rawTitle != null ? String(rawTitle).trim() : '';
  if (!t || /^preset\s+break/i.test(t)) {
    return `${tn}'s Break`;
  }
  return t;
}

/**
 * Match `teacher_break_presets` for a calendar `staff_break` hour (teacher, weekday, time in range).
 * Lets the UI attach preset_id so breaks stay editable even when synced from Calendar.
 */
function matchPresetForSlot(teacherName, dateStr, timeStr, presetRows, teacherNamesByJstDate) {
  if (teacherNamesByJstDate) {
    const names = teacherNamesByJstDate[dateStr];
    if (!names || !names.has(normalizeTeacherNameKey(teacherName))) return null;
  }
  const wd = dateWeekday(dateStr);
  if (!Number.isFinite(wd)) return null;
  const tn = normalizeTeacherNameKey(teacherName);
  if (!tn) return null;
  for (const pr of presetRows || []) {
    if (normalizeTeacherNameKey(pr.teacher_name) !== tn) continue;
    const pwd = parseInt(pr.weekday, 10);
    if (!Number.isFinite(pwd) || pwd !== wd) continue;
    const start = parseClock5(pr.start_time);
    const end = parseClock5(pr.end_time);
    if (!start || !end) continue;
    if (!hourInHalfOpenRange(timeStr, start, end)) continue;
    const presetId = parseInt(pr.id, 10);
    if (!Number.isFinite(presetId)) continue;
    return {
      preset_id: presetId,
      preset_weekday: pwd,
      preset_start_time: start,
      preset_end_time: end,
    };
  }
  return null;
}

function dateWeekday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? NaN : d.getUTCDay();
}

function hourInHalfOpenRange(hourLabel, startTime, endTime) {
  return hourLabel >= startTime && hourLabel < endTime;
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
 * - `staffBreakBySlot`: keys -> break entries; calendar rows include `break_source: 'schedule'`; expanded
 *   presets include `preset_id`, `break_source: 'preset'`, and `preset_weekday` / `preset_*_time` for editing.
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
    let studentPaymentForGrid = null;
    if (Number.isFinite(studentIdNum)) {
      const sn = await query('SELECT name, payment FROM students WHERE id = $1', [studentIdNum]);
      studentNameForGrid = (sn.rows[0]?.name || '').trim() || null;
      studentPaymentForGrid = sn.rows[0]?.payment ?? null;
    }
    const [scheduleResult, teachersResult, breakPresetsResult] = await Promise.all([
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
      query(
        `SELECT id, teacher_name, weekday, start_time, end_time
         FROM teacher_break_presets
         WHERE active = TRUE`
      ),
    ]);
    /** date (JST YYYY-MM-DD) -> Set of normalized teacher names with any shift that day. Preset breaks only apply on those days. */
    const teacherNamesByJstDate = {};
    for (const r of teachersResult.rows) {
      const dateStr = r.date ? String(r.date).trim().slice(0, 10) : '';
      if (!dateStr) continue;
      const tn = normalizeTeacherNameKey(r.teacher_name);
      if (!tn) continue;
      if (!teacherNamesByJstDate[dateStr]) teacherNamesByJstDate[dateStr] = new Set();
      teacherNamesByJstDate[dateStr].add(tn);
    }
    /** key -> bucket: distinct events + kids/adult flags for booking UI (matches POST /book mixing rules) */
    const slotBuckets = new Map();
    /** Slot keys -> list of break cards (calendar staff_break and/or expanded presets). */
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
        const rawTitle = r.title != null ? String(r.title).trim() : '';
        const title = displayBreakTitleFromCalendar(tn, rawTitle);
        const presetMatch = matchPresetForSlot(
          tn,
          dateStr,
          timeStr,
          breakPresetsResult.rows || [],
          teacherNamesByJstDate
        );
        const entry = {
          teacher_name: tn,
          title,
          break_source: presetMatch ? 'preset' : 'schedule',
          ...(presetMatch
            ? {
                preset_id: presetMatch.preset_id,
                preset_weekday: presetMatch.preset_weekday,
                preset_start_time: presetMatch.preset_start_time,
                preset_end_time: presetMatch.preset_end_time,
              }
            : {}),
        };
        staffBreakBySlot[key].push(entry);
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
      const start0 = r.start_time ? String(r.start_time).slice(0, 5) : '';
      const end0 = r.end_time ? String(r.end_time).slice(0, 5) : '';
      if (!start0 || !end0) continue;
      const { start_time: startT, end_time: endT } = roundTeacherShiftStartEnd(start0, end0);
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

    /** Preset breaks expanded to slot keys (date+hour), used for capacity reduction + UI break cards. */
    const presetBreakBySlot = {};
    for (const r of breakPresetsResult.rows || []) {
      const presetId = parseInt(r.id, 10);
      const teacherName = String(r.teacher_name || '').trim();
      const start = parseClock5(r.start_time);
      const end = parseClock5(r.end_time);
      const weekday = parseInt(r.weekday, 10);
      if (!Number.isFinite(presetId) || !teacherName || !start || !end || !Number.isFinite(weekday)) continue;
      for (let di = 0; di < 7; di += 1) {
        const dateStr = addDaysToYyyyMmDd(weekStart, di);
        if (dateWeekday(dateStr) !== weekday) continue;
        const namesOnDay = teacherNamesByJstDate[dateStr];
        if (!namesOnDay || !namesOnDay.has(normalizeTeacherNameKey(teacherName))) continue;
        for (const timeStr of GRID_TIME_SLOTS) {
          if (!hourInHalfOpenRange(timeStr, start, end)) continue;
          const key = `${dateStr}T${timeStr}`;
          if (!presetBreakBySlot[key]) presetBreakBySlot[key] = [];
          presetBreakBySlot[key].push({
            teacher_name: teacherName,
            title: `${teacherName}'s Break`,
            preset_id: presetId,
            break_source: 'preset',
            preset_weekday: weekday,
            preset_start_time: start,
            preset_end_time: end,
          });
        }
      }
    }
    for (const [key, breaks] of Object.entries(presetBreakBySlot)) {
      const breakTeacherSet = new Set(breaks.map((b) => b.teacher_name));
      if (teachersBySlot[key]) {
        teachersBySlot[key] = teachersBySlot[key].filter((t) => !breakTeacherSet.has(t));
      }
      if (!staffBreakBySlot[key]) staffBreakBySlot[key] = [];
      staffBreakBySlot[key].push(...breaks);
    }
    for (const k of Object.keys(staffBreakBySlot)) {
      const seen = new Set();
      staffBreakBySlot[k] = (staffBreakBySlot[k] || []).filter((b) => {
        const dedupe =
          b.preset_id != null && Number.isFinite(Number(b.preset_id))
            ? `preset:${b.preset_id}`
            : `schedule:${b.teacher_name}::${b.title || ''}`;
        if (seen.has(dedupe)) return false;
        seen.add(dedupe);
        return true;
      });
    }
    /** Drop calendar-only rows when the same teacher already has a preset-backed row this hour (avoid duplicate chips). */
    for (const k of Object.keys(staffBreakBySlot)) {
      const list = staffBreakBySlot[k] || [];
      const presetTeachers = new Set(
        list
          .filter((b) => b.preset_id != null && Number.isFinite(Number(b.preset_id)))
          .map((b) => normalizeTeacherNameKey(b.teacher_name))
      );
      staffBreakBySlot[k] = list.filter((b) => {
        if (b.break_source === 'schedule' && presetTeachers.has(normalizeTeacherNameKey(b.teacher_name))) {
          return false;
        }
        return true;
      });
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

    /** Owner's course (payment contains "owner"): only slots where OWNER_COURSE_STAFF_ID's teacher is on shift. */
    const ownerShamBlocked = {};
    if (Number.isFinite(studentIdNum) && isOwnerCoursePayment(studentPaymentForGrid)) {
      const shamName = await resolveOwnerCourseTeacherName();
      if (shamName) {
        const shamNorm = normalizeTeacherNameForOwner(shamName);
        for (let di = 0; di < 7; di += 1) {
          const dateStr = addDaysToYyyyMmDd(weekStart, di);
          for (const timeStr of GRID_TIME_SLOTS) {
            const key = `${dateStr}T${timeStr}`;
            const teachers = teachersBySlot[key] || [];
            const hasSham = teachers.some((t) => normalizeTeacherNameForOwner(t) === shamNorm);
            if (!hasSham) ownerShamBlocked[key] = true;
          }
        }
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
      ownerShamBlocked,
      staffBreakBySlot,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/schedule/renumber-month-titles
 * Upsert `lessons` pack size for the month and rewrite `monthly_schedule.title` as `Name (Loc) i/N` in start order.
 */
router.post('/renumber-month-titles', async (req, res) => {
  try {
    const { student_id, month, pack_total } = req.body || {};
    const monthKey = String(month || '').trim().slice(0, 7);
    const pack = Math.max(1, parseInt(pack_total, 10) || 0);
    const sid = Number(student_id);
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey) || !Number.isFinite(sid) || sid <= 0) {
      return res.status(400).json({ error: 'student_id, month (YYYY-MM), and pack_total are required' });
    }
    if (!pack) {
      return res.status(400).json({ error: 'pack_total must be at least 1' });
    }

    const studentResult = await query('SELECT id, name FROM students WHERE id = $1', [sid]);
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const studentName = String(studentResult.rows[0].name || '').trim();
    if (!studentName) {
      return res.status(400).json({ error: 'Student has no name' });
    }

    await query(
      `INSERT INTO lessons (student_id, month, lessons) VALUES ($1, $2, $3)
       ON CONFLICT (student_id, month) DO UPDATE SET lessons = EXCLUDED.lessons`,
      [sid, monthKey, pack]
    );

    const rows = await query(
      `SELECT event_id, student_name, title
       FROM monthly_schedule
       WHERE student_id = $1
         AND to_char(date, 'YYYY-MM') = $2
         AND (status IS NULL OR status <> 'cancelled')
       ORDER BY start ASC`,
      [sid, monthKey]
    );

    let locationLabel = 'Cafe';
    const locRe = /\(([^)]+)\)\s+\d+\/\d+/;
    for (const r of rows.rows) {
      const m = String(r.title || '').match(locRe);
      if (m) {
        locationLabel = m[1].trim();
        break;
      }
    }

    let idx = 0;
    for (const r of rows.rows) {
      idx += 1;
      const newTitle = `${studentName} (${locationLabel}) ${idx}/${pack}`;
      await query(
        `UPDATE monthly_schedule SET title = $1 WHERE event_id = $2 AND student_name = $3`,
        [newTitle, r.event_id, r.student_name]
      );
    }

    res.json({ ok: true, updated: rows.rows.length, month: monthKey, pack_total: pack });
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
    const teachers = shifts.rows.map((r) => {
      const st0 = r.start_time ? String(r.start_time).slice(0, 5) : '';
      const et0 = r.end_time ? String(r.end_time).slice(0, 5) : '';
      const base = {
        teacher_name: r.teacher_name,
        extend_before_minutes: r.extend_before_minutes,
        extend_after_minutes: r.extend_after_minutes,
      };
      if (!st0 || !et0) return { ...base, start_time: st0, end_time: et0 };
      const rounded = roundTeacherShiftStartEnd(st0, et0);
      return { ...base, start_time: rounded.start_time, end_time: rounded.end_time };
    });
    res.json({ teachers });
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

/** Book a new lesson: create a Calendar event via GAS (source of truth). */
router.post('/book', async (req, res) => {
  try {
    const { student_id, date, time, duration_minutes, pack_total, location } = req.body || {};
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
      'SELECT id, name, is_child, status, payment FROM students WHERE id = $1',
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
    const [teacherRows, breakPresetsResult] = await Promise.all([
      query(
        `SELECT t.teacher_name, t.start_time, t.end_time,
                COALESCE(e.extend_before_minutes, 0) AS extend_before_minutes,
                COALESCE(e.extend_after_minutes, 0) AS extend_after_minutes
         FROM teacher_schedules t
         LEFT JOIN teacher_shift_extensions e ON e.date = t.date AND e.teacher_name = t.teacher_name
         WHERE t.date = $1::date`,
        [dateStr]
      ),
      query(
        `SELECT teacher_name, start_time, end_time
         FROM teacher_break_presets
         WHERE active = TRUE AND weekday = $1`,
        [dateWeekday(dateStr)]
      ),
    ]);
    const teachersOnBookingDate = new Set(
      (teacherRows.rows || []).map((r) => normalizeTeacherNameKey(r.teacher_name)).filter(Boolean)
    );
    const presetBreakTeacherSet = new Set();
    const slotHourLabel = `${String(hh).padStart(2, '0')}:00`;
    for (const r of breakPresetsResult.rows || []) {
      const teacherName = String(r.teacher_name || '').trim();
      const start = parseClock5(r.start_time);
      const end = parseClock5(r.end_time);
      if (!teacherName || !start || !end) continue;
      if (!teachersOnBookingDate.has(normalizeTeacherNameKey(teacherName))) continue;
      if (hourInHalfOpenRange(slotHourLabel, start, end)) presetBreakTeacherSet.add(teacherName);
    }
    const teacherSet = new Set();
    for (const r of teacherRows.rows) {
      const st0 = r.start_time ? String(r.start_time).slice(0, 5) : '';
      const et0 = r.end_time ? String(r.end_time).slice(0, 5) : '';
      if (!st0 || !et0) continue;
      const { start_time: stR, end_time: etR } = roundTeacherShiftStartEnd(st0, et0);
      const s = new Date(`1970-01-01T${stR}`);
      const e = new Date(`1970-01-01T${etR}`);
      const startMin = s.getHours() * 60 + s.getMinutes();
      const endMin = e.getHours() * 60 + e.getMinutes();
      const before = Math.min(120, parseInt(r.extend_before_minutes, 10) || 0);
      const after = Math.min(120, parseInt(r.extend_after_minutes, 10) || 0);
      const effectiveStart = startMin - before;
      const effectiveEnd = endMin + after;
      if (slotMinutes >= effectiveStart && slotMinutes < effectiveEnd) {
        const tn = String(r.teacher_name || '').trim();
        if (tn && !presetBreakTeacherSet.has(tn)) teacherSet.add(tn);
      }
    }

    if (isOwnerCoursePayment(student.payment)) {
      const shamTeacherName = await resolveOwnerCourseTeacherName();
      if (shamTeacherName) {
        const shamNorm = normalizeTeacherNameForOwner(shamTeacherName);
        const hasSham = [...teacherSet].some((t) => normalizeTeacherNameForOwner(t) === shamNorm);
        if (!hasSham) {
          return res.status(400).json({
            error: `Owner's course bookings require ${shamTeacherName} to be on shift for this hour. Choose another time.`,
          });
        }
      }
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
      const teachersOnBreakAtHour = new Set(
        (dayBreakRows.rows || [])
          .filter((r) => String(r.lesson_kind || '').trim() === 'staff_break')
          .filter((r) => String(r.time_jst || '').trim().slice(0, 5) === hourLabel)
          .map((r) => String(r.teacher_name || '').trim())
          .filter((name) => name && teachersOnSlot.includes(name))
      );
      for (const t of presetBreakTeacherSet) {
        if (teachersOnSlot.includes(t)) teachersOnBreakAtHour.add(t);
      }
      const effectiveTeachersOnSlot = teachersOnSlot.filter((name) => !teachersOnBreakAtHour.has(name));
      const assignable = findAssignableTeachers(effectiveTeachersOnSlot, teachingMap, hourLabel);
      if (assignable.length === 0) {
        return res.status(400).json({
          error:
            'No teacher can take this slot without exceeding 5 teaching hours in a row; add a break hour or choose another time.',
        });
      }

      // Do not force teacher assignment by default.
      // Only assign explicitly when another teacher is on a break.
      const hasAnotherTeacherOnBreak = teachersOnBreakAtHour.size > 0;
      if (hasAnotherTeacherOnBreak) {
        assignedTeacherName = pickTeacherForBooking(assignable, teachingMap);
      }
    }

    const locationLabel = String(location || 'Cafe').trim() || 'Cafe';
    const monthKey = dateStr.slice(0, 7);
    const lessonKindForBooking = deriveLessonKindFromStudent(student);

    let title;
    if (lessonKindForBooking === 'demo') {
      title = `${studentName} D/L`;
    } else {
      const bookedCountResult = await query(
        `SELECT COUNT(DISTINCT m.event_id) AS cnt
         FROM monthly_schedule m
         WHERE (m.status IS NULL OR m.status <> 'cancelled')
           AND m.student_id = $1
           AND to_char(m.date, 'YYYY-MM') = $2`,
        [studentIdNum, monthKey]
      );
      const bookedThisMonth = parseInt(bookedCountResult.rows[0]?.cnt, 10) || 0;
      const nextLessonNumber = bookedThisMonth + 1;

      const providedPackTotal = parseInt(pack_total, 10);
      let totalLessons = Number.isFinite(providedPackTotal) && providedPackTotal > 0 ? providedPackTotal : 0;
      if (!totalLessons) {
        const paidCountResult = await query(
          `SELECT COALESCE(SUM(CASE WHEN p.amount IS NULL THEN 0 ELSE p.amount END), 0) AS total_paid
           FROM payments p
           WHERE p.student_id = $1
             AND p.month = $2`,
          [studentIdNum, monthKey]
        );
        totalLessons = Math.max(0, parseInt(paidCountResult.rows[0]?.total_paid, 10) || 0);
      }
      if (!totalLessons) {
        const packRow = await query(
          'SELECT lessons FROM lessons WHERE student_id = $1 AND month = $2',
          [studentIdNum, monthKey]
        );
        totalLessons = Math.max(0, parseInt(packRow.rows[0]?.lessons, 10) || 0);
      }
      if (!totalLessons) {
        return res.status(400).json({
          error: 'Missing lesson pack total. Enter total lessons before booking.',
        });
      }
      title = `${studentName} (${locationLabel}) ${nextLessonNumber}/${totalLessons}`;
    }
    const lessonKind = lessonKindForBooking;
    const localEventId = buildLocalBookingEventId();
    const calendarSyncKey = buildCalendarSyncKey();
    await query(
      `INSERT INTO monthly_schedule
        (event_id, title, date, start, "end", status, student_name, is_kids_lesson, teacher_name, lesson_kind, lesson_mode, student_id,
         calendar_sync_status, calendar_sync_error, calendar_sync_key, calendar_sync_attempted_at, calendar_synced_at,
         reschedule_snapshot_to_date, reschedule_snapshot_to_time, reschedule_snapshot_from_date, reschedule_snapshot_from_time)
       VALUES
        ($1, $2, $3::date, $4::timestamptz, $5::timestamptz, 'scheduled', $6, $7, $8, $9, $10, $11, $12, NULL, $13, NULL, NULL,
         NULL, NULL, NULL, NULL)
       ON CONFLICT (event_id, student_name)
       DO UPDATE SET
         title = EXCLUDED.title,
         date = EXCLUDED.date,
         start = EXCLUDED.start,
         "end" = EXCLUDED."end",
         status = EXCLUDED.status,
         is_kids_lesson = EXCLUDED.is_kids_lesson,
         teacher_name = EXCLUDED.teacher_name,
         lesson_kind = EXCLUDED.lesson_kind,
         lesson_mode = EXCLUDED.lesson_mode,
         student_id = EXCLUDED.student_id,
         calendar_sync_status = EXCLUDED.calendar_sync_status,
         calendar_sync_error = EXCLUDED.calendar_sync_error,
         calendar_sync_key = EXCLUDED.calendar_sync_key,
         calendar_sync_attempted_at = EXCLUDED.calendar_sync_attempted_at,
         calendar_synced_at = EXCLUDED.calendar_synced_at,
         reschedule_snapshot_to_date = monthly_schedule.reschedule_snapshot_to_date,
         reschedule_snapshot_to_time = monthly_schedule.reschedule_snapshot_to_time,
         reschedule_snapshot_from_date = monthly_schedule.reschedule_snapshot_from_date,
         reschedule_snapshot_from_time = monthly_schedule.reschedule_snapshot_from_time`,
      [
        localEventId,
        title,
        dateStr,
        startDate.toISOString(),
        endDate.toISOString(),
        studentName,
        !!student.is_child,
        assignedTeacherName,
        lessonKind,
        lessonKind === 'demo' ? 'unknown' : String(locationLabel || '').trim().toLowerCase() === 'online' ? 'online' : 'cafe',
        studentIdNum,
        CALENDAR_SYNC_STATUS_PENDING,
        calendarSyncKey,
      ]
    );

    res.status(201).json({
      ok: true,
      event_id: localEventId,
      calendar_id: null,
      teacher_name: assignedTeacherName,
      date: dateStr,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      calendar_sync_status: CALENDAR_SYNC_STATUS_PENDING,
    });
    queueBookedLessonEventSync(localEventId);
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

router.post('/sync', async (req, res) => {
  try {
    const eventId = String(req.body?.event_id || '').trim();
    if (!eventId) return res.status(400).json({ error: 'event_id is required' });
    const rows = (await query('SELECT event_id, status, calendar_sync_status FROM monthly_schedule WHERE event_id = $1', [eventId])).rows;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Event not found', event_id: eventId });
    }
    if (normalizeCalendarSyncStatus(rows[0]?.calendar_sync_status) === CALENDAR_SYNC_STATUS_SYNCED) {
      return res.status(400).json({ error: 'Lesson is already synced with Google Calendar', event_id: eventId });
    }
    if (String(rows[0]?.status || '').toLowerCase() === 'cancelled') {
      return res.status(400).json({ error: 'Cancelled lessons cannot be synced', event_id: eventId });
    }
    const syncRes = await syncBookedLessonEventToCalendar(eventId);
    if (!syncRes.ok) {
      return res.status(502).json({ error: syncRes.error || 'Failed to sync lesson with Google Calendar', event_id: eventId });
    }
    return res.json({
      ok: true,
      event_id: syncRes.eventId || eventId,
      calendar_id: syncRes.calendarId || null,
      action_taken: syncRes.actionTaken || 'created',
      calendar_sync_status: CALENDAR_SYNC_STATUS_SYNCED,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Mark lesson as cancelled in calendar (graphite) but flag as awaiting a new date (orange in app vs plain cancel).
 */
router.post(/^\/(.+)\/reschedule-awaiting-date\/?$/, async (req, res) => {
  try {
    const eventId =
      getEventIdFromPath(req.path, 'reschedule-awaiting-date') ||
      decodeURIComponent((req.params[0] || req.params[1] || '').trim());
    const oldRows = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [eventId])).rows;
    if (oldRows.length === 0) {
      return res.status(404).json({ error: 'Event not found', event_id: eventId });
    }
    if (isBookingGasEnabled() && shouldSyncCalendarForRows(oldRows)) {
      await updateBookedLessonEventInGas(eventId, {
        colorId: '8',
        mergeStudentAdminDescription: { awaiting_reschedule_date: true },
      });
    }
    await query(
      `UPDATE monthly_schedule SET status = 'cancelled', awaiting_reschedule_date = TRUE WHERE event_id = $1`,
      [eventId]
    );
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

/** Cancel a scheduled lesson (set status to cancelled). eventId can contain @ and dots (e.g. email_date). */
router.patch(/^\/(.+)\/cancel\/?$/, async (req, res) => {
  try {
    const eventId = getEventIdFromPath(req.path, 'cancel') || decodeURIComponent((req.params[0] || req.params[1] || '').trim());
    const oldRows = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [eventId])).rows;
    if (oldRows.length === 0) {
      return res.status(404).json({ error: 'Event not found', event_id: eventId });
    }
    if (isBookingGasEnabled() && shouldSyncCalendarForRows(oldRows)) {
      // Google Calendar Graphite = colorId "8".
      await updateBookedLessonEventInGas(eventId, {
        colorId: '8',
        mergeStudentAdminDescription: { awaiting_reschedule_date: false },
      });
    }
    await query(
      `UPDATE monthly_schedule SET status = 'cancelled', awaiting_reschedule_date = FALSE WHERE event_id = $1`,
      [eventId]
    );
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
    if (isBookingGasEnabled() && shouldSyncCalendarForRows(oldRows)) {
      const lk = String(oldRows[0]?.lesson_kind || 'regular').toLowerCase();
      const cid = bookingEventColorId(lk);
      const merge = { mergeStudentAdminDescription: { awaiting_reschedule_date: false } };
      if (cid) {
        await updateBookedLessonEventInGas(eventId, { colorId: cid, ...merge });
      } else {
        await updateBookedLessonEventInGas(eventId, { clearColor: true, ...merge });
      }
    }
    await query(
      `UPDATE monthly_schedule SET status = 'scheduled', awaiting_reschedule_date = FALSE WHERE event_id = $1`,
      [eventId]
    );
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

/** Linked reschedule: insert destination as local pending (like POST /book), cancel source, link rows; calendar sync is queued. */
router.post('/reschedule-linked', async (req, res) => {
  let client;
  try {
    const {
      source_event_id,
      student_id,
      date,
      time,
      duration_minutes,
      location,
      source_student_name,
    } = req.body || {};
    const sourceEventId = String(source_event_id || '').trim();
    const studentIdNum = Number(student_id);
    const dateStrRaw = String(date || '').trim();
    const timeStrRaw = String(time || '').trim();
    if (!sourceEventId) return res.status(400).json({ error: 'source_event_id is required' });
    if (!Number.isFinite(studentIdNum)) return res.status(400).json({ error: 'student_id must be a number' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStrRaw)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    if (!/^\d{2}:\d{2}$/.test(timeStrRaw)) return res.status(400).json({ error: 'time must be HH:MM' });

    const studentResult = await query('SELECT id, name, is_child, status, payment FROM students WHERE id = $1', [studentIdNum]);
    if (studentResult.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    const student = studentResult.rows[0];
    const studentName = String(student.name || '').trim();
    const normalizedStudentName = studentName.replace(/\s+/g, ' ').trim();
    const normalizedSourceName = String(source_student_name || '').replace(/\s+/g, ' ').trim();
    const studentParts = normalizedStudentName.split(' ').filter(Boolean);
    const swappedStudentName =
      studentParts.length >= 2 ? [...studentParts.slice(-1), ...studentParts.slice(0, -1)].join(' ') : '';
    const candidateRows = (
      await query(
        `SELECT event_id, student_name, student_id, status, title, awaiting_reschedule_date,
                to_char(date, 'YYYY-MM-DD') AS src_date_str,
                to_char(start AT TIME ZONE 'Asia/Tokyo', 'HH24:MI') AS src_time_jst
         FROM monthly_schedule
         WHERE event_id = $1`,
        [sourceEventId]
      )
    ).rows;
    if (candidateRows.length === 0) {
      return res.status(404).json({ error: 'Source lesson not found for student' });
    }
    const nameCandidates = [normalizedStudentName, swappedStudentName, normalizedSourceName].filter(Boolean);
    const byStudentId = candidateRows.find((r) => Number(r.student_id) === studentIdNum);
    const byName = candidateRows.find((r) => {
      const n = String(r.student_name || '').replace(/\s+/g, ' ').trim();
      return nameCandidates.includes(n);
    });
    const source = byStudentId || byName || (candidateRows.length === 1 ? candidateRows[0] : null);
    if (!source) {
      return res.status(404).json({ error: 'Source lesson not found for student' });
    }
    const sourceCancelled = String(source.status || '').toLowerCase() === 'cancelled';
    const awaitingDate = !!source.awaiting_reschedule_date;
    if (sourceCancelled && !awaitingDate) {
      return res.status(400).json({ error: 'Source lesson is already cancelled' });
    }
    const sourceStudentName = String(source.student_name || source_student_name || '').trim();
    if (!sourceStudentName) return res.status(400).json({ error: 'Source student name is missing' });
    const duration = Math.min(120, Math.max(30, Number(duration_minutes) || 50));
    const [hh, mm] = timeStrRaw.split(':').map((x) => parseInt(x, 10) || 0);
    const startDate = parseJstToUtc(dateStrRaw, hh, mm);
    if (!startDate) return res.status(400).json({ error: 'Invalid date or time' });
    const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

    const locationLabel = String(location || 'Cafe').trim() || 'Cafe';
    const monthKey = dateStrRaw.slice(0, 7);
    const lessonKindForBooking = deriveLessonKindFromStudent(student);

    const fromDisplay = formatOrdinalCalendarDay(source.src_date_str);
    const toDisplay = formatOrdinalCalendarDay(dateStrRaw);
    const suffixRescheduledFrom = fromDisplay ? ` · Moved from ${fromDisplay}` : '';

    let title;
    if (lessonKindForBooking === 'demo') {
      title = `${studentName} D/L${suffixRescheduledFrom}`;
    } else {
      let totalLessons = parsePackTotalFromTitle(source.title);
      if (!totalLessons) {
        const packRow = await query('SELECT lessons FROM lessons WHERE student_id = $1 AND month = $2', [studentIdNum, monthKey]);
        totalLessons = Math.max(0, parseInt(packRow.rows[0]?.lessons, 10) || 0);
      }
      if (!totalLessons) totalLessons = 1;

      // Quota-neutral numbering: when moving within the same month, source lesson is effectively replaced.
      const sourceMonth = (
        await query(`SELECT to_char(date, 'YYYY-MM') AS ym FROM monthly_schedule WHERE event_id = $1 AND student_id = $2 LIMIT 1`, [sourceEventId, studentIdNum])
      ).rows[0]?.ym;
      const bookedCountResult = await query(
        `SELECT COUNT(DISTINCT m.event_id) AS cnt
         FROM monthly_schedule m
         WHERE (m.status IS NULL OR m.status <> 'cancelled')
           AND m.student_id = $1
           AND to_char(m.date, 'YYYY-MM') = $2`,
        [studentIdNum, monthKey]
      );
      const bookedThisMonth = parseInt(bookedCountResult.rows[0]?.cnt, 10) || 0;
      const nextLessonNumber = sourceMonth === monthKey ? Math.max(1, bookedThisMonth) : bookedThisMonth + 1;
      title = `${studentName} (${locationLabel}) ${nextLessonNumber}/${totalLessons}${suffixRescheduledFrom}`;
    }

    const baseOldTitle = String(source.title || '')
      .replace(/\s*·\s*(?:Rescheduled to|Moved to)\b.*$/i, '')
      .trim();
    const oldTitleUpdated = `${baseOldTitle} · Moved to ${toDisplay}`;

    const localEventId = buildLocalBookingEventId();
    const calendarSyncKey = buildCalendarSyncKey();
    const lessonKind = lessonKindForBooking;
    const lessonModeVal =
      lessonKind === 'demo'
        ? 'unknown'
        : String(locationLabel || '').trim().toLowerCase() === 'online'
          ? 'online'
          : 'cafe';

    client = await pool.connect();
    await client.query('BEGIN');
    const srcDateStr = String(source.src_date_str || '').trim();
    const srcDateForSnap = /^\d{4}-\d{2}-\d{2}$/.test(srcDateStr) ? srcDateStr : null;
    const srcTimeJst = String(source.src_time_jst || '').trim() || null;
    await client.query(
      `INSERT INTO monthly_schedule
        (event_id, title, date, start, "end", status, student_name, is_kids_lesson, teacher_name, lesson_kind, lesson_mode, student_id,
         calendar_sync_status, calendar_sync_error, calendar_sync_key, calendar_sync_attempted_at, calendar_synced_at,
         reschedule_snapshot_to_date, reschedule_snapshot_to_time, reschedule_snapshot_from_date, reschedule_snapshot_from_time)
       VALUES
        ($1, $2, $3::date, $4::timestamptz, $5::timestamptz, 'scheduled', $6, $7, $8, $9, $10, $11, $12, NULL, $13, NULL, NULL,
         NULL, NULL, $14::date, $15)
       ON CONFLICT (event_id, student_name)
       DO UPDATE SET
         title = EXCLUDED.title,
         date = EXCLUDED.date,
         start = EXCLUDED.start,
         "end" = EXCLUDED."end",
         status = EXCLUDED.status,
         is_kids_lesson = EXCLUDED.is_kids_lesson,
         teacher_name = EXCLUDED.teacher_name,
         lesson_kind = EXCLUDED.lesson_kind,
         lesson_mode = EXCLUDED.lesson_mode,
         student_id = EXCLUDED.student_id,
         calendar_sync_status = EXCLUDED.calendar_sync_status,
         calendar_sync_error = EXCLUDED.calendar_sync_error,
         calendar_sync_key = EXCLUDED.calendar_sync_key,
         calendar_sync_attempted_at = EXCLUDED.calendar_sync_attempted_at,
         calendar_synced_at = EXCLUDED.calendar_synced_at,
         reschedule_snapshot_to_date = COALESCE(monthly_schedule.reschedule_snapshot_to_date, EXCLUDED.reschedule_snapshot_to_date),
         reschedule_snapshot_to_time = COALESCE(monthly_schedule.reschedule_snapshot_to_time, EXCLUDED.reschedule_snapshot_to_time),
         reschedule_snapshot_from_date = COALESCE(monthly_schedule.reschedule_snapshot_from_date, EXCLUDED.reschedule_snapshot_from_date),
         reschedule_snapshot_from_time = COALESCE(monthly_schedule.reschedule_snapshot_from_time, EXCLUDED.reschedule_snapshot_from_time)`,
      [
        localEventId,
        title,
        dateStrRaw,
        startDate.toISOString(),
        endDate.toISOString(),
        studentName,
        !!student.is_child,
        null,
        lessonKind,
        lessonModeVal,
        studentIdNum,
        CALENDAR_SYNC_STATUS_PENDING,
        calendarSyncKey,
        srcDateForSnap,
        srcTimeJst,
      ]
    );
    await client.query(
      `UPDATE monthly_schedule SET status = 'cancelled', awaiting_reschedule_date = FALSE, title = $3,
         reschedule_snapshot_to_date = $4::date, reschedule_snapshot_to_time = $5
       WHERE event_id = $1 AND student_name = $2`,
      [sourceEventId, sourceStudentName, oldTitleUpdated, dateStrRaw, timeStrRaw]
    );
    await client.query(
      `INSERT INTO reschedules (from_event_id, from_student_name, to_event_id, to_student_name, created_by_staff_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (from_event_id, from_student_name)
       DO UPDATE SET to_event_id = EXCLUDED.to_event_id, to_student_name = EXCLUDED.to_student_name, created_by_staff_id = EXCLUDED.created_by_staff_id, created_at = NOW()`,
      [sourceEventId, sourceStudentName, localEventId, studentName, req.staff?.id ?? null]
    );
    await client.query('COMMIT');

    queueBookedLessonEventSync(localEventId);
    if (isBookingGasEnabled()) {
      setTimeout(() => {
        updateBookedLessonEventInGas(sourceEventId, {
          colorId: '8',
          title: oldTitleUpdated,
          mergeStudentAdminDescription: { awaiting_reschedule_date: false },
        }).catch((err) => {
          console.error('[reschedule-linked] source calendar update failed:', err?.message || err);
        });
      }, 0);
    }

    res.status(201).json({
      ok: true,
      source_event_id: sourceEventId,
      new_event_id: localEventId,
      date: dateStrRaw,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      calendar_sync_status: CALENDAR_SYNC_STATUS_PENDING,
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
    if (isBookingGasEnabled() && shouldSyncCalendarForRows(oldRows)) {
      const del = await deleteBookedLessonEventInGas(eventId);
      if (!del.ok) {
        return res.status(502).json({
          error: del.error || 'Failed to remove lesson from Google Calendar',
          event_id: eventId,
        });
      }
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
