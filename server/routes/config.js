import { Router } from 'express';
import { query } from '../db/index.js';

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

export default router;
