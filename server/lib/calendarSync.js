/**
 * Shared logic for syncing MonthlySchedule data to PostgreSQL.
 * Used by both /api/calendar-poll/sync (from GAS) and /api/calendar-poll/sync-from-sheet (from Google Sheets API).
 */
import { query } from '../db/index.js';

/**
 * Delete rows for a calendar event removed at source. DB event_id is raw Google id or raw + _date + _time.
 * @param {string} studentName
 * @param {string} rawEventId
 */
export async function deleteMonthlyScheduleByRawEvent(studentName, rawEventId) {
  const sn = (studentName || '').trim();
  const rid = (rawEventId || '').trim();
  if (!sn || !rid) return 0;
  const result = await query(
    `DELETE FROM monthly_schedule
     WHERE student_name = $1
       AND COALESCE(calendar_sync_status, 'synced') = 'synced'
       AND (event_id = $2 OR starts_with(event_id, $2 || '_'))`,
    [sn, rid]
  );
  return result.rowCount ?? 0;
}

/**
 * Upsert schedule rows into monthly_schedule. Returns { upserted, months }.
 * @param {Array<{eventID?: string, event_id?: string, title?: string, date?: string, start?: string, end?: string, status?: string, studentName?: string, student_name?: string, isKidsLesson?: boolean, is_kids_lesson?: boolean, teacherName?: string, teacher_name?: string, lessonKind?: string, lesson_kind?: string, lessonMode?: string, lesson_mode?: string}>} data
 */
const LESSON_KIND_VALID = { regular: true, demo: true, owner: true };
const LESSON_MODE_VALID = { cafe: true, online: true, unknown: true };

function normalizeLessonKind(val) {
  if (val == null || val === '') return 'regular';
  const v = String(val).trim().toLowerCase();
  return LESSON_KIND_VALID[v] ? v : 'regular';
}

function parseLessonModeFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/\bcafe\b|カフェ/.test(t)) return 'cafe';
  if (/\bonline\b|オンライン|\bzoom\b|ズーム|\bmeet\b/.test(t)) return 'online';
  return 'unknown';
}

function normalizeLessonMode(val, title, location) {
  if (val != null && val !== '') {
    const v = String(val).trim().toLowerCase();
    if (LESSON_MODE_VALID[v]) return v;
  }
  const byLocation = parseLessonModeFromText(location);
  if (byLocation !== 'unknown') return byLocation;
  return parseLessonModeFromText(title);
}

/** Normalize name for matching: trim and collapse internal spaces */
function normalizeName(s) {
  if (s == null || typeof s !== 'string') return '';
  return s.trim().replace(/\s+/g, ' ');
}

/**
 * Parse a date+time string as Asia/Tokyo and return ISO string in UTC.
 * Source data (CSV, Sheets, GAS) is Japan-facing; we store UTC in the DB.
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} timePart - HH or H:MM from regex
 * @returns {string|null} ISO timestamp in UTC, or null if invalid
 */
function parseTokyoToUTC(dateStr, hour, minute) {
  if (!dateStr || hour == null || minute == null) return null;
  const isoTokyo = `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`;
  const d = new Date(isoTokyo);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Build map: normalized student name -> student id (only when exactly one student has that name).
 * @returns {Promise<Map<string, number>>}
 */
async function buildStudentNameToIdMap() {
  const result = await query('SELECT id, name FROM students');
  const byName = new Map(); // normalized -> [id, id, ...]
  for (const row of result.rows) {
    const name = normalizeName(row.name);
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(row.id);
  }
  const singleMatch = new Map();
  for (const [name, ids] of byName) {
    if (ids.length === 1) singleMatch.set(name, ids[0]);
  }
  return singleMatch;
}

/**
 * @param {Array<Record<string, unknown>>} data
 * @returns {Promise<{ rows: Array<Record<string, unknown>>, months: Set<string>, incomingKeys: Set<string> }>}
 */
async function buildMonthlyScheduleRows(data) {
  const nameToId = await buildStudentNameToIdMap();
  const months = new Set();
  const rows = [];

  for (const r of data) {
    const rawEventId = (r.eventID || r.event_id || '').toString().trim();
    const studentName = (r.studentName || r.student_name || '').toString().trim();
    if (!rawEventId || !studentName) continue;

    const dateStr = (r.date || '').toString().trim();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : null;

    let startTs = null;
    const startVal = r.start || '';
    if (startVal && date) {
      const m = String(startVal).trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/);
      if (m) {
        startTs = parseTokyoToUTC(`${m[1]}-${m[2]}-${m[3]}`, m[4], m[5]);
      }
      if (!startTs) {
        const d = new Date(startVal);
        if (!isNaN(d.getTime())) startTs = d.toISOString();
      }
    } else if (startVal) {
      const d = new Date(startVal);
      if (!isNaN(d.getTime())) startTs = d.toISOString();
    }

    let endTs = null;
    const endVal = r.end || '';
    if (endVal && date) {
      const m = String(endVal).trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/);
      if (m) {
        endTs = parseTokyoToUTC(`${m[1]}-${m[2]}-${m[3]}`, m[4], m[5]);
      }
      if (!endTs) {
        const d = new Date(endVal);
        if (!isNaN(d.getTime())) endTs = d.toISOString();
      }
    } else if (endVal) {
      const d = new Date(endVal);
      if (!isNaN(d.getTime())) endTs = d.toISOString();
    }

    // Derive date from start/end when missing (handles GAS sending same ID for different occurrences)
    let resolvedDate = date;
    if (!resolvedDate && startVal) {
      const d = new Date(startVal);
      if (!isNaN(d.getTime())) resolvedDate = d.toISOString().slice(0, 10);
    }
    if (!resolvedDate && endVal) {
      const d = new Date(endVal);
      if (!isNaN(d.getTime())) resolvedDate = d.toISOString().slice(0, 10);
    }
    if (resolvedDate && /^\d{4}-\d{2}/.test(resolvedDate)) months.add(resolvedDate.slice(0, 7));

    const status = (r.status || 'scheduled').toString().trim() || 'scheduled';
    const isKids = (r.isKidsLesson || r.is_kids_lesson || '') === '子' ||
      r.isKidsLesson === true || r.is_kids_lesson === true;
    const title = (r.title || '').toString().trim();
    const teacherName = (r.teacherName || r.teacher_name || '').toString().trim();
    const lessonKind = normalizeLessonKind(r.lessonKind ?? r.lesson_kind);
    const lessonMode = normalizeLessonMode(
      r.lessonMode ?? r.lesson_mode,
      title,
      r.location ?? r.Location ?? r.lessonLocation ?? r.lesson_location ?? ''
    );

    // Append date and optionally time so same rawEventId + same day + different times = unique rows
    let eventId;
    if (resolvedDate && startTs) {
      const timeSuffix = startTs.slice(11, 19).replace(/:/g, '-'); // HH-mm-ss
      eventId = `${rawEventId}_${resolvedDate}_${timeSuffix}`;
    } else if (resolvedDate) {
      eventId = `${rawEventId}_${resolvedDate}`;
    } else {
      eventId = `${rawEventId}_${rows.length}`;
    }

    const studentId = nameToId.get(normalizeName(studentName)) ?? null;
    rows.push({ eventId, title, date: resolvedDate || date, startTs, endTs, status, studentName, isKids, teacherName, lessonKind, lessonMode, studentId });
  }

  const incomingKeys = new Set(rows.map((row) => `${row.eventId}\t${row.studentName}`));
  return { rows, months, incomingKeys };
}

/**
 * Drop DB rows in each month that are not present in the incoming snapshot (calendar deleted / no longer in GAS cache).
 * @param {Set<string>} months - YYYY-MM
 * @param {Set<string>} incomingKeys - `${eventId}\t${studentName}`
 */
async function reconcileMonthsToSnapshot(months, incomingKeys) {
  let deleted = 0;
  for (const ym of months) {
    const existing = await query(
      `SELECT event_id, student_name FROM monthly_schedule
       WHERE date IS NOT NULL
         AND to_char(date, 'YYYY-MM') = $1
         AND COALESCE(calendar_sync_status, 'synced') = 'synced'`,
      [ym]
    );
    for (const r of existing.rows || []) {
      const k = `${r.event_id}\t${r.student_name}`;
      if (!incomingKeys.has(k)) {
        await query('DELETE FROM monthly_schedule WHERE event_id = $1 AND student_name = $2', [
          r.event_id,
          r.student_name,
        ]);
        deleted++;
      }
    }
  }
  return deleted;
}

/**
 * @param {Array<{ eventID?: string, event_id?: string, studentName?: string, student_name?: string }>} removed
 */
async function applyRemovedFromPoll(removed) {
  let n = 0;
  if (!Array.isArray(removed)) return n;
  for (const item of removed) {
    const raw = (item?.eventID ?? item?.event_id ?? '').toString().trim();
    const sn = (item?.studentName ?? item?.student_name ?? '').toString().trim();
    if (!raw || !sn) continue;
    n += await deleteMonthlyScheduleByRawEvent(sn, raw);
  }
  return n;
}

/**
 * @param {Array<Record<string, unknown>>} data
 * @param {{ removed?: Array<{ eventID?: string, event_id?: string, studentName?: string, student_name?: string }>, reconcile?: boolean }} [options] - reconcile: delete DB rows in snapshot months not in `data` (default true).
 */
export async function upsertMonthlySchedule(data, options = {}) {
  const { removed = [], reconcile = true } = options;
  await applyRemovedFromPoll(removed);

  const { rows, months, incomingKeys } = await buildMonthlyScheduleRows(Array.isArray(data) ? data : []);
  let deletedOrphans = 0;
  if (reconcile && months.size > 0) {
    deletedOrphans = await reconcileMonthsToSnapshot(months, incomingKeys);
  }

  let upserted = 0;
  for (const { eventId, title, date, startTs, endTs, status, studentName, isKids, teacherName, lessonKind, lessonMode, studentId } of rows) {
    // When using new-format id (with time), remove legacy row with same rawEventId+date but no time
    if (date && /_\d{2}-\d{2}-\d{2}$/.test(eventId)) {
      const oldFormatId = eventId.replace(/_\d{2}-\d{2}-\d{2}$/, '');
      await query(
        `DELETE FROM monthly_schedule WHERE event_id = $1 AND student_name = $2 AND to_char(date, 'YYYY-MM') = $3`,
        [oldFormatId, studentName, date.slice(0, 7)]
      );
    }
    await query(
      `INSERT INTO monthly_schedule
        (event_id, title, date, start, "end", status, student_name, is_kids_lesson, teacher_name, lesson_kind, lesson_mode, student_id,
         calendar_sync_status, calendar_sync_error, calendar_synced_at, awaiting_reschedule_date,
         reschedule_snapshot_to_date, reschedule_snapshot_to_time, reschedule_snapshot_from_date, reschedule_snapshot_from_time)
       VALUES ($1, $2, $3::date, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10, $11, $12, 'synced', NULL, NOW(), FALSE,
         NULL, NULL, NULL, NULL)
       ON CONFLICT (event_id, student_name) DO UPDATE SET
         title = EXCLUDED.title, date = EXCLUDED.date, start = EXCLUDED.start, "end" = EXCLUDED."end",
         status = EXCLUDED.status, is_kids_lesson = EXCLUDED.is_kids_lesson, teacher_name = EXCLUDED.teacher_name, lesson_kind = EXCLUDED.lesson_kind, lesson_mode = EXCLUDED.lesson_mode, student_id = EXCLUDED.student_id,
         calendar_sync_status = EXCLUDED.calendar_sync_status, calendar_sync_error = EXCLUDED.calendar_sync_error, calendar_synced_at = EXCLUDED.calendar_synced_at,
         awaiting_reschedule_date = monthly_schedule.awaiting_reschedule_date,
         reschedule_snapshot_to_date = monthly_schedule.reschedule_snapshot_to_date,
         reschedule_snapshot_to_time = monthly_schedule.reschedule_snapshot_to_time,
         reschedule_snapshot_from_date = monthly_schedule.reschedule_snapshot_from_date,
         reschedule_snapshot_from_time = monthly_schedule.reschedule_snapshot_from_time`,
      [eventId, title, date, startTs, endTs, status, studentName, isKids, teacherName, lessonKind, lessonMode, studentId]
    );
    upserted++;
  }

  return {
    upserted,
    months: Array.from(months),
    deletedOrphans,
    removedRows: Array.isArray(removed) ? removed.length : 0,
  };
}
