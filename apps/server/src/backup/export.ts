import fs from 'node:fs';
import type { BackupKind, BackupManifest, BackupProjectInfo, BackupSummary } from '@storytime/shared';
import type { Sqlite } from '../db/client.js';
import { badRequest, notFound } from '../services/entities.js';
import { BACKUP_TABLES, scope, tableName } from './tables.js';
import {
  AUTO_KINDS,
  BackupWriter,
  FORMAT,
  FORMAT_VERSION,
  backupPath,
  currentAppSchema,
  encodeRow,
  newBackupId,
  pruneBackups,
} from './files.js';

export interface BackupTarget {
  sqlite: Sqlite;
  backupDir: string;
}

export interface CreateBackupOptions {
  /** Empty or omitted means every story. */
  projectIds?: string[];
  label?: string;
  kind?: BackupKind;
}

/**
 * Snapshot the chosen stories into a new backup file. Everything is read inside
 * one transaction, so the file is consistent even if a run is writing meanwhile.
 */
export function createBackup(target: BackupTarget, options: CreateBackupOptions = {}): BackupSummary {
  const { sqlite, backupDir } = target;
  const kind = options.kind ?? 'manual';
  const id = newBackupId(backupDir);
  const finalPath = backupPath(backupDir, id);
  let writer: BackupWriter | null = null;

  const write = sqlite.transaction((): BackupManifest => {
    const ids = resolveProjects(sqlite, options.projectIds ?? []);

    const projects = readProjectInfo(sqlite, ids);
    const tableCounts: Record<string, number> = {};
    for (const { table, where } of BACKUP_TABLES) {
      const name = tableName(table);
      const { sql, params } = scope(where, ids);
      tableCounts[name] = (sqlite.prepare(`SELECT COUNT(*) AS n FROM "${name}" WHERE ${sql}`).get(...params) as { n: number }).n;
    }

    const manifest: BackupManifest = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      id,
      label: options.label?.trim() ?? '',
      kind,
      createdAt: Date.now(),
      appSchema: currentAppSchema(),
      projects,
      tableCounts,
    };

    writer = new BackupWriter(finalPath);
    writer.writeManifest(manifest);
    for (const { table, where } of BACKUP_TABLES) {
      const name = tableName(table);
      const { sql, params } = scope(where, ids);
      const encoded: string[] = [];
      for (const row of sqlite.prepare(`SELECT * FROM "${name}" WHERE ${sql}`).iterate(...params)) {
        encoded.push(encodeRow(row as Record<string, unknown>));
      }
      writer.writeRows(name, encoded);
    }
    return manifest;
  });

  try {
    const manifest = write();
    writer!.commit();
    return { ...manifest, bytes: fs.statSync(finalPath).size };
  } catch (err) {
    (writer as BackupWriter | null)?.abort();
    throw err;
  }
}

/** createBackup, then the housekeeping that goes with a backup the app made on its own. */
export async function createBackupAndPrune(target: BackupTarget, options: CreateBackupOptions = {}) {
  const summary = createBackup(target, options);
  if (AUTO_KINDS.includes(summary.kind)) await pruneBackups(target.backupDir);
  return summary;
}

function resolveProjects(sqlite: Sqlite, requested: string[]): string[] {
  const wanted = [...new Set(requested)];
  if (wanted.length === 0) {
    const all = (sqlite.prepare('SELECT id FROM projects ORDER BY title').all() as Array<{ id: string }>).map((r) => r.id);
    if (all.length === 0) throw badRequest('There are no stories to back up.');
    return all;
  }
  const marks = wanted.map(() => '?').join(',');
  const found = new Set(
    (sqlite.prepare(`SELECT id FROM projects WHERE id IN (${marks})`).all(...wanted) as Array<{ id: string }>).map((r) => r.id),
  );
  if (wanted.some((id) => !found.has(id))) throw notFound('Project');
  return wanted;
}

/** Same word count the book list shows: the current version of each chapter. */
function readProjectInfo(sqlite: Sqlite, ids: string[]): BackupProjectInfo[] {
  const marks = ids.map(() => '?').join(',');
  return sqlite
    .prepare(
      `SELECT p.id AS id, p.title AS title, p.updated_at AS updatedAt,
         (SELECT COALESCE(SUM(v.word_count), 0) FROM chapters c
            JOIN generated_versions v ON v.id = c.current_version_id
           WHERE c.project_id = p.id) AS wordCount,
         (SELECT COUNT(*) FROM chapters WHERE project_id = p.id) AS chapters,
         (SELECT COUNT(*) FROM characters WHERE project_id = p.id) AS characters
       FROM projects p WHERE p.id IN (${marks}) ORDER BY p.title`,
    )
    .all(...ids) as BackupProjectInfo[];
}
