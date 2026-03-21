import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

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

export default router;
