#!/usr/bin/env node
import 'dotenv/config';
/**
 * Database migration script
 * 1. Applies schema (creates/updates tables)
 * 2. Imports data from CSV files in migration-data/
 *
 * Usage:
 *   node scripts/migrate.js              # Schema only
 *   node scripts/migrate.js --import     # Schema + import from CSVs
 *
 * Export your Google Sheets as CSV and save to react-app/migration-data/:
 *   - Students.csv
 *   - Payment.csv
 *   - Notes.csv
 *   - Lessons.csv
 *   - Unpaid.csv (optional)
 *   - Stats.csv (optional)
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import pg from 'pg';
import bcrypt from 'bcrypt';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const dataDir = join(rootDir, 'migration-data');

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/postgres';

const pool = new pg.Pool({ connectionString });

function parseCsv(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true });
}

function toNum(val) {
  if (val === '' || val == null) return null;
  const n = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? null : n;
}

function toDate(val) {
  if (val === '' || val == null) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toTimestamp(val) {
  if (val === '' || val == null) return new Date().toISOString();
  const s = String(val).trim();
  const d = new Date(s);
  if (isNaN(d.getTime())) return new Date().toISOString();
  const iso = d.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(iso)) return new Date().toISOString();
  return iso;
}

async function runSchema() {
  const schemaPath = join(rootDir, 'server', 'db', 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  await pool.query(schema);
  console.log('Schema applied.');
}

// Must match login dropdown (STAFF_OPTIONS minus 'Staff')
const DEFAULT_STAFF = ['Ana', 'Ayane', 'Haruka', 'Khacey', 'Manna', 'May', 'Rie', 'Sham'];
const DEFAULT_PASSWORD = 'staff123';

async function seedStaff() {
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  for (const name of DEFAULT_STAFF) {
    await pool.query(
      'INSERT INTO staff (name, password_hash) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
      [name, hash]
    );
  }
  console.log(`Seeded staff: ${DEFAULT_STAFF.join(', ')}.`);
}

function findCsv(name) {
  const candidates = [join(dataDir, name), join(dataDir, `Student Admin - ${name}`)];
  return candidates.find(existsSync);
}

async function importStudents() {
  const path = findCsv('Students.csv');
  if (!path) {
    console.log('Skipping Students (file not found)');
    return;
  }
  const rows = parseCsv(path);
  for (const r of rows) {
    const id = toNum(r.ID || r.id);
    if (!id) continue;
    await pool.query(
      `INSERT INTO students (id, name, name_kanji, email, phone, phone_secondary, same_day_cancel, status, payment, group_type, group_size, is_child)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, name_kanji = EXCLUDED.name_kanji, email = EXCLUDED.email,
         phone = EXCLUDED.phone, phone_secondary = EXCLUDED.phone_secondary,
         same_day_cancel = EXCLUDED.same_day_cancel, status = EXCLUDED.status,
         payment = EXCLUDED.payment, group_type = EXCLUDED.group_type,
         group_size = EXCLUDED.group_size, is_child = EXCLUDED.is_child,
         updated_at = NOW()`,
      [
        id,
        r.Name || r.name || '',
        r['漢字'] || r.name_kanji || '',
        r.Email || r.email || '',
        r.Phone || r.phone || '',
        r.phone || r.phone_secondary || '',
        r['当日'] || r.same_day_cancel || '',
        r.Status || r.status || 'Active',
        r.Payment || r.payment || 'NEO',
        r.Group || r.group_type || 'Single',
        toNum(r['人数'] || r.group_size),
        r['子'] === '子' || r.is_child === 'true' || r.is_child === '1',
      ]
    );
  }
  await pool.query("SELECT setval('students_id_seq', (SELECT COALESCE(MAX(id), 1) FROM students))");
  console.log(`Imported ${rows.length} students.`);
}

async function importPayments() {
  const path = findCsv('Payment.csv');
  if (!path) {
    console.log('Skipping Payment (file not found)');
    return;
  }
  const rows = parseCsv(path);
  const monthMap = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12', January: '01', February: '02', March: '03', April: '04', June: '06', July: '07', August: '08', September: '09', October: '10', November: '11', December: '12' };
  const getYear = (r) => r.Year || r.year || String(new Date().getFullYear());
  const toMonthKey = (r) => {
    let m = String(r.Month || r.month || '').trim();
    if (!m) return '';
    if (/^\d{4}-\d{2}$/.test(m)) return m;
    const num = monthMap[m] || monthMap[m.substring(0, 3)];
    return num ? `${getYear(r)}-${num}` : m;
  };
  for (const r of rows) {
    const tid = r['Transaction ID'] || r.transaction_id || `TXN_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const month = toMonthKey(r);
    await pool.query(
      `INSERT INTO payments (transaction_id, student_id, year, month, amount, discount, total, date, method, staff)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (transaction_id) DO UPDATE SET
         student_id = EXCLUDED.student_id, year = EXCLUDED.year, month = EXCLUDED.month,
         amount = EXCLUDED.amount, discount = EXCLUDED.discount, total = EXCLUDED.total,
         date = EXCLUDED.date, method = EXCLUDED.method, staff = EXCLUDED.staff`,
      [
        tid,
        toNum(r['Student ID'] || r.student_id),
        r.Year || r.year || '',
        month,
        toNum(r.Amount || r.amount) ?? 0,
        toNum(r.Discount || r.discount) ?? 0,
        toNum(r.Total || r.total) ?? 0,
        toDate(r.Date || r.date),
        r.Method || r.method || '',
        r.Staff || r.staff || '',
      ]
    );
  }
  console.log(`Imported ${rows.length} payments.`);
}

async function importNotes() {
  const path = findCsv('Notes.csv');
  if (!path) {
    console.log('Skipping Notes (file not found)');
    return;
  }
  await pool.query('TRUNCATE notes RESTART IDENTITY');
  const rows = parseCsv(path);
  let imported = 0;
  for (const r of rows) {
    try {
      const dateVal = String(r.Date || r.date || '').trim();
      let ts = null;
      if (dateVal) {
        const m = dateVal.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        const d = m
          ? new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10))
          : new Date(dateVal);
        if (!isNaN(d.getTime())) {
          const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
          ts = `${y}-${mo}-${day}`;
        }
      }
      await pool.query(
        `INSERT INTO notes (student_id, staff, date, note)
         VALUES ($1, $2, COALESCE($3::date, NOW()), $4)`,
        [
          toNum(r['Student ID'] || r.StudentID || r.student_id),
          r.Staff || r.staff || '',
          ts,
          r.Note || r.note || '',
        ]
      );
      imported++;
    } catch (err) {
      console.warn('Skipping note row:', err.message);
    }
  }
  console.log(`Imported ${imported} notes.`);
}

/** Split group lesson student names: "A and B", "A, B", "A & B" -> ["A", "B"] */
function splitStudentNames(str) {
  if (!str || typeof str !== 'string') return [];
  return str
    .split(/\s+and\s+|,\s*|\s*&\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function toMonthKeyYYYYMM(val, yearFallback) {
  const m = String(val || '').trim();
  if (!m) return '';
  if (/^\d{4}-\d{2}$/.test(m)) return m;
  const monthMap = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12', January: '01', February: '02', March: '03', April: '04', June: '06', July: '07', August: '08', September: '09', October: '10', November: '11', December: '12' };
  const parts = m.split(/\s+/);
  let year = yearFallback || new Date().getFullYear();
  let monthNum = '';
  if (parts.length >= 2 && /^\d{4}$/.test(parts[parts.length - 1])) {
    year = parseInt(parts.pop(), 10);
    monthNum = monthMap[parts.join(' ')] || monthMap[parts[0]] || monthMap[parts[0]?.substring(0, 3)];
  } else {
    monthNum = monthMap[m] || monthMap[m.substring(0, 3)];
  }
  return monthNum ? `${year}-${monthNum}` : m;
}

async function importLessons() {
  const path = findCsv('Lessons.csv');
  if (!path) {
    console.log('Skipping Lessons (file not found)');
    return;
  }
  const rows = parseCsv(path);
  for (const r of rows) {
    const month = toMonthKeyYYYYMM(r.Month || r.month, toNum(r.Year || r.year) || new Date().getFullYear());
    if (!month) continue;
    const studentId = toNum(r['Student ID'] || r.StudentID || r.student_id);
    if (!studentId) continue;
    await pool.query(
      `INSERT INTO lessons (student_id, month, lessons)
       VALUES ($1, $2, $3)
       ON CONFLICT (student_id, month) DO UPDATE SET lessons = EXCLUDED.lessons`,
      [studentId, month, toNum(r.Lessons || r.lessons) ?? 0]
    );
  }
  console.log(`Imported ${rows.length} lessons.`);
}

async function importMonthlySchedule() {
  const path = findCsv('MonthlySchedule.csv');
  if (!path) {
    console.log('Skipping MonthlySchedule (file not found)');
    return;
  }
  const rows = parseCsv(path);
  await pool.query('TRUNCATE monthly_schedule');
  let imported = 0;
  for (const r of rows) {
    try {
      const rawEventId = r.EventID || r.event_id || r.EventId || '';
      if (!rawEventId) continue;
      const dateVal = r.Date || r.date || '';
      const startVal = r.Start || r.start || '';
      const endVal = r.End || r.end || '';
      let date = null;
      let startTs = null;
      let endTs = null;
      if (dateVal) {
        const dm = String(dateVal).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        const d = dm
          ? new Date(parseInt(dm[3], 10), parseInt(dm[2], 10) - 1, parseInt(dm[1], 10))
          : new Date(dateVal);
        if (!isNaN(d.getTime())) {
          const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
          date = `${y}-${m}-${day}`;
        }
      }
      const eventId = date ? `${rawEventId}_${date}` : rawEventId;
      if (startVal && date) {
        const hm = String(startVal).trim().match(/^(\d{1,2}):(\d{2})/);
        if (hm) startTs = `${date}T${hm[1].padStart(2, '0')}:${hm[2]}:00`;
        else {
          const s = new Date(startVal);
          if (!isNaN(s.getTime())) startTs = s.toISOString();
        }
      } else if (startVal) {
        const s = new Date(startVal);
        if (!isNaN(s.getTime())) startTs = s.toISOString();
      }
      if (endVal && date) {
        const hm = String(endVal).trim().match(/^(\d{1,2}):(\d{2})/);
        if (hm) endTs = `${date}T${hm[1].padStart(2, '0')}:${hm[2]}:00`;
        else {
          const e = new Date(endVal);
          if (!isNaN(e.getTime())) endTs = e.toISOString();
        }
      } else if (endVal) {
        const e = new Date(endVal);
        if (!isNaN(e.getTime())) endTs = e.toISOString();
      }
      const rawStudentName = (r.StudentName || r.student_name || '').trim();
      if (!rawStudentName) continue;
      const studentNames = splitStudentNames(rawStudentName);
      for (const studentName of studentNames) {
        await pool.query(
          `INSERT INTO monthly_schedule (event_id, title, date, start, "end", status, student_name, is_kids_lesson, teacher_name)
           VALUES ($1, $2, $3::date, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9)
           ON CONFLICT (event_id, student_name) DO UPDATE SET
             title = EXCLUDED.title, date = EXCLUDED.date, start = EXCLUDED.start, "end" = EXCLUDED.end,
             status = EXCLUDED.status,
             is_kids_lesson = EXCLUDED.is_kids_lesson, teacher_name = EXCLUDED.teacher_name`,
          [
            eventId,
            r.Title || r.title || '',
            date || null,
            startTs || null,
            endTs || null,
            r.Status || r.status || 'scheduled',
            studentName,
            r.IsKidsLesson === 'true' || r.IsKidsLesson === '1' || r.is_kids_lesson === true,
            r.TeacherName || r.teacher_name || '',
          ]
        );
        imported++;
      }
    } catch (err) {
      console.warn('Skipping MonthlySchedule row:', err.message);
    }
  }
  console.log(`Imported ${imported} MonthlySchedule rows (group lessons split per student).`);
}

async function importUnpaid() {
  const path = findCsv('Unpaid.csv');
  if (!path) {
    console.log('Skipping Unpaid (file not found)');
    return;
  }
  const rows = parseCsv(path);
  await pool.query('TRUNCATE unpaid');
  for (const r of rows) {
    const name = r['Student Name'] || r.student_name || r.Name || r.name || Object.values(r)[0];
    const id = toNum(r['Student ID'] || r.student_id || r.ID || r.id);
    if (!name && !id) continue;
    await pool.query(
      'INSERT INTO unpaid (student_name, student_id) VALUES ($1, $2)',
      [name || null, id]
    );
  }
  console.log(`Imported ${rows.length} unpaid entries.`);
}

async function importStats() {
  const path = findCsv('Stats.csv');
  if (!path) {
    console.log('Skipping Stats (file not found)');
    return;
  }
  const rows = parseCsv(path);
  for (const r of rows) {
    const month = r.Month || r.month || Object.values(r)[0];
    if (!month) continue;
    await pool.query(
      `INSERT INTO stats (month, lessons, students)
       VALUES ($1, $2, $3)
       ON CONFLICT (month) DO UPDATE SET lessons = EXCLUDED.lessons, students = EXCLUDED.students`,
      [month, toNum(r.Lessons || r.lessons) ?? 0, toNum(r.Students || r.students) ?? 0]
    );
  }
  console.log(`Imported ${rows.length} stats.`);
}

async function main() {
  const doImport = process.argv.includes('--import');
  console.log('Connecting to database...');
  const client = await pool.connect();
  try {
    await runSchema();
    await seedStaff();
    if (doImport) {
      if (!existsSync(dataDir)) {
        console.log(`Creating ${dataDir} - add your CSV exports there and run again.`);
        const { mkdirSync } = await import('fs');
        mkdirSync(dataDir, { recursive: true });
        console.log('Place CSV files (Students.csv, Payment.csv, etc.) in migration-data/ and run with --import');
        return;
      }
      console.log('Importing data from migration-data/...');
      await importStudents();
      await importPayments();
      await importNotes();
      await importLessons();
      await importMonthlySchedule();
      await importUnpaid();
      await importStats();
      console.log('Migration complete.');
    } else {
      console.log('Schema only. Use --import to load data from migration-data/*.csv');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
