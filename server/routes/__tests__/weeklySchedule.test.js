import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createWeeklyScheduleRouter } from '../weeklySchedule.js';
import { groupWeekLessons, layoutDay, splitWeekLessons, weekRange, japanToday } from '../../../shared/weeklySchedule.js';

test('Japan weeks cross month/year boundaries and reject rollover dates', () => {
  assert.equal(weekRange('2027-01-03').start, '2026-12-28');
  assert.equal(weekRange('2027-01-03').end, '2027-01-04');
  assert.equal(japanToday(new Date('2026-10-28T16:00:00Z')), '2026-10-29');
  assert.throws(() => weekRange('2026-02-30'));
  assert.throws(() => weekRange('2026-1-01'));
});
test('groups shared events without collapsing different times or losing member status', () => {
  const row = { event_id: 'shared', date: '2026-10-26', start: '2026-10-26T01:00:00Z', end: '2026-10-26T01:50:00Z', title: 'Shared', student_id: 1, student_name: 'Sora', status: 'scheduled' };
  const events = groupWeekLessons([row, { ...row, student_id: 2, status: 'cancelled' }, { ...row, start: '2026-10-26T03:00:00Z' }]);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0].members.map(m => m.status), ['scheduled', 'cancelled']);
});
test('clips midnight lessons and assigns overlap lanes without hiding simultaneous lessons', () => {
  const events = [{ key: 'a', start: '2026-10-26T14:30:00Z', end: '2026-10-26T15:30:00Z' }, { key: 'b', date: '2026-10-26', start: null }];
  const result = splitWeekLessons(events, weekRange('2026-10-26').days);
  assert.equal(result.untimed.length, 1);
  assert.deepEqual(result.timed.map(e => [e.day, e.from, e.to]), [['2026-10-26', 1410, 1440], ['2026-10-27', 0, 30]]);
  const layout = layoutDay([{ key: 'a', from: 600, to: 660 }, { key: 'b', from: 630, to: 690 }, { key: 'c', from: 660, to: 700 }, { key: 'd', from: 720, to: 750 }]);
  assert.deepEqual(layout.map(e => e.columns), [2, 2, 2, 1]);
  assert.equal(layout[0].lane, layout[2].lane);
});
test('API rejects staff and operators before DB access; admin gets a bounded read-only snapshot', async () => {
  let calls = 0;
  const app = express();
  app.use((req, res, next) => { const role = req.headers['x-test-role']; if (role) req.staff = { name: 'Test', is_admin: role === 'admin', is_operator: role === 'operator' }; next(); });
  app.use('/week', createWeeklyScheduleRouter(async (sql, args) => {
    calls++; assert(!/INSERT|UPDATE|DELETE/i.test(sql));
    assert.deepEqual(args, ['2026-10-26', '2026-11-02', '2026-10-26T00:00:00+09:00', '2026-11-02T00:00:00+09:00']);
    return { rows: [] };
  }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/week?week_start=2026-10-28`;
  try {
    assert.equal((await fetch(url)).status, 401);
    for (const role of ['staff', 'operator']) assert.equal((await fetch(url, { headers: { 'x-test-role': role } })).status, 403);
    assert.equal(calls, 0);
    assert.equal((await fetch(url.replace('2026-10-28', '2026-02-30'), { headers: { 'x-test-role': 'admin' } })).status, 400);
    assert.equal(calls, 0);
    const response = await fetch(url, { headers: { 'x-test-role': 'admin' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).days.length, 7); assert.equal(calls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
