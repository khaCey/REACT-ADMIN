import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarPollRunner } from '../calendarPollState.js';

test('overlapping callers share one import and only completed imports advance refresh version', async () => {
  let finish;
  let calls = 0;
  const runner = createCalendarPollRunner(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, () => '2026-10-29T08:00:00.000Z');
  const first = runner.run();
  const second = runner.run();
  assert.equal(first, second);
  assert.equal(runner.status().running, true);
  assert.equal(runner.status().version, 0);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish({ ok: true });
  await first;
  assert.equal(runner.status().version, 1);
  assert.equal(runner.status().running, false);
  assert.equal(runner.status().lastSuccessAt, '2026-10-29T08:00:00.000Z');
});

test('a failed import preserves last success, exposes no error secrets, and permits retry', async () => {
  let fail = false;
  const runner = createCalendarPollRunner(async () => { if (fail) throw new Error('secret-key-in-error'); return { ok: true }; });
  await runner.run();
  const success = runner.status().lastSuccessAt;
  fail = true;
  await assert.rejects(runner.run(), /secret-key/);
  assert.equal(runner.status().lastSuccessAt, success);
  assert.equal(runner.status().version, 1);
  assert.equal(runner.status().failed, true);
  assert.equal(JSON.stringify(runner.status()).includes('secret-key'), false);
  fail = false;
  await runner.run();
  assert.equal(runner.status().version, 2);
  assert.equal(runner.status().failed, false);
});

test('skipped imports do not pretend to refresh the database; status is a defensive copy', async () => {
  const runner = createCalendarPollRunner(async () => ({ ok: false, skipped: true }));
  await runner.run();
  assert.equal(runner.status().version, 0);
  assert.equal(runner.status().lastSuccessAt, null);
  const copy = runner.status();
  copy.version = 999;
  assert.equal(runner.status().version, 0);
});
