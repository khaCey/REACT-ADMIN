#!/usr/bin/env node
import 'dotenv/config';
/**
 * Single-command startup: PostgreSQL + Express API + React frontend
 * Run: npm start
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname);

// Use existing PostgreSQL if DATABASE_URL is set (e.g. docker or local install)
const useExistingDb = !!process.env.DATABASE_URL;

function printDbInstructions() {
  console.error('Embedded PostgreSQL failed (common on Windows). Use Docker instead:');
  console.error('  1. Run: docker-compose up -d');
  console.error('  2. Run: set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres');
  console.error('  3. Run: npm start');
  console.error('');
  console.error('Or use local PostgreSQL and set DATABASE_URL.');
}

async function startEmbeddedPostgres() {
  if (process.platform === 'win32') {
    printDbInstructions();
    throw new Error('Use DATABASE_URL with Docker or local PostgreSQL on Windows.');
  }
  try {
    const EmbeddedPostgres = (await import('embedded-postgres')).default;
    const dataDir = join(rootDir, 'data', 'db');
    const pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 5433,
      persistent: true,
    });
    try {
      await pg.initialise();
    } catch (initErr) {
      if (!String(initErr).includes('already exist')) throw initErr;
    }
    await pg.start();
    process.env.DATABASE_URL = `postgresql://postgres:postgres@localhost:5433/postgres`;
    return pg;
  } catch (err) {
    printDbInstructions();
    throw err;
  }
}

async function main() {
  console.log('Starting Student Admin...');

  if (!useExistingDb) {
    try {
      await startEmbeddedPostgres();
      console.log('PostgreSQL started (embedded)');
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  } else {
    console.log('Using existing PostgreSQL (DATABASE_URL)');
  }

  // Run migrations
  const dbPath = join(rootDir, 'server', 'db', 'index.js');
  if (existsSync(dbPath)) {
    try {
      const { runMigrations } = await import('./server/db/index.js');
      await runMigrations();
      console.log('Database migrations complete');
    } catch (err) {
      console.error('Migration error:', err.message);
    }
  }

  // Start Express API
  const serverProcess = spawn('node', ['server/index.js'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  });

  serverProcess.on('error', (err) => {
    console.error('Server failed:', err);
    process.exit(1);
  });

  // Wait for API to be ready, then start Vite
  const apiPort = process.env.API_PORT || 3001;
  const clientPort = process.env.CLIENT_PORT || 5173;

  const waitForApi = () =>
    new Promise((resolve) => {
      const check = () => {
        fetch(`http://localhost:${apiPort}/api/health`)
          .then(() => resolve())
          .catch(() => setTimeout(check, 200));
      };
      setTimeout(check, 500);
    });

  waitForApi().then(() => {
    // Start Vite dev server (shell: true needed on Windows for npm to resolve)
    const isWin = process.platform === 'win32';
    const viteProcess = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'dev'], {
      cwd: join(rootDir, 'client'),
      stdio: 'inherit',
      shell: isWin,
      env: { ...process.env, VITE_API_URL: `http://localhost:${apiPort}` },
    });

    viteProcess.on('error', (err) => {
      console.error('Vite failed:', err);
    });

    // Open browser after a delay
    setTimeout(async () => {
      try {
        const { default: open } = await import('open');
        open(`http://localhost:${clientPort}`);
      } catch {
        console.log(`\nOpen http://localhost:${clientPort} in your browser\n`);
      }
    }, 3000);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
