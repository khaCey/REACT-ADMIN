/** Server-only adapter to the existing Apps Script Calendar API. */
export async function createRecoveryGasConfig() {
  const url = String(process.env.BOOKING_GAS_URL || process.env.CALENDAR_POLL_URL || '').trim();
  const key = String(process.env.BOOKING_API_KEY || '').trim();
  if (!url || !key) throw new Error('The existing Apps Script booking API is not configured.');
  async function call(operation, params = {}) {
    const endpoint = new URL(url);
    endpoint.searchParams.set('key', key);
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'calendar_recovery_v1', operation, ...params }), signal: AbortSignal.timeout(45000) });
    const json = await response.json().catch(() => null);
    if (operation === 'capabilities' && (!json || json.calendarRecoveryVersion !== 1)) {
      throw new Error('The Apps Script recovery extension is not deployed yet. Deploy the updated calendarAPI project; no Calendar sharing changes are needed.');
    }
    if (!response.ok || !json?.ok) throw Object.assign(new Error(json?.error || 'Apps Script recovery request failed'), { code: Number(json?.code || response.status || 502) });
    return json;
  }
  const capabilities = await call('capabilities');
  if (!Array.isArray(capabilities.calendars) || !capabilities.calendars.length) throw new Error('No recovery calendars are configured in Apps Script.');
  return {
    calendars: capabilities.calendars,
    api: {
      calendars: { get: async ({ calendarId }) => call('calendar', { calendarId }) },
      events: {
        list: async ({ calendarId, timeMin, timeMax, pageToken }) => call('list', { calendarId, timeMin, timeMax, pageToken }),
        get: async ({ calendarId, eventId }) => call('get', { calendarId, eventId }),
        insert: async ({ calendarId, requestBody }) => call('insert', { calendarId, resource: requestBody }),
      },
    },
  };
}
