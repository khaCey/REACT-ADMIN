import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Module isolation requires Node's opt-in flag. No real database or Calendar is touched.
const enabled = process.execArgv.includes('--experimental-test-module-mocks');
test('reschedule and Calendar mutation regressions', { skip: !enabled }, async (t) => {
  const domain = await import('../domainInternals.js');
  const gas = await import('../../bookingCalendarSync.js');
  let state;
  let gasEnabled = false;
  let gasFailure = false;
  let gasCalls = [];
  mock.module('../../../db/index.js', { namedExports: {
    query: (sql, args) => state.query(sql, args),
    pool: { connect: async () => state.client() },
  } });
  mock.module('../../changeLog.js', { namedExports: { logChange: async () => {} } });
  mock.module('../lessonCounterReconcile.js', { namedExports: { reconcileCountersForAffectedRows: async () => ({}) } });
  mock.module('../../bookingCalendarSync.js', { namedExports: {
    ...gas,
    isBookingGasEnabled: () => gasEnabled,
    updateBookedLessonEventInGas: async (id, patch) => {
      gasCalls.push({ id, patch });
      return gasFailure ? { ok: false, error: 'Simulated Calendar outage' } : { ok: true };
    },
    deleteBookedLessonEventInGas: async () => ({ ok: true }),
  } });
  mock.module('../domainInternals.js', { namedExports: {
    ...domain,
    getOrderedEventStudents: async (id) => state.rows.filter((r) => r.event_id === id).map((r) => ({ id: r.student_id, name: r.student_name, is_child: false })),
    getPackTotalForBooking: async () => 4,
    getBookedCountForMonth: async () => state.rows.filter((r) => r.status === 'scheduled').length,
    shouldSkipAmbiguousRecurringForRows: async () => false,
    canonicalizeEventTitleById: async () => '',
  } });
  const handlers = await import('../cancelRescheduleService.js');
  const { handleBookLesson } = await import('../bookLessonService.js');
  const { handleSync } = await import('../_syncHandler.js');
  const active = (id, day = '01', extra = {}) => ({
    event_id: id, student_id: 7, student_name: 'Sora', lesson_uuid: null,
    title: 'Sora (Cafe) 1/4', lesson_kind: 'regular', lesson_mode: 'cafe', status: 'scheduled',
    date: `2026-10-${day}`, src_date_str: `2026-10-${day}`, src_time_jst: '13:00',
    start: `2026-10-${day}T04:00:00Z`, end: `2026-10-${day}T04:50:00Z`,
    calendar_sync_status: 'synced', awaiting_reschedule_date: false, ...extra,
  });
  function fixture(rows, links = []) {
    gasEnabled = false; gasFailure = false; gasCalls = [];
    let gate = Promise.resolve();
    const f = {
      rows: structuredClone(rows), links: structuredClone(links), lockCount: 0,
      client() {
        let unlock = null;
        return { query: async (sql, args) => {
          if (sql.includes('pg_advisory_xact_lock')) {
            const prior = gate;
            gate = new Promise((resolve) => { unlock = resolve; });
            await prior; f.lockCount++; return { rows: [] };
          }
          if (sql === 'COMMIT' || sql === 'ROLLBACK') { unlock?.(); unlock = null; return { rows: [] }; }
          return f.query(sql, args);
        }, release() { unlock?.(); } };
      },
      async query(sql, args = []) {
        const q = sql.replace(/\s+/g, ' ').trim();
        const result = (rows = []) => ({ rows: structuredClone(rows), rowCount: rows.length });
        if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') return result();
        if (q.startsWith('SELECT id, name')) return result((Array.isArray(args[0]) ? args[0] : [args[0]]).map((id) => ({ id, name: 'Sora', payment: 'regular', is_child: false })));
        if (q.startsWith('SELECT 1 FROM reschedules') || q.startsWith('SELECT * FROM reschedules')) return result(f.links.filter((r) => r.from_event_id === args[0] || (q.includes('OR to_event_id') && r.to_event_id === args[0])));
        if (q.startsWith('SELECT lessons FROM lessons')) return result([{ lessons: 4 }]);
        if (q.startsWith('SELECT') && q.includes('FROM monthly_schedule') && (q.includes('WHERE event_id = $1') || q.includes('WHERE m.event_id = $1'))) return result(f.rows.filter((r) => r.event_id === args[0]));
        const overlapping = () => f.rows.filter((r) => !['cancelled','rescheduled'].includes(r.status)
          && new Date(r.start) < new Date(args[1]) && new Date(r.end) > new Date(args[0]) && !(args[3] || []).includes(r.event_id));
        if (q.startsWith('SELECT is_kids_lesson')) return result(overlapping().map((r) => ({ is_kids_lesson: !!r.is_kids_lesson })));
        if (q.startsWith('SELECT COALESCE(s.name')) return result(overlapping().filter((r) => (args[2] || []).includes(r.student_id)));
        if (q.startsWith('SELECT COUNT(DISTINCT m.event_id)')) return result([{ cnt: overlapping().length }]);
        if (q.includes('FROM teacher_schedules') || q.includes('FROM teacher_break_presets')) return result();
        if (q.startsWith('INSERT INTO monthly_schedule')) {
          f.rows.push(active(args[0], args[3].slice(8), { lesson_uuid: args[1], title: args[2], date: args[3], src_date_str: args[3], start: args[4], end: args[5], student_name: args[6], student_id: args[11], calendar_sync_status: args[12], reschedule_snapshot_from_date: args[16] }));
          return result();
        }
        if (q.startsWith('INSERT INTO reschedules')) { f.links.push({ from_event_id: args[0], from_student_name: args[1], to_event_id: args[2], to_student_name: args[3] }); return result(); }
        if (q.startsWith('UPDATE lesson_notes')) return result();
        if (q.startsWith('DELETE FROM monthly_schedule')) { f.rows = f.rows.filter((r) => r.event_id !== args[0]); return result(); }
        if (q.startsWith('DELETE FROM reschedules')) { f.links = f.links.filter((r) => r.from_event_id !== args[0]); return result(); }
        if (q.startsWith('UPDATE monthly_schedule')) {
          for (const r of f.rows.filter((r) => r.event_id === args[0])) {
            if (q.includes('SET date = $2')) { r.date = args[1]; r.start = args[2]; r.end = args[3]; }
            if (q.includes("SET status = 'rescheduled'")) { r.status = 'rescheduled'; r.awaiting_reschedule_date = q.includes('awaiting_reschedule_date = TRUE'); r.title = args[2] || args[1] || r.title; }
            if (q.includes("SET status = 'cancelled'")) { r.status = 'cancelled'; r.awaiting_reschedule_date = false; r.title = args[1]; }
            if (q.includes("SET status = 'scheduled'")) { r.status = 'scheduled'; r.awaiting_reschedule_date = false; if(args[1]) r.title = args[1]; }
            if (q.includes('SET title = $3')) r.title = args[2];
            if (q.includes("SET calendar_sync_status = 'failed'")) { r.calendar_sync_status = 'failed'; r.calendar_sync_error = args[1]; }
            if (q.includes('SET calendar_sync_status = $2')) { r.calendar_sync_status = args[1]; r.calendar_sync_error = args[2]; }
          }
          return result();
        }
        throw new Error('Unhandled fixture SQL: ' + q);
      },
    };
    state = f; return f;
  }
  const response = () => ({ code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } });
  async function call(name, event = 'A', body = {}) {
    const r = response();
    await handlers[name]({ path: `/${event}/${name === 'handleRescheduleAwaitingDate' ? 'reschedule-awaiting-date' : name === 'handleCancel' ? 'cancel' : name === 'handleLegacyReschedule' ? 'reschedule' : 'uncancel'}`, params: {}, body: { source_event_id: event, student_id: 7, date: '2026-10-08', time: '13:00', ...body } }, r);
    return r;
  }
  for (const name of ['handleCancel', 'handleUncancel', 'handleRescheduleAwaitingDate']) {
    await t.test(`${name} rejects a linked source without changing its replacement`, async () => {
      const f = fixture([active('A','01',{status:'rescheduled'}),active('B','08')], [{from_event_id:'A',to_event_id:'B'}]);
      assert.equal((await call(name)).code, 409);
      assert.equal(f.rows[0].status, 'rescheduled'); assert.equal(f.rows.length, 2);
    });
  }
  await t.test('undo an older move is rejected; undo latest preserves incoming history', async () => {
    const f = fixture([active('A','01',{status:'rescheduled'}), active('B','08',{status:'rescheduled', reschedule_snapshot_from_date:'2026-10-01'}), active('C','15')], [{from_event_id:'A',to_event_id:'B'}, {from_event_id:'B',to_event_id:'C'}]);
    assert.equal((await call('handleUnrescheduleLinked','A')).code, 409);
    assert.equal(f.rows.length, 3);
    const undo = await call('handleUnrescheduleLinked','B');
    assert.equal(undo.code, 200, JSON.stringify(undo.body));
    assert.deepEqual(f.rows.map((r)=>r.event_id), ['A','B']);
    assert.equal(f.rows[1].status, 'scheduled');
    assert.match(f.rows[1].title, /Moved from 1st/);
    assert.deepEqual(f.links.map((r)=>[r.from_event_id,r.to_event_id]), [['A','B']]);
    assert.equal((await call('handleUnrescheduleLinked','A')).code, 200);
    assert.equal(f.rows.length, 1); assert.equal(f.rows[0].status, 'scheduled');
  });
  await t.test('restoring a lesson cannot double-book its old slot', async () => {
    fixture([active('A','01',{status:'cancelled'}),active('occupied','01')]);
    assert.equal((await call('handleUncancel')).code, 400);
    fixture([active('A','01',{status:'rescheduled'}),active('B','08'),active('occupied','01')], [{from_event_id:'A',to_event_id:'B'}]);
    assert.equal((await call('handleUnrescheduleLinked')).code, 400);
    assert.equal(state.rows.length, 3);
  });
  await t.test('Calendar failure is saved, returned, and retry updates existing cancelled event', async () => {
    const f = fixture([active('A')]); gasEnabled = true; gasFailure = true;
    const cancelled = await call('handleCancel');
    assert.equal(cancelled.code, 200, JSON.stringify(cancelled.body));
    assert.equal(f.rows[0].status, 'cancelled');
    assert.equal(cancelled.body.calendar_sync_status, 'failed');
    assert.match(f.rows[0].calendar_sync_error, /Simulated Calendar outage/);
    gasFailure = false;
    const retry = response(); await handleSync({body:{event_id:'A'}}, retry);
    assert.equal(retry.code, 200, JSON.stringify(retry.body));
    assert.equal(f.rows[0].calendar_sync_status, 'synced');
    assert.equal(f.rows[0].calendar_sync_error, null);
    assert.equal(f.rows.length, 1); assert.equal(gasCalls.length, 2);
    assert.equal(gasCalls[1].patch.colorId, '8');
  });
  await t.test('pending-date and uncancel retain database changes when Calendar fails', async () => {
    for (const name of ['handleRescheduleAwaitingDate', 'handleUncancel']) {
      const f = fixture([active('A','01', name === 'handleUncancel' ? { status:'cancelled', title:'Sora (Cafe) 1/4 · Cancelled' } : {})]);
      gasEnabled = true; gasFailure = true;
      const result = await call(name);
      assert.equal(result.code, 200, JSON.stringify(result.body));
      assert.equal(result.body.calendar_sync_status, 'failed');
      assert.equal(f.rows[0].status, name === 'handleUncancel' ? 'scheduled' : 'rescheduled');
      assert.match(f.rows[0].calendar_sync_error, /calendar-style/);
    }
  });
  await t.test('reschedule reports source styling failure without losing the replacement', async () => {
    const f = fixture([active('A')]); gasEnabled = true; gasFailure = true;
    const result = await call('handleRescheduleLinked');
    assert.equal(result.code, 201, JSON.stringify(result.body));
    assert.match(result.body.calendar_source_style_error, /Simulated Calendar outage/);
    assert.equal(f.links.length, 1); assert.equal(f.rows.length, 2);
    assert.equal(f.rows[0].calendar_sync_status, 'failed');
  });
  await t.test('reschedule rejects student overlap and capacity conflict', async () => {
    for (const studentId of [7,8]) {
      const f = fixture([active('A'),active('occupied','08',{student_id:studentId})]);
      const rejected = await call('handleRescheduleLinked');
      assert.equal(rejected.code, 400, JSON.stringify(rejected.body));
      assert.equal(f.rows.length, 2); assert.equal(f.links.length, 0);
    }
  });
  await t.test('duplicate simultaneous requests create one replacement and one link', async () => {
    const f = fixture([active('A')]);
    const result = await Promise.all([call('handleRescheduleLinked'),call('handleRescheduleLinked')]);
    assert.deepEqual(result.map((r)=>r.code).sort(), [201,409], JSON.stringify(result));
    assert.equal(f.rows.length, 2); assert.equal(f.links.length, 1);
    assert.equal(f.lockCount, 2);
  });
  await t.test('different sources competing for one slot are revalidated after the lock', async () => {
    const f = fixture([active('A'),active('B','02')]);
    const result = await Promise.all([call('handleRescheduleLinked','A'),call('handleRescheduleLinked','B')]);
    assert.deepEqual(result.map((r)=>r.code).sort(), [201,400], JSON.stringify(result));
    assert.equal(f.links.length, 1);
  });
  await t.test('normal booking and reschedule cannot both claim the same capacity', async () => {
    const f = fixture([active('A')]);
    const bookingResponse = response();
    const result = await Promise.all([
      call('handleRescheduleLinked'),
      handleBookLesson({body:{student_id:8,date:'2026-10-08',time:'13:00',pack_total:4}}, bookingResponse).then(() => bookingResponse),
    ]);
    assert.deepEqual(result.map((r)=>r.code).sort(), [201,400], JSON.stringify(result));
    assert.equal(f.rows.filter((r)=>r.date==='2026-10-08').length, 1);
  });
  await t.test('legacy move validates destination and keeps date-only moves consistent', async () => {
    const blocked = fixture([active('A'), active('occupied','08')]);
    const rejection = await call('handleLegacyReschedule');
    assert.equal(rejection.code, 400, JSON.stringify(rejection.body));
    assert.equal(blocked.rows[0].date, '2026-10-01');
    const f = fixture([active('A')]);
    const moved = await call('handleLegacyReschedule');
    assert.equal(moved.code, 200, JSON.stringify(moved.body));
    assert.equal(f.rows[0].date, '2026-10-08');
    assert.equal(f.rows[0].start, '2026-10-08T04:00:00.000Z');
    assert.equal((await call('handleLegacyReschedule','A',{date:'bad'})).code, 400);
  });
  await t.test('date and time rollover are rejected before writes', async () => {
    const f = fixture([active('A')]);
    for (const body of [{date:'2026-02-31'}, {time:'25:00'}, {time:'12:99'}]) {
      assert.equal((await call('handleRescheduleLinked','A',body)).code, 400);
    }
    assert.equal(f.rows.length, 1); assert.equal(f.links.length, 0);
  });
  mock.restoreAll();
});
