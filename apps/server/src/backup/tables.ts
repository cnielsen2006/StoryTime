import { is } from 'drizzle-orm';
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from '../db/schema.js';

/** Stands in for the selected project ids; becomes one `?` per id when a query is built. */
export const IDS = '$ids';

export interface BackupTable {
  table: SQLiteTable;
  /** Scopes the table to the selected projects, written with `$ids`. */
  where: string;
}

/**
 * Every table a story's data lives in, parents before children, so rows can be
 * inserted in this order and deleted in reverse. This is the one place to touch
 * when the schema gains a table: add it here (or to EXCLUDED), or the coverage
 * test in test/backup.test.ts fails.
 */
export const BACKUP_TABLES: BackupTable[] = [
  { table: schema.projects, where: `id IN (${IDS})` },
  { table: schema.storyParameters, where: `project_id IN (${IDS})` },
  { table: schema.characters, where: `project_id IN (${IDS})` },
  {
    table: schema.characterExperiences,
    where: `character_id IN (SELECT id FROM characters WHERE project_id IN (${IDS}))`,
  },
  { table: schema.characterRelationships, where: `project_id IN (${IDS})` },
  { table: schema.locations, where: `project_id IN (${IDS})` },
  { table: schema.plotLines, where: `project_id IN (${IDS})` },
  { table: schema.plotPoints, where: `project_id IN (${IDS})` },
  {
    table: schema.plotPointCharacters,
    where: `plot_point_id IN (SELECT id FROM plot_points WHERE project_id IN (${IDS}))`,
  },
  {
    table: schema.plotPointLocations,
    where: `plot_point_id IN (SELECT id FROM plot_points WHERE project_id IN (${IDS}))`,
  },
  { table: schema.ideas, where: `project_id IN (${IDS})` },
  { table: schema.ideaLinks, where: `idea_id IN (SELECT id FROM ideas WHERE project_id IN (${IDS}))` },
  { table: schema.generationRuns, where: `project_id IN (${IDS})` },
  { table: schema.generatedVersions, where: `project_id IN (${IDS})` },
  {
    table: schema.versionEntityRefs,
    where: `version_id IN (SELECT id FROM generated_versions WHERE project_id IN (${IDS}))`,
  },
  { table: schema.dialogueAttributions, where: `project_id IN (${IDS})` },
  { table: schema.chapters, where: `project_id IN (${IDS})` },
  { table: schema.scenes, where: `project_id IN (${IDS})` },
  { table: schema.entityRevisions, where: `project_id IN (${IDS})` },
  { table: schema.revisionChats, where: `project_id IN (${IDS})` },
  {
    table: schema.revisionChatMessages,
    where: `chat_id IN (SELECT id FROM revision_chats WHERE project_id IN (${IDS}))`,
  },
];

/** Tables that are deliberately not part of a story: global settings and credentials. */
export const EXCLUDED_TABLES: SQLiteTable[] = [schema.appSettings];

export const tableName = (table: SQLiteTable) => getTableConfig(table).name;

/** Live table name -> its definition; the whitelist an uploaded file is checked against. */
export const TABLES_BY_NAME = new Map(BACKUP_TABLES.map((entry) => [tableName(entry.table), entry]));

/** Every table the schema defines, for the coverage test. */
export function schemaTables(): SQLiteTable[] {
  return Object.values(schema).filter((value) => is(value, SQLiteTable)) as SQLiteTable[];
}

/** A scope with `$ids` expanded to placeholders, and the values to bind to them. */
export function scope(where: string, ids: string[]): { sql: string; params: string[] } {
  const marks = ids.map(() => '?').join(',');
  const repeats = where.split(IDS).length - 1;
  return { sql: where.replaceAll(IDS, marks), params: Array.from({ length: repeats }, () => ids).flat() };
}
