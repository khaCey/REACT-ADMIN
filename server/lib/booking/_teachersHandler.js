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

export async function handleGetTeachers(req, res) {
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
}
