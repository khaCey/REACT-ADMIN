#!/usr/bin/env node
/**
 * Debug backfill: check DB contents and optionally test GAS response.
 * Usage:
 *   node scripts/debug-backfill.js 548              # Check DB for student 548 (Katsuya Mori)
 *   node scripts/debug-backfill.js 548 --test-gas    # Also fetch from GAS and show raw response
 */
import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres',
});

async function main() {
  const studentId = process.argv[2];
  const testGas = process.argv.includes('--test-gas');
  if (!studentId) {
    console.log('Usage: node scripts/debug-backfill.js <student_id> [--test-gas]');
    process.exit(1);
  }

  const studentResult = await pool.query('SELECT id, name FROM students WHERE id = $1', [studentId]);
  if (studentResult.rows.length === 0) {
    console.log(`No student found with ID ${studentId}`);
    await pool.end();
    process.exit(1);
  }
  const name = (studentResult.rows[0].name || '').trim();
  console.log(`\nStudent ${studentId}: "${name}"\n`);

  const scheduleResult = await pool.query(
    `SELECT event_id, date, start, status, student_name
     FROM monthly_schedule
     WHERE student_name = $1 OR student_name = $2
     AND date >= '2026-03-01' AND date < '2026-04-01'
     ORDER BY date`,
    [name, name.split(/\s+/).reverse().join(' ')]
  );
  console.log(`monthly_schedule rows for March 2026: ${scheduleResult.rows.length}`);
  if (scheduleResult.rows.length > 0) {
    scheduleResult.rows.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.date} ${r.start || ''} ${r.status} (event: ${(r.event_id || '').slice(0, 30)}...)`);
    });
  } else {
    console.log('  (none)');
  }

  if (testGas) {
    const url = (process.env.CALENDAR_POLL_URL || process.env.VITE_CALENDAR_POLL_URL || '').trim();
    const key = (process.env.CALENDAR_POLL_API_KEY || process.env.VITE_CALENDAR_POLL_API_KEY || '').trim();
    if (!url || !key) {
      console.log('\nGAS test skipped: CALENDAR_POLL_URL and CALENDAR_POLL_API_KEY not set in .env');
    } else {
      const gasUrl = `${url.replace(/\/$/, '')}?key=${encodeURIComponent(key)}&full=1&month=2026-03`;
      console.log('\nFetching from GAS...');
      const res = await fetch(gasUrl);
      const json = await res.json().catch(() => ({}));
      if (json.error) {
        console.log('GAS error:', json.error);
      } else {
        const data = Array.isArray(json.data) ? json.data : [];
        const forStudent = data.filter((r) => {
          const sn = (r.studentName || r.student_name || '').trim();
          return sn === name || sn === name.split(/\s+/).reverse().join(' ');
        });
        console.log(`GAS returned ${data.length} total rows, ${forStudent.length} for "${name}"`);
        forStudent.slice(0, 5).forEach((r, i) => {
          console.log(`  ${i + 1}. ${r.date} ${r.start} ${r.status} ${r.studentName || r.student_name}`);
        });
        if (forStudent.length > 5) console.log(`  ... and ${forStudent.length - 5} more`);
      }
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
