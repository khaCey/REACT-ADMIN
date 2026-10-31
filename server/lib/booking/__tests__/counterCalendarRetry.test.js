import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

test('counter Calendar failures survive an unchanged-title reconciliation and retry', {
  skip: !process.execArgv.includes('--experimental-test-module-mocks'),
}, async () => {
  const gas = await import('../../bookingCalendarSync.js');
  let failed = true;
  let calls = 0;
  const row = {
    event_id: 'audit_2026-10-01_04-00-00', student_id: 7, student_name: 'Sora',
    title: 'Sora (Cafe) 3/4', lesson_kind: 'regular', lesson_mode: 'cafe',
    status: 'scheduled', start: '2026-10-01T04:00:00Z', end: '2026-10-01T04:50:00Z',
    calendar_sync_status: 'synced', calendar_sync_error: null,
  };
  const statements = [];
  async function db(sql, args = []) {
    const q = sql.replace(/\s+/g, ' ').trim();
    statements.push(q);
    if (q.startsWith('SELECT id, name FROM students')) return { rows: [{ id: 7, name: 'Sora' }] };
    if (q.startsWith('SELECT m.student_id')) return { rows: [{ ...row, canonical_student_name: 'Sora' }] };
    if (q.startsWith('SELECT') && q.includes('FROM monthly_schedule')) return { rows: [{ ...row }] };
    if (q.startsWith('UPDATE monthly_schedule SET title')) row.title = args[0];
    if (q.includes("SET calendar_sync_status = 'failed'")) {
      row.calendar_sync_status = 'failed'; row.calendar_sync_error = args[1];
    }
    if (q.includes('SET calendar_sync_status = $2')) {
      row.calendar_sync_status = args[1]; row.calendar_sync_error = args[2];
    }
    if (/^(UPDATE|BEGIN|COMMIT|ROLLBACK)/.test(q)) return { rows: [] };
    throw new Error('Unexpected SQL: ' + q);
  }
  mock.module('../../../db/index.js', { namedExports: {
    query: db, pool: { connect: async () => ({ query: db, release() {} }) },
  } });
  mock.module('../../bookingCalendarSync.js', { namedExports: {
    ...gas, isBookingGasEnabled: () => true,
    isAmbiguousRecurringSeriesMaster: () => false,
    updateBookedLessonEventInGas: async (_id, patch) => {
      calls++;
      assert.equal(patch.title, 'Sora (Cafe) 1/4');
      return failed ? { ok: false, error: 'Calendar unavailable' } : { ok: true };
    },
  } });
  try {
    const { renumberMonthLessonTitlesForStudent } = await import('../domainInternals.js');
    process.env.CALENDAR_WRITES_ENABLED = 'true'; // Calendar is module-mocked in this test.
  const run = () => renumberMonthLessonTitlesForStudent(7, '2026-10', 4, db, { persistPack: false });
    const first = await run();
    assert.equal(first.updated, 1);
    assert.equal(first.calendar_errors.length, 1);
    assert.equal(row.title, 'Sora (Cafe) 1/4');
    assert.match(row.calendar_sync_error, /^\[calendar-style\] /);
    assert.ok(statements.findIndex((s) => s.includes("SET calendar_sync_status = 'failed'")) <
      statements.findIndex((s) => s.startsWith('UPDATE monthly_schedule SET title')));
    failed = false;
    const second = await run();
    assert.equal(second.updated, 0);
    assert.equal(second.calendar_patched, 1);
    assert.equal(row.calendar_sync_status, 'synced');
    assert.equal(row.calendar_sync_error, null);
    await run();
    assert.equal(calls, 2, 'successful unchanged events must not be patched again');
  } finally {
    mock.restoreAll();
  }
});
