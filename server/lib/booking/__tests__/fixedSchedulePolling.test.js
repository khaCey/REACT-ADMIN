import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

test(
  'polling cannot restore migrated placeholders, overwrite a moved appointment, or erase fixed history',
  {
    skip: !process.execArgv.includes('--experimental-test-module-mocks'),
  },
  async () => {
    const db = new PGlite();
    try {
      await db.exec(
        (
          await readFile(
            new URL('../../../db/schema.sql', import.meta.url),
            'utf8',
          )
        ).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''),
      );
      await db.exec(
        await readFile(
          new URL(
            '../../../db/add_individual_fixed_schedules.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      await db.query("INSERT INTO students(id,name) VALUES(7,'Sora')");
      await db.query(
        "INSERT INTO fixed_schedules(id,student_ids,weekday,time) VALUES('pattern',ARRAY[7],4,'13:00')",
      );
      const raw = `fs${'a'.repeat(64)}`,
        eventId = `${raw}_2026-10-01_04-00-00`;
      await db.query(
        `INSERT INTO fixed_schedule_occurrences(id,schedule_id,nominal_date,event_id,calendar_event_id,start,"end",status,title,legacy_event_id,legacy_calendar_source_event_id)
      VALUES('occurrence','pattern','2026-10-01',$1,$2,'2026-10-02T05:00:00Z','2026-10-02T05:50:00Z','scheduled','Local confirmed','old-series_2026-10-01_04-00-00','old-series')`,
        [eventId, raw],
      );
      await db.query(
        `INSERT INTO monthly_schedule(event_id,student_id,student_name,date,start,"end",status,title,calendar_sync_status,calendar_sync_error,fixed_schedule_id,fixed_occurrence_id)
      VALUES($1,7,'Sora','2026-10-02','2026-10-02T05:00:00Z','2026-10-02T05:50:00Z','scheduled','Local confirmed','failed','[fixed-schedule] pending','pattern','occurrence')`,
        [eventId],
      );
      mock.module('../../../db/index.js', {
        namedExports: { query: (sql, args) => db.query(sql, args), pool: {} },
      });
      const { upsertMonthlySchedule } = await import('../../calendarSync.js');
      const before = (await db.query('SELECT * FROM monthly_schedule')).rows;
      const result = await upsertMonthlySchedule(
        [
          {
            eventID: raw,
            studentName: 'Sora',
            date: '2026-10-01',
            start: '2026-10-01T04:00:00Z',
            end: '2026-10-01T04:50:00Z',
            status: 'reserved',
            title: 'Old Calendar state',
          },
          {
            eventID: 'old-series',
            studentName: 'Sora',
            date: '2026-10-01',
            start: '2026-10-01T04:00:00Z',
            end: '2026-10-01T04:50:00Z',
            status: 'reserved',
            title: 'Legacy hold',
          },
        ],
        { forceReconcile: true, removed: [`${raw}|Sora|2026-10-02`] },
      );
      assert.equal(result.upserted, 0);
      assert.deepEqual(
        (await db.query('SELECT * FROM monthly_schedule')).rows,
        before,
      );
    } finally {
      mock.restoreAll();
      await db.close();
    }
  },
);
