/**
 * Move one reserved (固定) week to a new date/time — stays reserved (Banana).
 */
import { query } from '../../db/index.js';
import { logChange } from '../changeLog.js';
import { parseJstToUtc } from '../timezone.js';
import {
  createBookedLessonEventInGas,
  isBookingGasEnabled,
} from '../bookingCalendarSync.js';
import {
  applyKidsTitlePrefix,
  formatOrderedStudentNames,
} from '../groupLessonTitle.js';
import * as D from './domainInternals.js';

const {
  LOCAL_BOOKING_EVENT_ID_PREFIX,
  CALENDAR_SYNC_STATUS_SYNCED,
  SQL_BLOCKS_STUDENT_SLOT_OVERLAP,
  clampBookingDurationMinutes,
  normalizeCalendarSyncStatus,
  buildCalendarSyncKey,
  buildMonthlyEventId,
  lessonModeToLocationLabel,
  locationLabelToLessonMode,
  normalizePersonName,
  batchRowsToOrderedStudents,
  deleteReservedPlaceholderForWeek,
  rollbackConfirmCreatedLessons,
  collectExcludeCalendarEventIds,
} = D;

function buildMovedReservedTitle(groupRows, orderedStudents, locationLabel) {
  const existing = String(groupRows[0]?.title || '').trim();
  if (existing) {
    return applyKidsTitlePrefix(existing, orderedStudents);
  }
  const names = formatOrderedStudentNames(orderedStudents);
  const location = locationLabel || 'Cafe';
  return applyKidsTitlePrefix(names ? `${names} (${location})` : `Reserved (${location})`, orderedStudents);
}

export async function handleMoveReserved(req, res) {
  try {
    if (!isBookingGasEnabled()) {
      return res.status(503).json({ error: 'Calendar booking sync is not configured' });
    }

    const eventIdRaw = String(req.body?.event_id || '').trim();
    const dateStr = String(req.body?.date || '').trim();
    const timeStr = String(req.body?.time || '').trim();
    if (!eventIdRaw) return res.status(400).json({ error: 'event_id is required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    if (!/^\d{2}:\d{2}$/.test(timeStr)) {
      return res.status(400).json({ error: 'time must be HH:MM' });
    }

    const groupResult = await query(
      `SELECT m.*, s.name AS canonical_student_name, s.status AS student_status,
              s.payment AS student_payment, s.is_child AS student_is_child
         FROM monthly_schedule m
         LEFT JOIN students s ON s.id = m.student_id
        WHERE m.event_id = $1
        ORDER BY COALESCE(m.group_sort_order, 2147483647) ASC, m.student_id ASC NULLS LAST`,
      [eventIdRaw]
    );
    const groupRows = groupResult.rows || [];
    if (groupRows.length === 0) {
      return res.status(404).json({ error: 'Event not found', event_id: eventIdRaw });
    }
    const anchor = groupRows[0];
    if (String(anchor.status || '').toLowerCase().trim() !== 'reserved') {
      return res.status(400).json({ error: 'Only reserved (固定) lessons can use Change date' });
    }
    if (normalizeCalendarSyncStatus(anchor.calendar_sync_status) !== CALENDAR_SYNC_STATUS_SYNCED) {
      return res.status(400).json({ error: 'Lesson must be synced with Google Calendar before changing date' });
    }
    if (String(anchor.event_id || '').startsWith(LOCAL_BOOKING_EVENT_ID_PREFIX)) {
      return res.status(400).json({ error: 'Cannot move a local-only booking row' });
    }

    const oldStart = new Date(anchor.start);
    const oldEnd = new Date(anchor.end);
    if (Number.isNaN(oldStart.getTime()) || Number.isNaN(oldEnd.getTime())) {
      return res.status(400).json({ error: 'Invalid start/end on reserved row' });
    }
    const oldDurMs = Math.max(30 * 60 * 1000, oldEnd.getTime() - oldStart.getTime());
    const durationMinutes = req.body?.duration_minutes != null
      ? clampBookingDurationMinutes(req.body.duration_minutes)
      : Math.round(oldDurMs / 60000);
    const durationMs = clampBookingDurationMinutes(durationMinutes) * 60 * 1000;

    const [hh, mm] = timeStr.split(':').map((x) => parseInt(x, 10));
    const startDate = parseJstToUtc(dateStr, hh, mm);
    if (!startDate) return res.status(400).json({ error: 'Invalid date/time' });
    const endDate = new Date(startDate.getTime() + durationMs);

    if (Math.abs(oldStart.getTime() - startDate.getTime()) < 60 * 1000) {
      return res.status(400).json({ error: 'Pick a different date or time' });
    }

    const orderedStudents = batchRowsToOrderedStudents(groupRows);
    const studentIds = orderedStudents
      .map((s) => Number(s.id))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (studentIds.length > 0) {
      const overlap = await query(
        `SELECT m.event_id, m.student_name, m.student_id
           FROM monthly_schedule m
          WHERE m.student_id = ANY($1::int[])
            AND ${SQL_BLOCKS_STUDENT_SLOT_OVERLAP}
            AND m.event_id IS DISTINCT FROM $2
            AND m.start < $4::timestamptz
            AND m."end" > $3::timestamptz
          LIMIT 1`,
        [studentIds, eventIdRaw, startDate.toISOString(), endDate.toISOString()]
      );
      if (overlap.rows.length > 0) {
        const who = normalizePersonName(overlap.rows[0].student_name) || 'Student';
        return res.status(409).json({
          error: `${who} already has a lesson overlapping this time. Cancel or move the other lesson first.`,
        });
      }
    }

    const lessonKind = String(anchor.lesson_kind || 'regular').trim().toLowerCase() || 'regular';
    const locationLabel =
      req.body?.location != null && String(req.body.location).trim()
        ? String(req.body.location).trim()
        : lessonModeToLocationLabel(anchor.lesson_mode);
    const title = buildMovedReservedTitle(groupRows, orderedStudents, locationLabel);
    const bookingKey = String(anchor.calendar_sync_key || '').trim() || buildCalendarSyncKey();
    const firstS = orderedStudents[0] || {
      id: anchor.student_id,
      name: anchor.canonical_student_name || anchor.student_name,
      is_child: !!anchor.student_is_child || !!anchor.is_kids_lesson,
    };
    const studentPayload = {
      id: firstS.id,
      name: firstS.name || '',
      status: firstS.status,
      payment: firstS.payment,
      is_child: !!firstS.is_child,
    };

    const descLines = [
      'Source: Student Admin move reserved (固定)',
      firstS.id != null ? `StudentId: ${firstS.id}` : null,
      studentIds.length > 1 ? `StudentIds: ${studentIds.join(',')}` : null,
      anchor.teacher_name ? `#teacher${String(anchor.teacher_name).trim()}` : null,
      bookingKey ? `BookingSyncKey: ${bookingKey}` : null,
    ].filter(Boolean);

    const gasRes = await createBookedLessonEventInGas({
      students: orderedStudents,
      student: studentPayload,
      startIso: startDate.toISOString(),
      endIso: endDate.toISOString(),
      assignedTeacherName: anchor.teacher_name,
      title,
      location: lessonKind === 'demo' ? '' : locationLabel,
      lessonKind,
      bookingKey,
      colorId: '5',
      description: descLines.join('\n'),
    });
    if (!gasRes.ok || !gasRes.eventId) {
      return res.status(502).json({
        error: gasRes.error || 'Failed to create reserved lesson in Google Calendar',
        event_id: eventIdRaw,
      });
    }

    const newEventId = buildMonthlyEventId(gasRes.eventId, dateStr, startDate);
    const plannedItem = {
      oldEventId: eventIdRaw,
      newEventId,
      title,
      calendarSourceRaw: gasRes.eventId,
      bookingKey,
    };

    const calendarDel = await deleteReservedPlaceholderForWeek(groupRows, {
      excludeEventIds: collectExcludeCalendarEventIds([gasRes.eventId], [plannedItem]),
    });
    if (!calendarDel.ok) {
      await rollbackConfirmCreatedLessons([gasRes.eventId], lessonKind);
      return res.status(502).json({
        error:
          calendarDel.error ||
          'Failed to delete old reserved calendar occurrence. Database was not changed.',
        event_id: eventIdRaw,
      });
    }

    const lessonMode =
      lessonKind === 'demo' ? 'unknown' : locationLabelToLessonMode(locationLabel);
    const upd = await query(
      `UPDATE monthly_schedule
          SET event_id = $1,
              title = $2,
              date = $3::date,
              start = $4::timestamptz,
              "end" = $5::timestamptz,
              status = 'reserved',
              calendar_source_event_id = $6,
              calendar_sync_status = $7,
              calendar_sync_error = NULL,
              calendar_sync_attempted_at = NOW(),
              calendar_synced_at = NOW(),
              calendar_sync_key = COALESCE(calendar_sync_key, $8),
              lesson_mode = COALESCE($9, lesson_mode)
        WHERE event_id = $10
          AND LOWER(TRIM(COALESCE(status, 'reserved'))) = 'reserved'`,
      [
        newEventId,
        title,
        dateStr,
        startDate.toISOString(),
        endDate.toISOString(),
        gasRes.eventId,
        CALENDAR_SYNC_STATUS_SYNCED,
        bookingKey,
        lessonMode,
        eventIdRaw,
      ]
    );
    if ((upd.rowCount || 0) === 0) {
      await rollbackConfirmCreatedLessons([gasRes.eventId], lessonKind);
      return res.status(500).json({
        error: 'Lesson changed mid-update; Calendar may need manual cleanup.',
        event_id: eventIdRaw,
      });
    }

    await query(`UPDATE reschedules SET from_event_id = $1 WHERE from_event_id = $2`, [
      newEventId,
      eventIdRaw,
    ]);
    await query(`UPDATE reschedules SET to_event_id = $1 WHERE to_event_id = $2`, [
      newEventId,
      eventIdRaw,
    ]);

    for (const oldRow of groupRows) {
      try {
        const newSnap = (
          await query(
            `SELECT * FROM monthly_schedule WHERE event_id = $1 AND student_name = $2`,
            [newEventId, oldRow.student_name]
          )
        ).rows[0];
        if (newSnap) {
          await logChange(req.staff?.id, 'update', 'monthly_schedule', newEventId, oldRow, newSnap);
        }
      } catch (logErr) {
        console.error('[move-reserved] change log failed', logErr?.message || logErr);
      }
    }

    return res.json({
      ok: true,
      event_id: newEventId,
      old_event_id: eventIdRaw,
      date: dateStr,
      time: timeStr,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      title,
      status: 'reserved',
      calendar_source_event_id: gasRes.eventId,
      created_calendar_event_id: gasRes.eventId,
      deleted_calendar_event_id: calendarDel.gas_event_id || null,
    });
  } catch (err) {
    console.error('[move-reserved]', err);
    return res.status(500).json({ error: err.message || 'Failed to move reserved lesson' });
  }
}
