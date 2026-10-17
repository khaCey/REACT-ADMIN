import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { pushGuideStaffRoster } from '../guideStaffRosterPush.js';

const URL = 'https://www.greensquare.jp/admin/api/guide-staff-sync.php';
const SECRET = '0123456789abcdef0123456789abcdef0123456789';

test('sends only active staff names and IDs in an HMAC-signed HTTPS request', async () => {
  let request;
  let dbCalls = 0;
  const result = await pushGuideStaffRoster({
    queryFn: async (sql) => {
      dbCalls++;
      assert.match(sql, /WHERE active = TRUE/);
      return { rows: [{ id: 4, name: 'Haruka' }, { id: 7, name: 'Ana' }] };
    },
    fetchFn: async (url, options) => {
      request = { url, ...options };
      return { ok: true, status: 200 };
    },
    url: URL,
    secret: SECRET,
    epochSeconds: 1781670000,
  });
  assert.equal(result.count, 2);
  assert.equal(dbCalls, 1);
  assert.equal(request.url, URL);
  assert.equal(request.method, 'POST');
  assert.equal(request.redirect, 'error');
  assert.deepEqual(JSON.parse(request.body), {
    staff: [{ id: 4, name: 'Haruka' }, { id: 7, name: 'Ana' }],
  });
  const expected = createHmac('sha256', SECRET)
    .update('1781670000.' + request.body).digest('hex');
  assert.equal(request.headers['X-GS-Staff-Signature'], expected);
  assert.equal(request.headers['X-GS-Staff-Time'], '1781670000');
});

test('requires HTTPS before querying the staff database', async () => {
  let queried = false;
  await assert.rejects(
    pushGuideStaffRoster({
      queryFn: async () => { queried = true; return { rows: [] }; },
      url: 'http://localhost:3002/api/staff',
      secret: SECRET,
    }),
    /HTTPS/
  );
  assert.equal(queried, false);
});

test('does not send an empty roster or insufficient secret', async () => {
  let sent = false;
  const q = async () => ({ rows: [] });
  const f = async () => { sent = true; return { ok: true }; };
  await assert.rejects(pushGuideStaffRoster({
    queryFn: q, fetchFn: f, url: URL, secret: SECRET,
  }), /Active staff list/);
  await assert.rejects(pushGuideStaffRoster({
    queryFn: q, fetchFn: f, url: URL, secret: 'weak',
  }), /32 characters/);
  assert.equal(sent, false);
});

test('surfaces HTTP failure for retry on next interval', async () => {
  await assert.rejects(pushGuideStaffRoster({
    queryFn: async () => ({ rows: [{ id: 1, name: 'Staff' }] }),
    fetchFn: async () => ({ ok: false, status: 503 }),
    url: URL,
    secret: SECRET,
  }), /503/);
});
