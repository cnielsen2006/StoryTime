import fs from 'node:fs';
import type { Statement } from 'better-sqlite3';
import type { Readable } from 'node:stream';
import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { BackupRestore, BackupRestoreResult, BackupSummary } from '@storytime/shared';
import type { Sqlite } from '../db/client.js';
import { isProjectBusy } from '../generation/runner.js';
import { badRequest, conflict, newId, notFound } from '../services/entities.js';
import { createBackup, type BackupTarget } from './export.js';
import { BackupWriter, backupPath, currentAppSchema, deleteBackup, newBackupId, pruneBackups, readBackup, encodeRow, type BackupContents, type Row } from './files.js';
import { BACKUP_TABLES, scope, tableName } from './tables.js';

type Mode = BackupRestoreResult['restored'][number]['mode'];

interface PlanItem {
  id: string;
  mode: Mode;
  title: string;
}

/** Everything that is a token in text: an id, with the characters ids are made of. */
const TOKEN = /[A-Za-z0-9_-]+/g;
const RUN_INTERRUPTED = 'Backed up while this run was in progress.';

interface TableShape {
  name: string;
  columns: Map<string, SQLiteColumn>;
  /** (local column, parent table) pairs, used to work out which story a row belongs to. */
  parents: Array<{ column: string; table: string; foreign: string }>;
}

const SHAPES: TableShape[] = BACKUP_TABLES.map(({ table }) => {
  const config = getTableConfig(table);
  return {
    name: config.name,
    columns: new Map(config.columns.map((c) => [c.name, c])),
    parents: config.foreignKeys.map((fk) => {
      const ref = fk.reference();
      return { column: ref.columns[0]!.name, table: getTableConfig(ref.foreignTable).name, foreign: ref.foreignColumns[0]!.name };
    }),
  };
});

export async function restoreBackup(
  target: BackupTarget,
  id: string,
  request: BackupRestore,
): Promise<BackupRestoreResult> {
  const file = backupPath(target.backupDir, id);
  if (!fs.existsSync(file)) throw notFound('Backup');
  const contents = await readBackup(fs.createReadStream(file));
  return restoreContents(target, contents, request);
}

/** Pure bookkeeping up to the transaction; from there it is all-or-nothing. */
async function restoreContents(
  target: BackupTarget,
  contents: BackupContents,
  request: BackupRestore,
): Promise<BackupRestoreResult> {
  const { sqlite } = target;
  const warnings: string[] = [];
  const rows = sanitise(contents, warnings);
  const owned = groupByProject(rows, warnings);

  const inFile = new Map((rows.get('projects') ?? []).map((row) => [String(row.id), String(row.title ?? '')]));
  const wanted = request.projects ?? [...inFile.keys()].map((pid) => ({ id: pid, mode: 'replace' as const }));
  if (wanted.length === 0) throw badRequest('This backup does not contain any stories.');

  const exists = sqlite.prepare('SELECT 1 FROM projects WHERE id = ?');
  const plan = new Map<string, PlanItem>();
  for (const { id, mode } of wanted) {
    const title = inFile.get(id);
    if (title === undefined) throw badRequest(`This backup does not contain the story ${id}.`);
    const present = exists.get(id) !== undefined;
    plan.set(id, { id, title, mode: mode === 'copy' ? 'copy' : present ? 'replace' : 'restore' });
  }

  // Nothing below awaits until the transaction is done, so a run cannot start in between.
  const replacing = [...plan.values()].filter((item) => item.mode === 'replace');
  for (const item of replacing) {
    if (isProjectBusy(item.id)) {
      throw conflict(`"${item.title}" is being written right now. Wait for it to finish, then restore it.`);
    }
  }

  let safety: BackupSummary | null = null;
  if (replacing.length > 0) {
    const first = replacing[0]!.title;
    const label =
      replacing.length === 1 ? `Before restoring "${first}"` : `Before restoring "${first}" and ${replacing.length - 1} more`;
    safety = createBackup(target, { projectIds: replacing.map((item) => item.id), kind: 'pre-restore', label });
  }

  const insert = new InsertCache(sqlite);
  const restored: BackupRestoreResult['restored'] = [];
  const apply = sqlite.transaction(() => {
    for (const item of plan.values()) {
      const projectRows = owned.get(item.id) ?? new Map<string, Row[]>();
      let tables = projectRows;
      let projectId = item.id;
      let title = item.title;

      if (item.mode === 'copy') {
        tables = withFreshIds(projectRows);
        projectId = String(tables.get('projects')![0]!.id);
        title = `${item.title} (restored ${today()})`;
        tables.get('projects')![0]!.title = title;
      }
      if (item.mode === 'replace') removeProject(sqlite, item.id);

      for (const shape of SHAPES) {
        for (const row of tables.get(shape.name) ?? []) {
          if (shape.name === 'generation_runs' && (row.status === 'queued' || row.status === 'running')) {
            row.status = 'failed';
            row.error = RUN_INTERRUPTED;
          }
          insert.run(shape, row);
        }
      }
      restored.push({ sourceId: item.id, projectId, title, mode: item.mode });
    }
  });

  try {
    apply();
  } catch (err) {
    if (safety) deleteBackup(target.backupDir, safety.id);
    throw explain(err);
  }
  if (safety) await pruneBackups(target.backupDir);

  return { restored, safetyBackupId: safety?.id ?? null, warnings };
}

/**
 * An uploaded file is untrusted: keep only tables and columns the live schema
 * has, and say what was dropped.
 */
function sanitise(contents: BackupContents, warnings: string[]): Map<string, Row[]> {
  const { manifest, tables } = contents;
  if (manifest.appSchema > currentAppSchema()) {
    warnings.push('This backup was made by a newer version of StoryTime; anything this version does not know about is skipped.');
  }
  const kept = new Map<string, Row[]>();
  for (const [name, rows] of tables) {
    const shape = SHAPES.find((s) => s.name === name);
    if (!shape) {
      warnings.push(`Skipped unknown table "${name}" (${rows.length} rows).`);
      continue;
    }
    const dropped = new Set<string>();
    // SQLite lets a text primary key be NULL, so a row without an id is refused here.
    const needsId = shape.columns.get('id')?.primary === true;
    const usable = needsId ? rows.filter((row) => typeof row.id === 'string' && row.id !== '') : rows;
    if (usable.length < rows.length) warnings.push(`Skipped ${rows.length - usable.length} rows in "${name}" with no id.`);
    const clean = usable.map((row) => {
      const out: Row = {};
      for (const [column, value] of Object.entries(row)) {
        if (shape.columns.has(column)) out[column] = value;
        else dropped.add(column);
      }
      return out;
    });
    if (dropped.size > 0) warnings.push(`Ignored unknown columns in "${name}": ${[...dropped].join(', ')}.`);
    kept.set(name, [...(kept.get(name) ?? []), ...clean]);
  }
  return kept;
}

/**
 * Sorts every row into the story it belongs to: directly by project_id, or by
 * following its foreign keys up to a row that has one. Driven by the schema,
 * so a new table needs nothing here.
 */
function groupByProject(rows: Map<string, Row[]>, warnings: string[]): Map<string, Map<string, Row[]>> {
  const grouped = new Map<string, Map<string, Row[]>>();
  const ownerOf = new Map<string, Map<string, string>>();
  const orphans = new Map<string, number>();

  for (const shape of SHAPES) {
    const owners = new Map<string, string>();
    ownerOf.set(shape.name, owners);
    for (const row of rows.get(shape.name) ?? []) {
      let project: string | undefined;
      if (shape.name === 'projects') project = String(row.id);
      else if (typeof row.project_id === 'string') project = row.project_id;
      else {
        for (const parent of shape.parents) {
          const value = row[parent.column];
          if (typeof value === 'string' && parent.foreign === 'id') project = ownerOf.get(parent.table)?.get(value);
          if (project) break;
        }
      }
      if (!project) {
        orphans.set(shape.name, (orphans.get(shape.name) ?? 0) + 1);
        continue;
      }
      if (typeof row.id === 'string') owners.set(row.id, project);
      const byTable = grouped.get(project) ?? new Map<string, Row[]>();
      byTable.set(shape.name, [...(byTable.get(shape.name) ?? []), row]);
      grouped.set(project, byTable);
    }
  }
  for (const [name, n] of orphans) warnings.push(`Skipped ${n} row${n === 1 ? '' : 's'} in "${name}" that belong to no story.`);
  return grouped;
}

/**
 * A copy needs new ids everywhere. Every id the story owns is collected, then
 * every string in its rows has any id token swapped, which also reaches ids
 * embedded in JSON text, [C:id] tags in markdown, and polymorphic entity_id columns.
 */
function withFreshIds(source: Map<string, Row[]>): Map<string, Row[]> {
  const map = new Map<string, string>();
  for (const shape of SHAPES) {
    if (!shape.columns.get('id')?.primary) continue;
    for (const row of source.get(shape.name) ?? []) {
      if (typeof row.id === 'string') map.set(row.id, newId());
    }
  }
  const swap = (text: string) => text.replace(TOKEN, (token) => map.get(token) ?? token);
  const out = new Map<string, Row[]>();
  for (const [table, rows] of source) {
    out.set(
      table,
      rows.map((row) => {
        const next: Row = {};
        for (const [column, value] of Object.entries(row)) next[column] = typeof value === 'string' ? swap(value) : value;
        return next;
      }),
    );
  }
  return out;
}

/** Deletes a story's rows child-first, so it does not matter whether every table cascades. */
function removeProject(sqlite: Sqlite, projectId: string) {
  for (const { table, where } of [...BACKUP_TABLES].reverse()) {
    const { sql, params } = scope(where, [projectId]);
    sqlite.prepare(`DELETE FROM "${tableName(table)}" WHERE ${sql}`).run(...params);
  }
}

/** Prepared INSERTs keyed by table and the columns a row has, so each shape is compiled once. */
class InsertCache {
  private readonly statements = new Map<string, Statement>();
  constructor(private readonly sqlite: Sqlite) {}

  run(shape: TableShape, row: Row) {
    const values: Row = { ...row };
    // Columns the backup predates fall back to the database default, except app-side defaults, which are filled here.
    for (const [name, column] of shape.columns) {
      if (name in values) continue;
      if (column.defaultFn) values[name] = column.defaultFn();
    }
    const names = Object.keys(values);
    const key = `${shape.name}|${names.join(',')}`;
    let statement = this.statements.get(key);
    if (!statement) {
      const cols = names.map((n) => `"${n}"`).join(',');
      const marks = names.map(() => '?').join(',');
      statement = this.sqlite.prepare(`INSERT INTO "${shape.name}" (${cols}) VALUES (${marks})`);
      this.statements.set(key, statement);
    }
    statement.run(...names.map((n) => values[n]));
  }
}

function explain(err: unknown): unknown {
  const code = (err as { code?: string }).code;
  if (typeof code !== 'string' || !code.startsWith('SQLITE_CONSTRAINT')) return err;
  if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return conflict('Some of this story already exists in your library under another story. Restore it as a copy instead.');
  }
  return badRequest(`This backup is incomplete or damaged and nothing was restored (${(err as Error).message}).`);
}

const pad = (n: number) => String(n).padStart(2, '0');
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// --- Import -----------------------------------------------------------------

/** Validate an uploaded file in full, then store it under a fresh id as an imported backup. */
export async function importBackup(backupDir: string, upload: Readable): Promise<BackupSummary> {
  const { manifest, tables } = await readBackup(upload);

  const stored = new Set((tables.get('projects') ?? []).map((row) => String(row.id)));
  const listed = new Set(manifest.projects.map((p) => p.id));
  if (stored.size !== listed.size || [...listed].some((pid) => !stored.has(pid))) {
    throw badRequest('That backup is damaged: the stories it lists are not the ones it contains.');
  }

  const id = newBackupId(backupDir);
  const finalPath = backupPath(backupDir, id);
  const writer = new BackupWriter(finalPath);
  try {
    writer.writeManifest({
      ...manifest,
      id,
      kind: 'imported',
      tableCounts: Object.fromEntries([...tables].map(([name, rows]) => [name, rows.length])),
    });
    for (const [name, rows] of tables) writer.writeRows(name, rows.map(encodeRow));
    writer.commit();
  } catch (err) {
    writer.abort();
    throw err;
  }
  return { ...manifest, id, kind: 'imported', bytes: fs.statSync(finalPath).size };
}
