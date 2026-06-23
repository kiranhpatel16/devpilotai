import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { SCHEMA_SQL } from './schema.js';

let db: Database.Database | null = null;

/** Returns the singleton database connection, creating + migrating it once. */
export function getDb(): Database.Database {
  if (db) return db;

  const dir = path.dirname(config.databaseFile);
  fs.mkdirSync(dir, { recursive: true });

  db = new Database(config.databaseFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/** Apply the idempotent schema. Safe to run on every boot. */
export function migrate(connection: Database.Database): void {
  connection.exec(SCHEMA_SQL);
  // Additive migrations for existing databases.
  ensureColumn(connection, 'users', 'jira_account_id', 'jira_account_id TEXT');
  ensureColumn(connection, 'runs', 'detail_json', 'detail_json TEXT');
  ensureColumn(connection, 'runs', 'error', 'error TEXT');
  ensureColumn(connection, 'projects', 'frontend_theme', 'frontend_theme TEXT');
}

/** Add a column to a table if it does not already exist. */
function ensureColumn(
  connection: Database.Database,
  table: string,
  column: string,
  ddl: string,
): void {
  const cols = connection
    .prepare(`PRAGMA table_info(${table})`)
    .all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    connection.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
