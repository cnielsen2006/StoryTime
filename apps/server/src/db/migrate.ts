import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, getDb, type Db } from './client.js';
import { config } from '../config.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export function runMigrations(db: Db) {
  migrate(db, { migrationsFolder });
}

/** Entry point for `npm run db:migrate`. */
async function main() {
  const { db } = getDb();
  runMigrations(db);
  console.log(`Migrations applied to ${config.dbPath}`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { createDb };
