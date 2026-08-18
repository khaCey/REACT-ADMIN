/**
 * Shared logic for syncing MonthlySchedule data to PostgreSQL.
 * Used by both /api/calendar-poll/sync (from GAS) and /api/calendar-poll/sync-from-sheet (from Google Sheets API).
 */
import { query } from '../db/index.js';
import { GOOGLE_INSTANCE_SUFFIX_RE } from './calendarEventId.js';
import { utcToJstDateAndTime } from './timezone.js';
import { upsertDemoLessonEvent } from './demoLessonEvents.js';

/** Appended in buildMonthlyScheduleRows: _YYYY-MM-DD or _YYYY-MM-DD_HH-mm-ss */
const OUR_DISAMBIGUATION_SUFFIX_RE = /_\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?$/;

function isPrecisePollEventKey(eventId) {
  const id = String(eventId || '').trim();
  return OUR_DISAMBIGUATION_SUFFIX_RE.test(id) || GOOGLE_INSTANCE_SUFFIX_RE.test(id);
}

/**
 * Delete rows for a calendar event removed at source. Never prefix-delete on a bare series master id
 * (that removed every recurring occurrence for the student) unless lessonDate scopes to one calendar day.
 * @param {string} studentName
 * @param {string} rawEventId
 * @param {string|null} [lessonDate] - YYYY-MM-DD from poll removed key (optional)
 */
export async function deleteMonthlyScheduleByRawEvent(studentName, rawEventId, lessonDate = null) {
  const sn = (studentName || '').trim();
  const rid = (rawEventId || '').trim();
  const ld =
    lessonDate && /^\d{4}-\d{2}-\d{2}$/.test(String(lessonDate).trim()) ? String(lessonDate).trim() : null;
  if (!sn || !rid) return 0;

  let matchSql;
  /** @type {unknown[]} */
  const params = [sn, rid];
  if (isPrecisePollEventKey(rid)) {
    matchSql = `(ms.event_id = $2 OR TRIM(ms.calendar_source_event_id) = $2)`;
  } else if (ld) {
    matchSql = `(
      (TRIM(ms.calendar_source_event_id) = $2 AND to_char(ms.date, 'YYYY-MM-DD') = $3)
      OR (ms.event_id = $2 AND to_char(ms.date, 'YYYY-MM-DD') = $3)
    )`;
    params.push(ld);
  } else {
    matchSql = `(
         ms.event_id = $2
         OR (
           TRIM(ms.calendar_source_event_id) = $2
           AND 1 = (
             SELECT COUNT(*)::int
             FROM monthly_schedule m2
             WHERE m2.student_name = $1
               AND TRIM(m2.calendar_source_event_id) = $2
               AND COALESCE(m2.calendar_sync_status, 'synced') = 'synced'
           )
         )
       )`;
  }

  let dateExtra = '';
  if (ld && isPrecisePollEventKey(rid)) {
    params.push(ld);
    dateExtra = ` AND to_char(ms.date, 'YYYY-MM-DD') = $${params.length}`;
  }

  const result = await query(
    `DELETE FROM monthly_schedule ms
     WHERE ms.student_name = $1
       AND COALESCE(ms.calendar_sync_status, 'synced') = 'synced'
       AND ${matchSql}${dateExtra}
       AND NOT EXISTS (
         SELECT 1 FROM reschedules rs
         WHERE TRIM(rs.from_event_id) = TRIM(ms.event_id)
           AND REGEXP_REPLACE(TRIM(rs.from_student_name), '\\s+', ' ', 'g')
             = REGEXP_REPLACE(TRIM(ms.student_name), '\\s+', ' ', 'g')
       )`,
    params
  );
  return result.rowCount ?? 0;
}

/**
 * Upsert schedule rows into monthly_schedule. Returns { upserted, months }.
 * @param {Array<{eventID?: string, event_id?: string, title?: string, date?: string, start?: string, end?: string, status?: string, studentName?: string, student_name?: string, isKidsLesson?: boolean, is_kids_lesson?: boolean, teacherName?: string, teacher_name?: string, lessonKind?: string, lesson_kind?: string, lessonMode?: string, lesson_mode?: string}>} data
 */
const LESSON_KIND_VALID = { regular: true, demo: true, owner: true };
const LESSON_MODE_VALID = { cafe: true, online: true, unknown: true };

/** Ignore GAS rows longer than this (all-day / multi-day spans); sync lesson-length events only. */
const MAX_LESSON_DURATION_MS = 60 * 60 * 1000;

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

/** GAS poll statuses (see Calendar API MonthlyCache / docs). Unknown values fall back to scheduled. */
const SCHEDULE_STATUS_VALID = {
  scheduled: true,
  cancelled: true,
  reserved: true,
  rescheduled: true,
  demo: true,
  unscheduled: true,
};

function normalizeScheduleStatus(raw) {
  const s = String(raw || 'scheduled')
    .trim()
    .toLowerCase() || 'scheduled';
  return SCHEDULE_STATUS_VALID[s] ? s : 'scheduled';
}

/**
 * @param {Record<string, unknown>} r - poll row
 * @returns {boolean|null} null = poll did not specify (preserve DB on upsert)
 */
function parseAwaitingReschedulePollMerge(r) {
  const hasCamel = Object.prototype.hasOwnProperty.call(r, 'awaitingRescheduleDate');
  const hasSnake = Object.prototype.hasOwnProperty.call(r, 'awaiting_reschedule_date');
  if (!hasCamel && !hasSnake) return null;
  const v = hasCamel ? r.awaitingRescheduleDate : r.awaiting_reschedule_date;
  if (v === true || v === 1 || v === '1') return true;
  if (v === false || v === 0 || v === '0') return false;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'true') return true;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'false') return false;
  return null;
}

/** Normalize name for matching: trim and collapse internal spaces */
function normalizeName(s) {
  if (s == null || typeof s !== 'string') return '';
  return s.trim().replace(/\s+/g, ' ');
}

/** Match reconcile candidates when event_id string changed but lesson instant did not (recurring id churn). */
export function lessonSlotKey(studentName, startIso) {
  if (!studentName || !startIso) return null;
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return null;
  const jst = utcToJstDateAndTime(d);
  if (!jst) return null;
  const timeSuffix = d.toISOString().slice(11, 19).replace(/:/g, '-');
  return `${normalizeName(studentName)}\t${jst.date}\t${timeSuffix}`;
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
 * @returns {Promise<{ rows: Array<Record<string, unknown>>, months: Set<string>, incomingKeys: Set<string>, incomingSlotKeys: Set<string> }>}
 */
/**
 * Slots staff dismissed in-app (Calendar already empty); poll upserts must not recreate them.
 * @param {Set<string>} months - YYYY-MM
 * @returns {Promise<Set<string>>} keys from lessonSlotKey
 */
async function loadDismissedSlotKeysForMonths(months) {
  const ymList = [...(months || [])].filter((m) => /^\d{4}-\d{2}$/.test(String(m)));
  if (ymList.length === 0) return new Set();
  try {
    const result = await query(
      `SELECT student_name, lesson_date, start_time_utc
         FROM schedule_slot_dismissals
        WHERE to_char(lesson_date, 'YYYY-MM') = ANY($1::text[])`,
      [ymList]
    );
    const keys = new Set();
    for (const row of result.rows || []) {
      const startIso =
        row.start_time_utc instanceof Date
          ? row.start_time_utc.toISOString()
          : new Date(row.start_time_utc).toISOString();
      const k = lessonSlotKey(row.student_name, startIso);
      if (k) keys.add(k);
    }
    return keys;
  } catch (err) {
    // Table may not exist until migration runs; do not block poll sync.
    if (String(err?.message || '').includes('schedule_slot_dismissals')) {
      return new Set();
    }
    throw err;
  }
}

/**
 * Record that a lesson slot was removed in-app and must not be recreated by calendar poll.
 * @param {Array<{ student_name?: string, date?: Date|string, start?: Date|string }>} rows
 */
export async function recordScheduleSlotDismissals(rows) {
  for (const row of rows || []) {
    const studentName = normalizeName(row.student_name);
    const dateVal = row.date;
    const startVal = row.start;
    if (!studentName || !dateVal || !startVal) continue;
    const dateStr =
      dateVal instanceof Date
        ? dateVal.toISOString().slice(0, 10)
        : String(dateVal).trim().slice(0, 10);
    const startDate = startVal instanceof Date ? startVal : new Date(startVal);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || Number.isNaN(startDate.getTime())) continue;
    try {
      await query(
        `INSERT INTO schedule_slot_dismissals (student_name, lesson_date, start_time_utc)
         VALUES ($1, $2::date, $3::timestamptz)
         ON CONFLICT (student_name, lesson_date, start_time_utc) DO NOTHING`,
        [studentName, dateStr, startDate.toISOString()]
      );
    } catch (err) {
      if (String(err?.message || '').includes('schedule_slot_dismissals')) {
        console.warn('[calendarSync] schedule_slot_dismissals missing; run server/db/add_schedule_slot_dismissals.sql');
        return;
      }
      throw err;
    }
  }
}

/**
 * Clear dismissals so an explicit "Add to local" can recreate the slot.
 * @param {Array<{ studentName?: string, student_name?: string, date?: string, startTs?: string, start?: Date|string }>} rows
 */
export async function clearScheduleSlotDismissals(rows) {
  for (const row of rows || []) {
    const studentName = normalizeName(row.studentName ?? row.student_name);
    const dateVal = row.date;
    const startVal = row.startTs ?? row.start;
    if (!studentName || !dateVal || !startVal) continue;
    const dateStr =
      dateVal instanceof Date
        ? dateVal.toISOString().slice(0, 10)
        : String(dateVal).trim().slice(0, 10);
    const startDate = startVal instanceof Date ? startVal : new Date(startVal);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || Number.isNaN(startDate.getTime())) continue;
    try {
      await query(
        `DELETE FROM schedule_slot_dismissals
          WHERE REGEXP_REPLACE(TRIM(student_name), '\\s+', ' ', 'g')
              = REGEXP_REPLACE(TRIM($1::text), '\\s+', ' ', 'g')
            AND lesson_date = $2::date
            AND start_time_utc = $3::timestamptz`,
        [studentName, dateStr, startDate.toISOString()]
      );
    } catch (err) {
      if (String(err?.message || '').includes('schedule_slot_dismissals')) {
        return;
      }
      throw err;
    }
  }
}

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

    // Derive date from start/end when missing (handles GAS sending same ID for different occurrences).
    // Use Japan calendar date, not UTC yyyy-mm-dd — otherwise Wednesday 10:00 JST becomes Tuesday UTC and
    // event_id disagrees with DB / prior syncs → reconcile deletes "orphan" rows that still exist on Calendar.
    let resolvedDate = date;
    if (!resolvedDate && startVal) {
      const d = new Date(startVal);
      if (!isNaN(d.getTime())) {
        const jst = utcToJstDateAndTime(d);
        if (jst) resolvedDate = jst.date;
      }
    }
    if (!resolvedDate && endVal) {
      const d = new Date(endVal);
      if (!isNaN(d.getTime())) {
        const jst = utcToJstDateAndTime(d);
        if (jst) resolvedDate = jst.date;
      }
    }

    if (startTs && endTs) {
      const durMs = new Date(endTs).getTime() - new Date(startTs).getTime();
      if (Number.isFinite(durMs) && durMs > MAX_LESSON_DURATION_MS) {
        continue;
      }
    }

    if (resolvedDate && /^\d{4}-\d{2}/.test(resolvedDate)) months.add(resolvedDate.slice(0, 7));

    const title = (r.title || '').toString().trim();
    // Prefer title markers over poll color→status (GAS once mapped graphite to cancelled, and
    // only recognized legacy [RESCHEDULED] — not "Moved to/from").
    let status = normalizeScheduleStatus(r.status != null && r.status !== '' ? r.status : 'scheduled');
    if (
      /Moved\s+(to|from)\s+(\?{3}|\d{1,2}(?:st|nd|rd|th))/i.test(title) ||
      /\[RESCHEDULED\]/i.test(title)
    ) {
      status = 'rescheduled';
    }
    const isKids = (r.isKidsLesson || r.is_kids_lesson || '') === '子' ||
      r.isKidsLesson === true || r.is_kids_lesson === true;
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
    const awaitingReschedulePollMerge = parseAwaitingReschedulePollMerge(r);
    rows.push({
      eventId,
      calendarSourceEventId: rawEventId,
      title,
      date: resolvedDate || date,
      startTs,
      endTs,
      status,
      studentName,
      isKids,
      teacherName,
      lessonKind,
      lessonMode,
      studentId,
      awaitingReschedulePollMerge,
    });
  }

  const incomingKeys = new Set(rows.map((row) => `${row.eventId}\t${row.studentName}`));
  const incomingSlotKeys = new Set();
  for (const row of rows) {
    const sk = lessonSlotKey(row.studentName, row.startTs);
    if (sk) incomingSlotKeys.add(sk);
  }
  return { rows, months, incomingKeys, incomingSlotKeys };
}

/**
 * Drop DB rows in each month that are not present in the incoming snapshot (calendar deleted / no longer in GAS cache).
 * @param {Set<string>} months - YYYY-MM
 * @param {Set<string>} incomingKeys - `${eventId}\t${studentName}`
 * @param {Set<string>} incomingSlotKeys - student+JST date+UTC HH-mm-ss from start (see lessonSlotKey)
 * @param {Set<string>|null} [onlyKeys] - when set, only delete these `${eventId}\t${studentName}` rows (still must be orphans)
 */
async function reconcileMonthsToSnapshot(months, incomingKeys, incomingSlotKeys, onlyKeys = null) {
  let deleted = 0;
  for (const ym of months) {
    const existing = await query(
      `SELECT ms.event_id, ms.student_name, ms.start
       FROM monthly_schedule ms
       WHERE ms.date IS NOT NULL
         AND to_char(ms.date, 'YYYY-MM') = $1
         AND COALESCE(ms.calendar_sync_status, 'synced') = 'synced'`,
      [ym]
    );
    for (const r of existing.rows || []) {
      const k = `${r.event_id}\t${r.student_name}`;
      if (onlyKeys && !onlyKeys.has(k)) {
        continue;
      }
      if (incomingKeys.has(k)) {
        continue;
      }
      const slot = lessonSlotKey(r.student_name, r.start);
      if (slot && incomingSlotKeys.has(slot)) {
        continue;
      }
      const block = await query(
        `SELECT 1 FROM reschedules rs
           WHERE TRIM(rs.from_event_id) = TRIM($1::text)
             AND REGEXP_REPLACE(TRIM(rs.from_student_name), '\\s+', ' ', 'g')
               = REGEXP_REPLACE(TRIM($2::text), '\\s+', ' ', 'g')
           LIMIT 1`,
        [r.event_id, r.student_name]
      );
      if ((block.rows || []).length > 0) {
        continue;
      }
      await query('DELETE FROM monthly_schedule WHERE event_id = $1 AND student_name = $2', [
        r.event_id,
        r.student_name,
      ]);
      deleted++;
    }
  }
  return deleted;
}

function mapCompareLessonRow(row) {
  const startIso =
    row.startTs ||
    (row.start instanceof Date
      ? row.start.toISOString()
      : row.start
        ? new Date(row.start).toISOString()
        : null);
  const endIso =
    row.endTs ||
    (row.end instanceof Date
      ? row.end.toISOString()
      : row.end
        ? new Date(row.end).toISOString()
        : null);
  const date =
    row.date instanceof Date
      ? row.date.toISOString().slice(0, 10)
      : row.date
        ? String(row.date).slice(0, 10)
        : null;
  return {
    event_id: row.eventId || row.event_id || null,
    student_name: row.studentName || row.student_name || null,
    title: row.title || null,
    date,
    start: startIso,
    end: endIso,
    teacher_name: row.teacherName || row.teacher_name || null,
    lesson_kind: row.lessonKind || row.lesson_kind || null,
    status: row.status || null,
  };
}

/**
 * Compare GAS month snapshot to local synced monthly_schedule rows.
 * Missing = on Calendar, not local. Disappeared = local synced, not on Calendar.
 * @param {Array<Record<string, unknown>>} data
 * @param {string} month YYYY-MM
 */
export async function compareMonthSchedule(data, month) {
  const ym = String(month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    throw new Error('month must be YYYY-MM');
  }
  const { rows, incomingKeys, incomingSlotKeys } = await buildMonthlyScheduleRows(
    Array.isArray(data) ? data : []
  );
  const calendarRows = rows.filter((r) => r.date && String(r.date).slice(0, 7) === ym);

  const existing = await query(
    `SELECT ms.event_id, ms.student_name, ms.title, ms.date, ms.start, ms."end",
            ms.teacher_name, ms.lesson_kind, ms.status
       FROM monthly_schedule ms
      WHERE ms.date IS NOT NULL
        AND to_char(ms.date, 'YYYY-MM') = $1
        AND COALESCE(ms.calendar_sync_status, 'synced') = 'synced'
      ORDER BY ms.start ASC NULLS LAST, ms.student_name ASC`,
    [ym]
  );
  const localRows = existing.rows || [];
  const localKeys = new Set(localRows.map((r) => `${r.event_id}\t${r.student_name}`));
  const localSlotKeys = new Set();
  for (const r of localRows) {
    const sk = lessonSlotKey(r.student_name, r.start);
    if (sk) localSlotKeys.add(sk);
  }
  const dismissedSlotKeys = await loadDismissedSlotKeysForMonths(new Set([ym]));

  const missingKeys = new Set();
  const missing = [];
  for (const row of calendarRows) {
    const k = `${row.eventId}\t${row.studentName}`;
    if (localKeys.has(k)) continue;
    const slot = lessonSlotKey(row.studentName, row.startTs);
    if (slot && localSlotKeys.has(slot)) continue;
    const dismissed = !!(slot && dismissedSlotKeys.has(slot));
    const mapped = {
      ...mapCompareLessonRow(row),
      source: 'calendar_only',
      dismissed,
    };
    missing.push(mapped);
    missingKeys.add(k);
    if (slot) missingKeys.add(`slot:${slot}`);
  }

  const disappearedKeys = new Set();
  const disappeared = [];
  for (const r of localRows) {
    const k = `${r.event_id}\t${r.student_name}`;
    if (incomingKeys.has(k)) continue;
    const slot = lessonSlotKey(r.student_name, r.start);
    if (slot && incomingSlotKeys.has(slot)) continue;
    const block = await query(
      `SELECT 1 FROM reschedules rs
         WHERE TRIM(rs.from_event_id) = TRIM($1::text)
           AND REGEXP_REPLACE(TRIM(rs.from_student_name), '\\s+', ' ', 'g')
             = REGEXP_REPLACE(TRIM($2::text), '\\s+', ' ', 'g')
         LIMIT 1`,
      [r.event_id, r.student_name]
    );
    if ((block.rows || []).length > 0) continue;
    const mapped = { ...mapCompareLessonRow(r), source: 'local_only' };
    disappeared.push(mapped);
    disappearedKeys.add(k);
  }

  const calendar = calendarRows.map((row) => {
    const k = `${row.eventId}\t${row.studentName}`;
    const slot = lessonSlotKey(row.studentName, row.startTs);
    const only = missingKeys.has(k) || (slot && missingKeys.has(`slot:${slot}`));
    return {
      ...mapCompareLessonRow(row),
      source: only ? 'calendar_only' : 'both',
    };
  });

  const local = localRows.map((r) => {
    const k = `${r.event_id}\t${r.student_name}`;
    return {
      ...mapCompareLessonRow(r),
      source: disappearedKeys.has(k) ? 'local_only' : 'both',
    };
  });

  return {
    month: ym,
    fetched: Array.isArray(data) ? data.length : 0,
    calendarCount: calendarRows.length,
    localCount: localRows.length,
    calendar,
    local,
    missing,
    disappeared,
    calendar_only: missing,
    local_only: disappeared,
  };
}

/**
 * Delete local synced rows for a month that are missing from the Calendar snapshot.
 * @param {Array<Record<string, unknown>>} data
 * @param {string} month YYYY-MM
 * @param {{ onlyKeys?: Set<string> | string[] }} [options]
 *   onlyKeys: optional `${eventId}\\t${studentName}` allowlist — delete only those orphan rows
 */
export async function removeDisappearedForMonth(data, month, options = {}) {
  const ym = String(month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    throw new Error('month must be YYYY-MM');
  }
  const { incomingKeys, incomingSlotKeys } = await buildMonthlyScheduleRows(
    Array.isArray(data) ? data : []
  );
  const onlyKeysOpt = options?.onlyKeys;
  const onlyKeys =
    onlyKeysOpt instanceof Set
      ? onlyKeysOpt
      : Array.isArray(onlyKeysOpt) && onlyKeysOpt.length > 0
        ? new Set(onlyKeysOpt.map((k) => String(k)))
        : null;
  return reconcileMonthsToSnapshot(new Set([ym]), incomingKeys, incomingSlotKeys, onlyKeys);
}

/**
 * Normalize one removal from calendar-poll/sync (string key or object).
 * String keys: `eventID|studentName` (legacy) or `eventID|studentName|YYYY-MM-DD` (recurring-safe).
 * @param {unknown} item
 * @returns {{ eventID: string, studentName: string, lessonDate?: string|null } | null}
 */
function normalizeRemovedPollItem(item) {
  if (item == null) return null;
  if (typeof item === 'string') {
    const parts = item.split('|');
    if (parts.length < 2) return null;
    const eventID = parts[0].trim();
    if (!eventID) return null;
    let studentParts = parts.slice(1);
    let lessonDate = null;
    const last = studentParts[studentParts.length - 1]?.trim() || '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(last)) {
      lessonDate = last;
      studentParts = studentParts.slice(0, -1);
    }
    const studentName = studentParts.join('|').trim();
    if (!studentName) return null;
    return { eventID, studentName, lessonDate };
  }
  if (typeof item === 'object') {
    const raw = (item.eventID ?? item.event_id ?? '').toString().trim();
    const sn = (item.studentName ?? item.student_name ?? '').toString().trim();
    const ldRaw = String(item.date ?? item.lesson_date ?? '')
      .trim()
      .slice(0, 10);
    const lessonDate = /^\d{4}-\d{2}-\d{2}$/.test(ldRaw) ? ldRaw : null;
    if (!raw || !sn) return null;
    return { eventID: raw, studentName: sn, lessonDate };
  }
  return null;
}

/**
 * @param {unknown[]} removed
 * @returns {Promise<{ removedReceived: number, removedParsed: number, removedSkippedInvalid: number, removedDeleted: number }>}
 */
async function applyRemovedFromPoll(removed) {
  const removedReceived = Array.isArray(removed) ? removed.length : 0;
  let removedSkippedInvalid = 0;
  let removedParsedAttempts = 0;
  const seen = new Set();
  /** @type {Array<{ eventID: string, studentName: string, lessonDate?: string|null }>} */
  const pairs = [];

  for (const item of Array.isArray(removed) ? removed : []) {
    const p = normalizeRemovedPollItem(item);
    if (!p) {
      removedSkippedInvalid++;
      continue;
    }
    removedParsedAttempts++;
    const dedupeKey = `${p.eventID}\t${p.studentName}\t${p.lessonDate || ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    pairs.push(p);
  }

  let removedDeleted = 0;
  for (const p of pairs) {
    removedDeleted += await deleteMonthlyScheduleByRawEvent(p.studentName, p.eventID, p.lessonDate || null);
  }

  return {
    removedReceived,
    removedParsed: pairs.length,
    removedParsedAttempts,
    removedSkippedInvalid,
    removedDeleted,
  };
}

/**
 * Limits orphan deletion to intended snapshot months (stray dated rows in payload must not reconcile wrong months).
 * @param {Set<string>} months - YYYY-MM from incoming rows
 * @param {{ reconcileMonthsAllowlist?: string[], reconcileOnlyYear?: string }} options
 * @returns {Set<string>}
 */
function monthsEligibleForReconcile(months, options) {
  const { reconcileMonthsAllowlist, reconcileOnlyYear } = options;
  let out = new Set(months);
  if (Array.isArray(reconcileMonthsAllowlist) && reconcileMonthsAllowlist.length > 0) {
    const allow = new Set(reconcileMonthsAllowlist.map((s) => String(s).trim()));
    out = new Set([...out].filter((m) => allow.has(m)));
  }
  if (reconcileOnlyYear != null && /^\d{4}$/.test(String(reconcileOnlyYear).trim())) {
    const y = `${String(reconcileOnlyYear).trim()}-`;
    out = new Set([...out].filter((m) => m.startsWith(y)));
  }
  return out;
}

/**
 * @param {Array<Record<string, unknown>>} data
 * @param {{
 *   removed?: Array<{ eventID?: string, event_id?: string, studentName?: string, student_name?: string }>,
 *   reconcile?: boolean,
 *   forceReconcile?: boolean,
 *   reconcileMonthsAllowlist?: string[],
 *   reconcileOnlyYear?: string,
 *   onlyKeys?: Set<string> | string[],
 *   ignoreDismissals?: boolean,
 * }} [options]
 * - reconcile: delete DB rows in snapshot months not in `data` (default true).
 * - forceReconcile: when true, orphan deletes run even if CALENDAR_RECONCILE_ORPHANS is off (explicit admin reconcile).
 * - reconcileMonthsAllowlist: only these YYYY-MM months are reconciled (intersected with months from payload).
 * - reconcileOnlyYear: only months starting with this YYYY (after allowlist filter).
 * - onlyKeys: optional `${eventId}\\t${studentName}` allowlist — upsert only those rows.
 * - ignoreDismissals: when true (explicit Add to local), clear dismissals and insert even if previously removed in-app.
 */
export async function upsertMonthlySchedule(data, options = {}) {
  const {
    removed = [],
    reconcile = true,
    forceReconcile = false,
    onlyKeys: onlyKeysOpt,
    ignoreDismissals = false,
  } = options;
  const removedStats = await applyRemovedFromPoll(removed);

  const built = await buildMonthlyScheduleRows(Array.isArray(data) ? data : []);
  let { rows, months, incomingKeys, incomingSlotKeys } = built;
  const onlyKeys =
    onlyKeysOpt instanceof Set
      ? onlyKeysOpt
      : Array.isArray(onlyKeysOpt) && onlyKeysOpt.length > 0
        ? new Set(onlyKeysOpt.map((k) => String(k)))
        : null;
  if (onlyKeys && onlyKeys.size > 0) {
    rows = rows.filter((r) => onlyKeys.has(`${r.eventId}\t${r.studentName}`));
    months = new Set(rows.map((r) => (r.date ? String(r.date).slice(0, 7) : '')).filter((m) => /^\d{4}-\d{2}$/.test(m)));
    incomingKeys = new Set(rows.map((r) => `${r.eventId}\t${r.studentName}`));
    incomingSlotKeys = new Set();
    for (const r of rows) {
      const sk = lessonSlotKey(r.studentName, r.startTs);
      if (sk) incomingSlotKeys.add(sk);
    }
  }
  const dismissedSlotKeys = ignoreDismissals
    ? new Set()
    : await loadDismissedSlotKeysForMonths(months);
  if (ignoreDismissals && rows.length > 0) {
    await clearScheduleSlotDismissals(rows);
  }
  const monthsToReconcile = monthsEligibleForReconcile(months, options);
  const envAllowReconcile = String(process.env.CALENDAR_RECONCILE_ORPHANS ?? '0').trim() === '1';

  let upserted = 0;
  let skippedDismissed = 0;
  for (const {
    eventId,
    calendarSourceEventId,
    title,
    date,
    startTs,
    endTs,
    status,
    studentName,
    isKids,
    teacherName,
    lessonKind,
    lessonMode,
    studentId,
    awaitingReschedulePollMerge,
  } of rows) {
    const slotKey = lessonSlotKey(studentName, startTs);
    if (slotKey && dismissedSlotKeys.has(slotKey)) {
      skippedDismissed++;
      continue;
    }
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
        (event_id, calendar_source_event_id, lesson_uuid, title, date, start, "end", status, student_name, is_kids_lesson, teacher_name, lesson_kind, lesson_mode, student_id,
         calendar_sync_status, calendar_sync_error, calendar_synced_at, awaiting_reschedule_date,
         reschedule_snapshot_to_date, reschedule_snapshot_to_time, reschedule_snapshot_from_date, reschedule_snapshot_from_time)
       VALUES ($1, $15,
         COALESCE((SELECT m.lesson_uuid FROM monthly_schedule m WHERE m.event_id = $14::text LIMIT 1), gen_random_uuid()),
         $2, $3::date, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10, $11, $12, 'synced', NULL, NOW(), COALESCE($13::boolean, FALSE),
         NULL, NULL, NULL, NULL)
       ON CONFLICT (event_id, student_name) DO UPDATE SET
         calendar_source_event_id = COALESCE(EXCLUDED.calendar_source_event_id, monthly_schedule.calendar_source_event_id),
         lesson_uuid = COALESCE(monthly_schedule.lesson_uuid, EXCLUDED.lesson_uuid),
         title = EXCLUDED.title, date = EXCLUDED.date, start = EXCLUDED.start, "end" = EXCLUDED."end",
         status = CASE
           WHEN EXISTS (
             SELECT 1 FROM reschedules rs
             WHERE TRIM(rs.from_event_id) = TRIM(monthly_schedule.event_id)
               AND REGEXP_REPLACE(TRIM(rs.from_student_name), '\\s+', ' ', 'g')
                 = REGEXP_REPLACE(TRIM(monthly_schedule.student_name), '\\s+', ' ', 'g')
           )
           AND LOWER(TRIM(EXCLUDED.status)) IN ('scheduled', 'cancelled')
             THEN 'rescheduled'
           ELSE EXCLUDED.status
         END,
         is_kids_lesson = EXCLUDED.is_kids_lesson, teacher_name = EXCLUDED.teacher_name, lesson_kind = EXCLUDED.lesson_kind, lesson_mode = EXCLUDED.lesson_mode, student_id = EXCLUDED.student_id,
         calendar_sync_status = EXCLUDED.calendar_sync_status, calendar_sync_error = EXCLUDED.calendar_sync_error, calendar_synced_at = EXCLUDED.calendar_synced_at,
         awaiting_reschedule_date = CASE
           WHEN $13::boolean IS NULL THEN monthly_schedule.awaiting_reschedule_date
           ELSE $13::boolean
         END,
         reschedule_snapshot_to_date = monthly_schedule.reschedule_snapshot_to_date,
         reschedule_snapshot_to_time = monthly_schedule.reschedule_snapshot_to_time,
         reschedule_snapshot_from_date = monthly_schedule.reschedule_snapshot_from_date,
         reschedule_snapshot_from_time = monthly_schedule.reschedule_snapshot_from_time`,
      [
        eventId,
        title,
        date,
        startTs,
        endTs,
        status,
        studentName,
        isKids,
        teacherName,
        lessonKind,
        lessonMode,
        studentId,
        awaitingReschedulePollMerge,
        eventId,
        calendarSourceEventId || null,
      ]
    );
    upserted++;
    if (
      String(lessonKind || '').toLowerCase() === 'demo' &&
      studentId != null &&
      !['cancelled', 'canceled'].includes(String(status || '').toLowerCase())
    ) {
      try {
        await upsertDemoLessonEvent({
          studentId,
          demoDate: date,
          teacherName,
          sourceEventId: eventId,
        });
      } catch (trackErr) {
        console.error('[demo-tracker] upsert after poll failed', trackErr?.message || trackErr);
      }
    }
  }

  let deletedOrphans = 0;
  // Reconcile after upsert so rows are updated/inserted before we compare keys; avoids wiping lessons
  // that are present in this payload but still keyed by an older event_id string.
  // forceReconcile: explicit admin "sync this month" bypasses CALENDAR_RECONCILE_ORPHANS=0.
  if (reconcile && (envAllowReconcile || forceReconcile) && monthsToReconcile.size > 0) {
    deletedOrphans = await reconcileMonthsToSnapshot(monthsToReconcile, incomingKeys, incomingSlotKeys);
  }

  return {
    upserted,
    skippedDismissed,
    months: Array.from(months),
    monthsReconciled: Array.from(monthsToReconcile),
    deletedOrphans,
    /** @deprecated use removedReceived — kept for backward compatibility */
    removedRows: removedStats.removedReceived,
    ...removedStats,
  };
}
