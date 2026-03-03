import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirnameDb = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirnameDb, '..', '..', '.env'), override: true });

import pg from 'pg';
import { readFileSync } from 'fs';

const __dirname = __dirnameDb;

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
