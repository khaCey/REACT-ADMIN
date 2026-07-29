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

export async function handleRescheduleLinked(req, res) {
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
        `SELECT event_id, lesson_uuid, student_name, student_id, status, title, awaiting_reschedule_date, group_id, group_sort_order,
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
    const sourceAnchor = byStudentId || byName || (candidateRows.length === 1 ? candidateRows[0] : null);
    if (!sourceAnchor) {
      return res.status(404).json({ error: 'Source lesson not found for student' });
    }
    const sourceStatus = String(sourceAnchor.status || '').toLowerCase();
    const sourceCancelled = sourceStatus === 'cancelled';
    const sourceRescheduled = sourceStatus === 'rescheduled';
    const awaitingDate = !!sourceAnchor.awaiting_reschedule_date;
    if (sourceCancelled) {
      return res.status(400).json({ error: 'Source lesson is already cancelled' });
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
    if (!startDate) return res.status(400).json({ error: 'Invalid date or time' });
    const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

    const locationLabel = String(location || 'Cafe').trim() || 'Cafe';
    const monthKey = dateStrRaw.slice(0, 7);
    const lessonKindForBooking = deriveLessonKindFromStudent(student);

    const fromDisplay = formatOrdinalCalendarDay(sourceAnchor.src_date_str);
    const toDisplay = formatOrdinalCalendarDay(dateStrRaw);
    const movedFromLabel = fromDisplay || '???';

    let title;
    if (lessonKindForBooking === 'demo') {
      title = applyRescheduleTitleMarker(`${studentName} D/L`, 'from', movedFromLabel);
    } else {
      let totalLessons = parsePackTotalFromTitle(sourceAnchor.title);
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
         WHERE (m.status IS NULL OR LOWER(TRIM(m.status)) NOT IN ('cancelled', 'rescheduled'))
           AND m.student_id = $1
           AND to_char(m.date, 'YYYY-MM') = $2`,
        [studentIdNum, monthKey]
      );
      const bookedThisMonth = parseInt(bookedCountResult.rows[0]?.cnt, 10) || 0;
      const nextLessonNumber = sourceMonth === monthKey ? Math.max(1, bookedThisMonth) : bookedThisMonth + 1;
      title = applyRescheduleTitleMarker(
        `${studentName} (${locationLabel}) ${nextLessonNumber}/${totalLessons}`,
        'from',
        movedFromLabel
      );
    }

    const sourceTitleSeed = sourceAnchor.title || title || '';
    const sourceOrderedStudents = await getOrderedEventStudents(sourceEventId);
    const canonicalBaseTitle =
      sourceOrderedStudents.length > 1 && sourceTitleSeed
        ? stripRescheduleTitleMarker(buildCanonicalLessonTitle(sourceTitleSeed, sourceOrderedStudents))
        : stripRescheduleTitleMarker(sourceTitleSeed);
    const canonicalSourceTitleUpdated = applyRescheduleTitleMarker(canonicalBaseTitle, 'to', toDisplay || '???');
    const canonicalDestinationTitle = applyRescheduleTitleMarker(canonicalBaseTitle, 'from', movedFromLabel);

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

    const sourceRowsFull = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [sourceEventId])).rows;
    const skipAmbiguousRecurringCalendar = await shouldSkipAmbiguousRecurringForRows(
      sourceEventId,
      sourceRowsForReschedule
    );
    /** Same predicate as PATCH cancel: style source Calendar (graphite) when lesson was on Calendar. */
    const shouldStyleSourceCalendar =
      isBookingGasEnabled() &&
      shouldSyncCalendarForRows(sourceRowsFull) &&
      !String(sourceEventId).startsWith(LOCAL_BOOKING_EVENT_ID_PREFIX) &&
      !skipAmbiguousRecurringCalendar;

    client = await pool.connect();
    await client.query('BEGIN');
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
      const destinationLessonKind = deriveLessonKindFromStudent(rowStudent);
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
    await client.query('COMMIT');

    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();

    /** Keep original Calendar event at original time: graphite + “Moved to …” title; the new event at the new time is created when the client calls POST /schedule/sync. */
    let calendarSourceGraphiteOk = false;
    let calendarSourceStyleError = null;

    if (shouldStyleSourceCalendar) {
      try {
        const styleUpd = await updateBookedLessonEventInGas(
          sourceEventId,
          {
            title: canonicalSourceTitleUpdated,
            colorId: '8',
            mergeStudentAdminDescription: { awaiting_reschedule_date: false },
          },
          calendarGasOptions(sourceRowsForReschedule)
        );
        if (styleUpd.ok) {
          calendarSourceGraphiteOk = true;
        } else {
          calendarSourceStyleError = styleUpd.error || 'Calendar source styling failed';
          console.error('[reschedule-linked] source graphite/title update failed:', calendarSourceStyleError);
        }
      } catch (err) {
        calendarSourceStyleError = err?.message || String(err);
        console.error('[reschedule-linked] source graphite/title update threw:', calendarSourceStyleError);
      }
    }

    // Calendar sync for the new event is triggered by the client via POST /schedule/sync
    // (single trigger). Auto-queuing here in addition would race with the client call and
    // create duplicate calendar events / spurious "failed" results.

    const sourceRowsAfter = (await query(`SELECT * FROM monthly_schedule WHERE event_id = $1`, [sourceEventId])).rows;
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
    const newRowsForLog = (await query(`SELECT * FROM monthly_schedule WHERE event_id = $1`, [localEventId])).rows;
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
    if (client) client.release();
  }
}

export async function handleUnrescheduleLinked(req, res) {
  let client;
  try {
    const { source_event_id, student_id, source_student_name } = req.body || {};
    const sourceEventId = String(source_event_id || '').trim();
    const studentIdNum = Number(student_id);
    if (!sourceEventId) return res.status(400).json({ error: 'source_event_id is required' });
    if (!Number.isFinite(studentIdNum)) return res.status(400).json({ error: 'student_id must be a number' });

    const studentResult = await query('SELECT id, name, is_child, status, payment FROM students WHERE id = $1', [studentIdNum]);
    if (studentResult.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    const studentName = String(studentResult.rows[0].name || '').trim();
    const normalizedStudentName = studentName.replace(/\s+/g, ' ').trim();
    const normalizedSourceName = String(source_student_name || '').replace(/\s+/g, ' ').trim();
    const studentParts = normalizedStudentName.split(' ').filter(Boolean);
    const swappedStudentName =
      studentParts.length >= 2 ? [...studentParts.slice(-1), ...studentParts.slice(0, -1)].join(' ') : '';
    const candidateRows = (
      await query(
        `SELECT event_id, lesson_uuid, student_name, student_id, status, title, awaiting_reschedule_date,
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
    const sourceStudentName = String(source.student_name || source_student_name || '').trim();
    if (!sourceStudentName) return res.status(400).json({ error: 'Source student name is missing' });
    const sourceLessonUuid = String(source.lesson_uuid || '').trim();

    const linkRes = await query(
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

    const destRows = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [toEventId])).rows;
    if (destRows.length === 0) {
      return res.status(400).json({ error: 'Destination lesson not found; link may be stale' });
    }

    const sourceRowsFullBefore = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [sourceEventId])).rows;
    const skipAmbiguousRecurringCalendar = await shouldSkipAmbiguousRecurringForRows(
      sourceEventId,
      sourceRowsFullBefore
    );
    const shouldStyleSourceCalendar =
      isBookingGasEnabled() &&
      shouldSyncCalendarForRows(sourceRowsFullBefore) &&
      !String(sourceEventId).startsWith(LOCAL_BOOKING_EVENT_ID_PREFIX) &&
      !skipAmbiguousRecurringCalendar;

    if (isBookingGasEnabled() && rowsIndicateExplicitCalendarSyncedForGasDelete(destRows)) {
      const del = await deleteBookedLessonEventInGas(toEventId, calendarGasOptions(destRows));
      if (!del.ok) {
        return res.status(502).json({
          error: del.error || 'Failed to remove destination lesson from Google Calendar',
          event_id: toEventId,
        });
      }
    }

    client = await pool.connect();
    await client.query('BEGIN');
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
         reschedule_snapshot_to_time = NULL,
         reschedule_snapshot_from_date = NULL,
         reschedule_snapshot_from_time = NULL
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
        [sourceEventId, sourceRowStudentName, stripRescheduleTitleMarker(oldSourceRow.title || '')]
      );
    }
    await client.query('COMMIT');

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
    const sourceRowsAfter = (await query(`SELECT * FROM monthly_schedule WHERE event_id = $1`, [sourceEventId])).rows;
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

    let calendarSourceRestoreError = null;
    if (shouldStyleSourceCalendar) {
      try {
        const activeForTitle = (
          await query(
            `SELECT m.*, s.name AS canonical_student_name, s.status AS student_status,
                    s.payment AS student_payment, s.is_child AS student_is_child
               FROM monthly_schedule m
               LEFT JOIN students s ON s.id = m.student_id
              WHERE m.event_id = $1
                AND (m.status IS NULL OR LOWER(TRIM(m.status)) NOT IN ('cancelled', 'rescheduled'))
              ORDER BY COALESCE(m.group_sort_order, 2147483647) ASC,
                       LOWER(COALESCE(s.name, m.student_name)) ASC`,
            [sourceEventId]
          )
        ).rows;
        if (activeForTitle.length > 0) {
          const orderedStudents = activeForTitle.map((entry, index) => ({
            id: entry.student_id != null ? Number(entry.student_id) : null,
            name: String(entry.canonical_student_name || entry.student_name || '').trim(),
            status: entry.student_status,
            payment: entry.student_payment,
            is_child: !!entry.student_is_child,
            sort_order: parseInt(entry.group_sort_order, 10) || index + 1,
          }));
          const gasTitle =
            activeForTitle.length > 1
              ? buildCanonicalLessonTitle(activeForTitle[0]?.title || '', orderedStudents)
              : stripRescheduleTitleMarker(activeForTitle[0]?.title || '');
          const lk = String(activeForTitle[0]?.lesson_kind || 'regular').toLowerCase();
          const cid = bookingEventColorId(lk);
          const merge = { mergeStudentAdminDescription: { awaiting_reschedule_date: false } };
          const restoreGasOpts = calendarGasOptions(sourceRowsFullBefore);
          const styleUpd = cid
            ? await updateBookedLessonEventInGas(
                sourceEventId,
                { title: gasTitle, colorId: cid, ...merge },
                restoreGasOpts
              )
            : await updateBookedLessonEventInGas(
                sourceEventId,
                { title: gasTitle, clearColor: true, ...merge },
                restoreGasOpts
              );
          if (!styleUpd.ok) {
            calendarSourceRestoreError = styleUpd.error || 'Calendar source restore failed';
            console.error('[unreschedule-linked] source calendar restore failed:', calendarSourceRestoreError);
          }
        }
      } catch (err) {
        calendarSourceRestoreError = err?.message || String(err);
        console.error('[unreschedule-linked] source calendar restore threw:', calendarSourceRestoreError);
      }
    }

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
    if (client) client.release();
  }
}

export async function handleRescheduleAwaitingDate(req, res) {
  try {
    const eventId =
      getEventIdFromPath(req.path, 'reschedule-awaiting-date') ||
      decodeURIComponent((req.params[0] || req.params[1] || '').trim());
    const oldRows = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [eventId])).rows;
    if (oldRows.length === 0) {
      return res.status(404).json({ error: 'Event not found', event_id: eventId });
    }
    const skipAmbiguousGas = await shouldSkipAmbiguousRecurringForRows(eventId, oldRows);
    if (isBookingGasEnabled() && shouldSyncCalendarForRows(oldRows) && !skipAmbiguousGas) {
      const pendingTitle = applyRescheduleTitleMarker(oldRows[0]?.title || '', 'to', '???');
      await updateBookedLessonEventInGas(
        eventId,
        {
          title: pendingTitle,
          colorId: '8',
          mergeStudentAdminDescription: { awaiting_reschedule_date: true },
        },
        calendarGasOptions(oldRows)
      );
    }
    await query(
      `UPDATE monthly_schedule
         SET status = 'rescheduled',
             awaiting_reschedule_date = TRUE,
             title = $2
       WHERE event_id = $1`,
      [eventId, applyRescheduleTitleMarker(oldRows[0]?.title || '', 'to', '???')]
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
}

export async function handleCancel(req, res) {
  try {
    const eventId = getEventIdFromPath(req.path, 'cancel') || decodeURIComponent((req.params[0] || req.params[1] || '').trim());
    const oldRows = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [eventId])).rows;
    if (oldRows.length === 0) {
      return res.status(404).json({ error: 'Event not found', event_id: eventId });
    }
    const skipAmbiguousGas = await shouldSkipAmbiguousRecurringForRows(eventId, oldRows);
    if (isBookingGasEnabled() && shouldSyncCalendarForRows(oldRows) && !skipAmbiguousGas) {
      // Google Calendar Graphite = colorId "8".
      await updateBookedLessonEventInGas(
        eventId,
        {
          colorId: '8',
          mergeStudentAdminDescription: { awaiting_reschedule_date: false },
        },
        calendarGasOptions(oldRows)
      );
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
}

export async function handleUncancel(req, res) {
  try {
    const eventId = getEventIdFromPath(req.path, 'uncancel') || decodeURIComponent((req.params[0] || req.params[1] || '').trim());
    const oldRows = (await query('SELECT * FROM monthly_schedule WHERE event_id = $1', [eventId])).rows;
    if (oldRows.length === 0) {
      return res.status(404).json({ error: 'Event not found', event_id: eventId });
    }
    if (isBookingGasEnabled() && shouldSyncCalendarForRows(oldRows)) {
      const lk = String(oldRows[0]?.lesson_kind || 'regular').toLowerCase();
      const cid = bookingEventColorId(lk);
      const restoredTitle = stripRescheduleTitleMarker(oldRows[0]?.title || '');
      const merge = { mergeStudentAdminDescription: { awaiting_reschedule_date: false } };
      const gasOpts = calendarGasOptions(oldRows);
      if (cid) {
        await updateBookedLessonEventInGas(eventId, { title: restoredTitle, colorId: cid, ...merge }, gasOpts);
      } else {
        await updateBookedLessonEventInGas(eventId, { title: restoredTitle, clearColor: true, ...merge }, gasOpts);
      }
    }
    await query(
      `UPDATE monthly_schedule
         SET status = 'scheduled',
             awaiting_reschedule_date = FALSE,
             title = $2
       WHERE event_id = $1`,
      [eventId, stripRescheduleTitleMarker(oldRows[0]?.title || '')]
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
}

export async function handleLegacyReschedule(req, res) {
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
    if (isBookingGasEnabled() && shouldSyncCalendarForRows(oldRows) && newRows.length > 0) {
      const nr = newRows[0];
      const startIso = nr.start ? new Date(nr.start).toISOString() : '';
      const endIso = nr.end ? new Date(nr.end).toISOString() : '';
      const patch = {
        ...(nr.title ? { title: String(nr.title) } : {}),
        ...(startIso ? { startIso } : {}),
        ...(endIso ? { endIso } : {}),
      };
      if (Object.keys(patch).length > 0) {
        updateBookedLessonEventInGas(eventId, patch, calendarGasOptions(oldRows)).catch((err) => {
          console.error('[schedule/reschedule] calendar update failed:', err?.message || err);
        });
      }
    }
    res.json({ ok: true, event_id: eventId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

