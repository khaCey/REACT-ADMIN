/**
 * Fetch Google Calendar blocks via GAS (STAFF_SCHEDULE_GAS_URL) and store in teacher_schedules.
 * Used for English teachers and Japanese staff rota (same table, keyed by staff name).
 */
import { query } from '../db/index.js';
import { roundTeacherShiftStartEnd } from './timezone.js';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeIsoToUtc(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const s = iso.trim();
  if (!s) return null;
  const hasTz = /Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
  const toParse = hasTz ? s : s.replace(/\.\d{3}$/, '') + '+09:00';
  const utcMs = new Date(toParse).getTime();
  return Number.isNaN(utcMs) ? null : utcMs;
}

function isoToTokyoDateAndTime(iso) {
  const utcMs = normalizeIsoToUtc(iso);
  if (utcMs == null) return null;
  const jstMs = utcMs + JST_OFFSET_MS;
  const jstDay = Math.floor(jstMs / MS_PER_DAY);
  const d = new Date(jstDay * MS_PER_DAY);
  const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const hours = Math.floor((jstMs % MS_PER_DAY) / (60 * 60 * 1000));
  const minutes = Math.floor((jstMs % (60 * 60 * 1000)) / (60 * 1000));
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return { date: dateStr, time: timeStr };
}

/**
 * Current + next calendar month in Japan for GAS fetch (same semantics as legacy index.js).
 */
export function getCurrentAndNextMonthJapanRange() {
  const now = new Date();
  const jstMs = now.getTime() + JST_OFFSET_MS;
  const jstDay = Math.floor(jstMs / MS_PER_DAY);
  const d = new Date(jstDay * MS_PER_DAY);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const timeMinUTC = Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - JST_OFFSET_MS;
  const timeMaxUTC = Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - JST_OFFSET_MS;
  const timeMinISO = new Date(timeMinUTC).toISOString();
  const timeMaxISO = new Date(timeMaxUTC).toISOString();
  const rangeStart = `${year}-${String(month).padStart(2, '0')}-01`;
  let nYear = year;
  let nMonth = month + 1;
  if (nMonth > 12) {
    nMonth = 1;
    nYear += 1;
  }
  const lastDayNext = new Date(Date.UTC(nYear, nMonth, 0)).getUTCDate();
  const rangeEnd = `${nYear}-${String(nMonth).padStart(2, '0')}-${String(lastDayNext).padStart(2, '0')}`;
  return { timeMinISO, timeMaxISO, rangeStart, rangeEnd };
}

/** @param {string} yyyyMm YYYY-MM */
export function getMonthAndNextMonthJapanRange(yyyyMm) {
  if (!/^\d{4}-\d{2}$/.test(String(yyyyMm || '').trim())) {
    return null;
  }
  const [yStr, mStr] = String(yyyyMm).split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;

  const timeMinUTC = Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - JST_OFFSET_MS;
  const timeMaxUTC = Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - JST_OFFSET_MS;
  const timeMinISO = new Date(timeMinUTC).toISOString();
  const timeMaxISO = new Date(timeMaxUTC).toISOString();

  const rangeStart = `${year}-${String(month).padStart(2, '0')}-01`;
  let nYear = year;
  let nMonth = month + 1;
  if (nMonth > 12) {
    nMonth = 1;
    nYear += 1;
  }
  const lastDayNext = new Date(Date.UTC(nYear, nMonth, 0)).getUTCDate();
  const rangeEnd = `${nYear}-${String(nMonth).padStart(2, '0')}-${String(lastDayNext).padStart(2, '0')}`;
  return { timeMinISO, timeMaxISO, rangeStart, rangeEnd };
}

export function getStaffScheduleGasConfig() {
  const url = (
    process.env.STAFF_SCHEDULE_GAS_URL ||
    process.env.CALENDAR_POLL_URL ||
    process.env.VITE_CALENDAR_POLL_URL ||
    ''
  )
    .trim()
    .replace(/\/$/, '');
  const key = (
    process.env.STAFF_SCHEDULE_API_KEY ||
    process.env.CALENDAR_POLL_API_KEY ||
    process.env.VITE_CALENDAR_POLL_API_KEY ||
    ''
  ).trim();
  return { url, key };
}

export function normaliseGasEvents(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.events)) return json.events;
  if (json && Array.isArray(json.items)) return json.items;
  return [];
}

function isBreakEvent(ev) {
  const s = (ev.summary || '').trim().toLowerCase();
  return s.includes('break');
}

function isShortEvent(startTime, endTime) {
  const toMins = (t) => {
    if (!t || typeof t !== 'string') return NaN;
    const parts = String(t).trim().split(':').map(Number);
    if (parts.length < 2) return NaN;
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  };
  const startM = toMins(startTime);
  const endM = toMins(endTime);
  if (Number.isNaN(startM) || Number.isNaN(endM)) return false;
  let duration = endM - startM;
  if (duration < 0) duration += 24 * 60;
  return duration <= 65;
}

/**
 * @param {string} filter 'english_teacher' | 'japanese_staff'
 */
function selectStaffSqlForFilter(filter) {
  const base = `SELECT id, name, calendar_id FROM staff
     WHERE calendar_id IS NOT NULL AND TRIM(calendar_id) != ''`;
  if (filter === 'english_teacher') {
    return `${base} AND staff_type = 'english_teacher' ORDER BY name ASC`;
  }
  if (filter === 'japanese_staff') {
    return `${base} AND (staff_type = 'japanese_staff' OR staff_type IS NULL) ORDER BY name ASC`;
  }
  throw new Error(`Invalid staff calendar filter: ${filter}`);
}

/**
 * Fetch one person’s calendar from GAS and replace their rows in teacher_schedules for the date range.
 * @returns {Promise<{ ok: boolean, eventsStored: number, error?: string }>}
 */
export async function syncOneStaffCalendarFromGas({
  teacherName,
  calendarId,
  url,
  key,
  timeMinISO,
  timeMaxISO,
  rangeStart,
  rangeEnd,
  logFirstEvent = false,
}) {
  const cal = String(calendarId || '').trim();
  const name = String(teacherName || '').trim();
  if (!cal || !name) {
    return { ok: false, eventsStored: 0, error: 'Missing calendar or name' };
  }

  const gasUrl = `${url}?key=${encodeURIComponent(key)}&calendarId=${encodeURIComponent(cal)}&timeMin=${encodeURIComponent(
    timeMinISO
  )}&timeMax=${encodeURIComponent(timeMaxISO)}`;

  let json;
  try {
    const fetchRes = await fetch(gasUrl);
    json = await fetchRes.json().catch(() => ({}));
    if (!fetchRes.ok) {
      return { ok: false, eventsStored: 0, error: `GAS responded with ${fetchRes.status}` };
    }
  } catch (err) {
    return { ok: false, eventsStored: 0, error: err.message };
  }
  if (json.error) {
    return { ok: false, eventsStored: 0, error: json.error };
  }

  const events = normaliseGasEvents(json);
  if (events.length === 0 && !Array.isArray(json)) {
    console.warn(
      '[staffScheduleGasSync] GAS returned 0 events for',
      name,
      '; response keys:',
      Object.keys(json || {}).join(', ')
    );
  }
  const rows = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const startRaw = ev.start?.dateTime || ev.start;
    const endRaw = ev.end?.dateTime || ev.end;
    if (!startRaw || !endRaw) continue;
    const startStr = typeof startRaw === 'string' ? startRaw : startRaw?.dateTime ?? String(startRaw);
    const endStr = typeof endRaw === 'string' ? endRaw : endRaw?.dateTime ?? String(endRaw);
    const startParsed = isoToTokyoDateAndTime(startStr);
    const endParsed = isoToTokyoDateAndTime(endStr);
    if (!startParsed || !endParsed) continue;
    if (isBreakEvent(ev)) continue;
    if (isShortEvent(startParsed.time, endParsed.time)) continue;
    if (logFirstEvent && rows.length === 0) {
      console.log('[staffScheduleGasSync]', name, 'first event: rawStart=', startStr, '-> parsed', startParsed.date, startParsed.time);
    }
    const { start_time, end_time } = roundTeacherShiftStartEnd(startParsed.time, endParsed.time);
    rows.push({ date: startParsed.date, start_time, end_time });
  }

  await query(
    `DELETE FROM teacher_schedules WHERE teacher_name = $1 AND date >= $2::date AND date <= $3::date`,
    [name, rangeStart, rangeEnd]
  );
  let totalStored = 0;
  for (const row of rows) {
    await query(
      `INSERT INTO teacher_schedules (date, teacher_name, start_time, end_time)
       VALUES ($1::date, $2, $3::time, $4::time)
       ON CONFLICT (date, teacher_name, start_time) DO UPDATE SET end_time = $4::time`,
      [row.date, name, row.start_time, row.end_time]
    );
    totalStored++;
  }
  return { ok: true, eventsStored: totalStored };
}

/**
 * Bulk fetch for all staff of a type (English teachers or Japanese staff) with calendar_id set.
 * @param {'english_teacher' | 'japanese_staff'} filter
 * @param {{ timeMinISO: string, timeMaxISO: string, rangeStart: string, rangeEnd: string } | null} range - defaults to current+next JST month
 * @returns {Promise<{ staffProcessed: number, eventsStored: number, errors?: Array<{ staff: string, error: string }> }>}
 */
export async function bulkSyncCalendarsFromGasForStaffType(filter, range = null) {
  const { url, key } = getStaffScheduleGasConfig();
  if (!url || !key) {
    throw new Error(
      'Set STAFF_SCHEDULE_GAS_URL and STAFF_SCHEDULE_API_KEY in .env (or CALENDAR_POLL_*). Use STAFF_SCHEDULE_* for calendar-by-id fetch.'
    );
  }
  const r = range || getCurrentAndNextMonthJapanRange();
  const { timeMinISO, timeMaxISO, rangeStart, rangeEnd } = r;

  const staffResult = await query(selectStaffSqlForFilter(filter));
  const staffList = staffResult.rows;

  let totalStored = 0;
  const errors = [];

  for (const staff of staffList) {
    const calendarId = String(staff.calendar_id || '').trim();
    const teacherName = staff.name;
    if (!calendarId) continue;

    const result = await syncOneStaffCalendarFromGas({
      teacherName,
      calendarId,
      url,
      key,
      timeMinISO,
      timeMaxISO,
      rangeStart,
      rangeEnd,
      logFirstEvent: true,
    });
    if (!result.ok) {
      errors.push({ staff: teacherName, error: result.error || 'Unknown error' });
      continue;
    }
    totalStored += result.eventsStored;
  }

  return {
    staffProcessed: staffList.length,
    eventsStored: totalStored,
    errors: errors.length > 0 ? errors : undefined,
  };
}
