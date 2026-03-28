/**
 * JST (Asia/Tokyo) / UTC helpers for schedule and booking.
 * Rule: store and compute in UTC; convert to JST only for display.
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse a date (YYYY-MM-DD) and time (hour, minute) as Japan time and return a Date (UTC instant).
 * @param {string} dateStr - YYYY-MM-DD
 * @param {number} hour - 0-23
 * @param {number} minute - 0-59
 * @returns {Date|null} UTC Date or null if invalid
 */
function parseJstToUtc(dateStr, hour, minute) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) return null;
  const jstMs = Date.UTC(y, mo, d, hour || 0, minute || 0, 0, 0) - JST_OFFSET_MS;
  const date = new Date(jstMs);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Convert a UTC Date to JST calendar date and time string.
 * @param {Date} utcDate - instant in UTC
 * @returns {{ date: string, time: string }|null} { date: 'YYYY-MM-DD', time: 'HH:MM' } or null
 */
function utcToJstDateAndTime(utcDate) {
  if (!utcDate || !(utcDate instanceof Date) || isNaN(utcDate.getTime())) return null;
  const jstMs = utcDate.getTime() + JST_OFFSET_MS;
  const jstDay = Math.floor(jstMs / MS_PER_DAY);
  const d = new Date(jstDay * MS_PER_DAY);
  const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const hours = Math.floor((jstMs % MS_PER_DAY) / (60 * 60 * 1000));
  const minutes = Math.floor((jstMs % (60 * 60 * 1000)) / (60 * 1000));
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return { date: dateStr, time: timeStr };
}

/**
 * Today's date in Japan (Asia/Tokyo) as YYYY-MM-DD.
 * @returns {string}
 */
function getTodayJstDateStr() {
  const now = new Date();
  const jstMs = now.getTime() + JST_OFFSET_MS;
  const jstDay = Math.floor(jstMs / MS_PER_DAY);
  const d = new Date(jstDay * MS_PER_DAY);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Minute-of-day (0–1439) in JST for a UTC instant. Used to compare with teacher_schedules start_time/end_time (JST).
 * @param {Date} utcDate - instant in UTC
 * @returns {number} minutes since midnight JST
 */
function getJstMinutesOfDay(utcDate) {
  if (!utcDate || !(utcDate instanceof Date) || isNaN(utcDate.getTime())) return 0;
  const jstMs = utcDate.getTime() + JST_OFFSET_MS;
  const msInDay = jstMs % MS_PER_DAY;
  if (msInDay < 0) return 0;
  return Math.floor(msInDay / (60 * 1000));
}

/** JST wall clock "HH:MM" / "HH:MM:SS" -> minutes 0..1439 */
function wallTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const parts = String(timeStr).trim().split(':').map(Number);
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  return Math.max(0, Math.min(h * 60 + m, 23 * 60 + 59));
}

/** Minutes 0..1439 -> "HH:MM" */
function minutesToWallHHMM(totalMin) {
  const capped = Math.max(0, Math.min(totalMin, 23 * 60 + 59));
  const hh = Math.floor(capped / 60);
  const mm = capped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Round JST wall time to nearest hour (e.g. 12:05 and 11:50 -> 12:00).
 * Values that would round past midnight are capped at 23:59 the same day.
 */
function roundJstWallTimeToNearestHour(timeStr) {
  const raw = wallTimeToMinutes(timeStr);
  let m = Math.round(raw / 60) * 60;
  if (m >= 24 * 60) m = 23 * 60 + 59;
  return minutesToWallHHMM(m);
}

/**
 * Round teacher_schedules start/end to the nearest hour each. If end <= start after rounding,
 * extend end by one hour (capped at 23:59) so the interval stays valid.
 */
function roundTeacherShiftStartEnd(startTime, endTime) {
  let start = roundJstWallTimeToNearestHour(startTime);
  let end = roundJstWallTimeToNearestHour(endTime);
  let sm = wallTimeToMinutes(start);
  let em = wallTimeToMinutes(end);
  if (em <= sm) {
    em = Math.min(sm + 60, 23 * 60 + 59);
    end = minutesToWallHHMM(em);
  }
  return { start_time: start, end_time: end };
}

export {
  JST_OFFSET_MS,
  MS_PER_DAY,
  parseJstToUtc,
  utcToJstDateAndTime,
  getTodayJstDateStr,
  getJstMinutesOfDay,
  roundJstWallTimeToNearestHour,
  roundTeacherShiftStartEnd,
};
