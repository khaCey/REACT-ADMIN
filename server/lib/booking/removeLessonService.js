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

export async function handleRemoveLesson(req, res) {
  try {
    const rawPath = (req.path || req.url || '').replace(/\?.*$/, '');
    const m = rawPath.match(/^\/(.+)\/?$/);
    const eventId = (m ? decodeURIComponent(m[1]).trim() : '') || decodeURIComponent((req.params[0] || req.params[1] || '').trim());
    const oldRows = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [eventId])).rows;
    if (oldRows.length === 0) {
      return res.status(404).json({ error: 'Event not found', event_id: eventId });
    }
    const localOnlyRemove =
      req.query?.localOnly === '1' || String(req.query?.localOnly || '').toLowerCase() === 'true';
    const anchorRow = oldRows[0];
    const anchorStatus = String(anchorRow.status || '').toLowerCase().trim();

    if (anchorStatus === 'reserved') {
      // Reserved rows always use date-disambiguated event_ids (one week per event_id).
      if (oldRows.length === 0) {
        return res.status(404).json({ error: 'Event not found', event_id: eventId });
      }
      const distinctDates = new Set(
        oldRows.map((r) => scheduleRowDateToYyyyMmDd(r.date)).filter(Boolean)
      );
      if (distinctDates.size > 1) {
        return res.status(409).json({
          error:
            'Refusing reserved remove: this event_id maps to multiple dates. Re-sync calendar and retry.',
          event_id: eventId,
          dates: [...distinctDates],
        });
      }

      let calendarCancel = null;
      if (!localOnlyRemove && isBookingGasEnabled() && rowsShouldAttemptGasCalendarDelete(oldRows)) {
        // Cancel this one Calendar occurrence only (GAS patches status=cancelled; never removes series).
        calendarCancel = await deleteReservedPlaceholderForWeek(oldRows);
        if (!calendarCancel.ok) {
          return res.status(502).json({
            error: calendarCancel.error || 'Failed to cancel reserved calendar occurrence',
            event_id: eventId,
            series_master_id: bareSeriesMasterFromScheduleRow(oldRows[0]) || null,
            ...(calendarCancel.gas_revision ? { gas_script_revision: calendarCancel.gas_revision } : {}),
          });
        }
      }

      await recordScheduleSlotDismissals(oldRows);
      const primaryDeleted = await query(`DELETE FROM monthly_schedule WHERE event_id = $1`, [eventId]);
      if ((primaryDeleted.rowCount || 0) === 0) {
        return res.status(404).json({
          error: 'Reserved occurrence row not found for delete',
          event_id: eventId,
        });
      }
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

      return res.json({
        ok: true,
        event_id: eventId,
        reserved_single: true,
        removed_row_count: primaryDeleted.rowCount || 0,
        calendar_cancelled: Boolean(calendarCancel?.ok),
        ...(calendarCancel?.gas_event_id ? { calendar_event_id: calendarCancel.gas_event_id } : {}),
        ...(calendarCancel?.gas_revision ? { gas_script_revision: calendarCancel.gas_revision } : {}),
      });
    }

    if (!localOnlyRemove && isBookingGasEnabled() && rowsShouldAttemptGasCalendarDelete(oldRows)) {
      const { del, outcome: delOutcome } = await attemptGasCalendarDeleteForLesson(eventId, oldRows);
      if (!delOutcome.proceed) {
        return res.status(502).json({
          error: delOutcome.blockingError || 'Failed to remove lesson from Google Calendar',
          event_id: eventId,
          ...(del.gasScriptRevision ? { gas_script_revision: del.gasScriptRevision } : {}),
        });
      }
    }
    const { slotDeleted } = await finalizeLessonRemoveFromDb(oldRows, eventId, req);
    res.json({
      ok: true,
      event_id: eventId,
      ...(slotDeleted > (oldRows.length || 0) ? { duplicate_slot_rows_removed: slotDeleted } : {}),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

