/**
 * Server-side Calendar GAS full fetch → PostgreSQL monthly_schedule sync.
 * Runs on a cron schedule from server/index.js when CALENDAR_POLL_SERVER_CRON is set.
 * Uses full=1 snapshot + reconcile so DB matches GAS without relying on a browser session.
 */
import { upsertMonthlySchedule } from './calendarSync.js';
import {
  bulkSyncCalendarsFromGasForStaffType,
  getMonthAndNextMonthJapanRange,
} from './staffScheduleGasSync.js';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const TEACHER_SCHEDULE_AUTO_FETCH_TTL_MS = 60 * 60 * 1000;
const lastTeacherScheduleAutoFetchAtByMonth = new Map();

function formatFetchError(err) {
  if (!err) return 'Unknown error';
  if (err.name === 'AbortError') {
    return 'Request timed out (GAS did not respond in time)';
  }
  const parts = [];
  const msg = err.message || String(err);
  if (msg && msg !== 'fetch failed') parts.push(msg);
  let c = err.cause;
  let depth = 0;
  while (c && depth < 4) {
    const cm = c.message || c.code || String(c);
    if (cm) parts.push(cm);
    c = c.cause;
    depth += 1;
  }
  if (parts.length === 0) return 'fetch failed';
  return parts.join(' — ');
}

export function getCalendarPollGasEnv() {
  const url = (process.env.CALENDAR_POLL_URL || process.env.VITE_CALENDAR_POLL_URL || '')
    .trim()
    .replace(/\/$/, '');
  const key = (process.env.CALENDAR_POLL_API_KEY || process.env.VITE_CALENDAR_POLL_API_KEY || '').trim();
  return { url, key, configured: !!(url && key) };
}

async function refreshTeacherSchedulesFromGASForMonth(yyyyMm) {
  const range = getMonthAndNextMonthJapanRange(yyyyMm);
  if (!range) throw new Error(`Invalid yyyyMm for teacher schedule refresh: ${yyyyMm}`);

  const now = Date.now();
  const lastAt = lastTeacherScheduleAutoFetchAtByMonth.get(yyyyMm);
  if (lastAt != null && now - lastAt < TEACHER_SCHEDULE_AUTO_FETCH_TTL_MS) {
    return { ok: true, skipped: true, reason: 'throttled', yyyyMm };
  }

  const result = await bulkSyncCalendarsFromGasForStaffType('english_teacher', range);
  lastTeacherScheduleAutoFetchAtByMonth.set(yyyyMm, Date.now());
  return {
    ok: true,
    yyyyMm,
    staffProcessed: result.staffProcessed,
    eventsStored: result.eventsStored,
    errors: result.errors,
  };
}

/**
 * Fetch MonthlySchedule JSON from GAS (?full=1).
 * @returns {Promise<{ data: Array, raw: object }>}
 */
export async function fetchFullMonthlyScheduleFromGas() {
  const { url, key, configured } = getCalendarPollGasEnv();
  if (!configured) {
    throw new Error('Set CALENDAR_POLL_URL and CALENDAR_POLL_API_KEY in .env (project root)');
  }
  const gasUrl = `${url}?key=${encodeURIComponent(key)}&full=1`;
  let fetchRes;
  try {
    fetchRes = await fetch(gasUrl);
  } catch (err) {
    const detail = formatFetchError(err);
    throw new Error(`Failed to reach Calendar GAS: ${detail}`);
  }
  const json = await fetchRes.json().catch(() => ({}));
  if (!fetchRes.ok) {
    const msg = json?.error || `GAS responded with ${fetchRes.status}`;
    throw new Error(msg);
  }
  if (json.error) {
    throw new Error(String(json.error));
  }
  const data = Array.isArray(json.data) ? json.data : [];
  return { data, raw: json };
}

/**
 * Full GAS snapshot → upsert + reconcile; refresh teacher_schedules when payload touches current/next JST month.
 */
export async function runServerCalendarPollSync() {
  const { configured } = getCalendarPollGasEnv();
  if (!configured) {
    console.warn('[calendar-poll/server] skip: CALENDAR_POLL_URL / CALENDAR_POLL_API_KEY not set');
    return { ok: false, skipped: true, reason: 'not_configured' };
  }

  const { data, raw } = await fetchFullMonthlyScheduleFromGas();
  console.log('[calendar-poll/server] fetched', data.length, 'rows from GAS (full=1)');

  const syncResult = await upsertMonthlySchedule(data, { reconcile: true });
  const { upserted, months, deletedOrphans } = syncResult;

  let teacherSchedulesRefresh = null;
  try {
    const jstNow = new Date(Date.now() + JST_OFFSET_MS);
    const curYyyyMm = `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, '0')}`;
    const nextDate = new Date(jstNow.getTime());
    nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
    const nextYyyyMm = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}`;

    const intersectsCurOrNext =
      Array.isArray(months) && months.some((m) => m === curYyyyMm || m === nextYyyyMm);
    if (intersectsCurOrNext) {
      teacherSchedulesRefresh = await refreshTeacherSchedulesFromGASForMonth(curYyyyMm);
    }
  } catch (err) {
    console.warn('[calendar-poll/server] teacher schedule refresh failed:', err.message);
    teacherSchedulesRefresh = { ok: false, error: err.message };
  }

  console.log(
    '[calendar-poll/server] upserted',
    upserted,
    'rows for months',
    (months || []).slice().sort().join(', '),
    deletedOrphans ? `; reconciled (deleted ${deletedOrphans} orphan row(s))` : '',
    '; cacheVersion=',
    raw?.cacheVersion ?? '—'
  );

  return {
    ok: true,
    upserted,
    months,
    deletedOrphans: deletedOrphans || 0,
    teacherSchedulesRefresh,
    fetched: data.length,
    cacheVersion: raw?.cacheVersion ?? null,
    lastUpdated: raw?.lastUpdated ?? null,
  };
}
