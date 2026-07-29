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

export async function handleConfirmReserved(req, res) {
  try {
    if (!isBookingGasEnabled()) {
      return res.status(503).json({ error: 'Calendar booking sync is not configured' });
    }
    const eventIdRaw = String(req.body?.event_id || '').trim();
    const confirmMonthRaw = String(req.body?.confirm_month || '').trim();
    const pack_total = req.body?.pack_total;
    // Series shell delete + next-month hold only when client opts in (Confirm all last week).
    const finalizeSeries =
      req.body?.finalize_series === true ||
      req.body?.finalize_series === 1 ||
      String(req.body?.finalize_series || '').toLowerCase() === 'true';
    if (!eventIdRaw) return res.status(400).json({ error: 'event_id is required' });

    const anchorResult = await query(
      `SELECT m.*, s.name AS canonical_student_name, s.status AS student_status,
              s.payment AS student_payment, s.is_child AS student_is_child
         FROM monthly_schedule m
         LEFT JOIN students s ON s.id = m.student_id
        WHERE m.event_id = $1`,
      [eventIdRaw]
    );
    const anchorRow = anchorResult.rows[0];
    if (!anchorRow) return res.status(404).json({ error: 'Event not found', event_id: eventIdRaw });

    if (String(anchorRow.status || '').toLowerCase().trim() !== 'reserved') {
      return res.status(400).json({ error: 'Only reserved lessons can be confirmed this way' });
    }
    if (normalizeCalendarSyncStatus(anchorRow.calendar_sync_status) !== CALENDAR_SYNC_STATUS_SYNCED) {
      return res.status(400).json({ error: 'Lesson must be synced with Google Calendar before confirming' });
    }
    if (String(anchorRow.event_id || '').startsWith(LOCAL_BOOKING_EVENT_ID_PREFIX)) {
      return res.status(400).json({ error: 'Cannot confirm a local-only booking row' });
    }
    if (anchorRow.student_id == null) {
      return res.status(400).json({ error: 'Reserved row must have student_id set' });
    }

    const confirmMonth = /^\d{4}-\d{2}$/.test(confirmMonthRaw)
      ? confirmMonthRaw
      : scheduleRowDateToYyyyMmDd(anchorRow.date).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(confirmMonth)) {
      return res.status(400).json({ error: 'Could not determine confirm_month' });
    }

    const pollSeries = String(anchorRow.calendar_source_event_id || '').trim();
    const idBase = stripOurMonthlyDisambiguationSuffix(String(anchorRow.event_id || ''));

    const batchResult = pollSeries
      ? await query(
          `SELECT m.*, s.name AS canonical_student_name, s.status AS student_status,
                  s.payment AS student_payment, s.is_child AS student_is_child
             FROM monthly_schedule m
             LEFT JOIN students s ON s.id = m.student_id
            WHERE to_char(m.date, 'YYYY-MM') = $1
              AND LOWER(TRIM(COALESCE(m.status,''))) = 'reserved'
              AND (
                TRIM(COALESCE(m.calendar_source_event_id,'')) = $2
                OR REGEXP_REPLACE(TRIM(m.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '') = $3
              )
            ORDER BY m.date ASC, m.start ASC, m.event_id ASC, COALESCE(m.group_sort_order, 2147483647) ASC,
                     LOWER(COALESCE(s.name, m.student_name)) ASC`,
          [confirmMonth, pollSeries, idBase]
        )
      : await query(
          `SELECT m.*, s.name AS canonical_student_name, s.status AS student_status,
                  s.payment AS student_payment, s.is_child AS student_is_child
             FROM monthly_schedule m
             LEFT JOIN students s ON s.id = m.student_id
            WHERE to_char(m.date, 'YYYY-MM') = $1
              AND LOWER(TRIM(COALESCE(m.status,''))) = 'reserved'
              AND REGEXP_REPLACE(TRIM(m.event_id), '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2})?$', '') = $2
            ORDER BY m.date ASC, m.start ASC, m.event_id ASC, COALESCE(m.group_sort_order, 2147483647) ASC,
                     LOWER(COALESCE(s.name, m.student_name)) ASC`,
          [confirmMonth, idBase]
        );

    const batchRows = batchResult.rows || [];
    if (batchRows.length === 0) {
      return res.status(404).json({ error: 'No matching reserved rows for this month' });
    }

    const replacingEventIds = [
      ...new Set(batchRows.map((r) => String(r.event_id || '').trim()).filter(Boolean)),
    ];
    const anchorStudentId = Number(anchorRow.student_id);
    const groups = groupReservedBatchRows(batchRows);
    const weeksTotal = groups.length;

    const targetGroup = groups.find((g) => String(g[0].event_id || '').trim() === eventIdRaw);
    if (!targetGroup) {
      return res.status(404).json({
        error: 'Reserved week not found in this month batch',
        event_id: eventIdRaw,
      });
    }
    const weekIndex = groups.indexOf(targetGroup) + 1;
    const groupRows = targetGroup;

    const activeEventIdsByStart = await listActiveMonthEventIdsByStart(anchorStudentId, confirmMonth);
    const activeCount = activeEventIdsByStart.length;
    const chronoRank = activeEventIdsByStart.indexOf(eventIdRaw);
    const lessonNumber = chronoRank >= 0 ? chronoRank + 1 : activeCount || 1;

    let totalLessons = await getPackTotalForBooking(anchorStudentId, confirmMonth, pack_total);
    if (!totalLessons) {
      totalLessons = activeCount || weeksTotal;
    } else {
      totalLessons = Math.max(totalLessons, activeCount || weeksTotal);
    }
    if (!totalLessons) {
      return res.status(400).json({ error: 'No reserved lessons to confirm for this month.' });
    }

    const seriesMasterId = bareSeriesMasterFromScheduleRow(anchorRow);

    const dateStr = scheduleRowDateToYyyyMmDd(groupRows[0].date);
    if (!dateStr) {
      return res.status(400).json({ error: 'Invalid date on reserved row' });
    }
    const startDate = new Date(groupRows[0].start);
    const endDate = new Date(groupRows[0].end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid start/end on reserved row' });
    }
    const orderedStudents = batchRowsToOrderedStudents(groupRows);
    if (orderedStudents.some((s) => !normalizePersonName(s.name))) {
      return res.status(400).json({ error: 'One or more students have no name' });
    }

    const val = await assertBookableSlotForConfirm({
      startDate,
      endDate,
      dateStr,
      orderedStudents,
      excludedEventIds: replacingEventIds,
    });
    if (!val.ok) return res.status(val.status).json({ error: val.error });

    const lessonKindForBooking = String(groupRows[0].lesson_kind || 'regular').trim().toLowerCase();
    const locationLabel =
      lessonKindForBooking === 'demo' ? 'Cafe' : lessonModeToLocationLabel(groupRows[0].lesson_mode);

    let title;
    if (lessonKindForBooking === 'demo') {
      title = buildLessonTitleForOrderedStudents({
        students: orderedStudents,
        lessonKind: 'demo',
        locationLabel,
      });
    } else {
      title = buildLessonTitleForOrderedStudents({
        students: orderedStudents,
        lessonKind: lessonKindForBooking,
        locationLabel,
        lessonNumber,
        totalLessons,
      });
    }

    const bookingKey =
      String(groupRows[0].calendar_sync_key || '').trim() || buildCalendarSyncKey();

    const firstS = orderedStudents[0];
    const studentPayload = {
      id: firstS.id,
      name: firstS.name || '',
      status: firstS.status,
      payment: firstS.payment,
      is_child: !!firstS.is_child,
    };

    const gasRes = await createBookedLessonEventInGas({
      students: orderedStudents,
      student: studentPayload,
      startIso: startDate.toISOString(),
      endIso: endDate.toISOString(),
      assignedTeacherName: groupRows[0].teacher_name,
      title,
      location: lessonKindForBooking === 'demo' ? '' : lessonModeToLocationLabel(groupRows[0].lesson_mode),
      lessonKind: lessonKindForBooking,
      bookingKey,
    });
    if (!gasRes.ok || !gasRes.eventId) {
      return res.status(502).json({
        error: gasRes.error || 'Failed to create lesson in Google Calendar',
        event_id: eventIdRaw,
        gas_action: gasRes?.actionTaken || null,
        gas_event_id: gasRes?.eventId || null,
        ...(gasRes?.gasScriptRevision ? { gas_revision: gasRes.gasScriptRevision } : {}),
      });
    }

    const syncedMonthlyEventId = buildMonthlyEventId(gasRes.eventId, dateStr, groupRows[0].start);
    const plannedItem = {
      oldEventId: groupRows[0].event_id,
      newEventId: syncedMonthlyEventId,
      title,
      calendarSourceRaw: gasRes.eventId,
      bookingKey,
      groupRows,
    };

    const calendarDel = await deleteReservedPlaceholderForWeek(groupRows, {
      excludeEventIds: collectExcludeCalendarEventIds([gasRes.eventId], [plannedItem]),
    });
    if (!calendarDel.ok) {
      await rollbackConfirmCreatedLessons([gasRes.eventId], lessonKindForBooking);
      return res.status(502).json({
        error:
          calendarDel.error ||
          'Failed to delete old reserved calendar placeholder. Database was not changed.',
        event_id: calendarDel.event_id,
        series_master_id: seriesMasterId || null,
        ...(calendarDel.gas_revision ? { gas_revision: calendarDel.gas_revision } : {}),
        ...(calendarDel.gas_deleted_count != null
          ? { gas_deleted_count: calendarDel.gas_deleted_count }
          : {}),
        ...(gasRes?.calendarId ? { created_calendar_id: gasRes.calendarId } : {}),
        ...(gasRes?.eventId ? { created_calendar_event_id: gasRes.eventId } : {}),
      });
    }

    const dbPersist = await persistConfirmReservedWeek(plannedItem);
    if (!dbPersist.ok) {
      await rollbackConfirmCreatedLessons([gasRes.eventId], lessonKindForBooking);
      return res.status(500).json({
        error: `${dbPersist.error}. Database was not changed; Calendar may need manual cleanup.`,
        event_id: eventIdRaw,
      });
    }

    // Heal n/total for all students on this week (chronological by start).
    const studentIdsToRenumber = [
      ...new Set(
        groupRows
          .map((r) => Number(r.student_id))
          .filter((id) => Number.isFinite(id) && id > 0)
      ),
    ];
    let renumberWarning = null;
    for (const sid of studentIdsToRenumber) {
      try {
        let packForStudent = await getPackTotalForBooking(sid, confirmMonth, pack_total);
        const activeForStudent = await listActiveMonthEventIdsByStart(sid, confirmMonth);
        if (!packForStudent) {
          packForStudent = activeForStudent.length || totalLessons || 1;
        } else {
          packForStudent = Math.max(packForStudent, activeForStudent.length || 0, 1);
        }
        await renumberMonthLessonTitlesForStudent(sid, confirmMonth, packForStudent);
      } catch (renumberErr) {
        console.error(
          '[confirm-reserved] renumber failed',
          sid,
          renumberErr?.message || renumberErr
        );
        renumberWarning =
          renumberWarning ||
          `Week confirmed but month title renumber failed: ${renumberErr?.message || renumberErr}`;
      }
    }

    let seriesCleanedUp = false;
    const remainingReservedWeeks = await countReservedWeeksInBatch(anchorRow, confirmMonth);
    if (
      finalizeSeries &&
      remainingReservedWeeks === 0 &&
      seriesMasterId &&
      isBookingGasEnabled()
    ) {
      const lessonKind = String(anchorRow.lesson_kind || 'regular').trim().toLowerCase();
      const delSeries = await deleteReservedCalendarSeriesInGas({ seriesMasterId, lessonKind });
      const seriesOutcome = interpretGasDeleteResultForDbRemove(delSeries);
      if (!seriesOutcome.proceed) {
        return res.status(502).json({
          error:
            seriesOutcome.blockingError ||
            'Week confirmed in DB but failed to delete empty reserved calendar series',
          event_id: eventIdRaw,
          new_event_id: syncedMonthlyEventId,
          series_master_id: seriesMasterId,
        });
      }
      seriesCleanedUp = true;
    }

    let nextMonthHoldEventId = null;
    let holdWarning = null;
    if (seriesCleanedUp) {
      const holdResult = await createNextMonthReservedHoldForSeries(anchorRow, confirmMonth);
      if (holdResult.eventId) nextMonthHoldEventId = holdResult.eventId;
      if (holdResult.warning) holdWarning = holdResult.warning;
      if (!holdResult.ok) {
        holdWarning = holdResult.error || 'Failed to create next-month reserved hold';
      }
    }

    let orphanReservedRemoved = 0;
    if (finalizeSeries && remainingReservedWeeks === 0) {
      orphanReservedRemoved = await deleteOrphanReservedRowsAfterConfirm(
        anchorRow,
        confirmMonth,
        pollSeries,
        idBase
      );
    }

    for (const oldSnapshot of groupRows) {
      const newRowsSnap = await query(
        `SELECT * FROM monthly_schedule WHERE event_id = $1 AND student_name = $2`,
        [plannedItem.newEventId, oldSnapshot.student_name]
      );
      const newRow = newRowsSnap.rows[0];
      if (newRow) {
        await logChange(
          {
            entityType: 'monthly_schedule',
            entityKey: `${plannedItem.newEventId}_${oldSnapshot.student_name}`,
            action: 'update',
            oldData: oldSnapshot,
            newData: newRow,
          },
          req
        );
      }
    }

    return res.json({
      ok: true,
      confirm_month: confirmMonth,
      event_id: eventIdRaw,
      new_event_id: syncedMonthlyEventId,
      week_index: weekIndex,
      weeks_total: weeksTotal,
      series_cleaned_up: seriesCleanedUp,
      finalize_series: finalizeSeries,
      next_month_hold_event_id: nextMonthHoldEventId,
      lesson_number: lessonNumber,
      total_lessons: totalLessons,
      ...((holdWarning || renumberWarning)
        ? { warning: [holdWarning, renumberWarning].filter(Boolean).join(' ') }
        : {}),
      ...(gasRes?.calendarId ? { created_calendar_id: gasRes.calendarId } : {}),
      ...(gasRes?.eventId ? { created_calendar_event_id: gasRes.eventId } : {}),
      ...(calendarDel?.gas_calendar_id ? { deleted_calendar_id: calendarDel.gas_calendar_id } : {}),
      ...(calendarDel?.gas_event_id ? { deleted_calendar_event_id: calendarDel.gas_event_id } : {}),
      ...(calendarDel?.gas_deleted_count != null ? { deleted_count: calendarDel.gas_deleted_count } : {}),
      ...(seriesMasterId ? { series_master_id: seriesMasterId } : {}),
      ...(orphanReservedRemoved > 0 ? { orphan_reserved_rows_removed: orphanReservedRemoved } : {}),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

