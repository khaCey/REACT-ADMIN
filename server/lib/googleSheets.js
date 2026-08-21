/**
 * Google Sheets helpers used by REACT-ADMIN.
 *
 * - MonthlySchedule belongs to the existing Admin/legacy sync path.
 * - monthlyLessons belongs to the rebuilt Booking API Calendar mirror.
 *
 * Preview/read code may read Sheets directly. Google Calendar is not contacted by
 * these helpers.
 */
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirnameHere = dirname(fileURLToPath(import.meta.url));

// Booking API / new Calendar Mirror spreadsheet. Sheet IDs are not secrets.
const DEFAULT_CALENDAR_MIRROR_SHEET_ID = '17zXtRW5Ue-u4DQwW-sa0lvMQmKnEGcjTyPskaByjF0s';

function getSheetsAuth() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  let credentials = null;
  if (keyPath) {
    try {
      const resolved = join(__dirnameHere, '..', '..', keyPath.replace(/^\.\//, ''));
      credentials = JSON.parse(readFileSync(resolved, 'utf8'));
    } catch (e) {
      console.error('Sheets: failed to read key file', e.message);
      return null;
    }
  } else if (keyJson) {
    try {
      const raw = keyJson.startsWith('{') ? keyJson : Buffer.from(keyJson, 'base64').toString('utf8');
      credentials = JSON.parse(raw);
    } catch (e) {
      console.error('Sheets: failed to parse GOOGLE_SERVICE_ACCOUNT_JSON', e.message);
      return null;
    }
  }
  if (!credentials) return null;
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

/**
 * Fetch MonthlySchedule sheet and return rows as polling format.
 * @returns {Promise<Array<{eventID: string, title: string, date: string, start: string, end: string, status: string, studentName: string, isKidsLesson: boolean, teacherName: string}>>}
 */
export async function fetchMonthlyScheduleFromSheet() {
  const auth = getSheetsAuth();
  if (!auth) return [];
  const sheetId = process.env.GOOGLE_ADMIN_SHEET_ID || '1upKC-iNWs7HIeKiVVAegve5O5WbNebbjMlveMcvnuow';
  const sheets = google.sheets({ version: 'v4', auth });
  const lessonKindValid = { regular: true, demo: true, owner: true };
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "'MonthlySchedule'!A:J",
    });
    const rows = res.data.values || [];
    if (rows.length < 2) return [];
    const headers = (rows[0] || []).map((h) => String(h || '').trim().toLowerCase());
    const idx = {
      eventID: headers.indexOf('eventid'),
      title: headers.indexOf('title'),
      date: headers.indexOf('date'),
      start: headers.indexOf('start'),
      end: headers.indexOf('end'),
      status: headers.indexOf('status'),
      studentName: headers.indexOf('studentname'),
      isKidsLesson: headers.indexOf('iskidslesson'),
      teacherName: headers.indexOf('teachername'),
      lessonKind: headers.indexOf('lessonkind'),
    };
    if (idx.eventID < 0 || idx.studentName < 0) return [];
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const get = (k) => (idx[k] >= 0 && row[idx[k]] != null ? String(row[idx[k]]).trim() : '');
      const eventId = get('eventID');
      const studentName = get('studentName');
      if (!eventId || !studentName) continue;
      const isKids = get('isKidsLesson') === '子' || get('isKidsLesson') === 'true' || row[idx.isKidsLesson] === true;
      const rawKind = (idx.lessonKind >= 0 && row[idx.lessonKind] != null ? String(row[idx.lessonKind]).trim().toLowerCase() : '');
      const lessonKind = lessonKindValid[rawKind] ? rawKind : 'regular';
      out.push({
        eventID: eventId,
        title: get('title'),
        date: get('date'),
        start: get('start'),
        end: get('end'),
        status: get('status') || 'scheduled',
        studentName,
        isKidsLesson: isKids,
        teacherName: get('teacherName'),
        lessonKind,
      });
    }
    return out;
  } catch (err) {
    console.error('[sheets] fetch error:', err.message);
    return [];
  }
}

/**
 * Read the rebuilt Calendar mirror directly from the Booking API spreadsheet.
 * This deliberately bypasses the GAS web-app read endpoint so preview cannot
 * accidentally inspect a different/stale bound spreadsheet deployment.
 */
export async function fetchCalendarMirrorMonthFromSheet(month) {
  const ym = String(month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('month must be YYYY-MM');

  const auth = getSheetsAuth();
  if (!auth) {
    const err = new Error('Google Sheets service account is not configured');
    err.statusCode = 503;
    throw err;
  }

  const spreadsheetId = String(
    process.env.GOOGLE_CALENDAR_MIRROR_SHEET_ID || DEFAULT_CALENDAR_MIRROR_SHEET_ID
  ).trim();
  const sheets = google.sheets({ version: 'v4', auth });

  let values;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'monthlyLessons'!A:Z",
    });
    values = res.data.values || [];
  } catch (err) {
    const wrapped = new Error(`Could not read Booking API monthlyLessons: ${err.message}`);
    wrapped.statusCode = err?.code === 403 ? 503 : 502;
    throw wrapped;
  }

  if (values.length === 0) {
    return { spreadsheetId, rows: [] };
  }

  const headers = (values[0] || []).map((value) => String(value || '').trim());
  const headerIndex = new Map(headers.map((header, index) => [header.toLowerCase(), index]));
  const getValue = (row, name) => {
    const index = headerIndex.get(String(name).toLowerCase());
    return index == null || row[index] == null ? '' : String(row[index]).trim();
  };

  // These fields are the stable mirror identity required by the backfill page.
  if (!headerIndex.has('googleeventid') || !headerIndex.has('date') || !headerIndex.has('start')) {
    const err = new Error('Booking API monthlyLessons is missing required mirror headers');
    err.statusCode = 502;
    throw err;
  }

  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const date = getValue(row, 'date');
    if (!date.startsWith(ym)) continue;

    const googleEventId = getValue(row, 'googleEventId');
    const eventKey = getValue(row, 'eventKey');
    if (!googleEventId && !eventKey) continue;

    rows.push({
      eventKey,
      calendarSource: getValue(row, 'calendarSource'),
      googleEventId,
      recurringEventId: getValue(row, 'recurringEventId'),
      originalStartTime: getValue(row, 'originalStartTime'),
      iCalUID: getValue(row, 'iCalUID'),
      studentId: getValue(row, 'studentId'),
      studentName: getValue(row, 'studentName'),
      teacherId: getValue(row, 'teacherId'),
      teacherName: getValue(row, 'teacherName'),
      lessonKind: getValue(row, 'lessonKind'),
      title: getValue(row, 'title'),
      start: getValue(row, 'start'),
      end: getValue(row, 'end'),
      date,
      time: getValue(row, 'time'),
      status: getValue(row, 'status'),
      location: getValue(row, 'location'),
      updatedAt: getValue(row, 'updatedAt'),
      lastSyncedAt: getValue(row, 'lastSyncedAt'),
    });
  }

  return { spreadsheetId, rows };
}

export function isSheetsConfigured() {
  return !!(getSheetsAuth() && (process.env.GOOGLE_ADMIN_SHEET_ID || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || process.env.GOOGLE_SERVICE_ACCOUNT_JSON));
}
