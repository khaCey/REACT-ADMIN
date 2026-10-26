import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertFixedCalendarEvent } from '../../fixedScheduleCalendar.js';

test('an old or mismatched GAS deployment fails closed without a destructive fallback', async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.FIXED_SCHEDULE_GAS_URL;
  const previousKey = process.env.BOOKING_API_KEY;
  process.env.FIXED_SCHEDULE_GAS_URL = 'https://example.invalid/test';
  process.env.BOOKING_API_KEY = 'test-only';
  const calls = [];
  let response = { ok: true, eventId: 'fs-test' };
  globalThis.fetch = async (_url, request) => {
    calls.push(JSON.parse(request.body));
    return { ok: true, json: async () => response };
  };
  try {
    const appointment = { eventId: 'fs-test', occurrenceId: 'test' };
    assert.equal((await upsertFixedCalendarEvent(appointment)).ok, false);
    response = { ok: true, independent: true, eventId: 'wrong-event' };
    assert.equal((await upsertFixedCalendarEvent(appointment)).ok, false);
    response = { ok: true, independent: true, eventId: 'fs-test' };
    assert.equal((await upsertFixedCalendarEvent(appointment)).ok, true);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((p) => p.action === 'fixed_schedule_upsert'));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.FIXED_SCHEDULE_GAS_URL;
    else process.env.FIXED_SCHEDULE_GAS_URL = previousUrl;
    if (previousKey === undefined) delete process.env.BOOKING_API_KEY;
    else process.env.BOOKING_API_KEY = previousKey;
  }
});
