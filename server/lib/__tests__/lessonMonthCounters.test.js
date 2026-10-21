import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countsTowardsRegularLessonPack,
  countBookedRegularLessons, restoreActiveLessonTitle, parseLessonPackTotal, applyCancelledTitleMarker, stripCancelledTitleMarker,
} from '../lessonMonthCounters.js';

test('demo lessons do not consume regular monthly credits', () => {
  const lessons = [
    { lessonKind: 'demo', status: 'scheduled', eventID: 'demo' },
    { lessonKind: 'regular', status: 'scheduled', eventID: 'regular-one' },
    { lessonKind: 'regular', status: 'reserved', eventID: 'regular-two' },
  ];
  assert.equal(countBookedRegularLessons(lessons), 2);
  assert.equal(Math.max(0, 4 - countBookedRegularLessons(lessons)), 2);
});

test('past demos remain excluded after student joins regular lessons', () => {
  const lessons = [
    { lessonKind: 'Demo', status: 'scheduled' },
    { lessonKind: 'regular', status: 'scheduled' },
    { lessonKind: 'OWNER', status: 'scheduled' },
    { lessonKind: 'staff_break', status: 'scheduled' },
  ];
  assert.equal(countBookedRegularLessons(lessons), 2);
});

test('cancelled credits count, linked sources and unscheduled placeholders do not', () => {
  const lessons = [
    { lessonKind: 'regular', status: 'scheduled' },
    { lessonKind: 'regular', status: 'cancelled' },
    { lessonKind: 'regular', status: 'rescheduled', awaitingRescheduleDate: true },
    { lessonKind: 'regular', status: 'rescheduled' },
    { lessonKind: 'regular', status: 'scheduled', rescheduledTo: { eventID: 'new' } },
    { lessonKind: 'regular', status: 'scheduled', optimisticRescheduledTo: { eventID: 'new' } },
    { lessonKind: 'regular', status: 'unscheduled' },
    { lessonKind: 'regular', status: 'scheduled', rescheduledFrom: { eventID: 'old' } },
  ];
  assert.equal(countBookedRegularLessons(lessons), 4);
});

test('legacy kind missing defaults to regular and empty lists are safe', () => {
  assert.equal(countsTowardsRegularLessonPack({ status: 'scheduled' }), true);
  assert.equal(countBookedRegularLessons(null), 0);
  assert.equal(countBookedRegularLessons([]), 0);
});

test('pack parser and cancellation markers survive movement suffixes without duplication', () => {
  for (const title of ['Sora (Cafe) 2/4', 'Sora (Cafe) 2/4 · Moved to ???', 'Sora (Cafe) 2/4 · Moved from 8th']) {
    assert.equal(parseLessonPackTotal(title), 4);
    const cancelled = applyCancelledTitleMarker(title);
    assert.equal(applyCancelledTitleMarker(cancelled), cancelled);
    assert.equal(stripCancelledTitleMarker(cancelled), title);
    assert.equal(parseLessonPackTotal(cancelled), 4);
  }
});

test('undo clears pending movement but preserves replacement history', () => {
  assert.equal(restoreActiveLessonTitle('Sora (Cafe) 2/4 · Moved to ??? · Cancelled'), 'Sora (Cafe) 2/4');
  assert.equal(restoreActiveLessonTitle('Sora (Cafe) 2/4 · Moved from 8th · Cancelled'), 'Sora (Cafe) 2/4 · Moved from 8th');
});
