import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../service/package.json', import.meta.url));
let Database;
try {
  Database = require('better-sqlite3');
} catch {
  ({ DatabaseSync: Database } = await import('node:sqlite'));
}
const directory = mkdtempSync(join(tmpdir(), 'breakout-migrations-'));
const db = new Database(join(directory, 'fresh.sqlite'));
try {
  for (const version of ['0001', '0002', '0003', '0004', '0005']) {
    db.exec(readFileSync(new URL(`../service/migrations/${version}.sql`, import.meta.url), 'utf8'));
    console.log(`${version}.sql: PASS`);
  }
  const integrity = db.prepare('PRAGMA integrity_check').get();
  if (integrity.integrity_check !== 'ok') throw Error('SQLite integrity check failed');
  const columns = db.prepare('PRAGMA table_info(jobs)').all().map(row => row.name);
  for (const name of ['cleanup_status', 'cleanup_attempts', 'cleanup_last_attempt_at', 'submit_started', 'submission_generation']) {
    if (!columns.includes(name)) throw Error(`Missing jobs column ${name}`);
  }
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  for (const name of ['jobs', 'reservations', 'mock_reservations', 'deleted_jobs']) {
    if (!tables.includes(name)) throw Error(`Missing table ${name}`);
  }
  const spend = db.prepare("SELECT pool, units, status FROM reservations WHERE id = 'external-dev-spend-20261025'").get();
  if (spend?.pool !== 'dev' || spend.units !== 9 || spend.status !== 'spent') throw Error('Missing migration 0005 external spend reservation');
  console.log('Fresh SQLite schema and integrity: PASS');
} finally {
  db.close();
  rmSync(directory, { recursive: true, force: true });
}
