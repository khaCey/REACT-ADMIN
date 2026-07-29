import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEEK_GRID_REQUIRED_KEYS,
  WEEK_GRID_OPTIONAL_KEYS,
  BOOK_SUCCESS_REQUIRED_KEYS,
} from '../contracts.js';

describe('booking frozen contracts', () => {
  it('GET /week required keys stay stable for BookLessonModal', () => {
    assert.deepEqual(WEEK_GRID_REQUIRED_KEYS, [
      'slots',
      'teachersBySlot',
      'slotTypes',
      'slotMix',
      'breakRuleBlocked',
      'staffBreakBySlot',
    ]);
  });

  it('GET /week optional keys documented', () => {
    assert.ok(WEEK_GRID_OPTIONAL_KEYS.includes('studentBookedSlots'));
    assert.ok(WEEK_GRID_OPTIONAL_KEYS.includes('ownerShamBlocked'));
    assert.ok(WEEK_GRID_OPTIONAL_KEYS.includes('ownerCourseConflictBlocked'));
  });

  it('POST /book success keys stay stable', () => {
    assert.deepEqual(BOOK_SUCCESS_REQUIRED_KEYS, [
      'ok',
      'event_id',
      'calendar_sync_status',
      'date',
      'start',
      'end',
    ]);
  });
});
