#!/usr/bin/env node
/**
 * Seed dummy teacher shifts.
 * Sham, Khacey, Ana - from March 2026.
 *
 * Usage: node scripts/seed-teacher-shifts.js
 */

import 'dotenv/config';
import pg from 'pg';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/postgres';

const pool = new pg.Pool({ connectionString });

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Check if date is alternate Sunday for Ana 10-5 (Sundays when Khacey doesn't have 10-9). */
function isAnaShortSunday(date) {
  if (date.getDay() !== 0) return false;
  const march8 = new Date(date.getFullYear(), 2, 8);
  if (date < march8) return false;
  const weeksSince = Math.floor((date - march8) / (7 * 24 * 60 * 60 * 1000));
  return weeksSince % 2 === 1;
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM teacher_schedules');
    const rows = [];

    // Jan 2025 - May 2026 (covers current and upcoming weeks)
    const start = new Date(2025, 0, 1);  // Jan 1, 2025
    const end = new Date(2026, 4, 31);   // May 31, 2026
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = formatDate(d);
      const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

      // Sham: Tue, Wed, Thu, Fri, Sun — 10:00-17:00
      if ([0, 2, 3, 4, 5].includes(dow)) {
        rows.push([dateStr, 'Sham', '10:00', '17:00']);
      }

      // Khacey
      if (dow === 6 || dow === 1) {
        // Sat, Mon: 10:00-17:00
        rows.push([dateStr, 'Khacey', '10:00', '17:00']);
      } else if (dow === 2 || dow === 4) {
        // Tue, Thu: 16:00-21:00
        rows.push([dateStr, 'Khacey', '16:00', '21:00']);
      } else if (dow === 3) {
        // Wed: 12:00-21:00
        rows.push([dateStr, 'Khacey', '12:00', '21:00']);
      } else if (dow === 0) {
        // Sun: 10:00-17:00
        rows.push([dateStr, 'Khacey', '10:00', '17:00']);
      }

      // Ana: Tue 10:00-21:00, Thu 15:00-21:00, Fri 10:00-21:00, Sat 10:00-18:00, alternate Sun 10:00-17:00
      if (dow === 2) {
        rows.push([dateStr, 'Ana', '10:00', '21:00']);
      } else if (dow === 4) {
        rows.push([dateStr, 'Ana', '15:00', '21:00']);
      } else if (dow === 5) {
        rows.push([dateStr, 'Ana', '10:00', '21:00']);
      } else if (dow === 6) {
        rows.push([dateStr, 'Ana', '10:00', '18:00']);
      } else if (dow === 0 && isAnaShortSunday(d)) {
        rows.push([dateStr, 'Ana', '10:00', '17:00']);
      }
    }

    for (const [date, teacher, startTime, endTime] of rows) {
      await client.query(
        `INSERT INTO teacher_schedules (date, teacher_name, start_time, end_time)
         VALUES ($1::date, $2, $3::time, $4::time)
         ON CONFLICT (date, teacher_name, start_time) DO NOTHING`,
        [date, teacher, startTime, endTime]
      );
    }

    console.log(`Seeded ${rows.length} teacher shifts (Jan 2025 – May 2026)`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
