import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Run with --experimental-test-module-mocks. Never calls a real database or Calendar.
test('Calendar style retry stores successful result with PostgreSQL-safe parameter types', {
  skip: !process.execArgv.includes('--experimental-test-module-mocks'),
}, async () => {
  const gas = await import('../../bookingCalendarSync.js');
  const domain = await import('../domainInternals.js');
  const row = {
    event_id: 'calendar-event_2026-10-30_10-00-00',
    status: 'scheduled',
    title: 'Test Student (Cafe) 1/4',
    lesson_kind: 'regular',
    calendar_sync_status: 'failed',
    calendar_sync_error: '[calendar-style] Pending Calendar update',
    start: '2026-10-30T10:00:00Z',
    end: '2026-10-30T10:50:00Z',
  };
  const sqlCalls = [];
  let calendarCalls = 0;
  let released = false;
  const client = {
    async query(sql, values = []) {
      sqlCalls.push({ sql, values });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM monthly_schedule') && sql.includes('FOR UPDATE')) {
        return { rows: [row] };
      }
      if (sql.includes('UPDATE monthly_schedule')) {
        assert.match(sql, /\$2::varchar\(20\) = 'synced'/);
        assert.deepEqual(values, [row.event_id, 'synced', null]);
        row.calendar_sync_status = values[1];
        row.calendar_sync_error = values[2];
        return { rowCount: 1 };
      }
      throw new Error('Unexpected query: ' + sql);
    },
    release() { released = true; },
  };
  mock.module('../../../db/index.js', {
    namedExports: { pool: { connect: async () => client } },
  });
  mock.module('../../bookingCalendarSync.js', { namedExports: {
    ...gas,
    isBookingGasEnabled: () => true,
    updateBookedLessonEventInGas: async (id, patch) => {
      calendarCalls++;
      assert.equal(id, row.event_id);
      assert.equal(patch.title, row.title);
      return { ok: true, actionTaken: 'updated' };
    },
  } });
  mock.module('../domainInternals.js', { namedExports: {
    ...domain,
    shouldSkipAmbiguousRecurringForRows: async () => false,
    calendarGasOptions: () => ({}),
  } });
  try {
    const { syncLessonCalendarStyle } = await import('../lessonCalendarStyle.js');
    const result = await syncLessonCalendarStyle(row.event_id);
    assert.equal(result.calendar_sync_status, 'synced');
    assert.equal(result.calendar_sync_error, null);
    assert.equal(calendarCalls, 1);
    assert.equal(row.calendar_sync_status, 'synced');
    assert.ok(sqlCalls.some(({ sql }) => sql === 'COMMIT'));
    assert.ok(released);
  } finally {
    mock.restoreAll();
  }
});
