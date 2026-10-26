import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('GAS independently creates, updates and retries appointments without touching a recurring series', () => {
  const events = new Map([
    [
      'old-series',
      {
        id: 'old-series',
        recurrence: ['RRULE:FREQ=WEEKLY'],
        summary: 'History June–October',
      },
    ],
  ]);
  let inserts = 0,
    patches = 0;
  const context = vm.createContext({
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) }),
    },
    getBookingApiKey_: () => 'test-only',
    getCalendarIdForKind_: () => 'test-calendar',
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }),
    },
    Calendar: {
      Events: {
        get: (_cal, id) => {
          if (!events.has(id)) throw Error('404 Not Found');
          return structuredClone(events.get(id));
        },
        insert: (resource) => {
          inserts++;
          events.set(resource.id, structuredClone(resource));
        },
        patch: (resource, _cal, id) => {
          patches++;
          events.set(id, { ...events.get(id), ...structuredClone(resource) });
        },
        remove: () => {
          throw Error('No deletion is permitted');
        },
      },
    },
  });
  vm.runInContext(
    readFileSync(
      new URL('../../../../gas/FixedSchedule.js', import.meta.url),
      'utf8',
    ),
    context,
  );
  const id = 'a'.repeat(64),
    eventId = `fs${id}`;
  const body = {
    eventId,
    occurrenceId: id,
    scheduleId: 'pattern',
    colorId: '10',
    status: 'reserved',
    start: '2026-11-05T04:00:00Z',
    end: '2026-11-05T04:50:00Z',
    title: '[固定] Sora',
    description: 'StudentId: 7',
  };
  const call = (changes = {}) =>
    context.fixedScheduleUpsert_(
      { parameter: { key: 'test-only' } },
      { ...body, ...changes },
    );
  assert.equal(call().ok, true);
  assert.equal(call().ok, true);
  assert.equal(inserts, 1);
  assert.equal(
    call({ status: 'scheduled', title: 'Sora (Cafe) 1/4' }).ok,
    true,
  );
  assert.equal(events.get(eventId).colorId, '10');
  assert.equal(
    call({
      status: 'scheduled',
      start: '2026-11-06T05:00:00Z',
      end: '2026-11-06T05:50:00Z',
    }).ok,
    true,
  );
  assert.equal(events.get(eventId).start.dateTime, '2026-11-06T05:00:00.000Z');
  assert.equal(events.get('old-series').summary, 'History June–October');
  assert.equal(events.size, 2);
  assert.equal(patches, 3);
  events.get(eventId).recurrence = ['RRULE:FREQ=WEEKLY'];
  assert.equal(
    call().ok,
    false,
    'recurring events must never be patched through this action',
  );
  delete events.get(eventId).recurrence;
  events.get(eventId).extendedProperties.private.fixedOccurrenceId =
    'different-owner';
  assert.equal(call().ok, false, 'foreign events must never be overwritten');
  assert.equal(
    context.fixedScheduleUpsert_({ parameter: { key: 'wrong' } }, body).ok,
    false,
  );
});
