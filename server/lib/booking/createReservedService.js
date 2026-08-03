/**
 * Create a weekly reserved (固定) hold for a student/month via GAS + DB rows.
 */
import { randomUUID } from 'crypto';
import { query } from '../../db/index.js';
import { logChange } from '../changeLog.js';
import { parseJstToUtc, utcToJstDateAndTime } from '../timezone.js';
import {
  createReservedRecurringHoldInGas,
  isBookingGasEnabled,
} from '../bookingCalendarSync.js';
import {
  applyKidsTitlePrefix,
  formatOrderedStudentNames,
} from '../groupLessonTitle.js';
import * as D from './domainInternals.js';

const {
  CALENDAR_SYNC_STATUS_SYNCED,
  clampBookingDurationMinutes,
  deriveLessonKindFromStudent,
  buildCalendarSyncKey,
  buildMonthlyEventId,
  locationLabelToLessonMode,
  normalizePersonName,
  getOrderedGroupMembers,
  lastDayOfYyyyMm,
  firstJstIsoDowDateInMonth,
  rruleUntilUtcFromJstEndOfDay,
  bydayFromJstIsoDow,
  addDaysToYyyyMmDd,
  jstIsoDowFromUtcMs,
} = D;

function buildReservedHoldTitle(students, locationLabel) {
  const names = formatOrderedStudentNames(students);
  const location = locationLabel || 'Cafe';
  return applyKidsTitlePrefix(names ? `${names} (${location})` : `Reserved (${location})`, students);
}

/** List YYYY-MM-DD dates in month for ISO weekday (1=Mon … 7=Sun). */
function listOccurrenceDatesInMonth(yyyyMm, isodow) {
  const first = firstJstIsoDowDateInMonth(yyyyMm, isodow);
  const last = lastDayOfYyyyMm(yyyyMm);
  if (!first || !last) return [];
  const dates = [];
  let cur = first;
  while (cur && cur <= last) {
    dates.push(cur);
    cur = addDaysToYyyyMmDd(cur, 7);
  }
  return dates;
}

export async function handleCreateReserved(req, res) {
  try {
    if (!isBookingGasEnabled()) {
      return res.status(503).json({ error: 'Calendar booking sync is not configured' });
    }

    const studentIdNum = Number(req.body?.student_id);
    const monthRaw = String(req.body?.month || '').trim();
    const timeStr = String(req.body?.time || '').trim();
    const dateHint = String(req.body?.date || '').trim();
    let weekdayRaw = req.body?.weekday;

    if (!Number.isFinite(studentIdNum) || studentIdNum <= 0) {
      return res.status(400).json({ error: 'student_id must be a number' });
    }
    if (!/^\d{4}-\d{2}$/.test(monthRaw)) {
      return res.status(400).json({ error: 'month must be YYYY-MM' });
    }
    if (!/^\d{2}:\d{2}$/.test(timeStr)) {
      return res.status(400).json({ error: 'time must be HH:MM' });
    }

    let isodow = null;
    if (weekdayRaw != null && String(weekdayRaw).trim() !== '') {
      const w = Number(weekdayRaw);
      // Accept ISO 1–7 or JS 0–6 (0=Sun → 7).
      if (w >= 1 && w <= 7) isodow = w;
      else if (w === 0) isodow = 7;
      else return res.status(400).json({ error: 'weekday must be 0–6 (Sun–Sat) or 1–7 (Mon–Sun)' });
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateHint)) {
      const probe = parseJstToUtc(dateHint, 12, 0);
      if (!probe) return res.status(400).json({ error: 'Invalid date' });
      isodow = jstIsoDowFromUtcMs(probe.getTime());
    } else {
      return res.status(400).json({ error: 'weekday or date is required' });
    }

    const studentResult = await query(
      `SELECT id, name, is_child, status, payment, group_type, group_size
         FROM students WHERE id = $1`,
      [studentIdNum]
    );
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const student = studentResult.rows[0];

    let orderedStudents = [
      {
        id: Number(student.id),
        name: normalizePersonName(student.name),
        status: student.status,
        payment: student.payment,
        is_child: !!student.is_child,
        sort_order: 1,
      },
    ];
    let groupId = null;
    if (String(student.group_type || '').toLowerCase() === 'group') {
      // Prefer linked group members when available (same event_id for all).
      const groupLink = await query(
        `SELECT group_id FROM student_group_members WHERE student_id = $1 LIMIT 1`,
        [studentIdNum]
      );
      const gid = groupLink.rows[0]?.group_id != null ? Number(groupLink.rows[0].group_id) : null;
      if (gid) {
        const members = await getOrderedGroupMembers(gid);
        if (members.length > 0) {
          orderedStudents = members;
          groupId = gid;
        }
      }
    }

    const durationMinutes = clampBookingDurationMinutes(req.body?.duration_minutes ?? 50);
    const [hh, mm] = timeStr.split(':').map((x) => parseInt(x, 10));
    const occurrenceDates = listOccurrenceDatesInMonth(monthRaw, isodow);
    if (occurrenceDates.length === 0) {
      return res.status(400).json({ error: 'No occurrences for that weekday in the selected month' });
    }

    const firstOcc = occurrenceDates[0];
    const firstStart = parseJstToUtc(firstOcc, hh, mm);
    if (!firstStart) return res.status(400).json({ error: 'Invalid first occurrence start' });
    const firstEnd = new Date(firstStart.getTime() + durationMinutes * 60 * 1000);
    const endJst = utcToJstDateAndTime(firstEnd);
    const startLocal = `${firstOcc}T${String(hh).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}:00`;
    const endLocal = endJst
      ? `${endJst.date}T${endJst.time.slice(0, 2)}:${endJst.time.slice(3, 5)}:00`
      : startLocal;

    const lastNext = lastDayOfYyyyMm(monthRaw);
    const untilZ = rruleUntilUtcFromJstEndOfDay(lastNext);
    const byday = bydayFromJstIsoDow(isodow);
    const recurrence = untilZ
      ? [`RRULE:FREQ=WEEKLY;BYDAY=${byday};UNTIL=${untilZ}`]
      : [`RRULE:FREQ=WEEKLY;COUNT=${occurrenceDates.length};BYDAY=${byday}`];

    const locationLabel =
      req.body?.location != null && String(req.body.location).trim()
        ? String(req.body.location).trim()
        : 'Cafe';
    const teacherName =
      req.body?.teacher_name != null ? String(req.body.teacher_name).trim() : '';
    const lessonKind = deriveLessonKindFromStudent(student);
    const title = buildReservedHoldTitle(orderedStudents, locationLabel);
    const lessonMode = lessonKind === 'demo' ? 'unknown' : locationLabelToLessonMode(locationLabel);
    const bookingKey = buildCalendarSyncKey();

    const descLines = [
      'Source: Student Admin create reserved (固定)',
      `StudentId: ${studentIdNum}`,
      orderedStudents.length > 1
        ? `StudentIds: ${orderedStudents.map((s) => s.id).filter(Boolean).join(',')}`
        : null,
      teacherName ? `#teacher${teacherName}` : null,
      `BookingSyncKey: ${bookingKey}`,
    ].filter(Boolean);

    const holdRes = await createReservedRecurringHoldInGas({
      lessonKind,
      title,
      description: descLines.join('\n'),
      startLocal,
      endLocal,
      timeZone: 'Asia/Tokyo',
      recurrence,
    });
    if (!holdRes.ok || !holdRes.eventId) {
      return res.status(502).json({
        error: holdRes.error || 'Failed to create reserved hold in Google Calendar',
      });
    }

    const seriesEventId = holdRes.eventId;
    const lessonUuid = randomUUID();
    const insertedEventIds = [];

    for (const occDate of occurrenceDates) {
      const occStart = parseJstToUtc(occDate, hh, mm);
      if (!occStart) continue;
      const occEnd = new Date(occStart.getTime() + durationMinutes * 60 * 1000);
      const monthlyEventId = buildMonthlyEventId(seriesEventId, occDate, occStart);
      insertedEventIds.push(monthlyEventId);

      for (let index = 0; index < orderedStudents.length; index += 1) {
        const studentEntry = orderedStudents[index];
        const rowSyncKey = index === 0 ? bookingKey : buildCalendarSyncKey();
        await query(
          `INSERT INTO monthly_schedule
            (event_id, calendar_source_event_id, lesson_uuid, title, date, start, "end", status,
             student_name, is_kids_lesson, teacher_name, lesson_kind, lesson_mode, student_id,
             calendar_sync_status, calendar_sync_error, calendar_sync_key,
             calendar_sync_attempted_at, calendar_synced_at,
             group_id, group_sort_order)
           VALUES
            ($1, $2, $3, $4, $5::date, $6::timestamptz, $7::timestamptz, 'reserved',
             $8, $9, $10, $11, $12, $13,
             $14, NULL, $15, NOW(), NOW(),
             $16, $17)
           ON CONFLICT (event_id, student_name)
           DO UPDATE SET
             calendar_source_event_id = EXCLUDED.calendar_source_event_id,
             lesson_uuid = COALESCE(monthly_schedule.lesson_uuid, EXCLUDED.lesson_uuid),
             title = EXCLUDED.title,
             date = EXCLUDED.date,
             start = EXCLUDED.start,
             "end" = EXCLUDED."end",
             status = 'reserved',
             is_kids_lesson = EXCLUDED.is_kids_lesson,
             teacher_name = EXCLUDED.teacher_name,
             lesson_kind = EXCLUDED.lesson_kind,
             lesson_mode = EXCLUDED.lesson_mode,
             student_id = EXCLUDED.student_id,
             calendar_sync_status = EXCLUDED.calendar_sync_status,
             calendar_sync_error = NULL,
             calendar_sync_key = EXCLUDED.calendar_sync_key,
             calendar_sync_attempted_at = NOW(),
             calendar_synced_at = NOW(),
             group_id = EXCLUDED.group_id,
             group_sort_order = EXCLUDED.group_sort_order`,
          [
            monthlyEventId,
            seriesEventId,
            lessonUuid,
            title,
            occDate,
            occStart.toISOString(),
            occEnd.toISOString(),
            normalizePersonName(studentEntry.name),
            !!studentEntry.is_child,
            teacherName || null,
            lessonKind,
            lessonMode,
            Number(studentEntry.id),
            CALENDAR_SYNC_STATUS_SYNCED,
            rowSyncKey,
            groupId,
            index + 1,
          ]
        );
      }
    }

    try {
      await logChange(req.staff?.id, 'create', 'monthly_schedule', seriesEventId, null, {
        series_event_id: seriesEventId,
        month: monthRaw,
        weekday: isodow,
        time: timeStr,
        title,
        occurrence_count: occurrenceDates.length,
        student_ids: orderedStudents.map((s) => s.id),
      });
    } catch (logErr) {
      console.error('[create-reserved] change log failed', logErr?.message || logErr);
    }

    return res.status(201).json({
      ok: true,
      series_event_id: seriesEventId,
      month: monthRaw,
      weekday: isodow,
      time: timeStr,
      title,
      occurrence_dates: occurrenceDates,
      event_ids: insertedEventIds,
      student_ids: orderedStudents.map((s) => s.id),
      location: locationLabel,
      teacher_name: teacherName || null,
    });
  } catch (err) {
    console.error('[create-reserved]', err);
    return res.status(500).json({ error: err.message || 'Failed to create reserved hold' });
  }
}
