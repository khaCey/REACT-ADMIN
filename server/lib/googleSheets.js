/**
 * Google Sheets helpers used by REACT-ADMIN.
 *
 * - MonthlySchedule belongs to the existing Admin/legacy sync path.
 * - monthlyLessons belongs to the rebuilt Booking API Calendar mirror.
 * - students / studentPayments are write mirrors maintained by REACT-ADMIN.
 *
 * Preview/read code may read Sheets directly. Google Calendar is not contacted by
 * these helpers.
 */
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirnameHere = dirname(fileURLToPath(import.meta.url));

// Booking API / new Calendar Mirror spreadsheet. This is the mirror used by the
// rebuilt booking API; do not allow an unrelated env var to silently redirect the
// student-ID backfill preview to another spreadsheet.
const CALENDAR_MIRROR_SHEET_ID = '17zXtRW5Ue-u4DQwW-sa0lvMQmKnEGcjTyPskaByjF0s';
const BOOKING_STUDENTS_HEADERS = ['studentId', 'studentName', 'status', 'createdAt', 'updatedAt'];
const BOOKING_PAYMENTS_HEADERS = [
  'paymentKey',
  'studentId',
  'billingMonth',
  'status',
  'transactionIds',
  'amount',
  'total',
  'paidAt',
  'sourceUpdatedAt',
  'lastSyncedAt',
];

function getSheetsAuth(scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly']) {
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
  return new google.auth.GoogleAuth({ credentials, scopes });
}

function getWritableSheetsAuth() {
  return getSheetsAuth(['https://www.googleapis.com/auth/spreadsheets']);
}

async function ensureBookingPaymentSheets(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  const existing = new Set(
    (meta.data.sheets || []).map((sheet) => String(sheet?.properties?.title || '').trim()).filter(Boolean)
  );
  const requests = [];
  if (!existing.has('students')) requests.push({ addSheet: { properties: { title: 'students' } } });
  if (!existing.has('studentPayments')) requests.push({ addSheet: { properties: { title: 'studentPayments' } } });
  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  await Promise.all([
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "'students'!A1:E1",
      valueInputOption: 'RAW',
      requestBody: { values: [BOOKING_STUDENTS_HEADERS] },
    }),
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "'studentPayments'!A1:J1",
      valueInputOption: 'RAW',
      requestBody: { values: [BOOKING_PAYMENTS_HEADERS] },
    }),
  ]);
}

function normalizeString(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeTransactions(value) {
  if (Array.isArray(value)) return value.map(normalizeString).filter(Boolean).join(',');
  return normalizeString(value);
}

/**
 * Idempotently upsert Booking API student + monthly payment mirror records.
 * A student is created in `students` automatically before their payment is written.
 */
export async function upsertBookingPaymentMirror(records) {
  const list = Array.isArray(records) ? records : [];
  const auth = getWritableSheetsAuth();
  if (!auth) {
    const err = new Error('Google Sheets service account is not configured');
    err.statusCode = 503;
    throw err;
  }

  const spreadsheetId = CALENDAR_MIRROR_SHEET_ID;
  const sheets = google.sheets({ version: 'v4', auth });
  try {
    await ensureBookingPaymentSheets(sheets, spreadsheetId);
  } catch (err) {
    const wrapped = new Error(`Could not prepare Booking API payment sheets: ${err.message}`);
    wrapped.statusCode = err?.code === 403 ? 503 : 502;
    throw wrapped;
  }

  const [studentRes, paymentRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: "'students'!A:E" }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "'studentPayments'!A:J" }),
  ]);

  const students = (studentRes.data.values || []).slice(1).map((row) => [
    normalizeString(row[0]),
    normalizeString(row[1]),
    normalizeString(row[2]),
    normalizeString(row[3]),
    normalizeString(row[4]),
  ]).filter((row) => row[0]);
  const payments = (paymentRes.data.values || []).slice(1).map((row) => [
    normalizeString(row[0]),
    normalizeString(row[1]),
    normalizeString(row[2]),
    normalizeString(row[3]),
    normalizeString(row[4]),
    row[5] ?? '',
    row[6] ?? '',
    normalizeString(row[7]),
    normalizeString(row[8]),
    normalizeString(row[9]),
  ]).filter((row) => row[0]);

  const studentIndex = new Map(students.map((row, index) => [row[0], index]));
  const paymentIndex = new Map(payments.map((row, index) => [row[0], index]));
  const now = new Date().toISOString();
  let studentsCreated = 0;
  let studentsExisting = 0;
  let paymentRowsCreated = 0;
  let paymentRowsUpdated = 0;

  const deduped = new Map();
  for (const raw of list) {
    const studentId = normalizeString(raw?.studentId);
    const billingMonth = normalizeString(raw?.billingMonth);
    if (!studentId || !/^\d{4}-\d{2}$/.test(billingMonth)) continue;
    deduped.set(`${studentId}:${billingMonth}`, { ...raw, studentId, billingMonth });
  }

  for (const record of deduped.values()) {
    const studentId = record.studentId;
    const studentName = normalizeString(record.studentName);
    const existingStudentIndex = studentIndex.get(studentId);
    if (existingStudentIndex == null) {
      studentIndex.set(studentId, students.length);
      students.push([studentId, studentName, 'active', now, now]);
      studentsCreated += 1;
    } else {
      const row = students[existingStudentIndex];
      row[1] = studentName || row[1];
      row[2] = row[2] || 'active';
      row[3] = row[3] || now;
      row[4] = now;
      studentsExisting += 1;
    }

    const key = `${studentId}:${record.billingMonth}`;
    const nextPayment = [
      key,
      studentId,
      record.billingMonth,
      normalizeString(record.status) || 'paid',
      normalizeTransactions(record.transactionIds),
      record.amount ?? 0,
      record.total ?? 0,
      normalizeString(record.paidAt),
      normalizeString(record.sourceUpdatedAt),
      now,
    ];
    const existingPaymentIndex = paymentIndex.get(key);
    if (existingPaymentIndex == null) {
      paymentIndex.set(key, payments.length);
      payments.push(nextPayment);
      paymentRowsCreated += 1;
    } else {
      payments[existingPaymentIndex] = nextPayment;
      paymentRowsUpdated += 1;
    }
  }

  try {
    await Promise.all([
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'students'!A1:E${students.length + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: [BOOKING_STUDENTS_HEADERS, ...students] },
      }),
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'studentPayments'!A1:J${payments.length + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: [BOOKING_PAYMENTS_HEADERS, ...payments] },
      }),
    ]);
  } catch (err) {
    const wrapped = new Error(`Could not write Booking API payment mirror: ${err.message}`);
    wrapped.statusCode = err?.code === 403 ? 503 : 502;
    throw wrapped;
  }

  return {
    ok: true,
    spreadsheetId,
    recordsReceived: deduped.size,
    studentsCreated,
    studentsExisting,
    paymentRowsCreated,
    paymentRowsUpdated,
  };
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

  const spreadsheetId = CALENDAR_MIRROR_SHEET_ID;
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
