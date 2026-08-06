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
import { upsertDemoLessonEvent } from '../demoLessonEvents.js';
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

export async function handleBookLesson(req, res) {
  try {
    const { student_id, group_id, date, time, duration_minutes, pack_total, location } = req.body || {};
    const dateStrRaw = date != null ? String(date).trim() : '';
    const timeStrRaw = time != null ? String(time).trim() : '';
    const hasStudentId = !(student_id === undefined || student_id === null || student_id === '');
    const groupIdNum = Number(group_id);
    if ((!hasStudentId && !(Number.isFinite(groupIdNum) && groupIdNum > 0)) || !dateStrRaw || !timeStrRaw) {
      return res.status(400).json({ error: 'Missing student_id or group_id, date, or time' });
    }

    let orderedStudents = [];
    let activeGroupId = Number.isFinite(groupIdNum) && groupIdNum > 0 ? groupIdNum : null;
    let anchorStudentId = Number(student_id);
    if (activeGroupId) {
      orderedStudents = await getOrderedGroupMembers(activeGroupId);
      if (orderedStudents.length === 0) {
        return res.status(404).json({ error: 'Group not found or has no members.' });
      }
      if (!Number.isFinite(anchorStudentId) || !orderedStudents.some((student) => student.id === anchorStudentId)) {
        anchorStudentId = Number(orderedStudents[0]?.id);
      }
    } else {
      if (!Number.isFinite(anchorStudentId)) {
        return res.status(400).json({ error: 'student_id must be a number' });
      }
      const studentResult = await query(
        'SELECT id, name, is_child, status, payment FROM students WHERE id = $1',
        [anchorStudentId]
      );
      if (studentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Student not found' });
      }
      const student = studentResult.rows[0];
      orderedStudents = [
        {
          id: Number(student.id),
          name: normalizePersonName(student.name),
          is_child: !!student.is_child,
          status: student.status,
          payment: student.payment,
          sort_order: 1,
        },
      ];
    }

    if (orderedStudents.some((student) => BOOKING_DISABLED_STUDENT_IDS.has(Number(student.id)))) {
      return res.status(403).json({ error: 'Booking is not available for one or more students in this group.' });
    }
    if (orderedStudents.some((student) => !normalizePersonName(student.name))) {
      return res.status(400).json({ error: 'One or more selected students have no name.' });
    }
    const studentKinds = new Set(orderedStudents.map((student) => !!student.is_child));
    if (studentKinds.size > 1) {
      return res.status(400).json({ error: 'Kids and adult students cannot be mixed in one linked group.' });
    }
    const lessonKinds = new Set(orderedStudents.map((student) => deriveLessonKindFromStudent(student)));
    if (lessonKinds.size > 1) {
      return res.status(400).json({
        error: 'Demo, owner, and regular students cannot be mixed in one linked-group booking.',
      });
    }
    const bookingLessonKind = [...lessonKinds][0] || 'regular';

    const anchorStudent =
      orderedStudents.find((student) => Number(student.id) === anchorStudentId) || orderedStudents[0];
    const studentIdNum = Number(anchorStudent.id);
    const studentName = normalizePersonName(anchorStudent.name);
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
       WHERE (m.status IS NULL OR LOWER(TRIM(m.status)) NOT IN ('cancelled', 'rescheduled'))
         AND ${SQL_NOT_STAFF_BREAK}
         AND m.start < $2::timestamptz AND m."end" > $1::timestamptz
         AND (m.student_id IS NULL OR NOT (m.student_id = ANY($3::int[])))`,
      [startDate.toISOString(), endDate.toISOString(), excludedStudentIds]
    );
    const isChild = !!anchorStudent.is_child;
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

    if (bookingLessonKind === 'owner') {
      const ownerOverlap = await query(
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
         LIMIT 1`,
        [startDate.toISOString(), endDate.toISOString(), excludedStudentIds]
      );
      if (ownerOverlap.rows.length > 0) {
        return res.status(400).json({
          error:
            "An owner's course lesson is already scheduled for this time. Choose another slot.",
        });
      }
    }

    const orderedStudentIds = orderedStudents.map((student) => Number(student.id)).filter(Number.isFinite);
    const dupResult = await query(
      `SELECT COALESCE(s.name, m.student_name) AS student_name
         FROM monthly_schedule m
         LEFT JOIN students s ON s.id = m.student_id
       WHERE ${SQL_BLOCKS_STUDENT_SLOT_OVERLAP}
         AND ${SQL_NOT_STAFF_BREAK}
         AND m.start < $2::timestamptz AND m."end" > $1::timestamptz
         AND m.student_id = ANY($3::int[])
       LIMIT 1`,
      [startDate.toISOString(), endDate.toISOString(), orderedStudentIds]
    );
    if (dupResult.rows.length > 0) {
      return res.status(400).json({
        error: `${normalizePersonName(dupResult.rows[0]?.student_name) || 'A selected student'} already has a lesson overlapping this time. Cancel or reschedule the existing lesson first.`,
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

    if (bookingLessonKind === 'owner') {
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
       WHERE (m.status IS NULL OR LOWER(TRIM(m.status)) NOT IN ('cancelled', 'rescheduled'))
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
           AND (m.status IS NULL OR LOWER(TRIM(m.status)) NOT IN ('cancelled', 'rescheduled'))
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
    const lessonKindForBooking = bookingLessonKind;

    let title;
    if (lessonKindForBooking === 'demo') {
      title = buildLessonTitleForOrderedStudents({
        students: orderedStudents,
        lessonKind: lessonKindForBooking,
        locationLabel,
      });
    } else {
      const bookedThisMonth = await getBookedCountForMonth(studentIdNum, monthKey);
      const nextLessonNumber = bookedThisMonth + 1;
      const totalLessons = await getPackTotalForBooking(studentIdNum, monthKey, pack_total);
      if (!totalLessons) {
        return res.status(400).json({
          error: 'Missing lesson pack total. Enter total lessons before booking.',
        });
      }
      title = buildLessonTitleForOrderedStudents({
        students: orderedStudents,
        lessonKind: lessonKindForBooking,
        locationLabel,
        lessonNumber: nextLessonNumber,
        totalLessons,
      });
    }
    const lessonKind = lessonKindForBooking;
    const lessonUuid = randomUUID();
    const localEventId = buildLocalBookingEventId();
    for (let index = 0; index < orderedStudents.length; index += 1) {
      const studentEntry = orderedStudents[index];
      // One key per row: idx_monthly_schedule_calendar_sync_key is unique. GAS bookingKey still comes from rows[0] in sync.
      const calendarSyncKey = buildCalendarSyncKey();
      await query(
        `INSERT INTO monthly_schedule
          (event_id, lesson_uuid, title, date, start, "end", status, student_name, is_kids_lesson, teacher_name, lesson_kind, lesson_mode, student_id,
           calendar_sync_status, calendar_sync_error, calendar_sync_key, calendar_sync_attempted_at, calendar_synced_at,
           group_id, group_sort_order,
           reschedule_snapshot_to_date, reschedule_snapshot_to_time, reschedule_snapshot_from_date, reschedule_snapshot_from_time)
         VALUES
          ($1, $2, $3, $4::date, $5::timestamptz, $6::timestamptz, 'scheduled', $7, $8, $9, $10, $11, $12, $13, NULL, $14, NULL, NULL,
           $15, $16, NULL, NULL, NULL, NULL)
         ON CONFLICT (event_id, student_name)
         DO UPDATE SET
           lesson_uuid = COALESCE(monthly_schedule.lesson_uuid, EXCLUDED.lesson_uuid),
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
           group_id = EXCLUDED.group_id,
           group_sort_order = EXCLUDED.group_sort_order,
           reschedule_snapshot_to_date = monthly_schedule.reschedule_snapshot_to_date,
           reschedule_snapshot_to_time = monthly_schedule.reschedule_snapshot_to_time,
           reschedule_snapshot_from_date = monthly_schedule.reschedule_snapshot_from_date,
           reschedule_snapshot_from_time = monthly_schedule.reschedule_snapshot_from_time`,
        [
          localEventId,
          lessonUuid,
          title,
          dateStr,
          startDate.toISOString(),
          endDate.toISOString(),
          normalizePersonName(studentEntry.name),
          !!studentEntry.is_child,
          assignedTeacherName,
          lessonKind,
          lessonKind === 'demo' ? 'unknown' : locationLabelToLessonMode(locationLabel),
          Number(studentEntry.id),
          CALENDAR_SYNC_STATUS_PENDING,
          calendarSyncKey,
          null,
          index + 1,
        ]
      );
    }

    if (String(lessonKind || '').toLowerCase() === 'demo') {
      for (const studentEntry of orderedStudents) {
        try {
          await upsertDemoLessonEvent({
            studentId: studentEntry.id,
            demoDate: dateStr,
            teacherName: assignedTeacherName,
            sourceEventId: localEventId,
          });
        } catch (trackErr) {
          console.error('[demo-tracker] upsert after book failed', trackErr?.message || trackErr);
        }
      }
    }

    res.status(201).json({
      ok: true,
      event_id: localEventId,
      calendar_id: null,
      teacher_name: assignedTeacherName,
      date: dateStr,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      calendar_sync_status: CALENDAR_SYNC_STATUS_PENDING,
      group_id: null,
    });
    // Calendar sync is triggered by the client via POST /schedule/sync (single trigger).
    // Do NOT auto-queue a background sync here: two concurrent syncs race and create
    // duplicate calendar events / spurious "failed" results.
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

