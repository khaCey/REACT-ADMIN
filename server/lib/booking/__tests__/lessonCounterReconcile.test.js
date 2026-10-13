import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileStudentMonthCounters, reconcileCountersForAffectedRows, runDailyLessonCounterReconciliation } from '../lessonCounterReconcile.js';

delete process.env.BOOKING_GAS_URL;
delete process.env.BOOKING_API_KEY;
delete process.env.CALENDAR_POLL_URL;

function fixture(initial, totals) {
  const rows = initial.map((r) => ({
    student_id: 7, student_name: 'Sora', lesson_kind: 'regular',
    lesson_mode: 'cafe', status: 'scheduled', calendar_sync_status: 'pending', ...r,
  }));
  const writes = [];
  const active = (r) => !['cancelled', 'rescheduled'].includes(r.status) && r.lesson_kind !== 'demo';
  async function db(sql, args = []) {
    const q = sql.replace(/\s+/g, ' ').toLowerCase().trim();
    if (q.startsWith('select lessons from lessons'))
      return { rows: [{ lessons: totals[String(args[0]) + ':' + args[1]] || 0 }] };
    if (q.startsWith('select id, name from students'))
      return { rows: [{ id: args[0], name: 'Sora' }] };
    if (q.includes('select event_id, student_id, student_name, title, lesson_kind, lesson_mode'))
      return { rows: rows.filter((r) => r.student_id === args[0] && r.date.slice(0, 7) === args[1] && active(r))
        .sort((a,b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.event_id.localeCompare(b.event_id))
        .map((r) => ({ ...r })) };
    if (q.includes('select m.student_id, m.student_name, m.group_sort_order'))
      return { rows: rows.filter((r) => r.event_id === args[0])
        .map((r) => ({ ...r, canonical_student_name: r.student_name, student_is_child: false })) };
    if (q.startsWith('update monthly_schedule set title')) {
      for (const r of rows) if (r.event_id === args[1] && (!args[2] || args[2] === r.student_name)) r.title = args[0];
      writes.push(args);
      return { rowCount: 1 };
    }
    if (q.startsWith('select distinct student_id,')) {
      const keys = [...new Set(rows.filter(active).map((r) => String(r.student_id) + ':' + r.date.slice(0, 7)))];
      return { rows: keys.map((k) => ({ student_id: Number(k.split(':')[0]), month: k.split(':')[1] })) };
    }
    if (q.includes('select count(distinct m.event_id)'))
      return { rows: [{ cnt: new Set(rows.filter((r) => active(r) && r.student_id === args[0] && r.date.slice(0, 7) === args[1]).map((r) => r.event_id)).size }] };
    if (q.startsWith('select coalesce(sum(')) return { rows: [{ total_paid: 0 }] };
    if (q.startsWith('select title from monthly_schedule'))
      return { rows: rows.filter((r) => r.student_id === args[0] && r.date.slice(0, 7) === args[1]).map((r) => ({ title: r.title })) };
    throw new Error('Unexpected SQL in test: ' + q.slice(0, 120));
  }
  return { db, rows, writes };
}
function lesson(event_id, date, title, extra = {}) {
  return { event_id, date, start: date + 'T09:00:00Z', title, ...extra };
}
test('repairs out-of-order counters and is idempotent', async () => {
  const f = fixture([
    lesson('d', '2026-10-29', 'Sora (Cafe) 1/4'),
    lesson('b', '2026-10-08', 'Sora (Cafe) 2/4'),
    lesson('a', '2026-10-01', 'Sora (Cafe) 3/4'),
    lesson('c', '2026-10-15', 'Sora (Cafe) 4/4'),
  ], { '7:2026-10': 4 });
  assert.equal((await reconcileStudentMonthCounters(7, '2026-10', f.db)).updated, 3);
  assert.deepEqual(f.rows.slice().sort((a,b) => a.date.localeCompare(b.date)).map((r) => r.title), [
    'Sora (Cafe) 1/4', 'Sora (Cafe) 2/4', 'Sora (Cafe) 3/4', 'Sora (Cafe) 4/4',
  ]);
  assert.equal((await reconcileStudentMonthCounters(7, '2026-10', f.db)).updated, 0);
  assert.equal(f.writes.length, 3);
});
test('excludes demo/cancelled/moved-source rows and keeps movement marker', async () => {
  const f = fixture([
    lesson('demo', '2026-10-01', 'Sora D/L', { lesson_kind: 'demo' }),
    lesson('cancel', '2026-10-03', 'Sora (Cafe) 1/4', { status: 'cancelled' }),
    lesson('source', '2026-10-05', 'Sora (Cafe) 2/4 Moved to 8th', { status: 'rescheduled' }),
    lesson('new', '2026-10-08', 'Sora (Cafe) 4/4 Moved from 5th'),
    lesson('other', '2026-10-15', 'Sora (Cafe) 3/4'),
  ], { '7:2026-10': 4 });
  assert.equal((await reconcileStudentMonthCounters(7, '2026-10', f.db)).updated, 2);
  assert.equal(f.rows.find((r) => r.event_id === 'new').title, 'Sora (Cafe) 1/4 · Moved from 5th');
  assert.equal(f.rows.find((r) => r.event_id === 'other').title, 'Sora (Cafe) 2/4');
  assert.equal(f.rows.find((r) => r.event_id === 'source').title, 'Sora (Cafe) 2/4 Moved to 8th');
});
test('cross-month reschedule fixes both affected months', async () => {
  const f = fixture([
    lesson('old', '2026-10-22', 'Sora (Cafe) 2/4'),
    lesson('new', '2026-11-01', 'Sora (Cafe) 3/4 Moved from 8th'),
  ], { '7:2026-10': 4, '7:2026-11': 4 });
  const r = await reconcileCountersForAffectedRows([
    { student_id: 7, date: '2026-10-08' },
    { student_id: 7, date: new Date('2026-11-01T00:00:00+09:00') },
  ], f.db);
  assert.equal(r.checked, 2);
  assert.equal(r.updated, 2);
  assert.equal(f.rows.find((r) => r.event_id === 'old').title, 'Sora (Cafe) 1/4');
  assert.equal(f.rows.find((r) => r.event_id === 'new').title, 'Sora (Cafe) 1/4 Moved from 8th');
});
test('daily sweep is safe to run repeatedly', async () => {
  const f = fixture([lesson('one', '2026-10-01', 'Sora (Cafe) 3/4')], { '7:2026-10': 4 });
  assert.equal((await runDailyLessonCounterReconciliation(f.db)).updated, 1);
  assert.equal((await runDailyLessonCounterReconciliation(f.db)).updated, 0);
  assert.equal(f.writes.length, 1);
});
