import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalEventMembers, validateCalendarSnapshot } from '../calendarMemberValidation.js';

test('case variants cannot multiply members across repeated title rewrites', () => {
  const input = [{ id: null, name: 'sora Example' }, { id: 7, name: 'Sora Example' }, { id: 8, name: 'Rin Example' }];
  const result = canonicalEventMembers(input);
  assert.deepEqual(result.map(m => m.id), [7, 8]);
  assert.deepEqual(canonicalEventMembers([...result, ...input]), result);
});
test('rejects previously generated group-name fragments before rewriting Calendar', () => {
  assert.throws(() => canonicalEventMembers([{ id: 7, name: 'Sora Example' }, { id: null, name: 'Sora Example, sora Example, Sora,,' }]), /Ambiguous Calendar group member/);
  assert.equal(canonicalEventMembers([{ id: null, name: 'Unregistered Guest' }]).length, 1);
});
test('rejects oversized snapshot names with field and event context', () => {
  assert.doesNotThrow(() => validateCalendarSnapshot([{ studentName: '字'.repeat(255) }]));
  assert.throws(() => validateCalendarSnapshot([{ studentName: '字'.repeat(256), eventID: 'event-1', date: '2026-10-18' }]), e => e.rowContext.field === 'student_name' && e.rowContext.eventId === 'event-1');
});

test('distinct registered students with the same name remain distinct', () => {
  assert.equal(canonicalEventMembers([{id: 7, name: 'Sora'}, {id: 8, name: 'Sora'}]).length, 2);
});
