import { calendarWritesEnabled } from '../calendarWritePolicy.js';
import { lessonPackStatusSql, parseLessonPackTotal } from '../lessonMonthCounters.js';
/**
 * Repairs chronological x/y lesson title suffixes. Used after timetable edits
 * and by the daily maintenance job; never changes payment or lesson-pack data.
 */
import { query } from '../../db/index.js';
import {
  getBookedCountForMonth,
  getPackTotalForBooking,
  renumberMonthLessonTitlesForStudent,
} from './domainInternals.js';

function validMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
}

function monthFromRow(row) {
  const explicit = String(row?.month || row?.src_date_str || '').slice(0, 7);
  if (validMonth(explicit)) return explicit;
  const date = row?.date;
  if (typeof date === 'string') {
    const month = date.slice(0, 7);
    return validMonth(month) ? month : null;
  }
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    // PostgreSQL DATE may be returned as a Date at local midnight.
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const key = `${year}-${month}`;
    return validMonth(key) ? key : null;
  }
  return null;
}

async function packTotalForMonth(studentId, month, db) {
  // Explicit monthly lesson count is authoritative. Payment data is the
  // existing fallback; do not replace a paid 4-lesson pack with 2/2 simply
  // because only two future dates have been booked.
  const saved = await db(
    'SELECT lessons FROM lessons WHERE student_id = $1 AND month = $2',
    [studentId, month]
  );
  const configured = Number(saved.rows?.[0]?.lessons) || 0;
  if (configured > 0) return configured;

  const paid = await getPackTotalForBooking(studentId, month, null, db);
  if (paid > 0) return paid;

  const existing = await db(
    `SELECT title FROM monthly_schedule
       WHERE student_id = $1 AND to_char(date, 'YYYY-MM') = $2
         AND LOWER(TRIM(COALESCE(lesson_kind, 'regular'))) <> 'demo'
       ORDER BY date ASC, start ASC`,
    [studentId, month]
  );
  for (const row of existing.rows || []) {
    const total = parseLessonPackTotal(row.title);
    if (total > 0) return total;
  }

  // Imported lessons sometimes have no pack or numbered titles at all.
  return getBookedCountForMonth(studentId, month, db);
}

export async function reconcileStudentMonthCounters(studentId, month, db = query) {
  const sid = Number(studentId);
  if (!Number.isInteger(sid) || sid <= 0 || !validMonth(month)) {
    throw new Error('Valid student_id and YYYY-MM are required to reconcile counters');
  }
  const total = await packTotalForMonth(sid, month, db);
  if (total <= 0) {
    return { student_id: sid, month, checked: false, updated: 0, calendar_patched: 0, calendar_errors: [] };
  }
  const result = await renumberMonthLessonTitlesForStudent(
    sid, month, total, db, { persistPack: false }
  );
  return { student_id: sid, month, checked: true, ...result };
}

/** Reconcile both old and new months after a move, and all students in a group. */
export async function reconcileCountersForAffectedRows(rows, db = query) {
  if (!calendarWritesEnabled()) return { skipped: true, reason: 'calendar_writes_disabled', checked: 0, updated: 0, calendar_patched: 0, errors: [] };
  const pairs = new Map();
  for (const row of rows || []) {
    const studentId = Number(row?.student_id);
    const month = monthFromRow(row);
    if (!Number.isInteger(studentId) || studentId <= 0 || !month) continue;
    pairs.set(`${studentId}:${month}`, { studentId, month });
  }
  const result = { checked: 0, updated: 0, calendar_patched: 0, errors: [] };
  for (const { studentId, month } of pairs.values()) {
    try {
      const current = await reconcileStudentMonthCounters(studentId, month, db);
      if (current.checked) result.checked += 1;
      result.updated += current.updated;
      result.calendar_patched += current.calendar_patched;
      for (const error of current.calendar_errors || []) {
        result.errors.push({ student_id: studentId, month, ...error });
      }
    } catch (error) {
      result.errors.push({ student_id: studentId, month, error: error?.message || String(error) });
    }
  }
  if (result.errors.length) console.error('[lesson-counters] reconciliation errors', result.errors);
  return result;
}

let dailyRunning = false;

/** Daily sweep of all months that still have active, non-demo lesson rows. */
export async function runDailyLessonCounterReconciliation(db = query) {
  if (!calendarWritesEnabled()) return { skipped: true, reason: 'calendar_writes_disabled', checked: 0, updated: 0, calendar_patched: 0, errors: [] };
  if (dailyRunning) return { skipped: true, reason: 'previous run still active' };
  dailyRunning = true;
  try {
    const months = await db(
      `SELECT DISTINCT student_id, to_char(date, 'YYYY-MM') AS month
         FROM monthly_schedule
        WHERE student_id IS NOT NULL
          AND ${lessonPackStatusSql()}
          AND LOWER(TRIM(COALESCE(lesson_kind, 'regular'))) <> 'demo'
        ORDER BY student_id, month`
    );
    const pairs = (months.rows || []).map((r) => ({ student_id: r.student_id, month: r.month }));
    const result = await reconcileCountersForAffectedRows(pairs, db);
    console.log('[lesson-counters] daily reconciliation', {
      student_months: pairs.length,
      checked: result.checked,
      updated: result.updated,
      calendar_patched: result.calendar_patched,
      errors: result.errors.length,
    });
    return result;
  } finally {
    dailyRunning = false;
  }
}
