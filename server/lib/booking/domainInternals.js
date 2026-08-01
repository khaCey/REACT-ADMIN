import { Router } from 'express';
import { randomUUID } from 'crypto';
import { pool, query } from '../../db/index.js';
import { logChange } from '../changeLog.js';
import {
  parseJstToUtc,
  getTodayJstDateStr,
  getJstMinutesOfDay,
  roundTeacherShiftStartEnd,
  utcToJstDateAndTime,
} from '../timezone.js';
import {
  BOOKING_DISABLED_STUDENT_IDS,
  bookingDisabledStudentIdsArray,
} from '../bookingExclusions.js';
import {
  buildTeachingHoursByTeacher,
  findAssignableTeachers,
  jstHourLabelFromUtc,
  pickTeacherForBooking,
} from '../teacherBreakRules.js';
import {
  bookingEventColorId,
  createBookedLessonEventInGas,
  deleteBookedLessonEventInGas,
  updateBookedLessonEventInGas,
  deleteReservedCalendarSeriesInGas,
  createReservedRecurringHoldInGas,
  isBookingGasEnabled,
  shouldProceedWithDbOnlyCalendarDelete,
  isGasCalendarEventMissingError,
  isGasCalendarDeleteUnreachableError,
  interpretGasDeleteResultForDbRemove,
  gasDeleteConfirmedInCalendar,
  isAmbiguousRecurringSeriesMaster,
} from '../bookingCalendarSync.js';
import { recordScheduleSlotDismissals } from '../calendarSync.js';
import {
  occurrenceStartIsoFromScheduleRows,
  stripOurMonthlyDisambiguationSuffix,
} from '../calendarEventId.js';
import {
  buildLessonTitleForOrderedStudents,
  rewriteLessonTitleStudentNames,
} from '../groupLessonTitle.js';

/** Pass original lesson start and poll source id so GAS targets one recurring occurrence, not the series master. */
export function calendarGasOptions(rows) {
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  const occurrenceStartIso = occurrenceStartIsoFromScheduleRows(rows);
  const calendarSourceEventId = row?.calendar_source_event_id
    ? String(row.calendar_source_event_id).trim()
    : null;
  const monthlyEventId = row?.event_id ? String(row.event_id).trim() : '';
  const lessonKind = row?.lesson_kind ? String(row.lesson_kind).trim().toLowerCase() : 'regular';
  return {
    scheduleRows: rows,
    ...(occurrenceStartIso ? { occurrenceStartIso } : {}),
    ...(calendarSourceEventId ? { calendarSourceEventId } : {}),
    ...(monthlyEventId ? { rawMonthlyEventId: monthlyEventId } : {}),
    lessonKind,
  };
}

/** Non-local rows that may still exist in Google Calendar — attempt GAS delete on remove. */
export function rowsShouldAttemptGasCalendarDelete(rows) {
  return (rows || []).some(
    (r) => !String(r?.event_id || '').startsWith(LOCAL_BOOKING_EVENT_ID_PREFIX)
  );
}

/**
 * Delete in Calendar via GAS; for recurring holds also try series master remove.
 * @returns {Promise<{ del: object, outcome: ReturnType<typeof interpretGasDeleteResultForDbRemove> }>}
 */
export async function attemptGasCalendarDeleteForLesson(monthlyEventId, rows, options = {}) {
  const row = rows?.[0];
  const seriesMasterId = row ? bareSeriesMasterFromScheduleRow(row) : '';
  // Whole-series Calendar delete only when explicitly requested (never on normal / single reserved remove).
  if (seriesMasterId && isBookingGasEnabled() && options.allowSeriesDelete === true) {
    const seriesDel = await deleteReservedCalendarSeriesInGas({
      seriesMasterId,
      lessonKind: String(row?.lesson_kind || 'regular').trim().toLowerCase(),
    });
    const seriesOutcome = interpretGasDeleteResultForDbRemove(seriesDel);
    if (!seriesOutcome.proceed) return { del: seriesDel, outcome: seriesOutcome };
  }

  const del = await deleteBookedLessonEventInGas(monthlyEventId, {
    ...calendarGasOptions(rows),
    ...(options.excludeEventIds?.length ? { excludeEventIds: options.excludeEventIds } : {}),
    ...(options.skipSlotSweep ? { skipSlotSweep: true } : {}),
    ...(options.skipSeriesMasterIdInDirectRemove
      ? { skipSeriesMasterIdInDirectRemove: true }
      : {}),
  });
  const outcome = interpretGasDeleteResultForDbRemove(del);
  return { del, outcome };
}

/** Calendar event ids that must not be removed (e.g. lessons just created during confirm). */
export function collectExcludeCalendarEventIds(createdGasIds, planned = []) {
  const set = new Set();
  for (const id of createdGasIds || []) {
    const s = String(id || '').trim();
    if (s) set.add(s);
  }
  for (const p of planned || []) {
    const raw = String(p.calendarSourceRaw || '').trim();
    if (raw) set.add(raw);
    const monthlyId = String(p.newEventId || '').trim();
    if (monthlyId) {
      set.add(monthlyId);
      const bare = stripOurMonthlyDisambiguationSuffix(monthlyId);
      if (bare) set.add(bare);
    }
  }
  return [...set];
}

/** Skip GAS styling when we only have a recurring series master and multiple DB occurrences exist. */
export async function shouldSkipAmbiguousRecurringCalendarUpdate(monthlyEventId, calendarSourceEventId, studentId) {
  if (!isAmbiguousRecurringSeriesMaster(monthlyEventId, calendarSourceEventId)) return false;
  const master = stripOurMonthlyDisambiguationSuffix(monthlyEventId);
  if (!master || !Number.isFinite(Number(studentId))) return true;
  const r = await query(
    `SELECT COUNT(DISTINCT date) AS cnt
     FROM monthly_schedule
     WHERE student_id = $1
       AND (
         TRIM(calendar_source_event_id) = $2
         OR REGEXP_REPLACE(TRIM(event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '') = $2
       )`,
    [studentId, master]
  );
  return (parseInt(r.rows[0]?.cnt, 10) || 0) > 1;
}

export async function shouldSkipAmbiguousRecurringForRows(monthlyEventId, rows) {
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return shouldSkipAmbiguousRecurringCalendarUpdate(
    monthlyEventId,
    row?.calendar_source_event_id,
    row?.student_id
  );
}

export const GRID_TIME_SLOTS = [
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

export function dayOrdinalSuffix(n) {
  const k = n % 100;
  const j = n % 10;
  if (k >= 11 && k <= 13) return 'th';
  if (j === 1) return 'st';
  if (j === 2) return 'nd';
  if (j === 3) return 'rd';
  return 'th';
}

/** YYYY-MM-DD -> "8th" (ordinal day only; no month, no time). */
export function formatOrdinalCalendarDay(yyyyMmDd) {
  const s = String(yyyyMmDd || '').trim();
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const dayNum = parseInt(match[3], 10);
  if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) return '';
  return `${dayNum}${dayOrdinalSuffix(dayNum)}`;
}

export const RESCHEDULE_TITLE_MARKER_RE = /Moved\s+(to|from)\s+(\?{3}|\d{1,2}(?:st|nd|rd|th))/i;

export function extractRescheduleTitleMarker(title) {
  const m = String(title || '').match(RESCHEDULE_TITLE_MARKER_RE);
  if (!m) return '';
  const dir = String(m[1] || '').toLowerCase() === 'from' ? 'from' : 'to';
  const label = String(m[2] || '').trim() || '???';
  return `Moved ${dir} ${label}`;
}

export function stripRescheduleTitleMarker(title) {
  let s = String(title || '').trim();
  if (!s) return '';
  s = s.replace(/^\s*Moved\s+(?:to|from)\s+(?:\?{3}|\d{1,2}(?:st|nd|rd|th))\s*[·•-]\s*/i, '');
  s = s.replace(/\s*[·•-]\s*Moved\s+(?:to|from)\s+(?:\?{3}|\d{1,2}(?:st|nd|rd|th))\s*$/i, '');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

export function applyRescheduleTitleMarker(baseTitle, direction, label) {
  const base = stripRescheduleTitleMarker(baseTitle);
  const dir = String(direction || '').toLowerCase() === 'from' ? 'from' : 'to';
  const dayLabel = String(label || '').trim() || '???';
  const marker = `Moved ${dir} ${dayLabel}`;
  if (!base) return marker;
  return `${base} · ${marker}`;
}

export function preserveRescheduleTitleMarker(existingTitle, nextBaseTitle) {
  const marker = extractRescheduleTitleMarker(existingTitle);
  const base = stripRescheduleTitleMarker(nextBaseTitle);
  if (!marker) return base;
  if (!base) return marker;
  return `${base} · ${marker}`;
}

/** Exclude break placeholder rows from capacity / overlap / mix (PostgreSQL). */
export const SQL_NOT_STAFF_BREAK = `(m.lesson_kind IS NULL OR m.lesson_kind <> 'staff_break')`;
/** Reserved holds are placeholders; they must not block confirm/book at the same time for the same student. */
export const SQL_BLOCKS_STUDENT_SLOT_OVERLAP = `(m.status IS NULL OR LOWER(TRIM(m.status)) NOT IN ('cancelled', 'rescheduled', 'reserved'))`;
export const LOCAL_BOOKING_EVENT_ID_PREFIX = 'local-booking-';
export const CALENDAR_SYNC_STATUS_PENDING = 'pending';
export const CALENDAR_SYNC_STATUS_SYNCED = 'synced';
export const CALENDAR_SYNC_STATUS_FAILED = 'failed';

export function isOwnerCoursePayment(payment) {
  return String(payment || '').toLowerCase().includes('owner');
}

/** Same clamp as POST /book for lesson duration (minutes). */
export function clampBookingDurationMinutes(raw) {
  return Math.min(120, Math.max(30, Number(raw) || 50));
}

export function normalizeTeacherNameForOwner(s) {
  return String(s || '').trim().toLowerCase();
}

/** Staff id from OWNER_COURSE_STAFF_ID; resolves `staff.name` to match `teacher_schedules.teacher_name`. */
export async function resolveOwnerCourseTeacherName() {
  // Product rule: owner's course is strictly tied to Sham's shift.
  // Keep this explicit so env misconfiguration cannot widen availability.
  return 'Sham';
}

export function deriveLessonKindFromStudent(student) {
  const status = String(student?.status || '').trim().toUpperCase();
  if (status === 'DEMO') return 'demo';
  const payment = String(student?.payment || '').toLowerCase();
  if (payment.includes('owner')) return 'owner';
  return 'regular';
}

export function normalizeCalendarSyncStatus(val) {
  const v = String(val || '').trim().toLowerCase();
  return v || CALENDAR_SYNC_STATUS_SYNCED;
}

export function buildLocalBookingEventId() {
  return `${LOCAL_BOOKING_EVENT_ID_PREFIX}${randomUUID()}`;
}

export function buildCalendarSyncKey() {
  return `booking-sync-${randomUUID()}`;
}

export function buildMonthlyEventId(rawEventId, lessonDate, startTs) {
  const raw = String(rawEventId || '').trim();
  const date = String(lessonDate || '').trim();
  if (!raw) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return raw;
  const start = startTs ? new Date(startTs) : null;
  if (!start || Number.isNaN(start.getTime())) return `${raw}_${date}`;
  const timeSuffix = start.toISOString().slice(11, 19).replace(/:/g, '-');
  return `${raw}_${date}_${timeSuffix}`;
}

export function lessonModeToLocationLabel(lessonMode) {
  return String(lessonMode || '').trim().toLowerCase() === 'online' ? 'Online' : 'Cafe';
}

export function locationLabelToLessonMode(locationLabel) {
  return String(locationLabel || '').trim().toLowerCase() === 'online' ? 'online' : 'cafe';
}

export function normalizePersonName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export async function getOrderedGroupMembers(groupId, db = query) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return [];
  const result = await db(
    `SELECT s.id, s.name, s.status, s.payment, s.is_child, sgm.sort_order
       FROM student_group_members sgm
       INNER JOIN students s ON s.id = sgm.student_id
      WHERE sgm.group_id = $1
      ORDER BY sgm.sort_order ASC, s.id ASC`,
    [gid]
  );
  return (result.rows || []).map((row) => ({
    id: Number(row.id),
    name: normalizePersonName(row.name),
    status: row.status,
    payment: row.payment,
    is_child: !!row.is_child,
    sort_order: parseInt(row.sort_order, 10) || 0,
  }));
}

export async function getOrderedEventStudents(eventId, db = query) {
  const result = await db(
    `SELECT m.student_id, m.student_name, m.group_sort_order,
            s.name AS canonical_student_name, s.status AS student_status,
            s.payment AS student_payment, s.is_child AS student_is_child
       FROM monthly_schedule m
       LEFT JOIN students s ON s.id = m.student_id
      WHERE m.event_id = $1
      ORDER BY COALESCE(m.group_sort_order, 2147483647) ASC,
               LOWER(COALESCE(s.name, m.student_name)) ASC`,
    [eventId]
  );
  return (result.rows || []).map((row, index) => ({
    id: row.student_id != null ? Number(row.student_id) : null,
    name: normalizePersonName(row.canonical_student_name || row.student_name),
    status: row.student_status,
    payment: row.student_payment,
    is_child: !!row.student_is_child,
    sort_order: parseInt(row.group_sort_order, 10) || index + 1,
  }));
}

export function buildCanonicalLessonTitle(existingTitle, orderedStudents) {
  const core = stripRescheduleTitleMarker(existingTitle || '');
  const rewritten = rewriteLessonTitleStudentNames(core, orderedStudents);
  return preserveRescheduleTitleMarker(existingTitle || '', rewritten);
}

export async function canonicalizeEventTitleById(eventId, { direction = null, label = '' } = {}, db = query) {
  const rowsResult = await db(
    `SELECT title
       FROM monthly_schedule
      WHERE event_id = $1
      ORDER BY student_name ASC`,
    [eventId]
  );
  const rows = rowsResult.rows || [];
  if (rows.length === 0) return '';
  const seedTitle = String(rows[0]?.title || '');
  const orderedStudents = await getOrderedEventStudents(eventId, db);
  const canonicalNoMarker =
    orderedStudents.length > 1 && seedTitle
      ? stripRescheduleTitleMarker(buildCanonicalLessonTitle(seedTitle, orderedStudents))
      : stripRescheduleTitleMarker(seedTitle);
  const finalTitle = direction
    ? applyRescheduleTitleMarker(canonicalNoMarker, direction, label)
    : canonicalNoMarker;
  await db(`UPDATE monthly_schedule SET title = $2 WHERE event_id = $1`, [eventId, finalTitle]);
  return finalTitle;
}

export async function getPackTotalForBooking(studentId, monthKey, providedPackTotal, db = query) {
  const provided = parseInt(providedPackTotal, 10);
  let totalLessons = Number.isFinite(provided) && provided > 0 ? provided : 0;
  if (!totalLessons) {
    const paidCountResult = await db(
      `SELECT COALESCE(SUM(CASE WHEN p.amount IS NULL THEN 0 ELSE p.amount END), 0) AS total_paid
         FROM payments p
        WHERE p.student_id = $1
          AND p.month = $2`,
      [studentId, monthKey]
    );
    totalLessons = Math.max(0, parseInt(paidCountResult.rows[0]?.total_paid, 10) || 0);
  }
  if (!totalLessons) {
    const packRow = await db(
      'SELECT lessons FROM lessons WHERE student_id = $1 AND month = $2',
      [studentId, monthKey]
    );
    totalLessons = Math.max(0, parseInt(packRow.rows[0]?.lessons, 10) || 0);
  }
  return totalLessons;
}

export async function getBookedCountForMonth(studentId, monthKey, db = query) {
  const bookedCountResult = await db(
    `SELECT COUNT(DISTINCT m.event_id) AS cnt
       FROM monthly_schedule m
      WHERE (m.status IS NULL OR LOWER(TRIM(m.status)) NOT IN ('cancelled', 'rescheduled'))
        AND m.student_id = $1
        AND to_char(m.date, 'YYYY-MM') = $2`,
    [studentId, monthKey]
  );
  return parseInt(bookedCountResult.rows[0]?.cnt, 10) || 0;
}

/**
 * Upsert pack size and rewrite monthly_schedule titles as Name (Loc) i/N in start order.
 * Then best-effort patch Google Calendar titles for synced scheduled lessons.
 * @returns {Promise<{ updated: number, pack_total: number, calendar_patched: number, calendar_errors: Array<{ event_id: string, error: string }> }>}
 */
export async function renumberMonthLessonTitlesForStudent(studentId, monthKey, packTotal, db = query) {
  const sid = Number(studentId);
  const month = String(monthKey || '').trim().slice(0, 7);
  const pack = Math.max(1, parseInt(packTotal, 10) || 0);
  if (!month || !/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(sid) || sid <= 0 || !pack) {
    throw new Error('renumberMonthLessonTitlesForStudent requires studentId, YYYY-MM month, and pack_total >= 1');
  }

  const studentResult = await db('SELECT id, name FROM students WHERE id = $1', [sid]);
  if (studentResult.rows.length === 0) {
    throw new Error('Student not found');
  }
  const studentName = String(studentResult.rows[0].name || '').trim();
  if (!studentName) {
    throw new Error('Student has no name');
  }

  await db(
    `INSERT INTO lessons (student_id, month, lessons) VALUES ($1, $2, $3)
     ON CONFLICT (student_id, month) DO UPDATE SET lessons = EXCLUDED.lessons`,
    [sid, month, pack]
  );

  const rows = await db(
    `SELECT event_id, student_id, student_name, title, lesson_kind, lesson_mode,
            status, start, "end", calendar_source_event_id, calendar_sync_status
       FROM monthly_schedule
      WHERE student_id = $1
        AND to_char(date, 'YYYY-MM') = $2
        AND (status IS NULL OR LOWER(TRIM(status)) NOT IN ('cancelled', 'rescheduled'))
      ORDER BY start ASC, event_id ASC`,
    [sid, month]
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

  /** @type {string[]} */
  const eventOrder = [];
  /** @type {Map<string, object[]>} */
  const rowsByEvent = new Map();
  for (const r of rows.rows || []) {
    const eid = String(r.event_id || '').trim();
    if (!eid) continue;
    if (!rowsByEvent.has(eid)) {
      rowsByEvent.set(eid, []);
      eventOrder.push(eid);
    }
    rowsByEvent.get(eid).push(r);
  }

  /** @type {Map<string, string>} */
  const titlesByEvent = new Map();
  let idx = 0;
  for (const eid of eventOrder) {
    idx += 1;
    const groupRows = rowsByEvent.get(eid) || [];
    const r = groupRows[0];
    const orderedStudents = await getOrderedEventStudents(eid, db);
    const titleStudents =
      orderedStudents.length > 0 ? orderedStudents : [{ name: studentName }];
    const lessonKind = String(r.lesson_kind || 'regular').toLowerCase();
    const baseTitle =
      lessonKind === 'demo'
        ? buildLessonTitleForOrderedStudents({
            students: titleStudents,
            lessonKind,
            locationLabel,
          })
        : buildLessonTitleForOrderedStudents({
            students: titleStudents,
            lessonKind,
            locationLabel: lessonModeToLocationLabel(r.lesson_mode || locationLabel),
            lessonNumber: idx,
            totalLessons: pack,
          });
    const newTitle = preserveRescheduleTitleMarker(r.title || '', baseTitle);
    titlesByEvent.set(eid, newTitle);
    if (orderedStudents.length > 1 || groupRows.length > 1) {
      await db(`UPDATE monthly_schedule SET title = $1 WHERE event_id = $2`, [newTitle, eid]);
    } else {
      await db(
        `UPDATE monthly_schedule SET title = $1 WHERE event_id = $2 AND student_name = $3`,
        [newTitle, eid, r.student_name]
      );
    }
  }

  let calendar_patched = 0;
  /** @type {Array<{ event_id: string, error: string }>} */
  const calendar_errors = [];
  if (isBookingGasEnabled()) {
    for (const eid of eventOrder) {
      const groupRows = rowsByEvent.get(eid) || [];
      const r = groupRows[0];
      if (!r) continue;
      const status = String(r.status || '').toLowerCase().trim();
      if (status === 'reserved') continue;
      if (String(eid).startsWith(LOCAL_BOOKING_EVENT_ID_PREFIX)) continue;
      if (normalizeCalendarSyncStatus(r.calendar_sync_status) !== CALENDAR_SYNC_STATUS_SYNCED) {
        continue;
      }
      try {
        if (await shouldSkipAmbiguousRecurringCalendarUpdate(eid, r.calendar_source_event_id, sid)) {
          continue;
        }
      } catch (skipErr) {
        calendar_errors.push({
          event_id: eid,
          error: skipErr?.message || String(skipErr),
        });
        continue;
      }
      const title = titlesByEvent.get(eid);
      if (!title) continue;
      try {
        const gasRes = await updateBookedLessonEventInGas(eid, { title }, calendarGasOptions(groupRows));
        if (gasRes?.ok) {
          calendar_patched += 1;
        } else {
          const errMsg = String(gasRes?.error || 'Calendar title update failed').trim();
          console.error('[renumber] Calendar title patch failed', eid, errMsg);
          calendar_errors.push({ event_id: eid, error: errMsg });
        }
      } catch (patchErr) {
        const errMsg = String(patchErr?.message || patchErr).trim();
        console.error('[renumber] Calendar title patch error', eid, errMsg);
        calendar_errors.push({ event_id: eid, error: errMsg });
      }
    }
  }

  return {
    updated: eventOrder.length,
    pack_total: pack,
    calendar_patched,
    calendar_errors,
  };
}

/**
 * Active event_ids for a student/month ordered by start (for chronological n/total).
 * @returns {Promise<string[]>}
 */
export async function listActiveMonthEventIdsByStart(studentId, monthKey, db = query) {
  const ordered = await db(
    `SELECT m.event_id
       FROM monthly_schedule m
      WHERE m.student_id = $1
        AND to_char(m.date, 'YYYY-MM') = $2
        AND (m.status IS NULL OR LOWER(TRIM(m.status)) NOT IN ('cancelled', 'rescheduled'))
      GROUP BY m.event_id
      ORDER BY MIN(m.start) ASC`,
    [studentId, monthKey]
  );
  return (ordered.rows || []).map((r) => String(r.event_id || '').trim()).filter(Boolean);
}

const SHORT_JST_TO_ISODOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function jstIsoDowFromUtcMs(utcMs) {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'short' }).format(
    new Date(utcMs)
  );
  return SHORT_JST_TO_ISODOW[short] || 1;
}

export function addOneMonthYyyyMmKey(ym) {
  const [ys, ms] = String(ym).split('-');
  const y = parseInt(ys, 10);
  const mo = parseInt(ms, 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return null;
  let ny = y;
  let nm = mo + 1;
  if (nm > 12) {
    nm = 1;
    ny += 1;
  }
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function lastDayOfYyyyMm(ym) {
  const [ys, ms] = String(ym).split('-');
  const y = parseInt(ys, 10);
  const mo = parseInt(ms, 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${y}-${String(mo).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;
}

export function firstJstIsoDowDateInMonth(yyyyMm, isodow1to7) {
  const [y, m] = yyyyMm.split('-').map(Number);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let day = 1; day <= dim; day++) {
    const ds = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const inst = new Date(`${ds}T12:00:00+09:00`);
    const short = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'short' }).format(inst);
    if (SHORT_JST_TO_ISODOW[short] === isodow1to7) return ds;
  }
  return null;
}

export function rruleUntilUtcFromJstEndOfDay(yyyyMmDd) {
  const u = parseJstToUtc(yyyyMmDd, 23, 59);
  if (!u) return '';
  const end = new Date(u.getTime() + 59 * 1000);
  return end.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function bydayFromJstIsoDow(isodow1to7) {
  const names = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  const i = Number(isodow1to7);
  if (!Number.isFinite(i) || i < 1 || i > 7) return 'MO';
  return names[i - 1];
}

export function bareSeriesMasterFromScheduleRow(row) {
  const src = String(row.calendar_source_event_id || '').trim();
  const fromEvent = stripOurMonthlyDisambiguationSuffix(String(row.event_id || ''));
  let base = src || fromEvent;
  base = base.replace(/@google\.com$/i, '');
  base = base.replace(/_\d{8}T\d{6}Z$/i, '');
  base = base.replace(/_R\d{8}T\d{6}Z?$/i, '');
  return base;
}

/** After the old recurring reserved series is removed, create a bounded hold for the following month. */
export async function createNextMonthReservedHoldForSeries(anchorRow, confirmMonth) {
  const nextYm = addOneMonthYyyyMmKey(confirmMonth);
  if (!nextYm) {
    return {
      ok: true,
      eventId: null,
      warning: 'Could not compute next month; skipped next-month reserved hold.',
    };
  }
  const lastNext = lastDayOfYyyyMm(nextYm);
  const templateStart = new Date(anchorRow.start);
  const isodow = jstIsoDowFromUtcMs(templateStart.getTime());
  const firstOcc = firstJstIsoDowDateInMonth(nextYm, isodow);
  const jstTemplate = utcToJstDateAndTime(templateStart);
  if (!firstOcc || !lastNext || !jstTemplate) {
    return { ok: true, eventId: null, warning: 'Could not build next-month hold; skipped.' };
  }
  const [th, tm] = jstTemplate.time.split(':').map((x) => parseInt(x, 10));
  const occStart = parseJstToUtc(firstOcc, th, tm);
  if (!occStart) {
    return { ok: true, eventId: null, warning: 'Could not compute next-month hold start; skipped.' };
  }
  const durMs = new Date(anchorRow.end).getTime() - templateStart.getTime();
  const occEnd = new Date(occStart.getTime() + durMs);
  const startLocal = `${firstOcc}T${String(th).padStart(2, '0')}:${String(tm || 0).padStart(2, '0')}:00`;
  const endJstParts = utcToJstDateAndTime(occEnd);
  const endLocal = endJstParts
    ? `${endJstParts.date}T${endJstParts.time.slice(0, 2)}:${endJstParts.time.slice(3, 5)}:00`
    : startLocal;

  const untilZ = rruleUntilUtcFromJstEndOfDay(lastNext);
  const byday = bydayFromJstIsoDow(isodow);
  const recurrence = untilZ
    ? [`RRULE:FREQ=WEEKLY;BYDAY=${byday};UNTIL=${untilZ}`]
    : [`RRULE:FREQ=WEEKLY;COUNT=1;BYDAY=${byday}`];

  const holdTitle = String(anchorRow.title || '').trim() || 'Reserved (placeholder)';
  const teacher = String(anchorRow.teacher_name || '').trim();
  const descLines = [
    'Source: Student Admin confirm schedule (reserved hold)',
    anchorRow.student_id != null ? `StudentId: ${anchorRow.student_id}` : null,
    teacher ? `#teacher${teacher}` : null,
  ].filter(Boolean);

  const holdRes = await createReservedRecurringHoldInGas({
    lessonKind: String(anchorRow.lesson_kind || 'regular').trim().toLowerCase(),
    title: holdTitle,
    description: descLines.join('\n'),
    startLocal,
    endLocal,
    timeZone: 'Asia/Tokyo',
    recurrence,
  });
  if (!holdRes.ok || !holdRes.eventId) {
    return {
      ok: false,
      eventId: null,
      error: holdRes.error || 'Failed to create next-month reserved hold',
    };
  }
  return { ok: true, eventId: holdRes.eventId, warning: null };
}

/** Reserved rows in one month that share the same recurring hold as the anchor (same scope as confirm-reserved). */
export async function queryReservedBatchRows(anchorRow, confirmMonth) {
  const pollSeries = String(anchorRow.calendar_source_event_id || '').trim();
  const idBase = stripOurMonthlyDisambiguationSuffix(String(anchorRow.event_id || ''));
  const batchResult = pollSeries
    ? await query(
        `SELECT m.*
           FROM monthly_schedule m
          WHERE to_char(m.date, 'YYYY-MM') = $1
            AND LOWER(TRIM(COALESCE(m.status,''))) = 'reserved'
            AND (
              TRIM(COALESCE(m.calendar_source_event_id,'')) = $2
              OR REGEXP_REPLACE(TRIM(m.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '') = $3
            )
          ORDER BY m.date ASC, m.start ASC, m.event_id ASC`,
        [confirmMonth, pollSeries, idBase]
      )
    : await query(
        `SELECT m.*
           FROM monthly_schedule m
          WHERE to_char(m.date, 'YYYY-MM') = $1
            AND LOWER(TRIM(COALESCE(m.status,''))) = 'reserved'
            AND REGEXP_REPLACE(TRIM(m.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '') = $2
          ORDER BY m.date ASC, m.start ASC, m.event_id ASC`,
        [confirmMonth, idBase]
      );
  return batchResult.rows || [];
}

/**
 * Delete old reserved placeholder events in Google Calendar (each occurrence, then series master).
 * Uses pre-confirm batch rows so GAS gets occurrence start / poll source ids.
 */
export async function deleteReservedHoldFromCalendar(batchRows, anchorRow, options = {}) {
  const seriesMasterId = bareSeriesMasterFromScheduleRow(anchorRow);
  const lessonKind = String(anchorRow.lesson_kind || 'regular').trim().toLowerCase();
  const excludeEventIds = Array.isArray(options.excludeEventIds) ? options.excludeEventIds : [];
  const byEventId = new Map();
  for (const row of batchRows || []) {
    const eid = String(row.event_id || '').trim();
    if (!eid) continue;
    if (!byEventId.has(eid)) byEventId.set(eid, []);
    byEventId.get(eid).push(row);
  }

  if (seriesMasterId && isBookingGasEnabled()) {
    const delSeries = await deleteReservedCalendarSeriesInGas({ seriesMasterId, lessonKind });
    const seriesOutcome = interpretGasDeleteResultForDbRemove(delSeries);
    if (!seriesOutcome.proceed) {
      return {
        ok: false,
        error: seriesOutcome.blockingError || 'Failed to delete old reserved calendar series',
        seriesMasterId,
        event_id: String(anchorRow.event_id || '').trim(),
      };
    }
  }

  for (const [eid, rowsForEvent] of byEventId) {
    const del = await deleteBookedLessonEventInGas(eid, {
      ...calendarGasOptions(rowsForEvent),
      excludeEventIds,
      skipSlotSweep: true,
      skipSeriesMasterIdInDirectRemove: true,
    });
    const outcome = interpretGasDeleteResultForDbRemove(del);
    if (!outcome.proceed) {
      return {
        ok: false,
        error: outcome.blockingError || `Failed to delete old reserved calendar event ${eid}`,
        seriesMasterId,
        event_id: eid,
      };
    }
  }

  return {
    ok: true,
    seriesMasterId: seriesMasterId || null,
    instances_deleted: byEventId.size,
    series_deleted: Boolean(seriesMasterId),
  };
}

export async function rollbackConfirmCreatedLessons(createdGasIds, lessonKind = 'regular') {
  const kind = String(lessonKind || 'regular').trim().toLowerCase() || 'regular';
  for (const id of createdGasIds || []) {
    try {
      await deleteBookedLessonEventInGas(id, { lessonKind: kind });
    } catch (cleanupErr) {
      console.error('[confirm-reserved] rollback create failed', id, cleanupErr?.message || cleanupErr);
    }
  }
}

export function groupReservedBatchRows(batchRows) {
  const byEvent = new Map();
  for (const row of batchRows || []) {
    const eid = String(row.event_id || '');
    if (!eid) continue;
    if (!byEvent.has(eid)) byEvent.set(eid, []);
    byEvent.get(eid).push(row);
  }
  return [...byEvent.values()].sort((a, b) => {
    const da = new Date(a[0].date) - new Date(b[0].date);
    if (da !== 0) return da;
    return new Date(a[0].start) - new Date(b[0].start);
  });
}

/** Delete one week's reserved placeholder occurrence (not the series master). */
export async function deleteReservedPlaceholderForWeek(groupRows, options = {}) {
  const eid = String(groupRows[0]?.event_id || '').trim();
  if (!eid) return { ok: false, error: 'No event_id on reserved week' };
  const excludeEventIds = Array.isArray(options.excludeEventIds) ? options.excludeEventIds : [];
  const seriesMasterId = bareSeriesMasterFromScheduleRow(groupRows[0]);
  const del = await deleteBookedLessonEventInGas(eid, {
    ...calendarGasOptions(groupRows),
    ...(seriesMasterId ? { seriesMasterId } : {}),
    excludeEventIds,
    skipSlotSweep: false,
    skipSeriesMasterIdInDirectRemove: true,
    strictDelete: true,
    confirmReservedPlaceholder: true,
  });
  const outcome = interpretGasDeleteResultForDbRemove(del);
  if (!outcome.proceed) {
    return {
      ok: false,
      error: outcome.blockingError || `Failed to delete old reserved calendar event ${eid}`,
      event_id: eid,
      gas_action: del?.actionTaken || null,
      gas_calendar_id: del?.calendarId || null,
      gas_event_id: del?.eventId || null,
      gas_deleted_count: del?.deletedCount ?? null,
      gas_revision: del?.gasScriptRevision || null,
    };
  }
  return {
    ok: true,
    event_id: eid,
    gas_calendar_id: del?.calendarId || null,
    gas_event_id: del?.eventId || null,
    gas_deleted_count: del?.deletedCount ?? null,
  };
}

export async function countReservedWeeksInBatch(anchorRow, confirmMonth) {
  const rows = await queryReservedBatchRows(anchorRow, confirmMonth);
  const byEvent = new Set();
  for (const row of rows) {
    const eid = String(row.event_id || '').trim();
    if (eid) byEvent.add(eid);
  }
  return byEvent.size;
}

/** Apply reserved → scheduled in DB for one week after Calendar steps succeed. */
export async function persistConfirmReservedWeek(plannedItem) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = plannedItem;
    const upd = await client.query(
      `UPDATE monthly_schedule
          SET event_id = $1,
              title = $2,
              status = 'scheduled',
              calendar_source_event_id = $3,
              calendar_sync_status = $4,
              calendar_sync_error = NULL,
              calendar_sync_attempted_at = NOW(),
              calendar_synced_at = NOW(),
              calendar_sync_key = COALESCE(calendar_sync_key, $5)
        WHERE event_id = $6
          AND LOWER(TRIM(COALESCE(status, 'reserved'))) = 'reserved'`,
      [p.newEventId, p.title, p.calendarSourceRaw, CALENDAR_SYNC_STATUS_SYNCED, p.bookingKey, p.oldEventId]
    );
    if ((upd.rowCount || 0) === 0) {
      throw new Error('Lesson changed mid-transaction; aborting confirm');
    }
    await client.query(`UPDATE reschedules SET from_event_id = $1 WHERE from_event_id = $2`, [
      p.newEventId,
      p.oldEventId,
    ]);
    await client.query(`UPDATE reschedules SET to_event_id = $1 WHERE to_event_id = $2`, [
      p.newEventId,
      p.oldEventId,
    ]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (dbErr) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    return { ok: false, error: dbErr.message || 'Database update failed' };
  } finally {
    client.release();
  }
}

/** Apply reserved → scheduled in DB only after all Calendar steps succeed. */
export async function persistConfirmReservedToDatabase(planned) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of planned) {
      const upd = await client.query(
        `UPDATE monthly_schedule
            SET event_id = $1,
                title = $2,
                status = 'scheduled',
                calendar_source_event_id = $3,
                calendar_sync_status = $4,
                calendar_sync_error = NULL,
                calendar_sync_attempted_at = NOW(),
                calendar_synced_at = NOW(),
                calendar_sync_key = COALESCE(calendar_sync_key, $5)
          WHERE event_id = $6
            AND LOWER(TRIM(COALESCE(status, 'reserved'))) = 'reserved'`,
        [p.newEventId, p.title, p.calendarSourceRaw, CALENDAR_SYNC_STATUS_SYNCED, p.bookingKey, p.oldEventId]
      );
      if ((upd.rowCount || 0) === 0) {
        throw new Error('Lesson changed mid-transaction; aborting confirm');
      }
      await client.query(`UPDATE reschedules SET from_event_id = $1 WHERE from_event_id = $2`, [
        p.newEventId,
        p.oldEventId,
      ]);
      await client.query(`UPDATE reschedules SET to_event_id = $1 WHERE to_event_id = $2`, [
        p.newEventId,
        p.oldEventId,
      ]);
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (dbErr) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    return { ok: false, error: dbErr.message || 'Database update failed' };
  } finally {
    client.release();
  }
}

/** Remove any reserved DB rows left in the batch (e.g. re-poll duplicates) after confirm. */
export async function deleteOrphanReservedRowsAfterConfirm(anchorRow, confirmMonth, pollSeries, idBase) {
  const anchorStudentId = anchorRow.student_id;
  if (anchorStudentId == null) return 0;
  const pollSeriesTrim = String(pollSeries || '').trim();
  const result = pollSeriesTrim
    ? await query(
        `DELETE FROM monthly_schedule m
          WHERE to_char(m.date, 'YYYY-MM') = $1
            AND m.student_id = $2
            AND LOWER(TRIM(COALESCE(m.status,''))) = 'reserved'
            AND (
              TRIM(COALESCE(m.calendar_source_event_id,'')) = $3
              OR REGEXP_REPLACE(TRIM(m.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '') = $4
            )`,
        [confirmMonth, anchorStudentId, pollSeriesTrim, idBase]
      )
    : await query(
        `DELETE FROM monthly_schedule m
          WHERE to_char(m.date, 'YYYY-MM') = $1
            AND m.student_id = $2
            AND LOWER(TRIM(COALESCE(m.status,''))) = 'reserved'
            AND REGEXP_REPLACE(TRIM(m.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '') = $3`,
        [confirmMonth, anchorStudentId, idBase]
      );
  return result.rowCount || 0;
}

export function scheduleRowDateToYyyyMmDd(rowDate) {
  if (!rowDate) return '';
  // pg returns DATE as JS Date at UTC midnight for the calendar day; use UTC ymd (not local).
  // For timestamptz-ish values, prefer Asia/Tokyo calendar date.
  if (rowDate instanceof Date && !Number.isNaN(rowDate.getTime())) {
    const jst = utcToJstDateAndTime(rowDate);
    if (jst?.date) return jst.date;
    return rowDate.toISOString().slice(0, 10);
  }
  const s = String(rowDate).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

export function batchRowsToOrderedStudents(rows) {
  const sorted = [...(rows || [])].sort((a, b) => {
    const g = (parseInt(a.group_sort_order, 10) || 9999) - (parseInt(b.group_sort_order, 10) || 9999);
    if (g !== 0) return g;
    return String(a.canonical_student_name || a.student_name || '').localeCompare(
      String(b.canonical_student_name || b.student_name || '')
    );
  });
  return sorted.map((row, index) => ({
    id: row.student_id != null ? Number(row.student_id) : null,
    name: normalizePersonName(row.canonical_student_name || row.student_name),
    status: row.student_status,
    payment: row.student_payment,
    is_child: !!row.student_is_child,
    sort_order: parseInt(row.group_sort_order, 10) || index + 1,
  }));
}

/**
 * Same overlap/capacity rules as POST /book, excluding rows whose event_id is in excludedEventIds
 * (reserved slots being converted in the same confirm run).
 */
export async function assertBookableSlotForConfirm({
  startDate,
  endDate,
  dateStr,
  orderedStudents,
  excludedEventIds,
  db = query,
}) {
  const excludedStudentIds = bookingDisabledStudentIdsArray();
  const rep = Array.isArray(excludedEventIds) ? excludedEventIds.filter(Boolean) : [];
  if (rep.length === 0) {
    return { ok: false, status: 500, error: 'Internal: excludedEventIds required for confirm validation' };
  }

  const existingResult = await db(
    `SELECT is_kids_lesson FROM monthly_schedule m
     WHERE (m.status IS NULL OR LOWER(TRIM(m.status)) NOT IN ('cancelled', 'rescheduled'))
       AND ${SQL_NOT_STAFF_BREAK}
       AND m.start < $2::timestamptz AND m."end" > $1::timestamptz
       AND (m.student_id IS NULL OR NOT (m.student_id = ANY($3::int[])))
       AND NOT (m.event_id = ANY($4::text[]))`,
    [startDate.toISOString(), endDate.toISOString(), excludedStudentIds, rep]
  );
  const isChild = orderedStudents.some((s) => s.is_child);
  for (const row of existingResult.rows) {
    const existingIsKids = !!row.is_kids_lesson;
    if (isChild && !existingIsKids) {
      return {
        ok: false,
        status: 400,
        error:
          'Cannot book a kids lesson in a time slot that contains adult lessons. Kids and adults must be kept separate.',
      };
    }
    if (!isChild && existingIsKids) {
      return {
        ok: false,
        status: 400,
        error:
          'Cannot book an adult lesson in a time slot that contains kids lessons. Kids and adults must be kept separate.',
      };
    }
  }

  if (orderedStudents.some((student) => isOwnerCoursePayment(student.payment))) {
    const ownerOverlap = await db(
      `SELECT 1 FROM monthly_schedule m
       LEFT JOIN students s ON s.id = m.student_id
       WHERE (m.status IS NULL OR LOWER(TRIM(m.status)) NOT IN ('cancelled', 'rescheduled'))
         AND ${SQL_NOT_STAFF_BREAK}
         AND m.start < $2::timestamptz AND m."end" > $1::timestamptz
         AND (
           LOWER(TRIM(COALESCE(m.lesson_kind, ''))) = 'owner'
           OR LOWER(TRIM(COALESCE(s.payment, ''))) LIKE '%owner%'
         )
         AND (m.student_id IS NULL OR NOT (m.student_id = ANY($3::int[])))
         AND NOT (m.event_id = ANY($4::text[]))
       LIMIT 1`,
      [startDate.toISOString(), endDate.toISOString(), excludedStudentIds, rep]
    );
    if (ownerOverlap.rows.length > 0) {
      return {
        ok: false,
        status: 400,
        error: "An owner's course lesson is already scheduled for this time. Choose another slot.",
      };
    }
  }

  const orderedStudentIds = orderedStudents.map((student) => Number(student.id)).filter(Number.isFinite);
  const dupResult = await db(
    `SELECT COALESCE(s.name, m.student_name) AS student_name
       FROM monthly_schedule m
       LEFT JOIN students s ON s.id = m.student_id
     WHERE ${SQL_BLOCKS_STUDENT_SLOT_OVERLAP}
       AND ${SQL_NOT_STAFF_BREAK}
       AND m.start < $2::timestamptz AND m."end" > $1::timestamptz
       AND m.student_id = ANY($3::int[])
       AND NOT (m.event_id = ANY($4::text[]))
     LIMIT 1`,
    [startDate.toISOString(), endDate.toISOString(), orderedStudentIds, rep]
  );
  if (dupResult.rows.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `${normalizePersonName(dupResult.rows[0]?.student_name) || 'A selected student'} already has a lesson overlapping this time. Cancel or reschedule the existing lesson first.`,
    };
  }

  const slotMinutes = getJstMinutesOfDay(startDate);
  const [teacherRows, breakPresetsResult] = await Promise.all([
    db(
      `SELECT t.teacher_name, t.start_time, t.end_time,
              COALESCE(e.extend_before_minutes, 0) AS extend_before_minutes,
              COALESCE(e.extend_after_minutes, 0) AS extend_after_minutes
       FROM teacher_schedules t
       LEFT JOIN teacher_shift_extensions e ON e.date = t.date AND e.teacher_name = t.teacher_name
       WHERE t.date = $1::date`,
      [dateStr]
    ),
    db(
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
  const jstForSlot = utcToJstDateAndTime(startDate);
  const hhSlot = jstForSlot ? parseInt(jstForSlot.time.slice(0, 2), 10) : 0;
  const slotHourLabel = `${String(hhSlot).padStart(2, '0')}:00`;
  for (const r of breakPresetsResult.rows || []) {
    const teacherName = String(r.teacher_name || '').trim();
    const start = parseClock5(r.start_time);
    const end = parseClock5(r.end_time);
    if (!teacherName || !start || !end) continue;
    if (!teachersOnBookingDate.has(normalizeTeacherNameKey(teacherName))) continue;
    if (hourInHalfOpenRange(slotHourLabel, start, end)) presetBreakTeacherSet.add(teacherName);
  }
  const teacherSet = new Set();
  for (const r of teacherRows.rows || []) {
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

  if (orderedStudents.some((student) => isOwnerCoursePayment(student.payment))) {
    const shamTeacherName = await resolveOwnerCourseTeacherName();
    if (shamTeacherName) {
      const shamNorm = normalizeTeacherNameForOwner(shamTeacherName);
      const hasSham = [...teacherSet].some((t) => normalizeTeacherNameForOwner(t) === shamNorm);
      if (!hasSham) {
        return {
          ok: false,
          status: 400,
          error: `Owner's course bookings require ${shamTeacherName} to be on shift for this hour. Choose another time.`,
        };
      }
    }
  }

  let teacherCount = teacherSet.size;
  if (teacherCount === 0) teacherCount = 1;
  const lessonCountResult = await db(
    `SELECT COUNT(DISTINCT m.event_id) AS cnt FROM monthly_schedule m
     WHERE (m.status IS NULL OR LOWER(TRIM(m.status)) NOT IN ('cancelled', 'rescheduled'))
       AND ${SQL_NOT_STAFF_BREAK}
       AND m.start < $2::timestamptz AND m."end" > $1::timestamptz
       AND (m.student_id IS NULL OR NOT (m.student_id = ANY($3::int[])))
       AND NOT (m.event_id = ANY($4::text[]))`,
    [startDate.toISOString(), endDate.toISOString(), excludedStudentIds, rep]
  );
  const currentLessonCount = parseInt(lessonCountResult.rows[0]?.cnt, 10) || 0;
  if (currentLessonCount >= teacherCount) {
    return {
      ok: false,
      status: 400,
      error: `No availability: this slot has ${teacherCount} teacher(s) and ${currentLessonCount} lesson(s) already booked.`,
    };
  }

  if (teacherSet.size > 0) {
    const [distinctTeachersResult, dayBreakRows] = await Promise.all([
      db(`SELECT DISTINCT teacher_name FROM teacher_schedules WHERE date = $1::date ORDER BY teacher_name`, [dateStr]),
      db(
        `SELECT
           to_char(m.start AT TIME ZONE 'Asia/Tokyo', 'HH24') || ':00' AS time_jst,
           m.teacher_name,
           m.lesson_kind
         FROM monthly_schedule m
         WHERE m.date = $1::date
         AND (m.status IS NULL OR LOWER(TRIM(m.status)) NOT IN ('cancelled', 'rescheduled'))
         AND (m.student_id IS NULL OR NOT (m.student_id = ANY($2::int[])))
         AND NOT (m.event_id = ANY($3::text[]))`,
        [dateStr, excludedStudentIds, rep]
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
      return {
        ok: false,
        status: 400,
        error:
          'No teacher can take this slot without exceeding 5 teaching hours in a row; add a break hour or choose another time.',
      };
    }
  }

  return { ok: true };
}

export function shouldSyncCalendarForRows(rows) {
  return (rows || []).some(
    (r) =>
      normalizeCalendarSyncStatus(r?.calendar_sync_status) === CALENDAR_SYNC_STATUS_SYNCED &&
      !String(r?.event_id || '').startsWith(LOCAL_BOOKING_EVENT_ID_PREFIX)
  );
}

/**
 * GAS calendar delete on remove: only when every row in the checked set explicitly says synced.
 * Prefers non-cancelled rows (group lessons: do not delete shared Calendar unless all remaining students qualify).
 * If every non-local row is cancelled (e.g. linked-reschedule source), fall back to those rows so remove still deletes Calendar.
 */
export function rowsIndicateExplicitCalendarSyncedForGasDelete(rows) {
  const nonLocal = (rows || []).filter(
    (r) => !String(r?.event_id || '').startsWith(LOCAL_BOOKING_EVENT_ID_PREFIX)
  );
  if (nonLocal.length === 0) return false;
  const active = nonLocal.filter((r) => !['cancelled', 'rescheduled'].includes(String(r?.status || '').toLowerCase()));
  const toCheck = active.length > 0 ? active : nonLocal;
  return toCheck.every((r) => {
    const st = String(r?.calendar_sync_status || '').trim().toLowerCase();
    return (
      st === CALENDAR_SYNC_STATUS_SYNCED ||
      st === 'failed' ||
      st === 'pending'
    );
  });
}

export async function syncBookedLessonEventToCalendar(localEventId) {
  const result = await query(
    `SELECT m.event_id, m.student_name, m.student_id, m.title, to_char(m.date, 'YYYY-MM-DD') AS lesson_date, m.start, m."end", m.status,
            m.teacher_name, m.lesson_kind, m.lesson_mode, m.calendar_sync_status,
            m.calendar_sync_error, m.calendar_sync_key,
            m.group_sort_order,
            s.name AS canonical_student_name, s.status AS student_status,
            s.payment AS student_payment, s.is_child AS student_is_child
       FROM monthly_schedule m
       LEFT JOIN students s ON s.id = m.student_id
      WHERE m.event_id = $1
      ORDER BY COALESCE(m.group_sort_order, 2147483647) ASC,
               LOWER(COALESCE(s.name, m.student_name)) ASC`,
    [localEventId]
  );
  const rows = result.rows || [];
  const row = rows[0];
  if (!row) return { ok: false, error: 'Pending lesson not found' };

  const orderedStudents = rows.map((entry, index) => ({
    id: entry.student_id != null ? Number(entry.student_id) : null,
    name: String(entry.canonical_student_name || entry.student_name || '').trim(),
    status: entry.student_status,
    payment: entry.student_payment,
    is_child: !!entry.student_is_child,
    sort_order: parseInt(entry.group_sort_order, 10) || index + 1,
  }));
  const syncedTitle =
    rows.length > 1
      ? buildCanonicalLessonTitle(row.title || '', orderedStudents)
      : row.title || '';
  const bookingKey =
    String(row.calendar_sync_key || '').trim() || `${String(row.event_id || '').trim() || buildCalendarSyncKey()}`;
  if (rows.some((entry) => ['cancelled', 'rescheduled'].includes(String(entry.status || '').toLowerCase()))) {
    await query(
      `UPDATE monthly_schedule
          SET calendar_sync_status = $2,
              calendar_sync_error = $3,
              calendar_sync_attempted_at = NOW()
        WHERE event_id = $1`,
      [row.event_id, CALENDAR_SYNC_STATUS_FAILED, 'Cancelled before calendar sync']
    );
    return { ok: false, error: 'Cancelled before calendar sync' };
  }

  await query(
    `UPDATE monthly_schedule
        SET calendar_sync_status = $2,
            calendar_sync_error = NULL,
            calendar_sync_attempted_at = NOW(),
            calendar_sync_key = COALESCE(calendar_sync_key, $3),
            title = COALESCE($4, title)
      WHERE event_id = $1`,
    [row.event_id, CALENDAR_SYNC_STATUS_PENDING, bookingKey, syncedTitle]
  );

  const gasRes = await createBookedLessonEventInGas({
    students: orderedStudents,
    student: {
      id: row.student_id,
      name: orderedStudents[0]?.name || '',
      status: row.student_status,
      payment: row.student_payment,
      is_child: !!row.student_is_child,
    },
    startIso: row.start ? new Date(row.start).toISOString() : null,
    endIso: row.end ? new Date(row.end).toISOString() : null,
    assignedTeacherName: row.teacher_name,
    title: syncedTitle,
    location: String(row.lesson_kind || '').trim() === 'demo' ? '' : lessonModeToLocationLabel(row.lesson_mode),
    lessonKind: row.lesson_kind,
    bookingKey,
  });
  if (!gasRes.ok || !gasRes.eventId) {
    await query(
      `UPDATE monthly_schedule
          SET calendar_sync_status = $2,
              calendar_sync_error = $3,
              calendar_sync_attempted_at = NOW()
        WHERE event_id = $1`,
      [row.event_id, CALENDAR_SYNC_STATUS_FAILED, gasRes.error || 'Failed to sync with calendar']
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
              title = $3,
              calendar_sync_status = $4,
              calendar_sync_error = NULL,
              calendar_sync_attempted_at = NOW(),
              calendar_synced_at = NOW(),
              calendar_sync_key = COALESCE(calendar_sync_key, $5)
        WHERE event_id = $2
          AND LOWER(TRIM(COALESCE(status, 'scheduled'))) NOT IN ('cancelled', 'rescheduled')`,
      [syncedMonthlyEventId, row.event_id, syncedTitle, CALENDAR_SYNC_STATUS_SYNCED, bookingKey]
    );
    if ((updateResult.rowCount || 0) === 0) {
      await client.query('ROLLBACK');
      try {
        await deleteBookedLessonEventInGas(gasRes.eventId, {
          lessonKind: String(row.lesson_kind || 'regular').trim().toLowerCase() || 'regular',
        });
      } catch {}
      await query(
        `UPDATE monthly_schedule
            SET calendar_sync_status = $2,
                calendar_sync_error = $3,
                calendar_sync_attempted_at = NOW()
          WHERE event_id = $1`,
        [row.event_id, CALENDAR_SYNC_STATUS_FAILED, 'Lesson changed before calendar sync completed']
      );
      return { ok: false, error: 'Lesson changed before calendar sync completed' };
    }
    await client.query(
      `UPDATE reschedules SET from_event_id = $1 WHERE from_event_id = $2`,
      [syncedMonthlyEventId, row.event_id]
    );
    await client.query(
      `UPDATE reschedules SET to_event_id = $1 WHERE to_event_id = $2`,
      [syncedMonthlyEventId, row.event_id]
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
          SET calendar_sync_status = $2,
              calendar_sync_error = $3,
              calendar_sync_attempted_at = NOW()
        WHERE event_id = $1`,
      [row.event_id, CALENDAR_SYNC_STATUS_FAILED, err.message || 'Failed to update sync result']
    );
    return { ok: false, error: err.message || 'Failed to update sync result' };
  } finally {
    client.release();
  }
}

export function parsePackTotalFromTitle(title) {
  const m = String(title || '').match(/\/\s*(\d+)\s*$/);
  const n = m ? parseInt(m[1], 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function addDaysToYyyyMmDd(dateStr, n) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

export function parseClock5(val) {
  const s = String(val || '').trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : '';
}

export function normalizeTeacherNameKey(s) {
  return String(s || '').trim().toLowerCase();
}

/** Calendar / GAS often stores titles like "Preset break 12:00-13:00"; use "{Name}'s Break". */
export function displayBreakTitleFromCalendar(teacherName, rawTitle) {
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
export function matchPresetForSlot(teacherName, dateStr, timeStr, presetRows, teacherNamesByJstDate) {
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

export function dateWeekday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? NaN : d.getUTCDay();
}

export function hourInHalfOpenRange(hourLabel, startTime, endTime) {
  return hourLabel >= startTime && hourLabel < endTime;
}

/**
 * Grid keys where an owner's-course lesson overlaps a candidate booking starting at that slot.
 * Uses the same interval overlap idea as POST /book (not only the lesson's start hour).
 * Candidate window length matches POST /book duration clamp (default 50m; optional GET duration_minutes).
 */
export function buildOwnerCourseSlotOccupiedForWeek(weekStart, scheduleRows, candidateDurationMinutes) {
  const occupied = {};
  const durationMin = clampBookingDurationMinutes(candidateDurationMinutes);
  const candidateMs = durationMin * 60 * 1000;
  for (const r of scheduleRows) {
    const kind = String(r.lesson_kind || '').trim();
    if (kind === 'staff_break') continue;
    const lk = String(r.lesson_kind || '').trim().toLowerCase();
    const pay = String(r.student_payment || '').toLowerCase();
    if (lk !== 'owner' && !pay.includes('owner')) continue;

    const lessonStart = r.start_ts != null ? new Date(r.start_ts) : null;
    if (!lessonStart || Number.isNaN(lessonStart.getTime())) continue;
    let lessonEnd = r.end_ts != null ? new Date(r.end_ts) : null;
    if (!lessonEnd || Number.isNaN(lessonEnd.getTime())) {
      lessonEnd = new Date(lessonStart.getTime() + 50 * 60 * 1000);
    }

    for (let di = 0; di < 7; di += 1) {
      const dateStr = addDaysToYyyyMmDd(weekStart, di);
      for (const timeStr of GRID_TIME_SLOTS) {
        const parts = String(timeStr || '')
          .trim()
          .slice(0, 5)
          .split(':')
          .map((x) => parseInt(x, 10) || 0);
        const hh = parts[0];
        const mm = parts[1] ?? 0;
        const candStart = parseJstToUtc(dateStr, hh, mm);
        if (!candStart) continue;
        const candEnd = new Date(candStart.getTime() + candidateMs);
        if (lessonStart < candEnd && lessonEnd > candStart) {
          occupied[`${dateStr}T${timeStr}`] = true;
        }
      }
    }
  }
  return occupied;
}

export function getEventIdFromPath(path, suffix) {
  const match = path && path.match(new RegExp(`^/(.+)/${suffix}`));
  const raw = match ? match[1] : '';
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

export async function deleteAllMonthlyScheduleRowsAtLessonSlot(seedRows) {
  const seen = new Set();
  let deleted = 0;
  for (const seed of seedRows || []) {
    const studentId = seed.student_id != null ? Number(seed.student_id) : null;
    const studentName = normalizePersonName(seed.student_name);
    const dateStr = scheduleRowDateToYyyyMmDd(seed.date);
    const startIso = seed.start ? new Date(seed.start).toISOString() : null;
    if (!dateStr || !startIso) continue;
    const dedupe = `${studentId || ''}\t${studentName}\t${dateStr}\t${startIso}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const matchResult =
      studentId != null && Number.isFinite(studentId)
        ? await query(
            `SELECT event_id, student_name FROM monthly_schedule
              WHERE student_id = $1
                AND date = $2::date
                AND start = $3::timestamptz`,
            [studentId, dateStr, startIso]
          )
        : await query(
            `SELECT event_id, student_name FROM monthly_schedule
              WHERE REGEXP_REPLACE(TRIM(student_name), '\\s+', ' ', 'g') = REGEXP_REPLACE(TRIM($1::text), '\\s+', ' ', 'g')
                AND date = $2::date
                AND start = $3::timestamptz`,
            [studentName, dateStr, startIso]
          );

    for (const row of matchResult.rows || []) {
      await query('DELETE FROM monthly_schedule WHERE event_id = $1 AND student_name = $2', [
        row.event_id,
        row.student_name,
      ]);
      deleted += 1;
    }
  }
  return deleted;
}

export async function finalizeLessonRemoveFromDb(oldRows, eventId, req) {
  await recordScheduleSlotDismissals(oldRows);
  const slotDeleted = await deleteAllMonthlyScheduleRowsAtLessonSlot(oldRows);
  const primaryDeleted = await query('DELETE FROM monthly_schedule WHERE event_id = $1', [eventId]);
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
  return { slotDeleted, primaryRowCount: primaryDeleted.rowCount || 0 };
}

export async function purgeAllReservedPlaceholders(req, options = {}) {
  const localOnly = options.localOnly === true;
  const monthFilter = String(options.month || '').trim();

  let sql = `SELECT * FROM monthly_schedule
              WHERE LOWER(TRIM(COALESCE(status,''))) = 'reserved'`;
  const params = [];
  if (/^\d{4}-\d{2}$/.test(monthFilter)) {
    params.push(monthFilter);
    sql += ` AND to_char(date, 'YYYY-MM') = $1`;
  }
  sql += ` ORDER BY student_id NULLS LAST, date ASC, start ASC, event_id ASC`;

  const allRows = (await query(sql, params)).rows || [];
  if (allRows.length === 0) {
    return {
      ok: true,
      batches_total: 0,
      batches_purged: 0,
      removed_row_count: 0,
      removed_event_count: 0,
      errors: [],
    };
  }

  const processedRowKeys = new Set();
  const batches = [];

  for (const row of allRows) {
    const rowKey = `${row.event_id}|${row.student_name}`;
    if (processedRowKeys.has(rowKey)) continue;

    const confirmMonth = scheduleRowDateToYyyyMmDd(row.date).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(confirmMonth)) continue;

    const batchRows = await queryReservedBatchRows(row, confirmMonth);
    if (batchRows.length === 0) continue;

    for (const br of batchRows) {
      processedRowKeys.add(`${br.event_id}|${br.student_name}`);
    }
    batches.push({ anchorRow: row, batchRows });
  }

  let removedRowCount = 0;
  let removedEventCount = 0;
  let batchesPurged = 0;
  const errors = [];

  for (const { anchorRow, batchRows } of batches) {
    const batchLabel = {
      event_id: String(anchorRow.event_id || '').trim(),
      student_id: anchorRow.student_id ?? null,
      student_name: anchorRow.student_name || null,
    };

    try {
      if (!localOnly && isBookingGasEnabled() && rowsShouldAttemptGasCalendarDelete(batchRows)) {
        const holdDel = await deleteReservedHoldFromCalendar(batchRows, anchorRow);
        if (!holdDel.ok) {
          errors.push({
            ...batchLabel,
            error: holdDel.error || 'Failed to delete reserved calendar events',
          });
          continue;
        }
      }

      const eventIds = [
        ...new Set(batchRows.map((r) => String(r.event_id || '').trim()).filter(Boolean)),
      ];

      for (const eid of eventIds) {
        const rowsForEvent = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [eid])).rows;
        if (rowsForEvent.length === 0) continue;
        await recordScheduleSlotDismissals(rowsForEvent);
        await deleteAllMonthlyScheduleRowsAtLessonSlot(rowsForEvent);
        await query('DELETE FROM monthly_schedule WHERE event_id = $1', [eid]);
        for (const oldRow of rowsForEvent) {
          await logChange(
            {
              entityType: 'monthly_schedule',
              entityKey: `${eid}_${oldRow.student_name}`,
              action: 'delete',
              oldData: oldRow,
              newData: null,
            },
            req
          );
          removedRowCount += 1;
        }
        removedEventCount += 1;
      }
      batchesPurged += 1;
    } catch (err) {
      errors.push({
        ...batchLabel,
        error: err?.message || String(err),
      });
    }
  }

  return {
    ok: errors.length === 0,
    batches_total: batches.length,
    batches_purged: batchesPurged,
    removed_row_count: removedRowCount,
    removed_event_count: removedEventCount,
    errors,
  };
}
