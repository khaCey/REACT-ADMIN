/**
 * Read/write MonthlySchedule in the Admin Google Sheet.
 *
 * The studentID column is the cached record that a Calendar event/student row has
 * already had its student number written to Calendar. Preview reads this Sheet;
 * only the actual tagging action reaches Google Calendar.
 */
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirnameHere = dirname(fileURLToPath(import.meta.url));
const MONTHLY_SCHEDULE_SHEET = 'MonthlySchedule';
const MONTHLY_SCHEDULE_RANGE = `'${MONTHLY_SCHEDULE_SHEET}'!A:Z`;
const DEFAULT_ADMIN_SHEET_ID = '1upKC-iNWs7HIeKiVVAegve5O5WbNebbjMlveMcvnuow';

function getSheetsCredentials() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (keyPath) {
    try {
      const resolved = join(__dirnameHere, '..', '..', keyPath.replace(/^\.\//, ''));
      return JSON.parse(readFileSync(resolved, 'utf8'));
    } catch (e) {
      console.error('Sheets: failed to read key file', e.message);
      return null;
    }
  }

  if (keyJson) {
    try {
      const raw = keyJson.startsWith('{') ? keyJson : Buffer.from(keyJson, 'base64').toString('utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.error('Sheets: failed to parse GOOGLE_SERVICE_ACCOUNT_JSON', e.message);
      return null;
    }
  }

  return null;
}

function getSheetsAuth() {
  const credentials = getSheetsCredentials();
  if (!credentials) return null;

  return new google.auth.GoogleAuth({
    credentials,
    // Write scope is required only for persisting MonthlySchedule.studentID.
    // Spreadsheet sharing permissions still control whether writes are allowed.
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getAdminSheetId() {
  return process.env.GOOGLE_ADMIN_SHEET_ID || DEFAULT_ADMIN_SHEET_ID;
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function columnLetters(indexZeroBased) {
  let n = Number(indexZeroBased) + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function findHeaderIndex(headers, names) {
  const wanted = new Set(names.map(normalizeHeader));
  return headers.findIndex((value) => wanted.has(normalizeHeader(value)));
}

async function readMonthlyScheduleRaw() {
  const auth = getSheetsAuth();
  if (!auth) throw new Error('Google Sheets service account is not configured');

  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getAdminSheetId(),
    range: MONTHLY_SCHEDULE_RANGE,
  });

  return {
    sheets,
    rows: res.data.values || [],
  };
}

function parseMonthlyScheduleRows(rows) {
  if (!Array.isArray(rows) || rows.length < 1) return { headers: [], indexes: {}, rows: [] };

  const headers = rows[0] || [];
  const indexes = {
    eventID: findHeaderIndex(headers, ['eventID']),
    title: findHeaderIndex(headers, ['title']),
    date: findHeaderIndex(headers, ['date']),
    start: findHeaderIndex(headers, ['start']),
    end: findHeaderIndex(headers, ['end']),
    status: findHeaderIndex(headers, ['status']),
    studentName: findHeaderIndex(headers, ['studentName']),
    studentID: findHeaderIndex(headers, ['studentID', 'student_id']),
    isKidsLesson: findHeaderIndex(headers, ['isKidsLesson']),
    teacherName: findHeaderIndex(headers, ['teacherName']),
    lessonKind: findHeaderIndex(headers, ['lessonKind']),
  };

  if (indexes.eventID < 0 || indexes.studentName < 0) {
    return { headers, indexes, rows: [] };
  }

  const lessonKindValid = { regular: true, demo: true, owner: true };
  const out = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const get = (key) => (
      indexes[key] >= 0 && row[indexes[key]] != null
        ? String(row[indexes[key]]).trim()
        : ''
    );

    const eventID = get('eventID');
    const studentName = get('studentName');
    if (!eventID || !studentName) continue;

    const rawKind = get('lessonKind').toLowerCase();
    const lessonKind = lessonKindValid[rawKind] ? rawKind : 'regular';
    const isKidsRaw = get('isKidsLesson');

    out.push({
      sheetRow: i + 1,
      eventID,
      title: get('title'),
      date: get('date'),
      start: get('start'),
      end: get('end'),
      status: get('status') || 'scheduled',
      studentName,
      studentID: get('studentID'),
      isKidsLesson: isKidsRaw === '子' || isKidsRaw === 'true' || row[indexes.isKidsLesson] === true,
      teacherName: get('teacherName'),
      lessonKind,
    });
  }

  return { headers, indexes, rows: out };
}

/**
 * Fetch MonthlySchedule as polling/cache rows.
 */
export async function fetchMonthlyScheduleFromSheet() {
  try {
    const { rows } = await readMonthlyScheduleRaw();
    return parseMonthlyScheduleRows(rows).rows;
  } catch (err) {
    console.error('[sheets] fetch error:', err.message);
    return [];
  }
}

/**
 * Persist student IDs into exact MonthlySchedule rows.
 *
 * assignments: [{
 *   eventIDs: string[],
 *   date: 'YYYY-MM-DD',
 *   studentName: string,
 *   studentID: string
 * }]
 *
 * Every assignment must resolve to exactly one Sheet row. Existing non-empty
 * studentID values are never overwritten with a different ID.
 */
export async function writeMonthlyScheduleStudentIds(assignments) {
  const requested = Array.isArray(assignments) ? assignments : [];
  if (requested.length === 0) {
    return { ok: true, updated: 0, alreadyPresent: 0, columnCreated: false };
  }

  const { sheets, rows: rawRows } = await readMonthlyScheduleRaw();
  if (!rawRows.length) throw new Error('MonthlySchedule sheet is empty');

  const parsed = parseMonthlyScheduleRows(rawRows);
  if (parsed.indexes.eventID < 0 || parsed.indexes.studentName < 0) {
    throw new Error('MonthlySchedule must contain eventID and studentName columns');
  }

  let studentIdColumn = parsed.indexes.studentID;
  let columnCreated = false;

  if (studentIdColumn < 0) {
    const lastUsedHeader = parsed.headers.reduce((last, value, index) => (
      String(value || '').trim() ? index : last
    ), -1);
    studentIdColumn = Math.max(0, lastUsedHeader + 1);
    const headerCell = `${MONTHLY_SCHEDULE_SHEET}!${columnLetters(studentIdColumn)}1`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: getAdminSheetId(),
      range: headerCell,
      valueInputOption: 'RAW',
      requestBody: { values: [['studentID']] },
    });
    columnCreated = true;
  }

  const sheetRows = parsed.rows;
  const updates = [];
  let alreadyPresent = 0;

  for (const assignment of requested) {
    const wantedIds = new Set(
      (assignment.eventIDs || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    const wantedName = normalizeName(assignment.studentName);
    const wantedDate = String(assignment.date || '').trim();
    const wantedStudentId = String(assignment.studentID || '').trim();

    if (!wantedIds.size || !wantedName || !wantedStudentId) {
      throw new Error('Invalid MonthlySchedule studentID assignment');
    }

    const matches = sheetRows.filter((row) => {
      if (!wantedIds.has(String(row.eventID || '').trim())) return false;
      if (normalizeName(row.studentName) !== wantedName) return false;
      if (wantedDate && String(row.date || '').trim() !== wantedDate) return false;
      return true;
    });

    if (matches.length !== 1) {
      throw new Error(
        `MonthlySchedule row match was ${matches.length === 0 ? 'missing' : 'ambiguous'} for ${wantedName} (${wantedDate || 'no date'})`
      );
    }

    const match = matches[0];
    const current = String(match.studentID || '').trim();
    if (current && current !== wantedStudentId) {
      throw new Error(
        `MonthlySchedule already has studentID ${current} for ${wantedName}; refusing to overwrite with ${wantedStudentId}`
      );
    }

    if (current === wantedStudentId) {
      alreadyPresent += 1;
      continue;
    }

    updates.push({
      range: `${MONTHLY_SCHEDULE_SHEET}!${columnLetters(studentIdColumn)}${match.sheetRow}`,
      values: [[wantedStudentId]],
    });
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getAdminSheetId(),
      requestBody: {
        valueInputOption: 'RAW',
        data: updates,
      },
    });
  }

  return {
    ok: true,
    updated: updates.length,
    alreadyPresent,
    columnCreated,
  };
}

export function isSheetsConfigured() {
  return !!(
    getSheetsAuth() &&
    (process.env.GOOGLE_ADMIN_SHEET_ID || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  );
}
