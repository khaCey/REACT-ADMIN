import { pool as defaultPool } from '../../db/index.js';
import { upsertFixedCalendarEvent } from '../fixedScheduleCalendar.js';
import { reconcileCountersForAffectedRows } from './lessonCounterReconcile.js';
import { logChange } from '../changeLog.js';
import {
  buildMonthlyEventId,
  getOrderedGroupMembers,
  deriveLessonKindFromStudent,
  assertBookableSlotForConfirm,
  getPackTotalForBooking,
} from './domainInternals.js';
import { bookingEventColorId } from '../bookingCalendarSync.js';
import {
  buildLessonTitleForOrderedStudents,
  applyKidsTitlePrefix,
  formatOrderedStudentNames,
} from '../groupLessonTitle.js';
import {
  fixedKey,
  fixedStart,
  occurrenceDates,
  validMonth,
  addMonths,
} from './fixedScheduleDates.js';
import { restoreActiveLessonTitle } from '../lessonMonthCounters.js';
import { utcToJstDateAndTime } from '../timezone.js';

const error = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const ymd = (v) => String(v).slice(0, 10);
const cloneRows = (rows) => rows.map((r) => ({ ...r }));

export function createFixedScheduleService({
  pool = defaultPool,
  calendar = upsertFixedCalendarEvent,
  validateSlot = assertBookableSlotForConfirm,
  audit = logChange,
} = {}) {
  async function locked(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(1936941420, 1)');
      const result = await fn(client.query.bind(client));
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  async function members(db, ids) {
    const rows = (
      await db(
        'SELECT * FROM students WHERE id = ANY($1::int[]) AND COALESCE(is_hidden, FALSE) = FALSE',
        [ids],
      )
    ).rows;
    if (
      rows.length !== ids.length ||
      rows.some((r) => ['休会中', 'Dormant'].includes(r.status))
    )
      throw error('All fixed schedule members must be active and visible');
    return ids
      .map((id) => rows.find((r) => Number(r.id) === Number(id)))
      .map((r, i) => ({
        ...r,
        id: Number(r.id),
        is_child: !!r.is_child,
        sort_order: i + 1,
      }));
  }
  async function pattern(
    db,
    students,
    date,
    time,
    location = 'Cafe',
    teacher = null,
  ) {
    const start = fixedStart(date, time);
    const weekday = new Date(start.getTime() + 32400000).getUTCDay() || 7;
    const ids = students.map((s) => Number(s.id));
    const id = fixedKey(
      'fixed-pattern-v1',
      [...ids].sort((a, b) => a - b),
      weekday,
      time,
      location,
    );
    return (
      await db(
        `INSERT INTO fixed_schedules (id, student_ids, weekday, time, location, lesson_kind, teacher_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id RETURNING *`,
        [
          id,
          ids,
          weekday,
          time,
          location,
          deriveLessonKindFromStudent(students[0]),
          teacher,
        ],
      )
    ).rows[0];
  }
  async function writeRows(db, o, p, students) {
    const local = utcToJstDateAndTime(new Date(o.start));
    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      await db(
        `INSERT INTO monthly_schedule
        (event_id, calendar_source_event_id, lesson_uuid, title, date, start, "end", status,
         student_name, student_id, is_kids_lesson, lesson_kind, lesson_mode, teacher_name,
         calendar_sync_status, calendar_sync_error, calendar_sync_key, fixed_schedule_id, fixed_occurrence_id, group_sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending','[fixed-schedule] Pending Calendar update',$15,$16,$17,$18)
        ON CONFLICT (event_id, student_name) DO UPDATE SET title=EXCLUDED.title, date=EXCLUDED.date,
          start=EXCLUDED.start, "end"=EXCLUDED."end", status=EXCLUDED.status,
          fixed_schedule_id=EXCLUDED.fixed_schedule_id, fixed_occurrence_id=EXCLUDED.fixed_occurrence_id,
          calendar_sync_status='pending', calendar_sync_error='[fixed-schedule] Pending Calendar update', awaiting_reschedule_date=FALSE`,
        [
          o.event_id,
          o.calendar_event_id,
          o.lesson_uuid,
          o.title,
          local.date,
          o.start,
          o.end,
          o.status,
          student.name,
          student.id,
          student.is_child,
          p.lesson_kind,
          p.location.toLowerCase() === 'online' ? 'online' : 'cafe',
          p.teacher_name,
          i === 0 ? o.id : fixedKey(o.id, student.id),
          p.id,
          o.id,
          i + 1,
        ],
      );
    }
  }
  async function sync(db, o, p, students) {
    // Cancellation and counter repairs can change a managed row after it was
    // generated. Always retry its current desired state, never a stale ledger title.
    const desired = (
      await db(
        `SELECT status,title,start,"end" FROM monthly_schedule
      WHERE fixed_occurrence_id=$1 ORDER BY group_sort_order LIMIT 1`,
        [o.id],
      )
    ).rows[0];
    if (desired) Object.assign(o, desired);

    const result = await calendar({
      eventId: o.calendar_event_id,
      occurrenceId: o.id,
      scheduleId: p.id,
      title: o.title,
      start: new Date(o.start).toISOString(),
      end: new Date(o.end).toISOString(),
      status: o.status,
      lessonKind: p.lesson_kind,
      location: p.location,
      colorId: bookingEventColorId(p.lesson_kind),
      description: `Source: Student Admin individual fixed schedule\nStudentId: ${students[0].id}\nStudentIds: ${students.map((s) => s.id).join(',')}\nBookingSyncKey: ${o.id}`,
    });
    const syncError = result.ok
      ? null
      : `[fixed-schedule] ${result.error || 'Calendar update failed'}`;
    await db(
      `UPDATE monthly_schedule SET calendar_sync_status=$2::varchar, calendar_sync_error=$3,
      calendar_source_event_id=COALESCE($4,calendar_source_event_id),
      calendar_sync_attempted_at=NOW(), calendar_synced_at=CASE WHEN $2::varchar='synced' THEN NOW() ELSE calendar_synced_at END
      WHERE fixed_occurrence_id=$1`,
      [
        o.id,
        result.ok ? 'synced' : 'failed',
        syncError,
        result.ok ? result.iCalUID || null : null,
      ],
    );
    return syncError;
  }
  async function ensureOccurrence(db, p, students, date, legacy = null) {
    const id = fixedKey('fixed-occurrence-v1', p.id, date);
    const found = (
      await db('SELECT * FROM fixed_schedule_occurrences WHERE id=$1', [id])
    ).rows[0];
    // A retained ledger entry is also a tombstone if staff removed/rescheduled the appointment.
    if (found) return found;
    const start = fixedStart(date, p.time);
    const end = new Date(start.getTime() + 50 * 60000);
    const calendarId = `fs${id}`;
    const eventId = buildMonthlyEventId(calendarId, date, start);
    const title = applyKidsTitlePrefix(
      `[固定] ${formatOrderedStudentNames(students)} (${p.location})`,
      students,
    );
    const o = (
      await db(
        `INSERT INTO fixed_schedule_occurrences
      (id,schedule_id,nominal_date,event_id,calendar_event_id,start,"end",status,title,legacy_event_id,legacy_calendar_source_event_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'reserved',$8,$9,$10) RETURNING *`,
        [
          id,
          p.id,
          date,
          eventId,
          calendarId,
          start.toISOString(),
          end.toISOString(),
          title,
          legacy?.event_id || null,
          legacy?.calendar_source_event_id || null,
        ],
      )
    ).rows[0];
    if (legacy) {
      // Update this occurrence's local rows only. The old Google event/series is untouched.
      await db(
        `UPDATE monthly_schedule SET event_id=$1, fixed_schedule_id=$2, fixed_occurrence_id=$3,
        calendar_source_event_id=$4 WHERE event_id=$5 AND date=$6::date AND student_id=ANY($7::int[])`,
        [eventId, p.id, id, calendarId, legacy.event_id, date, p.student_ids],
      );
    }
    await writeRows(db, o, p, students);
    return o;
  }
  async function checkSlot(db, students, start, end, exclusions) {
    const result = await validateSlot({
      startDate: new Date(start),
      endDate: new Date(end),
      dateStr: utcToJstDateAndTime(new Date(start)).date,
      orderedStudents: students,
      excludedEventIds: exclusions.length ? exclusions : ['fixed-new-slot'],
      db,
    });
    if (!result.ok) throw error(result.error, result.status || 409);
  }
  async function extend(db, p, month, students) {
    const remaining = (
      await db(
        `SELECT 1 FROM monthly_schedule
      WHERE fixed_schedule_id=$1 AND to_char(date,'YYYY-MM')=$2
      AND (status='reserved' OR calendar_sync_status <> 'synced') LIMIT 1`,
        [p.id, month],
      )
    ).rows;
    // Legacy placeholders may still be awaiting conversion this month.
    const legacyRemaining = (
      await db(
        `SELECT 1 FROM monthly_schedule
      WHERE student_id=ANY($1::int[]) AND to_char(date,'YYYY-MM')=$2 AND status='reserved'
      AND fixed_schedule_id IS NULL AND EXTRACT(ISODOW FROM date)=$3
      AND to_char(start AT TIME ZONE 'Asia/Tokyo','HH24:MI')=$4 LIMIT 1`,
        [p.student_ids, month, p.weekday, p.time],
      )
    ).rows;
    if (remaining.length || legacyRemaining.length)
      return { generated: 0, errors: [] };
    const horizon = Math.min(
      ...students.map((s) => Number(s.fixed_months_ahead ?? 1)),
    );
    let generated = 0;
    const errors = [];
    for (let offset = 1; offset <= horizon; offset++) {
      for (const date of occurrenceDates(addMonths(month, offset), p.weekday)) {
        const id = fixedKey('fixed-occurrence-v1', p.id, date);
        const prior = (
          await db('SELECT * FROM fixed_schedule_occurrences WHERE id=$1', [id])
        ).rows[0];
        if (prior) {
          const pending = (
            await db(
              `SELECT 1 FROM monthly_schedule WHERE fixed_occurrence_id=$1 AND calendar_sync_status<>'synced' LIMIT 1`,
              [id],
            )
          ).rows;
          if (pending.length) {
            const e = await sync(db, prior, p, students);
            if (e) errors.push({ date, error: e });
          }
          continue;
        }
        const existing = (
          await db(
            `SELECT event_id,status,fixed_occurrence_id FROM monthly_schedule WHERE student_id=ANY($1::int[])
          AND date=$2::date AND to_char(start AT TIME ZONE 'Asia/Tokyo','HH24:MI')=$3 LIMIT 1`,
            [p.student_ids, date, p.time],
          )
        ).rows;
        // Existing legacy holds or independently booked lessons already reserve this slot.
        if (existing.length) {
          const old = existing[0];
          if (old.status === 'reserved' && !old.fixed_occurrence_id) {
            const legacyRows = await load(db, old.event_id);
            if (
              legacyRows.length === students.length &&
              legacyRows.every((r) =>
                p.student_ids.includes(Number(r.student_id)),
              )
            ) {
              const migrated = await ensureOccurrence(
                db,
                p,
                students,
                date,
                legacyRows[0],
              );
              const e = await sync(db, migrated, p, students);
              if (e) errors.push({ date, error: e });
              else generated++;
            } else
              errors.push({
                date,
                error:
                  'Existing group differs from fixed schedule; review manually',
              });
          }
          continue;
        }
        const start = fixedStart(date, p.time),
          end = new Date(start.getTime() + 50 * 60000);
        // Conflicts are reported, never moved or silently replaced. Future shifts may be absent.
        const overlap = (
          await db(
            `SELECT 1 FROM monthly_schedule WHERE student_id=ANY($1::int[])
          AND status NOT IN ('cancelled','rescheduled') AND start<$3::timestamptz AND "end">$2::timestamptz LIMIT 1`,
            [p.student_ids, start.toISOString(), end.toISOString()],
          )
        ).rows;
        if (overlap.length) {
          errors.push({
            date,
            error: 'Student has an overlapping appointment',
          });
          continue;
        }
        try {
          await checkSlot(db, students, start, end, []);
        } catch (e) {
          if (!e.status) throw e;
          errors.push({ date, error: e.message });
          continue;
        }
        const o = await ensureOccurrence(db, p, students, date);
        const e = await sync(db, o, p, students);
        if (e) errors.push({ date, error: e });
        else generated++;
      }
    }
    await db(
      `UPDATE fixed_schedules SET confirmed_through=CASE WHEN confirmed_through IS NULL OR confirmed_through<$2 THEN $2 ELSE confirmed_through END WHERE id=$1`,
      [p.id, month],
    );
    return { generated, errors };
  }
  async function load(db, eventId) {
    return (
      await db(
        `SELECT m.*, s.name AS canonical_student_name, s.payment AS student_payment,
      s.status AS student_status, s.is_child AS student_is_child
      FROM monthly_schedule m JOIN students s ON s.id=m.student_id
      WHERE m.event_id=$1 ORDER BY COALESCE(m.group_sort_order,2147483647),m.student_id`,
        [eventId],
      )
    ).rows;
  }
  async function setup(req) {
    return locked(async (db) => {
      const {
        student_id,
        month,
        date,
        time,
        location = 'Cafe',
      } = req.body || {};
      if (
        !Number.isInteger(Number(student_id)) ||
        Number(student_id) <= 0 ||
        !validMonth(month)
      )
        throw error('Valid student_id and month required');
      const seedDate =
        date ||
        occurrenceDates(
          month,
          Number(req.body?.weekday) === 0 ? 7 : Number(req.body?.weekday),
        )[0];
      if (
        req.body.duration_minutes != null &&
        Number(req.body.duration_minutes) !== 50
      )
        throw error('Fixed appointments must be exactly 50 minutes');
      fixedStart(seedDate, time);
      let students = await members(db, [Number(student_id)]);
      if (String(students[0].group_type).toLowerCase() === 'group') {
        const link = (
          await db(
            'SELECT group_id FROM student_group_members WHERE student_id=$1 LIMIT 1',
            [Number(student_id)],
          )
        ).rows[0];
        if (link) {
          const group = await getOrderedGroupMembers(link.group_id, db);
          students = await members(
            db,
            group.map((s) => s.id),
          );
        }
      }
      const p = await pattern(db, students, seedDate, time, location);
      const dates = occurrenceDates(month, p.weekday),
        errors = [],
        eventIds = [];
      for (const day of dates) {
        const key = fixedKey('fixed-occurrence-v1', p.id, day);
        const existing = (
          await db('SELECT * FROM fixed_schedule_occurrences WHERE id=$1', [
            key,
          ])
        ).rows[0];
        if (!existing) {
          const start = fixedStart(day, time);
          await checkSlot(
            db,
            students,
            start,
            new Date(start.getTime() + 50 * 60000),
            [],
          );
        }
        const o = await ensureOccurrence(db, p, students, day);
        eventIds.push(o.event_id);
        if (!existing) {
          const e = await sync(db, o, p, students);
          if (e) errors.push({ date: day, error: e });
        }
      }
      return {
        ok: true,
        event_ids: eventIds,
        fixed_schedule_id: p.id,
        calendar_errors: errors,
        warning:
          'Independent appointments created. Staff must remove any old recurring Calendar series manually after checking its history.',
      };
    });
  }
  async function confirm(req) {
    return locked(async (db) => {
      const eventId = String(req.body?.event_id || '').trim();
      const rows = await load(db, eventId);
      if (!rows.length) throw error('Lesson not found', 404);
      const first = rows[0],
        oldRows = cloneRows(rows);
      if (
        (first.status === 'scheduled' && !first.fixed_occurrence_id) ||
        !['reserved', 'scheduled'].includes(first.status)
      )
        throw error(
          'Only reserved/confirmed fixed appointments can be confirmed',
        );
      const local = utcToJstDateAndTime(new Date(first.start)),
        month = local.date.slice(0, 7);
      if (req.body?.confirm_month && req.body.confirm_month !== month)
        throw error('Confirmation month does not match the appointment');
      let students = await members(
        db,
        rows.map((r) => Number(r.student_id)),
      );
      let p = first.fixed_schedule_id
        ? (
            await db('SELECT * FROM fixed_schedules WHERE id=$1', [
              first.fixed_schedule_id,
            ])
          ).rows[0]
        : await pattern(
            db,
            students,
            local.date,
            local.time,
            first.lesson_mode === 'online' ? 'Online' : 'Cafe',
            first.teacher_name,
          );
      let o = first.fixed_occurrence_id
        ? (
            await db('SELECT * FROM fixed_schedule_occurrences WHERE id=$1', [
              first.fixed_occurrence_id,
            ])
          ).rows[0]
        : await ensureOccurrence(db, p, students, local.date, first);
      await checkSlot(db, students, o.start, o.end, [eventId, o.event_id]);
      const pack =
        (await getPackTotalForBooking(
          students[0].id,
          month,
          req.body?.pack_total,
          db,
        )) || occurrenceDates(month, p.weekday).length;
      const rank =
        occurrenceDates(month, p.weekday).indexOf(ymd(o.nominal_date)) + 1;
      const title = buildLessonTitleForOrderedStudents({
        students,
        lessonKind: p.lesson_kind,
        locationLabel: p.location,
        lessonNumber: rank || 1,
        totalLessons: pack,
      });
      o = (
        await db(
          `UPDATE fixed_schedule_occurrences SET status='scheduled',title=$2 WHERE id=$1 RETURNING *`,
          [o.id, title],
        )
      ).rows[0];
      await writeRows(db, o, p, students);
      const syncError = await sync(db, o, p, students);
      const extension = syncError
        ? { generated: 0, errors: [] }
        : await extend(db, p, month, students);
      for (const old of oldRows) {
        const current = (
          await db(
            'SELECT * FROM monthly_schedule WHERE event_id=$1 AND student_id=$2',
            [o.event_id, old.student_id],
          )
        ).rows[0];
        await audit(
          {
            entityType: 'monthly_schedule',
            entityKey: `${o.event_id}_${old.student_name}`,
            action: 'update',
            oldData: old,
            newData: current,
          },
          req,
          { query: db },
        );
      }
      return {
        ok: true,
        event_id: o.event_id,
        new_event_id: o.event_id,
        old_event_id: eventId,
        calendar_sync_status: syncError ? 'failed' : 'synced',
        calendar_sync_error: syncError,
        affected_counters: students.map((s) => ({ student_id: s.id, month })),
        fixed_schedule_id: p.id,
        generated_holds: extension.generated,
        calendar_errors: extension.errors,
        legacy_calendar_untouched: !first.fixed_occurrence_id,
      };
    });
  }
  async function retry(req) {
    return locked(async (db) => {
      const rows = await load(db, req.body?.event_id);
      if (!rows[0]?.fixed_occurrence_id)
        throw error('Independent fixed appointment not found', 404);
      const o = (
        await db('SELECT * FROM fixed_schedule_occurrences WHERE id=$1', [
          rows[0].fixed_occurrence_id,
        ])
      ).rows[0];
      Object.assign(o, {
        title: rows[0].title,
        status: rows[0].status,
        start: rows[0].start,
        end: rows[0].end,
      });
      const p = (
        await db('SELECT * FROM fixed_schedules WHERE id=$1', [o.schedule_id])
      ).rows[0];
      const students = await members(db, p.student_ids);
      const e = await sync(db, o, p, students);
      const extension =
        !e && o.status === 'scheduled'
          ? await extend(
              db,
              p,
              utcToJstDateAndTime(new Date(o.start)).date.slice(0, 7),
              students,
            )
          : null;
      return {
        ok: !e,
        event_id: o.event_id,
        calendar_sync_status: e ? 'failed' : 'synced',
        calendar_sync_error: e,
        extension,
      };
    });
  }
  async function move(req) {
    return locked(async (db) => {
      const eventId = req.body?.event_id || req.body?.source_event_id;
      const rows = await load(db, eventId),
        first = rows[0];
      if (!first?.fixed_occurrence_id)
        throw error('Independent fixed appointment not found', 404);
      const pendingMove =
        first.status === 'rescheduled' && first.awaiting_reschedule_date;
      if (!['reserved', 'scheduled'].includes(first.status) && !pendingMove)
        throw error('Restore this appointment before moving it');
      if (
        req.body.student_id &&
        !rows.some((r) => Number(r.student_id) === Number(req.body.student_id))
      )
        throw error('Student is not part of this appointment', 403);
      const p = (
        await db('SELECT * FROM fixed_schedules WHERE id=$1', [
          first.fixed_schedule_id,
        ])
      ).rows[0];
      const students = await members(db, p.student_ids);
      const start = fixedStart(req.body.date, req.body.time),
        end = new Date(start.getTime() + 50 * 60000);
      await checkSlot(db, students, start, end, [eventId]);
      const o = (
        await db(
          `UPDATE fixed_schedule_occurrences SET start=$2,"end"=$3,title=$4,status=$5 WHERE id=$1 RETURNING *`,
          [
            first.fixed_occurrence_id,
            start.toISOString(),
            end.toISOString(),
            restoreActiveLessonTitle(first.title),
            pendingMove ? 'scheduled' : first.status,
          ],
        )
      ).rows[0];
      await writeRows(db, o, p, students);
      const e = await sync(db, o, p, students);
      for (const old of rows) {
        const current = (
          await db(
            'SELECT * FROM monthly_schedule WHERE event_id=$1 AND student_id=$2',
            [eventId, old.student_id],
          )
        ).rows[0];
        await audit(
          {
            entityType: 'monthly_schedule',
            entityKey: `${eventId}_${old.student_name}`,
            action: 'update',
            oldData: old,
            newData: current,
          },
          req,
          { query: db },
        );
      }
      return {
        ok: true,
        in_place: true,
        event_id: eventId,
        new_event_id: eventId,
        old_event_id: eventId,
        calendar_sync_status: e ? 'failed' : 'synced',
        calendar_sync_error: e,
        affected_counters: students.flatMap((s) => [
          {
            student_id: s.id,
            month: utcToJstDateAndTime(new Date(first.start)).date.slice(0, 7),
          },
          { student_id: s.id, month: req.body.date.slice(0, 7) },
        ]),
      };
    });
  }
  async function retryFuture(req) {
    return locked(async (db) => {
      const sid = Number(req.body?.student_id);
      if (!Number.isInteger(sid) || sid <= 0)
        throw error('Valid student_id required');
      const patterns = (
        await db(
          'SELECT * FROM fixed_schedules WHERE $1=ANY(student_ids) AND confirmed_through IS NOT NULL',
          [sid],
        )
      ).rows;
      const results = [];
      for (const p of patterns)
        results.push(
          await extend(
            db,
            p,
            p.confirmed_through,
            await members(db, p.student_ids),
          ),
        );
      return { ok: true, results };
    });
  }
  const handler = (fn) => async (req, res) => {
    try {
      const result = await fn(req);
      // Counter reconciliation must run after the transaction commits: its
      // Calendar retry worker locks those same lesson rows separately.
      if (result.affected_counters) {
        result.counter_reconciliation = await reconcileCountersForAffectedRows(
          result.affected_counters,
        );
        delete result.affected_counters;
      }
      if (result.ok === false)
        return res
          .status(502)
          .json({
            ...result,
            error: result.calendar_sync_error || 'Calendar sync failed',
          });
      res.json(result);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  };
  return {
    setup,
    confirm,
    retry,
    move,
    retryFuture,
    handleRetryFuture: handler(retryFuture),
    handleCreate: handler(setup),
    handleConfirm: handler(confirm),
    handleRetry: handler(retry),
    handleMove: handler(move),
  };
}
export const individualFixedSchedules = createFixedScheduleService();
