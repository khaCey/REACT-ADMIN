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

export async function handleRenumberMonthTitles(req, res) {
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

    const result = await renumberMonthLessonTitlesForStudent(sid, monthKey, pack);
    res.json({
      ok: true,
      updated: result.updated,
      month: monthKey,
      pack_total: result.pack_total,
      calendar_patched: result.calendar_patched ?? 0,
      ...(Array.isArray(result.calendar_errors) && result.calendar_errors.length > 0
        ? { calendar_errors: result.calendar_errors }
        : {}),
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg === 'Student not found') return res.status(404).json({ error: msg });
    if (msg === 'Student has no name' || msg.includes('requires studentId')) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: err.message });
  }
}

export { renumberMonthLessonTitlesForStudent };
