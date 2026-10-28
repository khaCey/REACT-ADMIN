import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirnameDb = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirnameDb, '..', '..', '.env'), override: true });

import pg from 'pg';
import { logEvent } from '../lib/appLogger.js';
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
  let client;
  const operation = String(text).trim().match(/^(INSERT INTO|UPDATE|DELETE FROM)\s+([\w.]+)/i);
  try {
    client = await pool.connect();
    const result = await client.query(text, params);
    if (operation) logEvent('info', 'database.write', { operation: operation[1], table: operation[2], rows: result.rowCount });
    return result;
  } catch (error) {
    logEvent('error', 'database.failed', { operation: operation?.[1], table: operation?.[2], error,
      parameterLengths: (params || []).map(v => typeof v === 'string' ? Array.from(v).length : null) });
    throw error;
  } finally {
    client?.release();
  }
}

export async function runMigrations() {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf8');
  await pool.query(schema);

  // Additive migration for the rebuilt Calendar mirror/tagging flow.
  // Existing event_id / calendar_source_event_id infrastructure is untouched.
  const exactGoogleEventIdPath = join(__dirname, 'add_calendar_google_event_id.sql');
  const exactGoogleEventIdMigration = readFileSync(exactGoogleEventIdPath, 'utf8');
  await pool.query(exactGoogleEventIdMigration);
}

export { pool };
