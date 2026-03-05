/**
 * Fetch MonthlySchedule from Google Sheets (Admin spreadsheet).
 * Requires GOOGLE_SERVICE_ACCOUNT_KEY_PATH or GOOGLE_SERVICE_ACCOUNT_JSON
 * and GOOGLE_ADMIN_SHEET_ID. Share the spreadsheet with the service account email.
 */
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirnameHere = dirname(fileURLToPath(import.meta.url));

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
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "'MonthlySchedule'!A:I",
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
      });
    }
    return out;
  } catch (err) {
    console.error('[sheets] fetch error:', err.message);
    return [];
  }
}

export function isSheetsConfigured() {
  return !!(getSheetsAuth() && (process.env.GOOGLE_ADMIN_SHEET_ID || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || process.env.GOOGLE_SERVICE_ACCOUNT_JSON));
}
