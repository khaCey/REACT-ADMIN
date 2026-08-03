/**
 * Server -> GAS calendar booking sync.
 * Called from POST /api/schedule/book to create a real Calendar event.
 */

import {
  GOOGLE_INSTANCE_SUFFIX_RE,
  gasCalendarEventIdFromMonthly,
  isAmbiguousRecurringSeriesMaster,
  occurrenceStartIsoFromScheduleRows,
  stripOurMonthlyDisambiguationSuffix,
} from './calendarEventId.js';

export { isAmbiguousRecurringSeriesMaster };

function normalizeResult(data, fallbackError = null) {
  const rev =
    data?.scriptRevision != null && data?.scriptRevision !== '' ? String(data.scriptRevision) : null;
  let err = data?.error || fallbackError || null;
  if (err && rev) {
    err = `${err} [gas:${rev}]`;
  }
  return {
    ok: !!data?.ok,
    actionTaken: data?.actionTaken || null,
    eventId: data?.eventId || null,
    calendarId: data?.calendarId || null,
    deletedCount: data?.deletedCount != null ? data.deletedCount : null,
    error: err,
    gasScriptRevision: rev,
  };
}

/** Node fetch often throws TypeError("fetch failed") with real reason in err.cause */
function formatFetchError(err) {
  if (!err) return 'Unknown error';
  if (err.name === 'AbortError') {
    return 'Request timed out (GAS did not respond in time; try again or increase BOOKING_SYNC_TIMEOUT_MS)';
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

const DEFAULT_TIMEOUT_MS = 60000;

/** True when GAS reports the Calendar event is already gone (idempotent delete). */
export function isGasCalendarEventMissingError(errorMessage) {
  const msg = String(errorMessage || '').trim().toLowerCase();
  if (!msg) return false;
  // Lookup failed — the occurrence may still exist. Do not treat as already-deleted.
  if (msg.includes('occurrence not found')) return false;
  if (msg.includes('refusing to delete series master')) return false;
  return (
    msg.includes('calendar event not found') ||
    msg.includes('event not found') ||
    msg.includes('not found on calendar') ||
    msg.includes('calendar.events.delete') ||
    msg.includes('calendar api remove failed') ||
    msg.includes('calendar api remove series failed') ||
    msg.includes('requested resource was not found') ||
    msg.includes('resource has been deleted') ||
    msg.includes('no longer exists') ||
    msg.includes('status code: 404') ||
    msg.includes('http 404') ||
    /\b404\b/.test(msg) ||
    (msg.includes('remove failed') && msg.includes('not found')) ||
    (msg.includes('remove series failed') && msg.includes('not found')) ||
    (msg.includes('not found') && msg.includes('calendar'))
  );
}

/** GAS delete response: treat already-removed Calendar events as success (idempotent). */
function normalizeDeleteResult(data, fallbackError = null, options = {}) {
  const r = normalizeResult(data, fallbackError);
  if (r.ok) return r;
  if (options.strict) return r;
  if (isGasCalendarEventMissingError(r.error)) {
    return {
      ...r,
      ok: true,
      error: null,
      actionTaken: r.actionTaken || 'already_deleted',
    };
  }
  return r;
}

const CONFIRMED_CALENDAR_DELETE_ACTIONS = new Set([
  'deleted',
  'cancelled_instance',
  'series_deleted',
  'already_deleted',
]);

/** True when GAS reports the event was removed (or was already gone). */
export function gasDeleteConfirmedInCalendar(del) {
  if (!del?.ok) return false;
  const action = String(del.actionTaken || '').trim().toLowerCase();
  if (CONFIRMED_CALENDAR_DELETE_ACTIONS.has(action)) return true;
  const deletedCount = parseInt(del?.deletedCount, 10);
  return Number.isFinite(deletedCount) && deletedCount > 0;
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GAS/Calendar unreachable or too slow — remove from DB so the app is not stuck on ETIMEDOUT. */
export function isGasCalendarDeleteUnreachableError(errorMessage) {
  const msg = String(errorMessage || '').trim().toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('etimedout') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('abort') ||
    msg.includes('fetch failed') ||
    msg.includes('did not respond in time') ||
    msg.includes('aggregateerror') ||
    msg.includes('network') ||
    msg.includes('socket')
  );
}

/** Proceed with DB-only delete when Calendar delete cannot be confirmed. */
export function shouldProceedWithDbOnlyCalendarDelete(errorMessage) {
  return (
    isGasCalendarEventMissingError(errorMessage) ||
    isGasCalendarDeleteUnreachableError(errorMessage)
  );
}

/** True when a failed GAS delete must block removing the row from the DB (auth/config only). */
export function isGasCalendarDeleteBlockingError(errorMessage) {
  const msg = String(errorMessage || '').trim().toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('unauthorized') ||
    msg.includes('not configured') ||
    msg.includes('missing booking') ||
    msg.includes('missing eventid')
  );
}

/**
 * @param {{ ok?: boolean, error?: string|null, calendarDeleteWarning?: string|null }} del
 * @returns {{ proceed: boolean, warning: string|null, blockingError: string|null }}
 */
export function interpretGasDeleteResultForDbRemove(del) {
  if (gasDeleteConfirmedInCalendar(del)) {
    return { proceed: true, warning: null, blockingError: null };
  }
  const err = String(del?.error || '').trim();
  if (isGasCalendarDeleteBlockingError(err)) {
    return { proceed: false, warning: null, blockingError: err || 'Calendar delete blocked' };
  }
  if (isGasCalendarEventMissingError(err)) {
    return { proceed: true, warning: null, blockingError: null };
  }
  if (isGasCalendarDeleteUnreachableError(err)) {
    return {
      proceed: false,
      warning: null,
      blockingError:
        `${err} Calendar was not updated. Retry remove, or use “schedule only” if the event is already gone in Google Calendar.`,
    };
  }
  return {
    proceed: false,
    warning: null,
    blockingError: err || 'Failed to remove lesson from Google Calendar',
  };
}

export function isBookingGasEnabled() {
  const url = String(process.env.BOOKING_GAS_URL || process.env.CALENDAR_POLL_URL || '').trim();
  const key = String(process.env.BOOKING_API_KEY || '').trim();
  return Boolean(url && key);
}

/**
 * @typedef {{ id:number, name:string, status?:string|null, payment?:string|null, is_child?:boolean }} StudentForBooking
 */

function deriveLessonKind(student) {
  const status = String(student?.status || '').trim().toUpperCase();
  if (status === 'DEMO') return 'demo';
  const payment = String(student?.payment || '').toLowerCase();
  if (payment.includes('owner')) return 'owner';
  return 'regular';
}

/**
 * Google Calendar event colorId for `CalendarEvent.setColor` (same numbering as Calendar API).
 * Returns `null` for demo and owner so GAS does not call setColor — event keeps the calendar default.
 * Regular lessons use Basil (10).
 * @see https://developers.google.com/calendar/api/v3/reference/colors
 */
export function bookingEventColorId(lessonKind) {
  const k = String(lessonKind || '').trim().toLowerCase();
  if (k === 'demo' || k === 'owner') return null;
  return '10';
}

/**
 * @param {{
 *   occurrenceStartIso?: string|null,
 *   calendarSourceEventId?: string|null,
 *   scheduleRows?: Array<{ start?: Date|string|null, calendar_source_event_id?: string|null }>,
 * }} [gasOptions]
 */
function resolveGasEventId(monthlyEventId, gasOptions = {}) {
  const occurrenceStartIso =
    gasOptions.occurrenceStartIso != null && gasOptions.occurrenceStartIso !== ''
      ? String(gasOptions.occurrenceStartIso)
      : occurrenceStartIsoFromScheduleRows(gasOptions.scheduleRows);
  const calendarSourceEventId =
    gasOptions.calendarSourceEventId != null && gasOptions.calendarSourceEventId !== ''
      ? String(gasOptions.calendarSourceEventId)
      : String(gasOptions.scheduleRows?.[0]?.calendar_source_event_id || '').trim() || null;
  return gasCalendarEventIdFromMonthly(monthlyEventId, occurrenceStartIso, calendarSourceEventId);
}

function buildGasUpdatePayload(monthlyEventId, updates, gasOptions = {}) {
  const occurrenceStartIso =
    gasOptions.occurrenceStartIso != null && gasOptions.occurrenceStartIso !== ''
      ? String(gasOptions.occurrenceStartIso)
      : occurrenceStartIsoFromScheduleRows(gasOptions.scheduleRows);
  const calendarSourceEventId =
    gasOptions.calendarSourceEventId != null && gasOptions.calendarSourceEventId !== ''
      ? String(gasOptions.calendarSourceEventId)
      : String(gasOptions.scheduleRows?.[0]?.calendar_source_event_id || '').trim() || null;
  const eventId = resolveGasEventId(monthlyEventId, gasOptions);
  const seriesMasterId =
    gasOptions.seriesMasterId != null && String(gasOptions.seriesMasterId).trim() !== ''
      ? String(gasOptions.seriesMasterId).trim()
      : stripOurSuffixForPayload(monthlyEventId, calendarSourceEventId);
  return {
    eventId,
    occurrenceStartIso: occurrenceStartIso || null,
    seriesMasterId,
    updateScope: 'thisInstanceOnly',
  };
}

function stripOurSuffixForPayload(monthlyEventId, calendarSourceEventId) {
  const src = String(calendarSourceEventId || '').trim();
  if (src && !GOOGLE_INSTANCE_SUFFIX_RE.test(src)) return src;
  return stripOurMonthlyDisambiguationSuffix(monthlyEventId);
}

/**
 * Create a Calendar event via GAS.
 * @param {{ student: StudentForBooking, students?: StudentForBooking[], startIso: string, endIso: string, assignedTeacherName: string|null, title: string, location?: string|null, lessonKind?: string|null, bookingKey?: string|null }} args
 * @returns {Promise<{ok:boolean,actionTaken:string|null,eventId:string|null,calendarId:string|null,error:string|null}>}
 */
export async function createBookedLessonEventInGas(args) {
  const baseUrl = String(process.env.BOOKING_GAS_URL || process.env.CALENDAR_POLL_URL || '').trim();
  const apiKey = String(process.env.BOOKING_API_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    return normalizeResult(null, 'BOOKING_GAS_URL (or CALENDAR_POLL_URL) / BOOKING_API_KEY is not configured');
  }

  const url = new URL(baseUrl);
  url.searchParams.set('key', apiKey);

  const student = args?.student;
  const students = Array.isArray(args?.students) && args.students.length > 0 ? args.students : student ? [student] : [];
  const lessonKind = student
    ? deriveLessonKind(student)
    : String(args?.lessonKind || '').trim().toLowerCase() || 'regular';
  const teacher = (args?.assignedTeacherName || '').trim();
  const bookingKey = String(args?.bookingKey || '').trim();
  const studentIds = students
    .map((entry) => entry?.id)
    .filter((value, index, arr) => value != null && arr.indexOf(value) === index);
  const descLines = [
    'Source: Student Admin booking',
    student?.id != null ? `StudentId: ${student.id}` : null,
    studentIds.length > 1 ? `StudentIds: ${studentIds.join(',')}` : null,
    teacher ? `#teacher${teacher}` : null,
    bookingKey ? `BookingSyncKey: ${bookingKey}` : null,
  ].filter(Boolean);

  const explicitColorId =
    args?.colorId != null && String(args.colorId).trim() !== ''
      ? String(args.colorId).trim()
      : bookingEventColorId(lessonKind);
  const description =
    args?.description != null && String(args.description).trim() !== ''
      ? String(args.description).trim()
      : descLines.join('\n');
  const payload = {
    action: 'lesson_book_create',
    lessonKind,
    ...(explicitColorId ? { colorId: explicitColorId } : {}),
    title: args?.title || '',
    start: args?.startIso,
    end: args?.endIso,
    description,
    location: args?.location || '',
    bookingKey,
    source: 'student-admin-server',
    timestamp: new Date().toISOString(),
  };

  const timeoutMs = Math.min(
    120000,
    Math.max(5000, parseInt(process.env.BOOKING_SYNC_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS)
  );

  const requestOnce = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return normalizeResult(data, `GAS booking failed (${res.status})`);
      return normalizeResult(data);
    } catch (err) {
      const detail = formatFetchError(err);
      console.error('[BookingSync] fetch error:', detail, err?.cause || '');
      return normalizeResult(null, detail);
    } finally {
      clearTimeout(timeout);
    }
  };

  const first = await requestOnce();
  if (first.ok) return first;
  const second = await requestOnce();
  return second.ok ? second : first;
}

/**
 * Delete a Calendar event via GAS.
 * @param {string} monthlyEventId
 * @param {{ occurrenceStartIso?: string|null, scheduleRows?: Array<{ start?: Date|string|null }> }} [gasOptions]
 * @returns {Promise<{ok:boolean,actionTaken:string|null,eventId:string|null,calendarId:string|null,error:string|null}>}
 */
export async function deleteBookedLessonEventInGas(monthlyEventId, gasOptions = {}) {
  const baseUrl = String(process.env.BOOKING_GAS_URL || process.env.CALENDAR_POLL_URL || '').trim();
  const apiKey = String(process.env.BOOKING_API_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    return normalizeResult(null, 'BOOKING_GAS_URL (or CALENDAR_POLL_URL) / BOOKING_API_KEY is not configured');
  }

  const url = new URL(baseUrl);
  url.searchParams.set('key', apiKey);
  const ids = buildGasUpdatePayload(monthlyEventId, {}, gasOptions);
  const rawMonthlyEventId = String(gasOptions.rawMonthlyEventId || monthlyEventId || '').trim();
  const calendarSourceEventId =
    gasOptions.calendarSourceEventId != null && gasOptions.calendarSourceEventId !== ''
      ? String(gasOptions.calendarSourceEventId).trim()
      : String(gasOptions.scheduleRows?.[0]?.calendar_source_event_id || '').trim() || null;
  const lessonKind = String(gasOptions.lessonKind || gasOptions.scheduleRows?.[0]?.lesson_kind || 'regular')
    .trim()
    .toLowerCase();
  const scheduleRow = gasOptions.scheduleRows?.[0];
  const studentId = scheduleRow?.student_id != null ? scheduleRow.student_id : gasOptions.studentId;
  const endIso =
    scheduleRow?.end != null
      ? new Date(scheduleRow.end).toISOString()
      : gasOptions.endIso != null
        ? String(gasOptions.endIso)
        : null;
  const excludeEventIds = Array.isArray(gasOptions.excludeEventIds)
    ? gasOptions.excludeEventIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const payload = {
    action: 'lesson_book_delete',
    eventId: ids.eventId,
    occurrenceStartIso: ids.occurrenceStartIso,
    seriesMasterId: ids.seriesMasterId,
    updateScope: ids.updateScope,
    rawMonthlyEventId,
    ...(calendarSourceEventId ? { calendarSourceEventId } : {}),
    ...(studentId != null ? { studentId } : {}),
    ...(scheduleRow?.student_name ? { studentName: String(scheduleRow.student_name).trim() } : {}),
    ...(endIso ? { endIso } : {}),
    lessonKind,
    ...(excludeEventIds.length > 0 ? { excludeEventIds } : {}),
    ...(gasOptions.skipSlotSweep ? { skipSlotSweep: true } : {}),
    ...(gasOptions.skipSeriesMasterIdInDirectRemove ? { skipSeriesMasterIdInDirectRemove: true } : {}),
    ...(gasOptions.confirmReservedPlaceholder ? { confirmReservedPlaceholder: true } : {}),
    source: 'student-admin-server',
    timestamp: new Date().toISOString(),
  };
  const timeoutMs = Math.min(
    120000,
    Math.max(5000, parseInt(process.env.BOOKING_SYNC_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS)
  );

  const requestOnce = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      const strict = gasOptions.strictDelete === true;
      if (!res.ok) return normalizeDeleteResult(data, `GAS booking delete failed (${res.status})`, { strict });
      return normalizeDeleteResult(data, null, { strict });
    } catch (err) {
      const detail = formatFetchError(err);
      console.error('[BookingSync] delete fetch error:', detail, err?.cause || '');
      return normalizeDeleteResult(null, detail, { strict: gasOptions.strictDelete === true });
    } finally {
      clearTimeout(timeout);
    }
  };

  let last = await requestOnce();
  if (gasDeleteConfirmedInCalendar(last)) return last;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!isGasCalendarDeleteUnreachableError(last.error)) break;
    await sleepMs(2500);
    const retry = await requestOnce();
    if (gasDeleteConfirmedInCalendar(retry)) return retry;
    last = retry;
  }
  return last;
}

/**
 * Update a Calendar booking event via GAS (title/color/description markers).
 * Omit start/end to change metadata only (e.g. linked reschedule: graphite old slot without moving time).
 * @param {string} monthlyEventId
 * @param {{ title?: string, colorId?: string, clearColor?: boolean, startIso?: string, endIso?: string, mergeStudentAdminDescription?: { awaiting_reschedule_date?: boolean } }} updates
 * @param {{ occurrenceStartIso?: string|null, scheduleRows?: Array<{ start?: Date|string|null }> }} [gasOptions] - use original occurrence start for recurring instance id (not new startIso)
 * @returns {Promise<{ok:boolean,actionTaken:string|null,eventId:string|null,calendarId:string|null,error:string|null}>}
 */
export async function updateBookedLessonEventInGas(monthlyEventId, updates = {}, gasOptions = {}) {
  const baseUrl = String(process.env.BOOKING_GAS_URL || process.env.CALENDAR_POLL_URL || '').trim();
  const apiKey = String(process.env.BOOKING_API_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    return normalizeResult(null, 'BOOKING_GAS_URL (or CALENDAR_POLL_URL) / BOOKING_API_KEY is not configured');
  }

  const url = new URL(baseUrl);
  url.searchParams.set('key', apiKey);
  const merge = updates?.mergeStudentAdminDescription;
  const startIso = updates?.startIso != null ? String(updates.startIso).trim() : '';
  const endIso = updates?.endIso != null ? String(updates.endIso).trim() : '';
  const ids = buildGasUpdatePayload(monthlyEventId, updates, gasOptions);
  const payload = {
    action: 'lesson_book_update',
    eventId: ids.eventId,
    occurrenceStartIso: ids.occurrenceStartIso,
    seriesMasterId: ids.seriesMasterId,
    updateScope: ids.updateScope,
    ...(updates?.title ? { title: String(updates.title) } : {}),
    ...(updates?.colorId ? { colorId: String(updates.colorId) } : {}),
    ...(updates?.clearColor ? { clearColor: true } : {}),
    ...(startIso ? { start: startIso } : {}),
    ...(endIso ? { end: endIso } : {}),
    ...(merge && typeof merge === 'object' ? { mergeStudentAdminDescription: merge } : {}),
    source: 'student-admin-server',
    timestamp: new Date().toISOString(),
  };
  const timeoutMs = Math.min(
    120000,
    Math.max(5000, parseInt(process.env.BOOKING_SYNC_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS)
  );

  const requestOnce = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return normalizeResult(data, `GAS booking update failed (${res.status})`);
      return normalizeResult(data);
    } catch (err) {
      const detail = formatFetchError(err);
      console.error('[BookingSync] update fetch error:', detail, err?.cause || '');
      return normalizeResult(null, detail);
    } finally {
      clearTimeout(timeout);
    }
  };

  const first = await requestOnce();
  if (first.ok) return first;
  const second = await requestOnce();
  return second.ok ? second : first;
}

/**
 * Delete an entire recurring Calendar series (series master id) via GAS — used when removing a reserved hold.
 * @param {{ seriesMasterId: string, lessonKind?: string|null }} args
 * @returns {Promise<{ok:boolean,actionTaken:string|null,eventId:string|null,calendarId:string|null,error:string|null}>}
 */
export async function deleteReservedCalendarSeriesInGas(args) {
  const baseUrl = String(process.env.BOOKING_GAS_URL || process.env.CALENDAR_POLL_URL || '').trim();
  const apiKey = String(process.env.BOOKING_API_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    return normalizeResult(null, 'BOOKING_GAS_URL (or CALENDAR_POLL_URL) / BOOKING_API_KEY is not configured');
  }

  const url = new URL(baseUrl);
  url.searchParams.set('key', apiKey);
  const payload = {
    action: 'lesson_book_delete_series',
    seriesMasterId: String(args?.seriesMasterId || '').trim(),
    lessonKind: String(args?.lessonKind || 'regular').trim().toLowerCase(),
    source: 'student-admin-server',
    timestamp: new Date().toISOString(),
  };
  const timeoutMs = Math.min(
    120000,
    Math.max(5000, parseInt(process.env.BOOKING_SYNC_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS)
  );

  const requestOnce = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return normalizeDeleteResult(data, `GAS series delete failed (${res.status})`);
      return normalizeDeleteResult(data);
    } catch (err) {
      const detail = formatFetchError(err);
      console.error('[BookingSync] series delete fetch error:', detail, err?.cause || '');
      return normalizeDeleteResult(null, detail);
    } finally {
      clearTimeout(timeout);
    }
  };

  let last = await requestOnce();
  if (gasDeleteConfirmedInCalendar(last)) return last;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!isGasCalendarDeleteUnreachableError(last.error)) break;
    await sleepMs(2500);
    const retry = await requestOnce();
    if (gasDeleteConfirmedInCalendar(retry)) return retry;
    last = retry;
  }
  return last;
}

/**
 * Create a bounded weekly recurring reserved hold (Calendar API insert via GAS).
 * @param {{
 *   lessonKind?: string|null,
 *   title: string,
 *   description?: string|null,
 *   startLocal: string,
 *   endLocal: string,
 *   timeZone?: string|null,
 *   recurrence: string[],
 * }} args
 * @returns {Promise<{ok:boolean,actionTaken:string|null,eventId:string|null,calendarId:string|null,error:string|null}>}
 */
export async function createReservedRecurringHoldInGas(args) {
  const baseUrl = String(process.env.BOOKING_GAS_URL || process.env.CALENDAR_POLL_URL || '').trim();
  const apiKey = String(process.env.BOOKING_API_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    return normalizeResult(null, 'BOOKING_GAS_URL (or CALENDAR_POLL_URL) / BOOKING_API_KEY is not configured');
  }

  const url = new URL(baseUrl);
  url.searchParams.set('key', apiKey);
  const recurrence = Array.isArray(args?.recurrence) ? args.recurrence : [];
  const payload = {
    action: 'reserved_hold_recurring_create',
    lessonKind: String(args?.lessonKind || 'regular').trim().toLowerCase(),
    title: String(args?.title || '').trim(),
    description: String(args?.description || '').trim(),
    startLocal: String(args?.startLocal || '').trim(),
    endLocal: String(args?.endLocal || '').trim(),
    timeZone: String(args?.timeZone || 'Asia/Tokyo').trim(),
    recurrence,
    colorId: '5',
    source: 'student-admin-server',
    timestamp: new Date().toISOString(),
  };
  const timeoutMs = Math.min(
    120000,
    Math.max(5000, parseInt(process.env.BOOKING_SYNC_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS)
  );

  const requestOnce = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return normalizeResult(data, `GAS reserved recurring create failed (${res.status})`);
      return normalizeResult(data);
    } catch (err) {
      const detail = formatFetchError(err);
      console.error('[BookingSync] reserved recurring create fetch error:', detail, err?.cause || '');
      return normalizeResult(null, detail);
    } finally {
      clearTimeout(timeout);
    }
  };

  const first = await requestOnce();
  if (first.ok) return first;
  const second = await requestOnce();
  return second.ok ? second : first;
}
