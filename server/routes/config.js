import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { logChange } from '../lib/changeLog.js';
import {
  isStudentLineEmailEnabled,
  isValidEmailAddress,
  maskEmailAddress,
  sendStudentLineLinkEmail,
} from '../lib/studentLineEmail.js';
import {
  createStudentLineLinkInvitation,
  isStudentLineLinkApiConfigured,
} from '../lib/studentLineInvitation.js';

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
 * Create a one-time LINE linking invitation through GAS and return it to the
 * browser. The UI opens a Gmail draft; REACT-ADMIN does not send mail.
 */
router.post('/student-line-invitation/:id', requireAuth, async (req, res) => {
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
    if (!isStudentLineLinkApiConfigured()) {
      return res.status(503).json({
        error: 'LINE連携リンク生成APIが設定されていません。',
        code: 'LINE_LINK_API_NOT_CONFIGURED',
      });
    }

    let invitation;
    try {
      invitation = await createStudentLineLinkInvitation(
        student.id,
        req.staff?.id || ''
      );
    } catch (err) {
      console.error('[StudentLineInvitation] creation failed', err?.message || err);
      const code = err?.code || 'LINE_LINK_CREATE_FAILED';
      const error =
        code === 'LINE_LINK_API_INVALID_RESPONSE'
          ? 'LINE連携リンクを生成できませんでした。GAS Web App が未認証アクセス（401）を返しています。デプロイの「アクセスできるユーザー」を確認してください。'
          : 'LINE連携リンクを生成できませんでした。GASの設定を確認してください。';
      return res.status(502).json({ error, code });
    }

    return res.json({
      ok: true,
      studentName: student.name || '',
      email,
      link: invitation.link,
      invitationId: invitation.invitationId,
      expiresAt: invitation.expiresAt,
      expiresInHours: invitation.expiresInHours,
    });
  } catch (err) {
    console.error('[StudentLineInvitation] failed', err?.message || err);
    return res.status(502).json({
      error: 'LINE連携リンクを生成できませんでした。',
      code: 'LINE_LINK_CREATE_FAILED',
    });
  }
});

/**
 * Create a one-time LINE linking invitation through GAS, then send it to the
 * student's saved email address. The browser supplies only the student id;
 * recipient details are read from the private local database.
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
    if (!isStudentLineLinkApiConfigured()) {
      return res.status(503).json({
        error: 'LINE連携リンク生成APIが設定されていません。',
        code: 'LINE_LINK_API_NOT_CONFIGURED',
      });
    }

    let invitation;
    try {
      invitation = await createStudentLineLinkInvitation(
        student.id,
        req.staff?.id || ''
      );
    } catch (err) {
      console.error('[StudentLineEmail] invitation creation failed', err?.message || err);
      return res.status(502).json({
        error: 'LINE連携リンクを生成できませんでした。GASの設定を確認してください。',
        code: err?.code || 'LINE_LINK_CREATE_FAILED',
      });
    }

    const sendResult = await sendStudentLineLinkEmail({
      to: email,
      studentName: student.name,
      linkUrl: invitation.link,
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
          invitationId: invitation.invitationId,
          invitationExpiresAt: invitation.expiresAt,
          expiresInHours: invitation.expiresInHours,
          testMode: false,
        },
      },
      req
    );

    return res.json({
      ok: true,
      recipientMasked,
      invitationId: invitation.invitationId,
      expiresAt: invitation.expiresAt,
      expiresInHours: invitation.expiresInHours,
      testMode: false,
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
