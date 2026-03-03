#!/usr/bin/env node
/**
 * Search monthly_schedule by student ID.
 * Resolves ID → name via students table, then lists all schedule rows for that name.
 *
 * Usage: node scripts/query-schedule-by-student.js 392
 */
import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres',
});

async function main() {
  const studentId = process.argv[2];
  if (!studentId) {
    console.log('Usage: node scripts/query-schedule-by-student.js <student_id>');
    process.exit(1);
  }

  const studentResult = await pool.query(
    'SELECT id, name, name_kanji FROM students WHERE id = $1',
    [studentId]
  );
  if (studentResult.rows.length === 0) {
    console.log(`No student found with ID ${studentId}`);
    await pool.end();
    process.exit(1);
  }
  const student = studentResult.rows[0];
  const name = student.name || student.name_kanji || '';
  console.log(`Student ${studentId}: ${student.name || ''} ${student.name_kanji ? `(${student.name_kanji})` : ''}\n`);

  const nameKanji = (student.name_kanji || '').replace(/\s*（.*?）\s*/g, '').trim();
  const scheduleResult = await pool.query(
    `SELECT event_id, title, date, start, "end", status, student_name, is_kids_lesson, teacher_name
     FROM monthly_schedule
     WHERE TRIM(student_name) = TRIM($1)
        OR ($2 <> '' AND TRIM(student_name) = TRIM($2))
     ORDER BY date ASC NULLS LAST, start ASC NULLS LAST`,
    [name, nameKanji]
  );

  console.log(`monthly_schedule rows for student ${studentId} ("${name}"): ${scheduleResult.rows.length}\n`);
  if (scheduleResult.rows.length > 0) {
    console.log(JSON.stringify(scheduleResult.rows, null, 2));
  } else {
    console.log('(No rows. Schedule links by student_name; if the export used a different name, no match.)');
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
