import { Router } from 'express';
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirnameCalendar = dirname(fileURLToPath(import.meta.url));

const router = Router();

/** In-memory cache of fetched calendar events (updated by webhook or on GET). */
let eventsCache = null;
let cacheTimeMin = null;
let cacheTimeMax = null;

function getAuth() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  let credentials = null;
  if (keyPath) {
    try {
      const resolved = join(__dirnameCalendar, '..', '..', keyPath.replace(/^\.\//, ''));
      credentials = JSON.parse(readFileSync(resolved, 'utf8'));
    } catch (e) {
      console.error('Calendar: failed to read key file', e.message);
      return null;
    }
  } else if (keyJson) {
    try {
      const raw = keyJson.startsWith('{') ? keyJson : Buffer.from(keyJson, 'base64').toString('utf8');
      credentials = JSON.parse(raw);
    } catch (e) {
      console.error('Calendar: failed to parse GOOGLE_SERVICE_ACCOUNT_JSON', e.message);
      return null;
    }
  }
  if (!credentials) return null;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
  return auth;
}

function getCalendarClient() {
  const auth = getAuth();
  if (!auth) return null;
  return google.calendar({ version: 'v3', auth });
}

const calendarId = () => process.env.GOOGLE_CALENDAR_ID || 'primary';

/** Fetch events from Google Calendar API for the given time range. */
async function fetchEventsFromGoogle(timeMin, timeMax) {
  const calendar = getCalendarClient();
  if (!calendar) return null;
  try {
    const res = await calendar.events.list({
      calendarId: calendarId(),
      timeMin: timeMin instanceof Date ? timeMin.toISOString() : timeMin,
      timeMax: timeMax instanceof Date ? timeMax.toISOString() : timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });
    return res.data.items || [];
  } catch (err) {
    console.error('Calendar API list error:', err.message);
    return null;
  }
}

/** GET /api/calendar/events?timeMin=ISO&timeMax=ISO - list calendar events. */
router.get('/events', async (req, res) => {
  try {
    let timeMin = req.query.timeMin;
    let timeMax = req.query.timeMax;
    const now = new Date();
    if (!timeMin) timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    if (!timeMax) timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const tMin = new Date(timeMin);
    const tMax = new Date(timeMax);
    if (isNaN(tMin.getTime()) || isNaN(tMax.getTime())) {
      return res.status(400).json({ error: 'Invalid timeMin or timeMax' });
    }

    const calendar = getCalendarClient();
    if (!calendar) {
      return res.json({ events: [], message: 'Google Calendar not configured' });
    }

    const events = await fetchEventsFromGoogle(tMin, tMax);
    if (events) {
      eventsCache = events;
      cacheTimeMin = timeMin;
      cacheTimeMax = timeMax;
    }
    res.json({ events: events || eventsCache || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/calendar/webhook - receive Google Calendar push notification; fetch and cache events. */
router.post('/webhook', async (req, res) => {
  // Respond immediately so Google doesn't retry; process async.
  res.status(200).send();
  const channelId = req.headers['x-goog-channel-id'];
  const resourceState = req.headers['x-goog-resource-state'];
  if (resourceState === 'sync') return;

  const calendar = getCalendarClient();
  if (!calendar) return;

  const now = new Date();
  const timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const events = await fetchEventsFromGoogle(timeMin, timeMax);
  if (events) {
    eventsCache = events;
    cacheTimeMin = timeMin.toISOString();
    cacheTimeMax = timeMax.toISOString();
  }
  if (channelId) console.log('Calendar webhook: updated cache for channel', channelId);
});

/** GET /api/calendar - health / info. */
router.get('/', (req, res) => {
  const configured = !!getAuth();
  res.json({
    ok: true,
    calendar: configured ? 'configured' : 'not configured',
    message: configured ? 'Use GET /api/calendar/events?timeMin=&timeMax=' : 'Set GOOGLE_SERVICE_ACCOUNT_KEY_PATH or GOOGLE_SERVICE_ACCOUNT_JSON',
  });
});

/** Register a push watch with Google so we get POST to webhook when calendar changes. Call once on startup when CALENDAR_WEBHOOK_BASE_URL is set. */
export async function registerWatch() {
  const baseUrl = process.env.CALENDAR_WEBHOOK_BASE_URL;
  if (!baseUrl || !getAuth()) return;
  const calendar = getCalendarClient();
  if (!calendar) return;
  const address = `${baseUrl.replace(/\/$/, '')}/api/calendar/webhook`;
  const channelId = `student-admin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const expiration = Math.min(7 * 24 * 60 * 60 * 1000, Date.now() + 6 * 24 * 60 * 60 * 1000);
  try {
    await calendar.events.watch({
      calendarId: calendarId(),
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address,
        expiration,
      },
    });
    console.log('Calendar watch registered; expiration in ~7 days. Re-register on next startup if needed.');
  } catch (err) {
    console.error('Calendar watch registration failed:', err.message);
  }
}

export default router;
