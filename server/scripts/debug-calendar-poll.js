/**
 * Debug: fetch from calendar-poll GAS (full=1) and log results.
 * Run from repo root: node server/scripts/debug-calendar-poll.js
 * Uses CALENDAR_POLL_URL and CALENDAR_POLL_API_KEY from .env
 */
import '../db/index.js';

const url = (process.env.CALENDAR_POLL_URL || process.env.VITE_CALENDAR_POLL_URL || '').trim().replace(/\/$/, '');
const key = (process.env.CALENDAR_POLL_API_KEY || process.env.VITE_CALENDAR_POLL_API_KEY || '').trim();

if (!url || !key) {
  console.log('Result: SKIP (CALENDAR_POLL_URL or CALENDAR_POLL_API_KEY not set in .env)');
  process.exit(0);
}

const gasUrl = `${url}?key=${encodeURIComponent(key)}&full=1`;
console.log('Fetching:', gasUrl.replace(key, '***'));

try {
  const res = await fetch(gasUrl);
  const json = await res.json().catch(() => ({}));

  console.log('Status:', res.status);
  console.log('Response keys:', Object.keys(json).join(', '));

  if (json.error) {
    console.log('Error from GAS:', json.error);
    process.exit(1);
  }

  const data = Array.isArray(json.data) ? json.data : (json.diff?.updated ?? []);
  console.log('Data length:', data.length);
  console.log('cacheVersion:', json.cacheVersion ?? null);
  console.log('lastUpdated:', json.lastUpdated ?? null);

  if (data.length > 0) {
    const first = data[0];
    console.log('First row keys:', Object.keys(first).join(', '));
    console.log('First row sample:', JSON.stringify({ ...first, title: (first.title || first.Title || '').slice(0, 40) }, null, 2).slice(0, 400));
  }

  console.log('Result: OK');
  process.exit(0);
} catch (err) {
  console.error('Fetch error:', err.message);
  process.exit(1);
}
