/**
 * Booking service handler — logic extracted from schedule routes.
 * Staff routes remain thin adapters that call these handlers unchanged.
 */
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
import * as D from './domainInternals.js';

const {
  SQL_NOT_STAFF_BREAK,
  SQL_BLOCKS_STUDENT_SLOT_OVERLAP,
  LOCAL_BOOKING_EVENT_ID_PREFIX,
  CALENDAR_SYNC_STATUS_PENDING,
  CALENDAR_SYNC_STATUS_SYNCED,
  CALENDAR_SYNC_STATUS_FAILED,
  GRID_TIME_SLOTS,
  isOwnerCoursePayment,
  clampBookingDurationMinutes,
  normalizeTeacherNameForOwner,
  resolveOwnerCourseTeacherName,
  deriveLessonKindFromStudent,
  normalizeCalendarSyncStatus,
  buildLocalBookingEventId,
  buildCalendarSyncKey,
  buildMonthlyEventId,
  lessonModeToLocationLabel,
  locationLabelToLessonMode,
  normalizePersonName,
  getOrderedGroupMembers,
  getOrderedEventStudents,
  buildCanonicalLessonTitle,
  canonicalizeEventTitleById,
  getPackTotalForBooking,
  getBookedCountForMonth,
  renumberMonthLessonTitlesForStudent,
  listActiveMonthEventIdsByStart,
  jstIsoDowFromUtcMs,
  addOneMonthYyyyMmKey,
  lastDayOfYyyyMm,
  firstJstIsoDowDateInMonth,
  rruleUntilUtcFromJstEndOfDay,
  bydayFromJstIsoDow,
  bareSeriesMasterFromScheduleRow,
  createNextMonthReservedHoldForSeries,
  queryReservedBatchRows,
  deleteReservedHoldFromCalendar,
  rollbackConfirmCreatedLessons,
  groupReservedBatchRows,
  deleteReservedPlaceholderForWeek,
  countReservedWeeksInBatch,
  persistConfirmReservedWeek,
  persistConfirmReservedToDatabase,
  deleteOrphanReservedRowsAfterConfirm,
  scheduleRowDateToYyyyMmDd,
  batchRowsToOrderedStudents,
  assertBookableSlotForConfirm,
  shouldSyncCalendarForRows,
  rowsIndicateExplicitCalendarSyncedForGasDelete,
  syncBookedLessonEventToCalendar,
  parsePackTotalFromTitle,
  addDaysToYyyyMmDd,
  parseClock5,
  normalizeTeacherNameKey,
  displayBreakTitleFromCalendar,
  matchPresetForSlot,
  dateWeekday,
  hourInHalfOpenRange,
  buildOwnerCourseSlotOccupiedForWeek,
  getEventIdFromPath,
  deleteAllMonthlyScheduleRowsAtLessonSlot,
  finalizeLessonRemoveFromDb,
  calendarGasOptions,
  attemptGasCalendarDeleteForLesson,
  rowsShouldAttemptGasCalendarDelete,
  shouldSkipAmbiguousRecurringCalendarUpdate,
  shouldSkipAmbiguousRecurringForRows,
  dayOrdinalSuffix,
  formatOrdinalCalendarDay,
  extractRescheduleTitleMarker,
  stripRescheduleTitleMarker,
  applyRescheduleTitleMarker,
  preserveRescheduleTitleMarker,
  collectExcludeCalendarEventIds,
} = D;

export async function handleGetWeek(req, res) {
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
    let studentStatusForGrid = null;
    if (Number.isFinite(studentIdNum)) {
      const sn = await query('SELECT name, payment, status FROM students WHERE id = $1', [studentIdNum]);
      studentNameForGrid = (sn.rows[0]?.name || '').trim() || null;
      studentPaymentForGrid = sn.rows[0]?.payment ?? null;
      studentStatusForGrid = sn.rows[0]?.status ?? null;
    }
    const isOwnerCourseForGrid =
      deriveLessonKindFromStudent({
        payment: studentPaymentForGrid,
        status: studentStatusForGrid,
      }) === 'owner';
    const [scheduleResult, teachersResult, breakPresetsResult] = await Promise.all([
      query(
        `SELECT
           to_char(m.start AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS date_jst,
           to_char(m.start AT TIME ZONE 'Asia/Tokyo', 'HH24') || ':00' AS time_jst,
           m.start AS start_ts,
           m."end" AS end_ts,
           m.is_kids_lesson,
           m.event_id,
           m.student_name,
           m.student_id,
           m.lesson_kind,
           m.teacher_name,
           m.title,
           s.payment AS student_payment
         FROM monthly_schedule m
         LEFT JOIN students s ON s.id = m.student_id
         WHERE m.date >= $1::date AND m.date < $1::date + interval '7 days'
         AND (m.status IS NULL OR LOWER(TRIM(m.status)) NOT IN ('cancelled', 'rescheduled'))
         AND (m.student_id IS NULL OR NOT (m.student_id = ANY($2::int[])))
         ORDER BY m.date, m.start`,
        [weekStart, excludedStudentIds]
      ),
      query(
        `SELECT
           t.date,
           t.teacher_name,
           t.start_time,
           t.end_time
         FROM teacher_schedules t
         INNER JOIN staff s
           ON LOWER(TRIM(s.name)) = LOWER(TRIM(t.teacher_name))
         WHERE t.date >= $1::date
           AND t.date < $1::date + interval '7 days'
           AND s.active = TRUE
           AND s.staff_type = 'english_teacher'
         ORDER BY t.date, t.teacher_name, t.start_time`,
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

    /** Hour slots where an owner's course lesson overlaps a new booking at that grid time (matches POST /book overlap). */
    const ownerCourseSlotOccupied = buildOwnerCourseSlotOccupiedForWeek(
      weekStart,
      scheduleResult.rows,
      clampBookingDurationMinutes(req.query.duration_minutes)
    );

    /** Owner's course: only slots where OWNER_COURSE_STAFF_ID's teacher is on shift. */
    const ownerShamBlocked = {};
    if (Number.isFinite(studentIdNum) && isOwnerCourseForGrid) {
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

    /** Owner's course: cannot double-book another owner's lesson in the same hour (grid aligns with POST /book overlap rule). */
    const ownerCourseConflictBlocked =
      Number.isFinite(studentIdNum) && isOwnerCourseForGrid
        ? { ...ownerCourseSlotOccupied }
        : {};

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
      ownerCourseConflictBlocked,
      staffBreakBySlot,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

