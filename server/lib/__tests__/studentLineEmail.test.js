import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStudentLineLinkEmail,
  isValidEmailAddress,
  maskEmailAddress,
} from '../studentLineEmail.js';

test('validates student email addresses', () => {
  assert.equal(isValidEmailAddress('keishi@example.com'), true);
  assert.equal(isValidEmailAddress('bad-address'), false);
  assert.equal(isValidEmailAddress(''), false);
});

test('masks the local part before returning a recipient to the UI', () => {
  assert.equal(maskEmailAddress('keishi@example.com'), 'ke****@example.com');
  assert.equal(maskEmailAddress('a@example.com'), 'a***@example.com');
  assert.equal(maskEmailAddress('invalid'), '');
});

test('builds Japanese LINE linking text and HTML around the supplied URL', () => {
  const linkUrl = 'https://booking.kaelenoer.com/link/TEST';
  const email = buildStudentLineLinkEmail({
    studentName: 'Keishi',
    linkUrl,
  });

  assert.equal(email.subject, 'Green Square LINE予約サービスのご案内');
  assert.match(email.text, /Keishi 様/);
  assert.match(email.text, /LINEアカウントの連携/);
  assert.match(email.text, /https:\/\/booking\.kaelenoer\.com\/link\/TEST/);
  assert.match(email.html, /LINEと連携する/);
  assert.match(email.html, /https:\/\/booking\.kaelenoer\.com\/link\/TEST/);
});
