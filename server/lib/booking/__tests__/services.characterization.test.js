import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertBookableSlotForConfirm } from '../slotValidation.js';
import { handleBookLesson } from '../bookLessonService.js';
import { handleGetWeek } from '../availabilityService.js';
import { handleRemoveLesson } from '../removeLessonService.js';
import { BOOK_SUCCESS_REQUIRED_KEYS, WEEK_GRID_REQUIRED_KEYS } from '../contracts.js';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('slotValidation.assertBookableSlotForConfirm', () => {
  it('requires excludedEventIds', async () => {
    const result = await assertBookableSlotForConfirm({
      startDate: new Date('2026-08-03T01:00:00.000Z'),
      endDate: new Date('2026-08-03T01:50:00.000Z'),
      dateStr: '2026-08-03',
      orderedStudents: [{ id: 1, is_child: false, payment: 'regular' }],
      excludedEventIds: [],
      db: async () => ({ rows: [] }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 500);
  });

  it('rejects kids into adult-occupied slot', async () => {
    const result = await assertBookableSlotForConfirm({
      startDate: new Date('2026-08-03T01:00:00.000Z'),
      endDate: new Date('2026-08-03T01:50:00.000Z'),
      dateStr: '2026-08-03',
      orderedStudents: [{ id: 1, is_child: true, payment: 'regular' }],
      excludedEventIds: ['hold-1'],
      db: async (sql) => {
        if (sql.includes('SELECT is_kids_lesson')) {
          return { rows: [{ is_kids_lesson: false }] };
        }
        return { rows: [] };
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.error, /Kids and adults/i);
  });

  it('rejects overlapping lesson for same student', async () => {
    let call = 0;
    const result = await assertBookableSlotForConfirm({
      startDate: new Date('2026-08-03T01:00:00.000Z'),
      endDate: new Date('2026-08-03T01:50:00.000Z'),
      dateStr: '2026-08-03',
      orderedStudents: [{ id: 42, is_child: false, payment: 'regular', name: 'Ada' }],
      excludedEventIds: ['hold-1'],
      db: async (sql) => {
        call += 1;
        if (sql.includes('SELECT is_kids_lesson')) return { rows: [] };
        if (sql.includes('already') || sql.includes('student_name')) {
          return { rows: [{ student_name: 'Ada' }] };
        }
        // teacher / capacity queries
        if (sql.includes('teacher_schedules')) {
          return {
            rows: [
              {
                teacher_name: 'T1',
                start_time: '10:00',
                end_time: '18:00',
                extend_before_minutes: 0,
                extend_after_minutes: 0,
              },
            ],
          };
        }
        if (sql.includes('teacher_break_presets')) return { rows: [] };
        if (sql.includes('COUNT(DISTINCT')) return { rows: [{ cnt: 0 }] };
        if (sql.includes('DISTINCT teacher_name')) return { rows: [{ teacher_name: 'T1' }] };
        return { rows: [] };
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.error, /already has a lesson overlapping/i);
    assert.ok(call >= 2);
  });
});

describe('service handler exports (characterization)', () => {
  it('exports book / week / remove handlers', () => {
    assert.equal(typeof handleBookLesson, 'function');
    assert.equal(typeof handleGetWeek, 'function');
    assert.equal(typeof handleRemoveLesson, 'function');
  });

  it('POST /book rejects missing fields without hitting DB', async () => {
    const res = mockRes();
    await handleBookLesson({ body: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.match(String(res.body?.error || ''), /Missing student_id or group_id/);
  });

  it('GET /week rejects bad week_start without full grid', async () => {
    const res = mockRes();
    await handleGetWeek({ query: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.match(String(res.body?.error || ''), /week_start/);
  });

  it('contract key lists remain non-empty for response assertions', () => {
    assert.ok(BOOK_SUCCESS_REQUIRED_KEYS.length >= 5);
    assert.ok(WEEK_GRID_REQUIRED_KEYS.length >= 5);
  });
});
