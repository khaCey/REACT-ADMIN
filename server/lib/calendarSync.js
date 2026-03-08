/**
 * Shared logic for syncing MonthlySchedule data to PostgreSQL.
 * Used by both /api/calendar-poll/sync (from GAS) and /api/calendar-poll/sync-from-sheet (from Google Sheets API).
 */
import { query } from '../db/index.js';

/**
 * Upsert schedule rows into monthly_schedule. Returns { upserted, months }.
 * @param {Array<{eventID?: string, event_id?: string, title?: string, date?: string, start?: string, end?: string, status?: string, studentName?: string, student_name?: string, isKidsLesson?: boolean, is_kids_lesson?: boolean, teacherName?: string, teacher_name?: string, lessonKind?: string, lesson_kind?: string}>} data
 */
const LESSON_KIND_VALID = { regular: true, demo: true, owner: true };

function normalizeLessonKind(val) {
  if (val == null || val === '') return 'regular';
  const v = String(val).trim().toLowerCase();
  return LESSON_KIND_VALID[v] ? v : 'regular';
}

/** Normalize name for matching: trim and collapse internal spaces */
function normalizeName(s) {
  if (s == null || typeof s !== 'string') return '';
  return s.trim().replace(/\s+/g, ' ');
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

export async function upsertMonthlySchedule(data) {
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
      if (m) startTs = `${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}:00`;
      else {
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
      if (m) endTs = `${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}:00`;
      else {
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
    rows.push({ eventId, title, date: resolvedDate || date, startTs, endTs, status, studentName, isKids, teacherName, lessonKind, studentId });
  }

  let upserted = 0;
  for (const { eventId, title, date, startTs, endTs, status, studentName, isKids, teacherName, lessonKind, studentId } of rows) {
    // When using new-format id (with time), remove legacy row with same rawEventId+date but no time
    if (date && /_\d{2}-\d{2}-\d{2}$/.test(eventId)) {
      const oldFormatId = eventId.replace(/_\d{2}-\d{2}-\d{2}$/, '');
      await query(
        `DELETE FROM monthly_schedule WHERE event_id = $1 AND student_name = $2 AND to_char(date, 'YYYY-MM') = $3`,
        [oldFormatId, studentName, date.slice(0, 7)]
      );
    }
    await query(
      `INSERT INTO monthly_schedule (event_id, title, date, start, "end", status, student_name, is_kids_lesson, teacher_name, lesson_kind, student_id)
       VALUES ($1, $2, $3::date, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (event_id, student_name) DO UPDATE SET
         title = EXCLUDED.title, date = EXCLUDED.date, start = EXCLUDED.start, "end" = EXCLUDED."end",
         status = EXCLUDED.status, is_kids_lesson = EXCLUDED.is_kids_lesson, teacher_name = EXCLUDED.teacher_name, lesson_kind = EXCLUDED.lesson_kind, student_id = EXCLUDED.student_id`,
      [eventId, title, date, startTs, endTs, status, studentName, isKids, teacherName, lessonKind, studentId]
    );
    upserted++;
  }

  return { upserted, months: Array.from(months) };
}
