/** Dedicated fail-closed GAS action. Its handler is bundled in gas/FixedSchedule.js. */
export async function upsertFixedCalendarEvent(appointment) {
  const base =
    process.env.FIXED_SCHEDULE_GAS_URL ||
    process.env.BOOKING_GAS_URL ||
    process.env.CALENDAR_POLL_URL;
  const key = process.env.BOOKING_API_KEY;
  if (!base || !key)
    return {
      ok: false,
      error: 'Fixed schedule Calendar integration is not configured',
    };
  const url = new URL(base);
  url.searchParams.set('key', key);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ action: 'fixed_schedule_upsert', ...appointment }),
    });
    const result = await response.json();
    if (
      !response.ok ||
      result?.ok !== true ||
      result?.eventId !== appointment.eventId ||
      result?.independent !== true
    ) {
      return {
        ok: false,
        error:
          result?.error ||
          'GAS must support independent fixed schedule events; no legacy fallback was attempted',
      };
    }
    return result;
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
