import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import * as schema from './schema.js';

export type Sqlite = Database.Database;
export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface DbHandle {
  db: Db;
  sqlite: Sqlite;
}

export function createDb(dbPath: string = config.dbPath): DbHandle {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

let singleton: DbHandle | null = null;

export function getDb(): DbHandle {
  if (!singleton) singleton = createDb();
  return singleton;
}

export { schema };
