import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

const here = dirname(fileURLToPath(import.meta.url));

let db: BetterSQLite3Database<typeof schema> | null = null;
let sqlite: Database.Database | null = null;

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (db) return db;
  const path = process.env.DATABASE_PATH ?? './data/app.db';
  sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  db = drizzle(sqlite, { schema });
  runMigrations(sqlite);
  return db;
}

function runMigrations(sqlite: Database.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS __migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  )`);
  const dir = join(here, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    sqlite.prepare('SELECT name FROM __migrations').all().map((r) => (r as { name: string }).name),
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    sqlite.exec(sql);
    sqlite
      .prepare('INSERT INTO __migrations (name, applied_at) VALUES (?, ?)')
      .run(file, new Date().toISOString());
  }
}

export function closeDb(): void {
  if (sqlite) {
    try {
      sqlite.close();
    } catch {
      /* ignore */
    }
  }
  sqlite = null;
  db = null;
}

export function getRawDb(): Database.Database {
  getDb();
  return sqlite!;
}
