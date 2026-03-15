import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirnameDb = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirnameDb, '..', '..', '.env'), override: true });

import pg from 'pg';
import { readFileSync } from 'fs';

const __dirname = __dirnameDb;

// Return DATE columns as YYYY-MM-DD strings so we never shift by a day when the server is in Japan (node-pg otherwise returns Date at local midnight; toISOString() then gives UTC date = one day earlier in JST).
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (val) => (val != null ? String(val).trim().slice(0, 10) : null));

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/postgres';

const pool = new pg.Pool({
  connectionString,
  max: 10,
});

export async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export async function runMigrations() {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
}

export { pool };
