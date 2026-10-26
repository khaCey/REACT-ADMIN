import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createFixedScheduleService } from '../individualFixedScheduleService.js';
import {
  occurrenceDates,
  addMonths,
  fixedStart,
} from '../fixedScheduleDates.js';

test('fixed dates handle five-week months, year boundaries and invalid input', () => {
  assert.equal(occurrenceDates('2026-11', 7).length, 5);
  assert.equal(addMonths('2026-12', 2), '2027-02');
  assert.throws(() => fixedStart('2026-02-31', '13:00'));
  assert.throws(() => fixedStart('2026-10-01', '25:00'));
});

async function fixture(horizon = 1) {
  const db = new PGlite();
  const schema = (
    await readFile(new URL('../../../db/schema.sql', import.meta.url), 'utf8')
  ).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '');
  await db.exec(schema);
  await db.exec(
    await readFile(
      new URL(
        '../../../db/add_individual_fixed_schedules.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  // Reapplying the additive migration must be safe.
  await db.exec(
    await readFile(
      new URL(
        '../../../db/add_individual_fixed_schedules.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  await db.query(
    `INSERT INTO students(id,name,status,payment,fixed_months_ahead) VALUES(7,'Sora','Active','NEO',$1)`,
    [horizon],
  );
  const calendarEvents = new Map(),
    calls = [],
    statements = [];
  let failed = false,
    rejectedSlot = false;
  const query = async (sql, args) => {
    statements.push(sql);
    // PGlite has one session; transaction sequencing is tested, not PostgreSQL advisory-lock concurrency.
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    return db.query(sql, args);
  };
  const pool = { connect: async () => ({ query, release() {} }) };
  const service = createFixedScheduleService({
    pool,
    validateSlot: async () =>
      rejectedSlot
        ? { ok: false, status: 409, error: 'Slot occupied' }
        : { ok: true },
    calendar: async (payload) => {
      calls.push({ ...payload });
      if (failed) return { ok: false, error: 'Simulated outage' };
      calendarEvents.set(payload.eventId, { ...payload });
      return { ok: true, eventId: payload.eventId, independent: true };
    },
  });
  const req = (body) => ({ body, staff: { id: null, name: 'Test' } });
  const setup = () =>
    service.setup(
      req({
        student_id: 7,
        month: '2026-10',
        date: '2026-10-01',
        time: '13:00',
      }),
    );
  const reserved = async (month = '2026-10') =>
    (
      await query(
        `SELECT DISTINCT event_id FROM monthly_schedule WHERE to_char(date,'YYYY-MM')=$1 AND status='reserved' ORDER BY event_id`,
        [month],
      )
    ).rows;
  const confirmMonth = async (month = '2026-10') => {
    let last;
    for (const row of await reserved(month))
      last = await service.confirm(
        req({ event_id: row.event_id, confirm_month: month }),
      );
    return last;
  };
  return {
    db,
    query,
    service,
    req,
    setup,
    reserved,
    confirmMonth,
    calendarEvents,
    calls,
    statements,
    fail(value) {
      failed = value;
    },
    rejectSlot(value) {
      rejectedSlot = value;
    },
  };
}

test('confirm updates independent IDs, extends configured horizon and does not auto-roll unpaid months', async () => {
  const f = await fixture(2);
  try {
    await f.setup();
    const octoberIds = [...f.calendarEvents.keys()];
    assert.equal(octoberIds.length, 5);
    assert.equal(
      (
        await f.query(
          'SELECT COUNT(DISTINCT lesson_uuid) AS n FROM monthly_schedule',
        )
      ).rows[0].n,
      5,
    );
    await f.confirmMonth();
    assert.equal((await f.reserved('2026-11')).length, 4);
    assert.equal((await f.reserved('2026-12')).length, 5);
    assert.equal((await f.reserved('2027-01')).length, 0);
    for (const id of octoberIds)
      assert.equal(f.calendarEvents.get(id).status, 'scheduled');
    const count = f.calendarEvents.size;
    await f.service.retryFuture(f.req({ student_id: 7 }));
    await f.service.retryFuture(f.req({ student_id: 7 }));
    assert.equal(
      f.calendarEvents.size,
      count,
      'retries cannot create duplicates or roll the horizon',
    );
    await f.confirmMonth('2026-11');
    assert.equal((await f.reserved('2027-01')).length, 4);
    assert.ok(
      f.statements.every((s) => !/^DELETE/i.test(s.trim())),
      'confirmation never deletes history',
    );
    assert.ok(f.calls.every((p) => !p.recurrence));
  } finally {
    await f.db.close();
  }
});

test('different students have different horizons; zero creates no future holds', async () => {
  const f = await fixture(0);
  try {
    await f.setup();
    await f.confirmMonth();
    assert.equal((await f.reserved('2026-11')).length, 0);
    await f.query(`UPDATE students SET fixed_months_ahead=3 WHERE id=7`);
    await f.service.retryFuture(f.req({ student_id: 7 }));
    assert.equal((await f.reserved('2027-01')).length, 4);
    await assert.rejects(
      f.query('UPDATE students SET fixed_months_ahead=13 WHERE id=7'),
    );
  } finally {
    await f.db.close();
  }
});

test('legacy confirmation preserves June–October history and never deletes the Calendar series', async () => {
  const f = await fixture(1);
  try {
    for (const month of ['06', '07', '08', '09']) {
      await f.query(
        `INSERT INTO monthly_schedule(event_id,student_name,student_id,date,start,"end",status,title,calendar_source_event_id)
        VALUES($1,'Sora',7,$2,$3,$4,'scheduled','Sora (Cafe) 1/4','legacy-series')`,
        [
          `history-${month}`,
          `2026-${month}-01`,
          `2026-${month}-01T04:00:00Z`,
          `2026-${month}-01T04:50:00Z`,
        ],
      );
    }
    for (const date of occurrenceDates('2026-10', 4)) {
      await f.query(
        `INSERT INTO monthly_schedule(event_id,student_name,student_id,date,start,"end",status,title,calendar_source_event_id)
        VALUES($1,'Sora',7,$2,$3,$4,'reserved','Sora (Cafe)','legacy-series')`,
        [`legacy-${date}`, date, `${date}T04:00:00Z`, `${date}T04:50:00Z`],
      );
    }
    f.calendarEvents.set('legacy-series', { history: true });
    await f.confirmMonth();
    assert.deepEqual(f.calendarEvents.get('legacy-series'), { history: true });
    assert.equal(
      (
        await f.query(
          "SELECT * FROM monthly_schedule WHERE event_id LIKE 'history-%'",
        )
      ).rows.length,
      4,
    );
    assert.equal((await f.reserved('2026-11')).length, 4);
    assert.equal(
      (
        await f.query(
          "SELECT * FROM monthly_schedule WHERE date<'2026-10-01' AND fixed_occurrence_id IS NOT NULL",
        )
      ).rows.length,
      0,
    );
  } finally {
    await f.db.close();
  }
});

test('Calendar failure persists an appointment and retry uses the same Calendar identity', async () => {
  const f = await fixture(1);
  try {
    await f.setup();
    const row = (await f.reserved())[0];
    f.fail(true);
    const result = await f.service.confirm(f.req({ event_id: row.event_id }));
    assert.equal(result.calendar_sync_status, 'failed');
    assert.equal(
      (
        await f.query(
          'SELECT status,calendar_sync_status FROM monthly_schedule WHERE event_id=$1',
          [row.event_id],
        )
      ).rows[0].status,
      'scheduled',
    );
    assert.equal((await f.reserved('2026-11')).length, 0);
    f.fail(false);
    await f.service.retry(f.req({ event_id: row.event_id }));
    assert.equal(f.calendarEvents.size, 5);
    assert.equal(
      (
        await f.query(
          'SELECT calendar_sync_error FROM monthly_schedule WHERE event_id=$1',
          [row.event_id],
        )
      ).rows[0].calendar_sync_error,
      null,
    );
    await f.confirmMonth();
    assert.equal((await f.reserved('2026-11')).length, 4);
  } finally {
    await f.db.close();
  }
});

test('moving a single appointment keeps its identity, notes and original future weekday', async () => {
  const f = await fixture(1);
  try {
    await f.setup();
    const row = (await f.reserved())[0];
    const before = (
      await f.query('SELECT * FROM monthly_schedule WHERE event_id=$1', [
        row.event_id,
      ])
    ).rows[0];
    await f.service.move(
      f.req({ event_id: row.event_id, date: '2026-10-02', time: '14:00' }),
    );
    const after = (
      await f.query('SELECT * FROM monthly_schedule WHERE event_id=$1', [
        row.event_id,
      ])
    ).rows[0];
    assert.equal(after.lesson_uuid, before.lesson_uuid);
    assert.equal(
      after.calendar_source_event_id,
      before.calendar_source_event_id,
    );
    await f.confirmMonth();
    const next = (
      await f.query(
        "SELECT EXTRACT(ISODOW FROM date) AS day FROM monthly_schedule WHERE date>='2026-11-01'",
      )
    ).rows;
    assert.ok(
      next.every((r) => Number(r.day) === 4),
      'one-off moves cannot change the weekly pattern',
    );
    f.rejectSlot(true);
    await assert.rejects(
      f.service.move(
        f.req({ event_id: row.event_id, date: '2026-10-03', time: '15:00' }),
      ),
      /Slot occupied/,
    );
  } finally {
    await f.db.close();
  }
});

test('future Calendar failures retry without extending beyond the last confirmed month', async () => {
  const f = await fixture(1);
  try {
    await f.setup();
    const current = await f.reserved();
    for (const r of current.slice(0, -1))
      await f.service.confirm(f.req({ event_id: r.event_id }));
    const last = current.at(-1);
    let calls = 0;
    // Let the final confirmation sync, then fail the future holds.
    const base = f.calendarEvents;
    const service = createFixedScheduleService({
      pool: { connect: async () => ({ query: f.query, release() {} }) },
      validateSlot: async () => ({ ok: true }),
      calendar: async (p) => {
        if (++calls > 1) return { ok: false, error: 'Future outage' };
        base.set(p.eventId, p);
        return { ok: true };
      },
    });
    const result = await service.confirm(f.req({ event_id: last.event_id }));
    assert.equal(result.calendar_errors.length, 4);
    assert.equal((await f.reserved('2026-11')).length, 4);
    await f.service.retryFuture(f.req({ student_id: 7 }));
    assert.equal(
      (
        await f.query(
          "SELECT * FROM monthly_schedule WHERE calendar_sync_status<>'synced'",
        )
      ).rows.length,
      0,
    );
    assert.equal((await f.reserved('2026-12')).length, 0);
    const removed = (await f.reserved('2026-11'))[0];
    await f.query('DELETE FROM monthly_schedule WHERE event_id=$1', [
      removed.event_id,
    ]);
    await f.service.retryFuture(f.req({ student_id: 7 }));
    assert.equal(
      (await f.reserved('2026-11')).length,
      3,
      'explicitly removed appointments are not regenerated',
    );
  } finally {
    await f.db.close();
  }
});

test('shared groups use the shortest horizon; legacy future holds are converted without duplicate rows', async () => {
  const f = await fixture(3);
  try {
    await f.query(
      "INSERT INTO students(id,name,status,payment,fixed_months_ahead) VALUES(8,'Kei','Active','NEO',1)",
    );
    await f.query(
      "UPDATE students SET group_type='Group',group_size=2 WHERE id IN (7,8)",
    );
    const g = (
      await f.query(
        'INSERT INTO student_groups(expected_size) VALUES(2) RETURNING id',
      )
    ).rows[0].id;
    await f.query(
      'INSERT INTO student_group_members(group_id,student_id,sort_order) VALUES($1,7,1),($1,8,2)',
      [g],
    );
    await f.setup();
    for (const date of occurrenceDates('2026-11', 4)) {
      for (const [sid, name] of [
        [7, 'Sora'],
        [8, 'Kei'],
      ]) {
        await f.query(
          `INSERT INTO monthly_schedule(event_id,student_name,student_id,date,start,"end",status,title,calendar_source_event_id)
          VALUES($1,$2,$3,$4,$5,$6,'reserved','Legacy group','old-group-series')`,
          [
            `legacy-${date}`,
            name,
            sid,
            date,
            `${date}T04:00:00Z`,
            `${date}T04:50:00Z`,
          ],
        );
      }
    }
    await f.confirmMonth();
    assert.equal((await f.reserved('2026-11')).length, 4);
    assert.equal((await f.reserved('2026-12')).length, 0);
    assert.equal(
      (await f.query("SELECT * FROM monthly_schedule WHERE date>='2026-11-01'"))
        .rows.length,
      8,
    );
    assert.equal(
      (
        await f.query(
          "SELECT * FROM monthly_schedule WHERE date>='2026-11-01' AND fixed_occurrence_id IS NULL",
        )
      ).rows.length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
