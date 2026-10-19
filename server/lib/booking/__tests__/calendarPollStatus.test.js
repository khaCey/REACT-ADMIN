import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePolledScheduleStatus } from '../../calendarPollStatus.js';

test('moved-to source remains rescheduled even if GAS returns cancelled for graphite', () => {
  assert.equal(resolvePolledScheduleStatus('cancelled', 'Sora (Cafe) 1/4 · Moved to 23rd'), 'rescheduled');
  assert.equal(resolvePolledScheduleStatus('scheduled', 'Sora (Cafe) 1/4 Moved to ???'), 'rescheduled');
});

test('moved-from replacement remains scheduled even if GAS wrongly labels it rescheduled', () => {
  assert.equal(resolvePolledScheduleStatus('rescheduled', 'Sora (Cafe) 1/4 · Moved from 20th'), 'scheduled');
  assert.equal(resolvePolledScheduleStatus('scheduled', 'Sora (Cafe) 1/4 Moved from 20th'), 'scheduled');
});

test('explicit cancellations on replacement lessons are not silently reinstated', () => {
  assert.equal(resolvePolledScheduleStatus('cancelled', 'Sora (Cafe) 1/4 · Moved from 20th'), 'cancelled');
});

test('subsequently moved replacement becomes a rescheduled source', () => {
  assert.equal(resolvePolledScheduleStatus('scheduled', 'Sora (Cafe) 1/4 · Moved to 25th'), 'rescheduled');
  assert.equal(resolvePolledScheduleStatus('rescheduled', 'Sora (Cafe) 1/4 Moved to 25th'), 'rescheduled');
});

test('legacy reschedule marker remains inactive and unchanged titles keep their statuses', () => {
  assert.equal(resolvePolledScheduleStatus('scheduled', 'Sora (Cafe) 1/4 [RESCHEDULED]'), 'rescheduled');
  assert.equal(resolvePolledScheduleStatus('reserved', 'Sora (Cafe) 1/4'), 'reserved');
  assert.equal(resolvePolledScheduleStatus('cancelled', 'Sora (Cafe) 1/4'), 'cancelled');
  assert.equal(resolvePolledScheduleStatus('weird', 'Sora (Cafe) 1/4'), 'scheduled');
});
