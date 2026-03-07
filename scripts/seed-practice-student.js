#!/usr/bin/env node
/**
 * Add practice student Tarou Tanaka (ID 0) to an existing database.
 * Run: npm run seed:practice
 */
import 'dotenv/config';
import pg from 'pg';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/postgres';

const pool = new pg.Pool({ connectionString });

async function main() {
  console.log('Adding practice student Tarou Tanaka (ID 0)...');
  await pool.query(
    `INSERT INTO students (id, name, name_kanji, email, phone, phone_secondary, same_day_cancel, status, payment, group_type, group_size, is_child)
     VALUES (0, 'Tarou Tanaka', '太郎 田中', '', '', '', '', 'Active', 'NEO', 'Single', 1, false)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       name_kanji = EXCLUDED.name_kanji,
       status = EXCLUDED.status,
       payment = EXCLUDED.payment,
       group_type = EXCLUDED.group_type,
       group_size = EXCLUDED.group_size,
       updated_at = NOW()`
  );
  await pool.query(
    `SELECT setval('students_id_seq', (SELECT COALESCE(MAX(id), 0) FROM students))`
  );
  console.log('Done. Tarou Tanaka (ID 0) is ready.');
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
