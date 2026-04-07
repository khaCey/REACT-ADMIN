/**
 * Server -> GAS calendar booking sync.
 * Called from POST /api/schedule/book to create a real Calendar event.
 */
 
function normalizeResult(data, fallbackError = null) {
  return {
    ok: !!data?.ok,
    actionTaken: data?.actionTaken || null,
    eventId: data?.eventId || null,
    calendarId: data?.calendarId || null,
    error: data?.error || fallbackError || null,
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
 
const DEFAULT_TIMEOUT_MS = 30000;
 
export function isBookingGasEnabled() {
  const url = String(process.env.BOOKING_GAS_URL || process.env.CALENDAR_POLL_URL || '').trim();
  const key = String(process.env.BOOKING_API_KEY || '').trim();
  return Boolean(url && key);
}
 
/**
 * @typedef {{ id:number, name:string, status?:string|null, payment?:string|null, is_child?:boolean }} StudentForBooking
 */
 
function deriveLessonKind(student) {
  const payment = String(student?.payment || '').toLowerCase();
  if (payment.includes('owner')) return 'owner';
  const status = String(student?.status || '').toLowerCase();
  if (status.includes('demo') || status.includes('trial')) return 'demo';
  return 'regular';
}
 
/**
 * Create a Calendar event via GAS.
 * @param {{ student: StudentForBooking, startIso: string, endIso: string, assignedTeacherName: string|null, title: string, location?: string|null, lessonKind?: string|null, bookingKey?: string|null }} args
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
  const lessonKind = String(args?.lessonKind || '').trim().toLowerCase() || deriveLessonKind(student);
  const teacher = (args?.assignedTeacherName || '').trim();
  const bookingKey = String(args?.bookingKey || '').trim();
  const descLines = [
    'Source: Student Admin booking',
    student?.id != null ? `StudentId: ${student.id}` : null,
    teacher ? `#teacher${teacher}` : null,
    bookingKey ? `BookingSyncKey: ${bookingKey}` : null,
  ].filter(Boolean);
 
  const payload = {
    action: 'lesson_book_create',
    lessonKind,
    title: args?.title || '',
    start: args?.startIso,
    end: args?.endIso,
    description: descLines.join('\n'),
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

function rawEventIdFromMonthlyEventId(eventId) {
  return String(eventId || '').trim().replace(/_\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?$/, '');
}

/**
 * Delete a Calendar event via GAS.
 * @param {string} monthlyEventId
 * @returns {Promise<{ok:boolean,actionTaken:string|null,eventId:string|null,calendarId:string|null,error:string|null}>}
 */
export async function deleteBookedLessonEventInGas(monthlyEventId) {
  const baseUrl = String(process.env.BOOKING_GAS_URL || process.env.CALENDAR_POLL_URL || '').trim();
  const apiKey = String(process.env.BOOKING_API_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    return normalizeResult(null, 'BOOKING_GAS_URL (or CALENDAR_POLL_URL) / BOOKING_API_KEY is not configured');
  }

  const url = new URL(baseUrl);
  url.searchParams.set('key', apiKey);
  const payload = {
    action: 'lesson_book_delete',
    eventId: rawEventIdFromMonthlyEventId(monthlyEventId),
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
      if (!res.ok) return normalizeResult(data, `GAS booking delete failed (${res.status})`);
      return normalizeResult(data);
    } catch (err) {
      const detail = formatFetchError(err);
      console.error('[BookingSync] delete fetch error:', detail, err?.cause || '');
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
 * Update a Calendar booking event via GAS (title/color).
 * @param {string} monthlyEventId
 * @param {{ title?: string, colorId?: string, clearColor?: boolean }} updates
 * @returns {Promise<{ok:boolean,actionTaken:string|null,eventId:string|null,calendarId:string|null,error:string|null}>}
 */
export async function updateBookedLessonEventInGas(monthlyEventId, updates = {}) {
  const baseUrl = String(process.env.BOOKING_GAS_URL || process.env.CALENDAR_POLL_URL || '').trim();
  const apiKey = String(process.env.BOOKING_API_KEY || '').trim();
  if (!baseUrl || !apiKey) {
    return normalizeResult(null, 'BOOKING_GAS_URL (or CALENDAR_POLL_URL) / BOOKING_API_KEY is not configured');
  }

  const url = new URL(baseUrl);
  url.searchParams.set('key', apiKey);
  const payload = {
    action: 'lesson_book_update',
    eventId: rawEventIdFromMonthlyEventId(monthlyEventId),
    ...(updates?.title ? { title: String(updates.title) } : {}),
    ...(updates?.colorId ? { colorId: String(updates.colorId) } : {}),
    ...(updates?.clearColor ? { clearColor: true } : {}),
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

