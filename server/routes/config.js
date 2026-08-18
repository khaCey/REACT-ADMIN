import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { logChange } from '../lib/changeLog.js';
import {
  getLineLinkEmailTestUrl,
  isStudentLineEmailEnabled,
  isValidEmailAddress,
  maskEmailAddress,
  sendStudentLineLinkEmail,
} from '../lib/studentLineEmail.js';

const router = Router();

router.get('/feature-flags', async (req, res) => {
  try {
    const result = await query('SELECT name, enabled, description FROM feature_flags');
    const flags = {};
    for (const r of result.rows) {
      flags[r.name] = { enabled: r.enabled, description: r.description };
    }
    res.json(flags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/staff', async (req, res) => {
  try {
    const result = await query("SELECT value FROM config WHERE key = 'staff'");
    res.json({ staff: result.rows[0]?.value || 'Staff' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/calendar-poll-configured', (_req, res) => {
  const url = (process.env.CALENDAR_POLL_URL || process.env.VITE_CALENDAR_POLL_URL || '').trim();
  const key = (process.env.CALENDAR_POLL_API_KEY || process.env.VITE_CALENDAR_POLL_API_KEY || '').trim();
  res.json({ configured: !!(url && key) });
});

/** URL + key for browser polling (production: from root .env CALENDAR_POLL_*; Vite build may omit VITE_*). */
router.get('/calendar-poll', requireAuth, (_req, res) => {
  const url = (process.env.CALENDAR_POLL_URL || process.env.VITE_CALENDAR_POLL_URL || '').trim();
  const apiKey = (process.env.CALENDAR_POLL_API_KEY || process.env.VITE_CALENDAR_POLL_API_KEY || '').trim();
  res.json({ url, apiKey });
});

/**
 * Send the first-phase LINE linking email from REACT-ADMIN.
 *
 * For this branch the link is intentionally a configurable test URL. The GAS
 * invitation generator will replace getLineLinkEmailTestUrl() in the next phase.
 * The student's email address is read from the private local database and is
 * never supplied by the browser.
 */
router.post('/student-line-email/:id', requireAuth, async (req, res) => {
  try {
    const studentId = Number(req.params.id);
    if (!Number.isFinite(studentId) || !Number.isInteger(studentId) || studentId <= 0) {
      return res.status(400).json({ error: 'Invalid student id', code: 'INVALID_STUDENT_ID' });
    }

    const result = await query(
      'SELECT id, name, email FROM students WHERE id = $1',
      [studentId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' });
    }

    const student = result.rows[0];
    const email = String(student.email || '').trim();
    if (!email) {
      return res.status(400).json({
        error: 'この生徒にはメールアドレスが登録されていません。',
        code: 'NO_EMAIL',
      });
    }
    if (!isValidEmailAddress(email)) {
      return res.status(400).json({
        error: '登録されているメールアドレスの形式が正しくありません。',
        code: 'INVALID_EMAIL',
      });
    }
    if (!isStudentLineEmailEnabled()) {
      return res.status(503).json({
        error: 'LINE連携メール送信が設定されていません。',
        code: 'EMAIL_NOT_CONFIGURED',
      });
    }

    const linkUrl = getLineLinkEmailTestUrl();
    const sendResult = await sendStudentLineLinkEmail({
      to: email,
      studentName: student.name,
      linkUrl,
    });

    const recipientMasked = sendResult.recipientMasked || maskEmailAddress(email);
    await logChange(
      {
        entityType: 'students',
        entityKey: String(studentId),
        action: 'line_link_email_sent',
        oldData: null,
        newData: {
          recipientMasked,
          sentAt: new Date().toISOString(),
          testMode: true,
        },
      },
      req
    );

    return res.json({
      ok: true,
      recipientMasked,
      testMode: true,
    });
  } catch (err) {
    console.error('[StudentLineEmail] send failed', err?.message || err);
    return res.status(502).json({
      error: 'LINE連携メールを送信できませんでした。メール設定を確認してください。',
      code: 'EMAIL_SEND_FAILED',
    });
  }
});

export default router;
