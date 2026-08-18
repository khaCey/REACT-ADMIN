import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStudentLineLinkInvitation,
  isStudentLineLinkApiConfigured,
} from '../studentLineInvitation.js';

const ORIGINAL_URL = process.env.LINE_LINK_API_URL;

test.afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.LINE_LINK_API_URL;
  else process.env.LINE_LINK_API_URL = ORIGINAL_URL;
});

test('reports whether the GAS invitation API is configured', () => {
  delete process.env.LINE_LINK_API_URL;
  assert.equal(isStudentLineLinkApiConfigured(), false);

  process.env.LINE_LINK_API_URL = 'https://script.google.com/macros/s/test/exec';
  assert.equal(isStudentLineLinkApiConfigured(), true);
});

test('creates a LINE invitation without sending an API key', async () => {
  process.env.LINE_LINK_API_URL = 'https://script.google.com/macros/s/test/exec';

  let capturedUrl = null;
  let capturedOptions = null;
  const fakeFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      async json() {
        return {
          ok: true,
          invitationId: 'invite-1',
          studentNumber: '12345',
          link: 'https://booking.greensquare.jp/link/example-token',
          expiresAt: '2026-08-19T10:00:00.000Z',
          expiresInHours: 24,
        };
      },
    };
  };

  const result = await createStudentLineLinkInvitation('12345', '7', fakeFetch);
  const body = JSON.parse(capturedOptions.body);

  assert.equal(capturedUrl, process.env.LINE_LINK_API_URL);
  assert.equal(capturedOptions.method, 'POST');
  assert.deepEqual(body, {
    action: 'line_link_create',
    studentNumber: '12345',
    createdByStaffId: '7',
  });
  assert.equal(Object.hasOwn(body, 'apiKey'), false);
  assert.equal(result.link, 'https://booking.greensquare.jp/link/example-token');
  assert.equal(result.expiresInHours, 24);
});

test('uses GAS payload.ok as the application-level result', async () => {
  process.env.LINE_LINK_API_URL = 'https://script.google.com/macros/s/test/exec';

  const fakeFetch = async () => ({
    ok: true,
    async json() {
      return {
        ok: false,
        code: 'INVALID_STUDENT_NUMBER',
        error: 'studentNumber must contain only digits.',
      };
    },
  });

  await assert.rejects(
    () => createStudentLineLinkInvitation('12345', '', fakeFetch),
    (err) => err.code === 'INVALID_STUDENT_NUMBER'
  );
});
