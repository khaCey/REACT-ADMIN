import { upsertFixedCalendarEvent } from '../fixedScheduleCalendar.js';
/** Retry styling of an existing Calendar event; never create a replacement event. */
import { pool } from '../../db/index.js';
import { bookingEventColorId, isBookingGasEnabled, updateBookedLessonEventInGas } from '../bookingCalendarSync.js';
import { calendarGasOptions, shouldSkipAmbiguousRecurringForRows } from './domainInternals.js';

export const CALENDAR_STYLE_ERROR_PREFIX = '[calendar-style] ';
export function needsCalendarStyleRetry(row) {
  return String(row?.calendar_sync_error || '').startsWith(CALENDAR_STYLE_ERROR_PREFIX);
}

export async function queueLessonCalendarStyle(db, eventId, previousRows) {
  if (!isBookingGasEnabled() || String(eventId).startsWith('local-booking-')) return false;
  if (!previousRows.some((row) => String(row.calendar_sync_status || 'synced') === 'synced' || needsCalendarStyleRetry(row))) return false;
  if (await shouldSkipAmbiguousRecurringForRows(eventId, previousRows, db)) return false;
  await db(`UPDATE monthly_schedule SET calendar_sync_status = 'failed', calendar_sync_error = $2
    WHERE event_id = $1`, [eventId, CALENDAR_STYLE_ERROR_PREFIX + 'Pending Calendar update']);
  return true;
}

export async function syncLessonCalendarStyle(eventId, previousRows = null) {
  if (!isBookingGasEnabled()) return {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const db = client.query.bind(client);
    const rows = (await db('SELECT * FROM monthly_schedule WHERE event_id = $1 FOR UPDATE', [eventId])).rows;
    if (!rows.length || String(eventId).startsWith('local-booking-')) return {};
    const eligible = previousRows || rows;
    if (!eligible.some((row) => String(row.calendar_sync_status || 'synced') === 'synced' || needsCalendarStyleRetry(row))) return {};
    if (await shouldSkipAmbiguousRecurringForRows(eventId, rows, db)) {
      return {}; // Never risk styling a recurring series master as one occurrence.
    }
    const row = rows[0];
    const inactive = ['cancelled', 'rescheduled'].includes(String(row.status || '').trim().toLowerCase());
    const color = inactive ? '8' : bookingEventColorId(row.lesson_kind || 'regular');
    let error = null;
    try {
      const result = row.fixed_occurrence_id
        ? await upsertFixedCalendarEvent({
          eventId: String(row.calendar_source_event_id || '').match(/^fs[0-9a-f]{64}/)?.[0],
          occurrenceId: row.fixed_occurrence_id, scheduleId: row.fixed_schedule_id,
          status: row.status, title: row.title,
          start: new Date(row.start).toISOString(), end: new Date(row.end).toISOString(),
          lessonKind: row.lesson_kind || 'regular',
          location: row.lesson_mode === 'online' ? 'Online' : 'Cafe', colorId: color,
        })
        : await updateBookedLessonEventInGas(eventId, {
        title: row.title,
        ...(row.start ? { startIso: new Date(row.start).toISOString() } : {}),
        ...(row.end ? { endIso: new Date(row.end).toISOString() } : {}),
        ...(color ? { colorId: color } : { clearColor: true }),
        mergeStudentAdminDescription: { awaiting_reschedule_date: !!row.awaiting_reschedule_date },
      }, calendarGasOptions(rows));
      if (!result.ok) error = result.error || 'Calendar update failed';
    } catch (err) {
      error = err?.message || String(err);
    }
    const status = error ? 'failed' : 'synced';
    const savedError = error ? CALENDAR_STYLE_ERROR_PREFIX + error : null;
    await db(`UPDATE monthly_schedule SET calendar_sync_status = $2::varchar, calendar_sync_error = $3,
      calendar_sync_attempted_at = NOW(),
      calendar_synced_at = CASE WHEN $2::varchar = 'synced' THEN NOW() ELSE calendar_synced_at END
      WHERE event_id = $1`, [eventId, status, savedError]);
    await db('COMMIT');
    return { calendar_sync_status: status, calendar_sync_error: savedError };
  } finally {
    try { await client.query('ROLLBACK'); } catch {}
    client.release();
  }
}
