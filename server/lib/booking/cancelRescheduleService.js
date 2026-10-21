import { syncLessonCalendarStyle, queueLessonCalendarStyle, needsCalendarStyleRetry } from './lessonCalendarStyle.js';
import { applyCancelledTitleMarker, restoreActiveLessonTitle } from '../lessonMonthCounters.js';
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
  applyKidsTitlePrefix,
  buildLessonTitleForOrderedStudents,
  rewriteLessonTitleStudentNames,
} from '../groupLessonTitle.js';
import * as D from './domainInternals.js';
import { reconcileCountersForAffectedRows } from './lessonCounterReconcile.js';

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

function restoredSourceTitle(row) {
  const base = restoreActiveLessonTitle(row?.title || '');
  const from = scheduleRowDateToYyyyMmDd(row?.reschedule_snapshot_from_date);
  return from ? applyRescheduleTitleMarker(base, 'from', formatOrdinalCalendarDay(from)) : base;
}

async function validateRestoredSlot(rows, excludedEventIds, db) {
  const row = rows[0];
  const startDate = new Date(row.start);
  const endDate = new Date(row.end);
  const dateStr = scheduleRowDateToYyyyMmDd(row.date);
  if (!dateStr || !Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
    return { ok: false, status: 409, error: 'The original lesson has no valid time to restore' };
  }
  const students = (await db('SELECT id, name, is_child, payment FROM students WHERE id = ANY($1::int[])', [rows.map((r) => r.student_id)])).rows;
  if (!students.length) return { ok: false, status: 409, error: 'Unable to resolve lesson students' };
  return assertBookableSlotForConfirm({ startDate, endDate, dateStr, orderedStudents: students, excludedEventIds, db });
}

export async function handleRescheduleLinked(req, res) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Serialise related status/link changes before inspecting source state.
    await client.query("SELECT pg_advisory_xact_lock(1936941420, 1)");
    const db = (sql, args) => client ? client.query(sql, args) : query(sql, args);
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

    const studentResult = await db('SELECT id, name, is_child, status, payment FROM students WHERE id = $1', [studentIdNum]);
    if (studentResult.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    const student = studentResult.rows[0];
    const studentName = String(student.name || '').trim();
    const normalizedStudentName = studentName.replace(/\s+/g, ' ').trim();
    const normalizedSourceName = String(source_student_name || '').replace(/\s+/g, ' ').trim();
    const studentParts = normalizedStudentName.split(' ').filter(Boolean);
    const swappedStudentName =
      studentParts.length >= 2 ? [...studentParts.slice(-1), ...studentParts.slice(0, -1)].join(' ') : '';
    const candidateRows = (
      await db(
        `SELECT event_id, lesson_uuid, student_name, student_id, status, title, lesson_kind, awaiting_reschedule_date, group_id, group_sort_order,
                to_char(date, 'YYYY-MM-DD') AS src_date_str,
                to_char(start AT TIME ZONE 'Asia/Tokyo', 'HH24:MI') AS src_time_jst
         FROM monthly_schedule
         WHERE event_id = $1 FOR UPDATE`,
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
    const sourceAnchor = byStudentId || byName;
    if (!sourceAnchor) {
      return res.status(404).json({ error: 'Source lesson not found for student' });
    }
    const sourceStatus = String(sourceAnchor.status || 'scheduled').trim().toLowerCase();
    const existingLink = await db('SELECT 1 FROM reschedules WHERE from_event_id = $1 LIMIT 1', [sourceEventId]);
    if (existingLink.rows.length) return res.status(409).json({ error: 'This lesson already has a replacement. Refresh the schedule.' });
    const sourceCancelled = sourceStatus === 'cancelled';
    const sourceRescheduled = sourceStatus === 'rescheduled';
    const awaitingDate = !!sourceAnchor.awaiting_reschedule_date;
    if (sourceCancelled) return res.status(400).json({ error: 'Source lesson is already cancelled' });
    if (!['scheduled', 'demo', 'rescheduled'].includes(sourceStatus)) {
      return res.status(409).json({ error: 'This lesson cannot be rescheduled in its current state' });
    }
    if (sourceRescheduled && !awaitingDate) {
      return res.status(400).json({ error: 'Source lesson is already rescheduled' });
    }
    const sourceRowsForReschedule = candidateRows.filter((row) => {
      if (String(row.status || '').toLowerCase() === 'cancelled') return false;
      if (Number(row.student_id) === studentIdNum) return true;
      const n = String(row.student_name || '').replace(/\s+/g, ' ').trim();
      return nameCandidates.includes(n);
    });
    if (sourceRowsForReschedule.length === 0) {
      return res.status(400).json({ error: 'No reschedulable source rows found for this event' });
    }
    const duration = Math.min(120, Math.max(30, Number(duration_minutes) || 50));
    const [hh, mm] = timeStrRaw.split(':').map((x) => parseInt(x, 10) || 0);
    const startDate = parseJstToUtc(dateStrRaw, hh, mm);
    if (!startDate || utcToJstDateAndTime(startDate)?.date !== dateStrRaw || hh > 23 || mm > 59) return res.status(400).json({ error: 'Invalid date or time' });
    const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

    const slotCheck = await assertBookableSlotForConfirm({
      startDate, endDate, dateStr: dateStrRaw,
      orderedStudents: [{ ...student, id: studentIdNum }],
      excludedEventIds: [sourceEventId], db,
    });
    if (!slotCheck.ok) return res.status(slotCheck.status || 409).json({ error: slotCheck.error });

    const locationLabel = String(location || 'Cafe').trim() || 'Cafe';
    const monthKey = dateStrRaw.slice(0, 7);
    // Keep the source lesson's type on a move. The student may have changed
    // from DEMO to regular since the original appointment was made.
    const lessonKindForBooking = String(
      sourceAnchor.lesson_kind || deriveLessonKindFromStudent(student)
    ).trim().toLowerCase();

    const fromDisplay = formatOrdinalCalendarDay(sourceAnchor.src_date_str);
    const toDisplay = formatOrdinalCalendarDay(dateStrRaw);
    const movedFromLabel = fromDisplay || '???';

    const sourceOrderedStudents = await getOrderedEventStudents(sourceEventId, db);
    const sourceTitleSeed = sourceAnchor.title || '';
    const kidsAwareSourceStudents =
      sourceOrderedStudents.length > 0
        ? sourceOrderedStudents
        : [{ name: studentName, is_child: !!student?.is_child }];

    let destinationBaseTitle;
    if (lessonKindForBooking === 'demo') {
      destinationBaseTitle = applyKidsTitlePrefix(
        `${studentName} D/L`,
        kidsAwareSourceStudents
      );
    } else {
      let totalLessons = parsePackTotalFromTitle(sourceAnchor.title);
      if (!totalLessons) {
        const packRow = await db('SELECT lessons FROM lessons WHERE student_id = $1 AND month = $2', [studentIdNum, monthKey]);
        totalLessons = Math.max(0, parseInt(packRow.rows[0]?.lessons, 10) || 0);
      }
      if (!totalLessons) totalLessons = 1;

      // Quota-neutral numbering: when moving within the same month, source lesson is effectively replaced.
      const sourceMonth = (
        await db(`SELECT to_char(date, 'YYYY-MM') AS ym FROM monthly_schedule WHERE event_id = $1 AND student_id = $2 LIMIT 1`, [sourceEventId, studentIdNum])
      ).rows[0]?.ym;
      const bookedThisMonth = await getBookedCountForMonth(studentIdNum, monthKey, db);
      const nextLessonNumber = sourceMonth === monthKey ? Math.max(1, bookedThisMonth) : bookedThisMonth + 1;
      destinationBaseTitle = applyKidsTitlePrefix(
        `${studentName} (${locationLabel}) ${nextLessonNumber}/${totalLessons}`,
        kidsAwareSourceStudents
      );
    }

    const canonicalBaseTitle =
      sourceOrderedStudents.length > 1 && sourceTitleSeed
        ? stripRescheduleTitleMarker(buildCanonicalLessonTitle(sourceTitleSeed, sourceOrderedStudents))
        : stripRescheduleTitleMarker(sourceTitleSeed) ||
          stripRescheduleTitleMarker(destinationBaseTitle);
    // Keep kids 子 on the original slot title when present / required.
    const sourceBaseTitle = applyKidsTitlePrefix(canonicalBaseTitle, kidsAwareSourceStudents);
    const canonicalSourceTitleUpdated = applyRescheduleTitleMarker(sourceBaseTitle, 'to', toDisplay || '???');
    // Solo moves: use renumbered destination base. Group moves: keep shared group title from source.
    const destBaseForMarker =
      sourceOrderedStudents.length > 1 ? sourceBaseTitle : destinationBaseTitle || sourceBaseTitle;
    const canonicalDestinationTitle = applyRescheduleTitleMarker(destBaseForMarker, 'from', movedFromLabel);

    const localEventId = buildLocalBookingEventId();
    const destinationLessonUuid = randomUUID();
    const sourceLessonUuids = [
      ...new Set(
        sourceRowsForReschedule
          .map((row) => String(row.lesson_uuid || '').trim())
          .filter(Boolean)
      ),
    ];
    const lessonKind = lessonKindForBooking;
    const lessonModeVal =
      lessonKind === 'demo'
        ? 'unknown'
        : String(locationLabel || '').trim().toLowerCase() === 'online'
          ? 'online'
          : 'cafe';

    const sourceRowsFull = (await db('SELECT * FROM monthly_schedule WHERE event_id = $1 FOR UPDATE', [sourceEventId])).rows;
    const skipAmbiguousRecurringCalendar = await shouldSkipAmbiguousRecurringForRows(
      sourceEventId,
      sourceRowsForReschedule, db
    );
    /** Same predicate as PATCH cancel: style source Calendar (graphite) when lesson was on Calendar. */
    const shouldStyleSourceCalendar =
      isBookingGasEnabled() &&
      (shouldSyncCalendarForRows(sourceRowsFull) || sourceRowsFull.some(needsCalendarStyleRetry)) &&
      !String(sourceEventId).startsWith(LOCAL_BOOKING_EVENT_ID_PREFIX) &&
      !skipAmbiguousRecurringCalendar;

    const srcDateStr = String(sourceAnchor.src_date_str || '').trim();
    const srcDateForSnap = /^\d{4}-\d{2}-\d{2}$/.test(srcDateStr) ? srcDateStr : null;
    const srcTimeJst = String(sourceAnchor.src_time_jst || '').trim() || null;
    const sourceStudentIds = [
      ...new Set(
        sourceRowsForReschedule
          .map((row) => Number(row.student_id))
          .filter((id) => Number.isFinite(id) && id > 0)
      ),
    ];
    const sourceStudents = sourceStudentIds.length
      ? (
          await client.query(
            `SELECT id, name, is_child, status, payment FROM students WHERE id = ANY($1::int[])`,
            [sourceStudentIds]
          )
        ).rows
      : [];
    const sourceStudentById = new Map(sourceStudents.map((row) => [Number(row.id), row]));
    const sourceStudentByName = new Map(
      sourceStudents
        .map((row) => [normalizePersonName(row.name), row])
        .filter(([name]) => !!name)
    );
    const insertedDestinationStudentIds = new Set();

    for (const sourceRow of sourceRowsForReschedule) {
      const sourceRowStudentName = String(sourceRow.student_name || '').trim();
      if (!sourceRowStudentName) continue;
      const sid = Number(sourceRow.student_id);
      let rowStudent =
        Number.isFinite(sid) && sid > 0 ? sourceStudentById.get(sid) || null : null;
      const sourceNameNorm = normalizePersonName(sourceRowStudentName);
      if (!rowStudent && sourceNameNorm) {
        rowStudent = sourceStudentByName.get(sourceNameNorm) || null;
      }
      if (!rowStudent && sourceNameNorm) {
        const byName = await client.query(
          `SELECT id, name, is_child, status, payment
             FROM students
            WHERE REGEXP_REPLACE(TRIM(name), '\\s+', ' ', 'g') = $1
            ORDER BY id ASC
            LIMIT 1`,
          [sourceNameNorm]
        );
        rowStudent = byName.rows[0] || null;
        if (rowStudent) {
          sourceStudentByName.set(sourceNameNorm, rowStudent);
          const resolvedByNameId = Number(rowStudent.id);
          if (Number.isFinite(resolvedByNameId) && resolvedByNameId > 0) {
            sourceStudentById.set(resolvedByNameId, rowStudent);
          }
        }
      }
      if (!rowStudent) {
        throw new Error(`Unable to resolve source student row for reschedule: ${sourceRowStudentName}`);
      }
      const resolvedStudentId = Number(rowStudent.id);
      if (!Number.isFinite(resolvedStudentId) || resolvedStudentId <= 0) {
        throw new Error(`Invalid resolved student id for reschedule row: ${sourceRowStudentName}`);
      }
      // Guard against duplicate destination rows for one student in a single fanout transaction.
      if (insertedDestinationStudentIds.has(resolvedStudentId)) {
        continue;
      }
      insertedDestinationStudentIds.add(resolvedStudentId);

      const destinationStudentName = normalizePersonName(rowStudent.name || sourceRowStudentName) || sourceRowStudentName;
      const destinationLessonKind = String(
        sourceRow.lesson_kind || deriveLessonKindFromStudent(rowStudent)
      ).trim().toLowerCase();
      const destinationLessonMode =
        destinationLessonKind === 'demo'
          ? 'unknown'
          : String(locationLabel || '').trim().toLowerCase() === 'online'
            ? 'online'
            : 'cafe';
      const destinationTitle = canonicalDestinationTitle;
      const calendarSyncKey = buildCalendarSyncKey();

      const sourceGroupId =
        sourceRow.group_id != null && Number.isFinite(Number(sourceRow.group_id))
          ? Number(sourceRow.group_id)
          : null;
      const sourceGroupSortOrder =
        sourceRow.group_sort_order != null && Number.isFinite(Number(sourceRow.group_sort_order))
          ? Number(sourceRow.group_sort_order)
          : null;

      await client.query(
        `INSERT INTO monthly_schedule
          (event_id, lesson_uuid, title, date, start, "end", status, student_name, is_kids_lesson, teacher_name, lesson_kind, lesson_mode, student_id,
           calendar_sync_status, calendar_sync_error, calendar_sync_key, calendar_sync_attempted_at, calendar_synced_at,
           group_id, group_sort_order,
           reschedule_snapshot_to_date, reschedule_snapshot_to_time, reschedule_snapshot_from_date, reschedule_snapshot_from_time)
         VALUES
          ($1, $2, $3, $4::date, $5::timestamptz, $6::timestamptz, 'scheduled', $7, $8, $9, $10, $11, $12, $13, NULL, $14, NULL, NULL,
           $15, $16, NULL, NULL, $17::date, $18)
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
           reschedule_snapshot_to_date = COALESCE(monthly_schedule.reschedule_snapshot_to_date, EXCLUDED.reschedule_snapshot_to_date),
           reschedule_snapshot_to_time = COALESCE(monthly_schedule.reschedule_snapshot_to_time, EXCLUDED.reschedule_snapshot_to_time),
           reschedule_snapshot_from_date = COALESCE(monthly_schedule.reschedule_snapshot_from_date, EXCLUDED.reschedule_snapshot_from_date),
           reschedule_snapshot_from_time = COALESCE(monthly_schedule.reschedule_snapshot_from_time, EXCLUDED.reschedule_snapshot_from_time)`,
        [
          localEventId,
          destinationLessonUuid,
          destinationTitle,
          dateStrRaw,
          startDate.toISOString(),
          endDate.toISOString(),
          destinationStudentName,
          !!rowStudent?.is_child,
          null,
          destinationLessonKind,
          destinationLessonMode,
          resolvedStudentId,
          CALENDAR_SYNC_STATUS_PENDING,
          calendarSyncKey,
          sourceGroupId,
          sourceGroupSortOrder,
          srcDateForSnap,
          srcTimeJst,
        ]
      );

      const sourceTitleUpdated = canonicalSourceTitleUpdated;
      await client.query(
        `UPDATE monthly_schedule
            SET status = 'rescheduled',
                awaiting_reschedule_date = FALSE,
                title = $3,
                reschedule_snapshot_to_date = $4::date,
                reschedule_snapshot_to_time = $5
          WHERE event_id = $1 AND student_name = $2`,
        [sourceEventId, sourceRowStudentName, sourceTitleUpdated, dateStrRaw, timeStrRaw]
      );
      await client.query(
        `INSERT INTO reschedules (from_event_id, from_student_name, to_event_id, to_student_name, created_by_staff_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (from_event_id, from_student_name)
         DO UPDATE SET to_event_id = EXCLUDED.to_event_id, to_student_name = EXCLUDED.to_student_name, created_by_staff_id = EXCLUDED.created_by_staff_id, created_at = NOW()`,
        [sourceEventId, sourceRowStudentName, localEventId, destinationStudentName, req.staff?.id ?? null]
      );
    }
    await canonicalizeEventTitleById(
      sourceEventId,
      { direction: 'to', label: toDisplay || '???' },
      client.query.bind(client)
    );
    await canonicalizeEventTitleById(
      localEventId,
      { direction: 'from', label: movedFromLabel },
      client.query.bind(client)
    );
    if (sourceLessonUuids.length > 0) {
      await client.query(
        `UPDATE lesson_notes
            SET lesson_uuid = $2::uuid,
                updated_at = NOW()
          WHERE lesson_uuid = ANY($1::uuid[])`,
        [sourceLessonUuids, destinationLessonUuid]
      );
    }
    await queueLessonCalendarStyle(db, sourceEventId, sourceRowsFull);
    await client.query('COMMIT');
    client.release();
    client = null;

    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();

    /** Keep original Calendar event at original time: graphite + “Moved to …” title; the new event at the new time is created when the client calls POST /schedule/sync. */
    const sourceStyle = shouldStyleSourceCalendar
      ? await syncLessonCalendarStyle(sourceEventId, sourceRowsFull)
      : {};
    const calendarSourceGraphiteOk = sourceStyle.calendar_sync_status === 'synced';
    const calendarSourceStyleError = sourceStyle.calendar_sync_error || null;

    // Calendar sync for the new event is triggered by the client via POST /schedule/sync
    // (single trigger). Auto-queuing here in addition would race with the client call and
    // create duplicate calendar events / spurious "failed" results.

    const sourceRowsAfter = (await db(`SELECT * FROM monthly_schedule WHERE event_id = $1`, [sourceEventId])).rows;
    for (const oldSourceRow of sourceRowsForReschedule) {
      const sourceRowStudentName = String(oldSourceRow.student_name || '').trim();
      if (!sourceRowStudentName) continue;
      const srcAfter =
        sourceRowsAfter.find((row) => String(row.student_name || '').trim() === sourceRowStudentName) || null;
      if (!srcAfter) continue;
      await logChange(
        {
          entityType: 'monthly_schedule',
          entityKey: `${sourceEventId}_${sourceRowStudentName}`,
          action: 'update',
          oldData: oldSourceRow,
          newData: srcAfter,
        },
        req
      );
    }
    const newRowsForLog = (await db(`SELECT * FROM monthly_schedule WHERE event_id = $1`, [localEventId])).rows;
    for (const newRowForLog of newRowsForLog) {
      await logChange(
        {
          entityType: 'monthly_schedule',
          entityKey: `${localEventId}_${newRowForLog.student_name}`,
          action: 'create',
          oldData: null,
          newData: newRowForLog,
        },
        req
      );
    }

    await reconcileCountersForAffectedRows([
      ...sourceRowsForReschedule.map((row) => ({ student_id: row.student_id ?? studentIdNum, month: row.src_date_str?.slice(0, 7) })),
      ...sourceRowsForReschedule.map((row) => ({ student_id: row.student_id ?? studentIdNum, month: monthKey })),
    ]);

    res.status(201).json({
      ok: true,
      source_event_id: sourceEventId,
      new_event_id: localEventId,
      date: dateStrRaw,
      start: startIso,
      end: endIso,
      calendar_sync_status: CALENDAR_SYNC_STATUS_PENDING,
      ...(shouldStyleSourceCalendar && calendarSourceGraphiteOk ? { calendar_source_graphite_ok: true } : {}),
      ...(calendarSourceStyleError ? { calendar_source_style_error: calendarSourceStyleError } : {}),
    });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    res.status(500).json({ error: err.message });
  } finally {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
      client.release();
    }
  }
}

export async function handleUnrescheduleLinked(req, res) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Serialise related status/link changes before inspecting source state.
    await client.query("SELECT pg_advisory_xact_lock(1936941420, 1)");
    const db = (sql, args) => client ? client.query(sql, args) : query(sql, args);
    const { source_event_id, student_id, source_student_name } = req.body || {};
    const sourceEventId = String(source_event_id || '').trim();
    const studentIdNum = Number(student_id);
    if (!sourceEventId) return res.status(400).json({ error: 'source_event_id is required' });
    if (!Number.isFinite(studentIdNum)) return res.status(400).json({ error: 'student_id must be a number' });

    const studentResult = await db('SELECT id, name, is_child, status, payment FROM students WHERE id = $1', [studentIdNum]);
    if (studentResult.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    const studentName = String(studentResult.rows[0].name || '').trim();
    const normalizedStudentName = studentName.replace(/\s+/g, ' ').trim();
    const normalizedSourceName = String(source_student_name || '').replace(/\s+/g, ' ').trim();
    const studentParts = normalizedStudentName.split(' ').filter(Boolean);
    const swappedStudentName =
      studentParts.length >= 2 ? [...studentParts.slice(-1), ...studentParts.slice(0, -1)].join(' ') : '';
    const candidateRows = (
      await db(
        `SELECT event_id, lesson_uuid, student_name, student_id, status, title, awaiting_reschedule_date,
                to_char(date, 'YYYY-MM-DD') AS src_date_str,
                to_char(start AT TIME ZONE 'Asia/Tokyo', 'HH24:MI') AS src_time_jst
         FROM monthly_schedule
         WHERE event_id = $1 FOR UPDATE`,
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
    const source = byStudentId || byName;
    if (!source) {
      return res.status(404).json({ error: 'Source lesson not found for student' });
    }
    const sourceStudentName = String(source.student_name || source_student_name || '').trim();
    if (!sourceStudentName) return res.status(400).json({ error: 'Source student name is missing' });
    const sourceLessonUuid = String(source.lesson_uuid || '').trim();

    const linkRes = await db(
      `SELECT * FROM reschedules WHERE from_event_id = $1`,
      [sourceEventId]
    );
    if (!linkRes.rows.length) {
      return res.status(400).json({ error: 'No linked reschedule found for this lesson' });
    }
    const toEventId = String(linkRes.rows[0]?.to_event_id || '').trim();
    if (!toEventId) return res.status(400).json({ error: 'Invalid reschedule link (missing destination)' });
    const distinctToEventIds = [...new Set(linkRes.rows.map((row) => String(row.to_event_id || '').trim()).filter(Boolean))];
    if (distinctToEventIds.length > 1) {
      return res.status(400).json({ error: 'Invalid reschedule links (multiple destination events)' });
    }

    const destRows = (await db('SELECT * FROM monthly_schedule WHERE event_id = $1 FOR UPDATE', [toEventId])).rows;
    if (destRows.length === 0) {
      return res.status(400).json({ error: 'Destination lesson not found; link may be stale' });
    }

    const laterLinks = await db('SELECT 1 FROM reschedules WHERE from_event_id = $1 LIMIT 1', [toEventId]);
    if (laterLinks.rows.length) {
      return res.status(409).json({ error: 'The replacement was rescheduled again. Undo its latest reschedule first.' });
    }

    const sourceRowsFullBefore = (await db('SELECT * FROM monthly_schedule WHERE event_id = $1 FOR UPDATE', [sourceEventId])).rows;
    const skipAmbiguousRecurringCalendar = await shouldSkipAmbiguousRecurringForRows(
      sourceEventId,
      sourceRowsFullBefore, db
    );
    const shouldStyleSourceCalendar =
      isBookingGasEnabled() &&
      (shouldSyncCalendarForRows(sourceRowsFullBefore) || sourceRowsFullBefore.some(needsCalendarStyleRetry)) &&
      !String(sourceEventId).startsWith(LOCAL_BOOKING_EVENT_ID_PREFIX) &&
      !skipAmbiguousRecurringCalendar;

    const restoredSlot = await validateRestoredSlot(sourceRowsFullBefore, [sourceEventId, toEventId], db);
    if (!restoredSlot.ok) return res.status(restoredSlot.status || 409).json({ error: restoredSlot.error });

    if (isBookingGasEnabled() && rowsIndicateExplicitCalendarSyncedForGasDelete(destRows)) {
      const del = await deleteBookedLessonEventInGas(toEventId, calendarGasOptions(destRows));
      if (!del.ok) {
        return res.status(502).json({
          error: del.error || 'Failed to remove destination lesson from Google Calendar',
          event_id: toEventId,
        });
      }
    }

    const destinationLessonUuids = [
      ...new Set(destRows.map((row) => String(row.lesson_uuid || '').trim()).filter(Boolean)),
    ];
    if (sourceLessonUuid && destinationLessonUuids.length > 0) {
      await client.query(
        `UPDATE lesson_notes
            SET lesson_uuid = $2::uuid,
                updated_at = NOW()
          WHERE lesson_uuid = ANY($1::uuid[])`,
        [destinationLessonUuids, sourceLessonUuid]
      );
    }
    await client.query('DELETE FROM monthly_schedule WHERE event_id = $1', [toEventId]);
    await client.query(
      `DELETE FROM reschedules WHERE from_event_id = $1`,
      [sourceEventId]
    );
    await client.query(
      `UPDATE monthly_schedule SET
         status = 'scheduled',
         awaiting_reschedule_date = FALSE,
         reschedule_snapshot_to_date = NULL,
         reschedule_snapshot_to_time = NULL
       WHERE event_id = $1`,
      [sourceEventId]
    );
    for (const oldSourceRow of sourceRowsFullBefore) {
      const sourceRowStudentName = String(oldSourceRow.student_name || '').trim();
      if (!sourceRowStudentName) continue;
      await client.query(
        `UPDATE monthly_schedule
            SET title = $3
          WHERE event_id = $1 AND student_name = $2`,
        [sourceEventId, sourceRowStudentName, restoredSourceTitle(oldSourceRow)]
      );
    }
    await queueLessonCalendarStyle(db, sourceEventId, sourceRowsFullBefore);
    await client.query('COMMIT');
    client.release();
    client = null;

    for (const oldRow of destRows) {
      await logChange(
        {
          entityType: 'monthly_schedule',
          entityKey: `${toEventId}_${oldRow.student_name}`,
          action: 'delete',
          oldData: oldRow,
          newData: null,
        },
        req
      );
    }
    const sourceRowsAfter = (await db(`SELECT * FROM monthly_schedule WHERE event_id = $1`, [sourceEventId])).rows;
    for (const oldSourceRow of sourceRowsFullBefore) {
      const sourceRowStudentName = String(oldSourceRow.student_name || '').trim();
      if (!sourceRowStudentName) continue;
      const srcAfter =
        sourceRowsAfter.find((row) => String(row.student_name || '').trim() === sourceRowStudentName) || null;
      if (!srcAfter) continue;
      await logChange(
        {
          entityType: 'monthly_schedule',
          entityKey: `${sourceEventId}_${sourceRowStudentName}`,
          action: 'update',
          oldData: oldSourceRow,
          newData: srcAfter,
        },
        req
      );
    }

    const sourceStyle = shouldStyleSourceCalendar
      ? await syncLessonCalendarStyle(sourceEventId, sourceRowsFullBefore)
      : {};
    const calendarSourceRestoreError = sourceStyle.calendar_sync_error || null;

    await reconcileCountersForAffectedRows([...sourceRowsFullBefore, ...destRows]);

    res.status(200).json({
      ok: true,
      source_event_id: sourceEventId,
      removed_event_id: toEventId,
      ...(calendarSourceRestoreError ? { calendar_source_restore_error: calendarSourceRestoreError } : {}),
    });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    res.status(500).json({ error: err.message });
  } finally {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
      client.release();
    }
  }
}

export async function handleRescheduleAwaitingDate(req, res) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Serialise related status/link changes before inspecting source state.
    await client.query("SELECT pg_advisory_xact_lock(1936941420, 1)");
    const db = (sql, args) => client ? client.query(sql, args) : query(sql, args);
    const eventId =
      getEventIdFromPath(req.path, 'reschedule-awaiting-date') ||
      decodeURIComponent((req.params[0] || req.params[1] || '').trim());
    const oldRows = (await db('SELECT * FROM monthly_schedule WHERE event_id = $1 FOR UPDATE', [eventId])).rows;
    if (oldRows.length === 0) {
      return res.status(404).json({ error: 'Event not found', event_id: eventId });
    }
    const linked = await db('SELECT 1 FROM reschedules WHERE from_event_id = $1 LIMIT 1', [eventId]);
    if (linked.rows.length) return res.status(409).json({ error: 'This lesson has a replacement. Use Undo reschedule first.' });
    if (oldRows.some((row) => !['scheduled', 'demo', 'rescheduled'].includes(String(row.status || 'scheduled').trim().toLowerCase())
      || (String(row.status).trim().toLowerCase() === 'rescheduled' && !row.awaiting_reschedule_date))) {
      return res.status(409).json({ error: 'Lesson status has changed. Refresh the schedule.' });
    }
    await db(
      `UPDATE monthly_schedule
         SET status = 'rescheduled',
             awaiting_reschedule_date = TRUE,
             reschedule_snapshot_to_date = NULL,
             reschedule_snapshot_to_time = NULL,
             title = $2
       WHERE event_id = $1`,
      [eventId, applyRescheduleTitleMarker(oldRows[0]?.title || '', 'to', '???')]
    );
    const newRows = (await db('SELECT * FROM monthly_schedule WHERE event_id = $1 FOR UPDATE', [eventId])).rows;
    await queueLessonCalendarStyle(db, eventId, oldRows);
    await client.query('COMMIT');
    client.release();
    client = null;
    const calendar = await syncLessonCalendarStyle(eventId, oldRows);
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
    await reconcileCountersForAffectedRows(oldRows);
    res.json({ ok: true, event_id: eventId, ...calendar });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
      client.release();
    }
  }
}

export async function handleCancel(req, res) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Serialise related status/link changes before inspecting source state.
    await client.query("SELECT pg_advisory_xact_lock(1936941420, 1)");
    const db = (sql, args) => client ? client.query(sql, args) : query(sql, args);
    const eventId = getEventIdFromPath(req.path, 'cancel') || decodeURIComponent((req.params[0] || req.params[1] || '').trim());
    const oldRows = (await db('SELECT * FROM monthly_schedule WHERE event_id = $1 FOR UPDATE', [eventId])).rows;
    if (oldRows.length === 0) {
      return res.status(404).json({ error: 'Event not found', event_id: eventId });
    }
    const linked = await db('SELECT 1 FROM reschedules WHERE from_event_id = $1 LIMIT 1', [eventId]);
    if (linked.rows.length) return res.status(409).json({ error: 'This lesson has a replacement. Use Undo reschedule first.' });
    if (oldRows.some((row) => !['scheduled', 'demo', 'cancelled', 'rescheduled'].includes(String(row.status || 'scheduled').trim().toLowerCase())
      || (String(row.status).trim().toLowerCase() === 'rescheduled' && !row.awaiting_reschedule_date))) {
      return res.status(409).json({ error: 'Lesson status has changed. Refresh the schedule.' });
    }
    await db(
      `UPDATE monthly_schedule SET status = 'cancelled', awaiting_reschedule_date = FALSE, title = $2 WHERE event_id = $1`,
      [eventId, applyCancelledTitleMarker(oldRows[0]?.title)]
    );
    const newRows = (await db('SELECT * FROM monthly_schedule WHERE event_id = $1 FOR UPDATE', [eventId])).rows;
    await queueLessonCalendarStyle(db, eventId, oldRows);
    await client.query('COMMIT');
    client.release();
    client = null;
    const calendar = await syncLessonCalendarStyle(eventId, oldRows);
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
    await reconcileCountersForAffectedRows(oldRows);
    res.json({ ok: true, event_id: eventId, ...calendar });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
      client.release();
    }
  }
}

export async function handleUncancel(req, res) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Serialise related status/link changes before inspecting source state.
    await client.query("SELECT pg_advisory_xact_lock(1936941420, 1)");
    const db = (sql, args) => client ? client.query(sql, args) : query(sql, args);
    const eventId = getEventIdFromPath(req.path, 'uncancel') || decodeURIComponent((req.params[0] || req.params[1] || '').trim());
    const oldRows = (await db('SELECT * FROM monthly_schedule WHERE event_id = $1 FOR UPDATE', [eventId])).rows;
    if (oldRows.length === 0) {
      return res.status(404).json({ error: 'Event not found', event_id: eventId });
    }
    const linked = await db('SELECT 1 FROM reschedules WHERE from_event_id = $1 LIMIT 1', [eventId]);
    if (linked.rows.length) return res.status(409).json({ error: 'This lesson has a replacement. Use Undo reschedule first.' });
    if (oldRows.some((row) => !['cancelled', 'rescheduled'].includes(String(row.status || 'scheduled').trim().toLowerCase())
      || (String(row.status).trim().toLowerCase() === 'rescheduled' && !row.awaiting_reschedule_date))) {
      return res.status(409).json({ error: 'Lesson status has changed. Refresh the schedule.' });
    }
    const restoredSlot = await validateRestoredSlot(oldRows, [eventId], db);
    if (!restoredSlot.ok) return res.status(restoredSlot.status || 409).json({ error: restoredSlot.error });
    await db(
      `UPDATE monthly_schedule
         SET status = 'scheduled',
             awaiting_reschedule_date = FALSE,
             reschedule_snapshot_to_date = NULL,
             reschedule_snapshot_to_time = NULL,
             title = $2
       WHERE event_id = $1`,
      [eventId, restoredSourceTitle(oldRows[0])]
    );
    const newRows = (await db('SELECT * FROM monthly_schedule WHERE event_id = $1 FOR UPDATE', [eventId])).rows;
    await queueLessonCalendarStyle(db, eventId, oldRows);
    await client.query('COMMIT');
    client.release();
    client = null;
    const calendar = await syncLessonCalendarStyle(eventId, oldRows);
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
    await reconcileCountersForAffectedRows(oldRows);
    res.json({ ok: true, event_id: eventId, ...calendar });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
      client.release();
    }
  }
}

/** Compatibility endpoint for moving an unlinked lesson in place. */
export async function handleLegacyReschedule(req, res) {
  let client;
  try {
    const eventId = getEventIdFromPath(req.path, 'reschedule') || decodeURIComponent((req.params[0] || req.params[1] || '').trim());
    const { date, start, end } = req.body || {};
    if (!date && !start && !end) return res.status(400).json({ error: 'Provide at least one of date, start, end' });
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(1936941420, 1)');
    const db = client.query.bind(client);
    const oldRows = (await db('SELECT * FROM monthly_schedule WHERE event_id = $1 FOR UPDATE', [eventId])).rows;
    if (!oldRows.length) return res.status(404).json({ error: 'Event not found', event_id: eventId });
    const links = await db('SELECT 1 FROM reschedules WHERE from_event_id = $1 OR to_event_id = $1 LIMIT 1', [eventId]);
    if (links.rows.length || oldRows.some((r) => !['scheduled', 'demo'].includes(String(r.status || 'scheduled').trim().toLowerCase()))) {
      return res.status(409).json({ error: 'Use the linked reschedule flow for this lesson' });
    }
    const row = oldRows[0];
    const oldStart = new Date(row.start);
    const oldEnd = new Date(row.end);
    const requestedDate = String(date || '').trim();
    const oldClock = utcToJstDateAndTime(oldStart)?.time;
    const startDate = start ? new Date(start) : requestedDate && oldClock
      ? parseJstToUtc(requestedDate, ...oldClock.split(':').map(Number)) : oldStart;
    if (!startDate || !Number.isFinite(startDate.getTime())) return res.status(400).json({ error: 'Invalid lesson start' });
    const endDate = end ? new Date(end) : new Date(startDate.getTime() + oldEnd.getTime() - oldStart.getTime());
    const dateStr = utcToJstDateAndTime(startDate)?.date;
    if (!dateStr || !Number.isFinite(endDate.getTime()) || endDate <= startDate || (requestedDate && requestedDate !== dateStr)) {
      return res.status(400).json({ error: 'Invalid or inconsistent lesson date and time' });
    }
    const students = (await db('SELECT id, name, is_child, payment FROM students WHERE id = ANY($1::int[])', [oldRows.map((r) => r.student_id)])).rows;
    if (!students.length) return res.status(409).json({ error: 'Unable to resolve lesson students' });
    const slot = await assertBookableSlotForConfirm({ startDate, endDate, dateStr, orderedStudents: students, excludedEventIds: [eventId], db });
    if (!slot.ok) return res.status(slot.status || 409).json({ error: slot.error });
    await db('UPDATE monthly_schedule SET date = $2::date, start = $3::timestamptz, "end" = $4::timestamptz WHERE event_id = $1', [eventId, dateStr, startDate.toISOString(), endDate.toISOString()]);
    await queueLessonCalendarStyle(db, eventId, oldRows);
    const newRows = (await db('SELECT * FROM monthly_schedule WHERE event_id = $1', [eventId])).rows;
    await db('COMMIT'); client.release(); client = null;
    const calendar = await syncLessonCalendarStyle(eventId, oldRows);
    for (const oldRow of oldRows) {
      await logChange({ entityType: 'monthly_schedule', entityKey: `${eventId}_${oldRow.student_name}`, action: 'update', oldData: oldRow, newData: newRows.find((r) => r.student_name === oldRow.student_name) }, req);
    }
    await reconcileCountersForAffectedRows([...oldRows, ...newRows]);
    res.json({ ok: true, event_id: eventId, ...calendar });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
      client.release();
    }
  }
}
