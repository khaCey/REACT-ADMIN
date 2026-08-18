import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const DEFAULT_TEST_LINK = 'https://booking.kaelenoer.com/link/TEST';

function loadServiceAccountCredentials() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (keyPath) {
    try {
      const resolved = join(__dir, '..', '..', keyPath.replace(/^\.\//, ''));
      return JSON.parse(readFileSync(resolved, 'utf8'));
    } catch (err) {
      console.error('[StudentLineEmail] failed to read service-account key', err.message);
      return null;
    }
  }

  if (keyJson) {
    try {
      const raw = keyJson.startsWith('{')
        ? keyJson
        : Buffer.from(keyJson, 'base64').toString('utf8');
      return JSON.parse(raw);
    } catch (err) {
      console.error('[StudentLineEmail] failed to parse GOOGLE_SERVICE_ACCOUNT_JSON', err.message);
      return null;
    }
  }

  return null;
}

function envEnabled(value) {
  if (value == null || String(value).trim() === '') return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export function isStudentLineEmailEnabled() {
  return envEnabled(process.env.GOOGLE_MAIL_ENABLED);
}

export function isValidEmailAddress(value) {
  const email = String(value || '').trim();
  if (!email || email.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function maskEmailAddress(value) {
  const email = String(value || '').trim();
  const at = email.indexOf('@');
  if (at <= 0) return '';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  const maskedLocal = `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}`;
  return `${maskedLocal}@${domain}`;
}

export function getLineLinkEmailTestUrl() {
  return String(process.env.LINE_LINK_EMAIL_TEST_URL || DEFAULT_TEST_LINK).trim();
}

function getDelegatedUser() {
  return String(
    process.env.GOOGLE_MAIL_DELEGATED_USER ||
      process.env.GOOGLE_CONTACTS_DELEGATED_USER ||
      ''
  ).trim();
}

function getFromAddress() {
  return String(process.env.GOOGLE_MAIL_FROM_ADDRESS || getDelegatedUser()).trim();
}

function getFromName() {
  return String(process.env.GOOGLE_MAIL_FROM_NAME || 'Green Square').trim() || 'Green Square';
}

function encodeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value), 'utf8').toString('base64')}?=`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function base64Body(value) {
  return Buffer.from(String(value), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
}

function toBase64Url(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function buildStudentLineLinkEmail({ studentName, linkUrl }) {
  const safeName = String(studentName || '').trim();
  const greeting = safeName ? `${safeName} 様` : 'Green Square 生徒様';
  const subject = 'Green Square LINE予約サービスのご案内';

  const text = `${greeting}\n\nいつもGreen Squareをご利用いただきありがとうございます。\n\nLINEからレッスンの予約・日時変更をご利用いただけるよう、LINEアカウントの連携をご案内しています。\n\n下記のリンクを開き、画面の案内に沿ってLINEと連携してください。\n\n${linkUrl}\n\n※このメールに心当たりがない場合は、リンクを開かずそのまま削除してください。\n\nGreen Square`;

  const html = `<!doctype html>
<html lang="ja">
  <body style="margin:0;background:#f7f5ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans JP',sans-serif;color:#2f3a34;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f5ef;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e8e4da;">
            <tr>
              <td style="background:#244b3c;padding:26px 28px;color:#ffffff;">
                <div style="font-size:26px;font-weight:700;letter-spacing:.02em;">Green Square</div>
                <div style="margin-top:6px;font-size:14px;opacity:.9;">LINE予約サービスのご案内</div>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px;">
                <p style="margin:0 0 18px;font-size:16px;line-height:1.8;">${escapeHtml(greeting)}</p>
                <p style="margin:0 0 18px;font-size:15px;line-height:1.8;">いつもGreen Squareをご利用いただきありがとうございます。</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.8;">LINEからレッスンの予約・日時変更をご利用いただけるよう、LINEアカウントの連携をご案内しています。</p>
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 24px;">
                  <tr>
                    <td style="border-radius:999px;background:#2f6b54;">
                      <a href="${escapeHtml(linkUrl)}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;">LINEと連携する</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 10px;font-size:13px;line-height:1.7;color:#65716b;">ボタンを開けない場合は、下のURLをブラウザで開いてください。</p>
                <p style="margin:0 0 24px;word-break:break-all;font-size:13px;line-height:1.7;"><a href="${escapeHtml(linkUrl)}" style="color:#2f6b54;">${escapeHtml(linkUrl)}</a></p>
                <div style="border-top:1px solid #ece8df;padding-top:18px;font-size:12px;line-height:1.7;color:#7b817d;">このメールに心当たりがない場合は、リンクを開かずそのまま削除してください。</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

function buildRawMessage({ to, subject, text, html }) {
  const delegatedUser = getDelegatedUser();
  const fromAddress = getFromAddress();
  const fromName = getFromName();
  const boundary = `greensquare_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  if (!delegatedUser) {
    throw new Error('GOOGLE_MAIL_DELEGATED_USER is not configured');
  }
  if (!fromAddress) {
    throw new Error('GOOGLE_MAIL_FROM_ADDRESS is not configured');
  }

  const lines = [
    `From: ${encodeHeader(fromName)} <${fromAddress}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(html),
    `--${boundary}--`,
    '',
  ];

  return toBase64Url(lines.join('\r\n'));
}

function getGmailClient() {
  if (!isStudentLineEmailEnabled()) {
    throw new Error('LINE linking email is disabled. Set GOOGLE_MAIL_ENABLED=1.');
  }

  const credentials = loadServiceAccountCredentials();
  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error('Google service-account credentials are not configured');
  }

  const subject = getDelegatedUser();
  if (!subject) {
    throw new Error('GOOGLE_MAIL_DELEGATED_USER is not configured');
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [GMAIL_SEND_SCOPE],
    subject,
  });

  return google.gmail({ version: 'v1', auth });
}

export async function sendStudentLineLinkEmail({ to, studentName, linkUrl }) {
  const recipient = String(to || '').trim();
  const url = String(linkUrl || '').trim();

  if (!isValidEmailAddress(recipient)) {
    throw new Error('Student email address is missing or invalid');
  }
  if (!/^https:\/\//i.test(url)) {
    throw new Error('LINE linking URL must use HTTPS');
  }

  const message = buildStudentLineLinkEmail({ studentName, linkUrl: url });
  const raw = buildRawMessage({ to: recipient, ...message });
  const gmail = getGmailClient();

  const { data } = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return {
    ok: true,
    messageId: data?.id || null,
    recipientMasked: maskEmailAddress(recipient),
  };
}
