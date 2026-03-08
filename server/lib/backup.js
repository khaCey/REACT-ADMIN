/**
 * Shared backup runner: pg_dump to temp file, upload to Drive, record in backups table.
 */
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlink, statSync } from 'fs';
import { promisify } from 'util';
import { query } from '../db/index.js';
import { uploadBackupFile, deleteBackupFile, downloadBackupFile } from './googleDrive.js';

const unlinkAsync = promisify(unlink);

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/postgres';

/**
 * Run a full backup: pg_dump, upload to Drive, insert metadata into backups table.
 * @param {{ source: 'manual' | 'scheduled' }} options
 * @returns {Promise<{ fileId: string, fileName: string, webViewLink: string }>}
 */
export async function runBackup({ source }) {
  const pgDumpPath = process.env.PG_DUMP_PATH || 'pg_dump';
  const tempPath = join(tmpdir(), `backup-${Date.now()}.sql`);
  const fileName = `backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.sql`;

  let success = false;
  try {
    await runPgDump(pgDumpPath, tempPath);
    const sizeBytes = statSync(tempPath).size;
    const { fileId, webViewLink } = await uploadBackupFile(tempPath, fileName);

    await query(
      `INSERT INTO backups (file_name, drive_file_id, web_view_link, size_bytes, source)
       VALUES ($1, $2, $3, $4, $5)`,
      [fileName, fileId, webViewLink || null, sizeBytes, source]
    );
    success = true;
    return { fileId, fileName, webViewLink: webViewLink || '' };
  } finally {
    try {
      await unlinkAsync(tempPath);
    } catch (_) {
      // ignore
    }
  }
}

/**
 * @param {string} pgDumpPath
 * @param {string} outputPath
 */
function runPgDump(pgDumpPath, outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(pgDumpPath, ['-f', outputPath, connectionString], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (ch) => { stderr += ch; });
    child.on('error', (err) => {
      reject(new Error(`pg_dump failed: ${err.message}. Is pg_dump on PATH or set PG_DUMP_PATH?`));
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited ${code}${stderr ? ': ' + stderr.trim() : ''}`));
    });
  });
}

/**
 * Delete backup rows and their Drive files older than the given number of days.
 * @param {number} days - Keep backups from the last N days
 * @returns {Promise<number>} Number of backups deleted
 */
export async function cleanupBackupsOlderThan(days) {
  const result = await query(
    `SELECT id, drive_file_id FROM backups WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
    [days]
  );
  const rows = result.rows || [];
  for (const row of rows) {
    if (row.drive_file_id) {
      try {
        await deleteBackupFile(row.drive_file_id);
      } catch (err) {
        console.error('[backup] cleanup: failed to delete Drive file', row.drive_file_id, err.message);
      }
    }
  }
  if (rows.length === 0) return 0;
  await query(`DELETE FROM backups WHERE created_at < NOW() - INTERVAL '1 day' * $1`, [days]);
  return rows.length;
}

/**
 * Resolve psql path: PG_PSQL_PATH, or same dir as pg_dump (pg_dump -> psql), or 'psql'.
 */
function getPsqlPath() {
  if (process.env.PG_PSQL_PATH) return process.env.PG_PSQL_PATH.trim();
  const pgDump = process.env.PG_DUMP_PATH || 'pg_dump';
  if (pgDump.includes('pg_dump')) {
    return pgDump.replace(/pg_dump(\.exe)?$/i, 'psql$1');
  }
  return 'psql';
}

/**
 * Restore the database from a backup by id (downloads from Drive, runs psql).
 * @param {number} backupId - Row id in backups table
 * @returns {Promise<{ fileName: string }>}
 */
export async function runRestore(backupId) {
  const id = Number(backupId);
  if (!Number.isInteger(id) || id < 1) throw new Error('Invalid backup id');
  const result = await query(
    `SELECT id, file_name, drive_file_id FROM backups WHERE id = $1`,
    [id]
  );
  if (!result.rows.length) throw new Error('Backup not found');
  const row = result.rows[0];
  if (!row.drive_file_id) throw new Error('Backup has no Drive file; cannot restore');
  const psqlPath = getPsqlPath();
  const tempPath = join(tmpdir(), `restore-${Date.now()}.sql`);
  try {
    await downloadBackupFile(row.drive_file_id, tempPath);
    await runPsql(psqlPath, tempPath);
    return { fileName: row.file_name };
  } finally {
    try {
      await unlinkAsync(tempPath);
    } catch (_) {
      // ignore
    }
  }
}

/**
 * @param {string} psqlPath
 * @param {string} inputPath - Path to .sql file
 */
function runPsql(psqlPath, inputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(psqlPath, ['-f', inputPath, connectionString], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (ch) => { stderr += ch; });
    child.on('error', (err) => {
      reject(new Error(`psql failed: ${err.message}. Set PG_PSQL_PATH or PG_DUMP_PATH (same dir as psql) if needed.`));
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql exited ${code}${stderr ? ': ' + stderr.trim() : ''}`));
    });
  });
}
