import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { RevisableEntityType } from '@storytime/shared';
import type { Db } from '../db/client.js';
import { entityRevisions } from '../db/schema.js';
import { markStale } from './staleness.js';

export type Snapshot = Record<string, unknown>;

/** Fields that change on every write and would otherwise pollute every diff. */
const NOISE_FIELDS = new Set(['updatedAt', 'createdAt', 'revision', 'sortOrder']);

/**
 * Compare two snapshots and name the fields that actually differ. Used for the
 * one-line summary on each history entry ("changed: backstory, appearance").
 */
export function diffFields(before: Snapshot | null, after: Snapshot | null): string[] {
  if (!before) return ['created'];
  if (!after) return ['deleted'];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (NOISE_FIELDS.has(key)) continue;
    const a = JSON.stringify(before[key] ?? null);
    const b = JSON.stringify(after[key] ?? null);
    if (a !== b) changed.push(key);
  }
  return changed;
}

export function summariseChange(changed: string[], deleted: boolean): string {
  if (deleted) return 'deleted';
  if (changed.length === 1 && changed[0] === 'created') return 'created';
  if (changed.length === 0) return 'no field changes';
  return `changed: ${changed.join(', ')}`;
}

export interface RecordRevisionInput {
  db: Db;
  projectId: string;
  entityType: RevisableEntityType;
  entityId: string;
  revision: number;
  before: Snapshot | null;
  after: Snapshot | null;
  deleted?: boolean;
}

/**
 * Append one entry to an entity's change history. Call inside the same
 * transaction as the write it describes.
 */
export function recordRevision(input: RecordRevisionInput): string[] {
  const { db, projectId, entityType, entityId, revision, before, after, deleted = false } = input;
  const changed = diffFields(before, deleted ? null : after);
  db.insert(entityRevisions)
    .values({
      id: nanoid(12),
      projectId,
      entityType,
      entityId,
      revision,
      snapshot: JSON.stringify(deleted ? { ...(before ?? {}), deleted: true } : (after ?? {})),
      summary: summariseChange(changed, deleted),
      deleted: deleted ? 1 : 0,
    })
    .run();
  return changed;
}

export interface WriteRevisionInput<T extends Snapshot> {
  db: Db;
  projectId: string;
  entityType: RevisableEntityType;
  entityId: string;
  label: string;
  before: T | null;
  after: T | null;
  /** The revision number now stored on the row. */
  revision: number;
  deleted?: boolean;
  /** Skip staleness marking (used when creating brand new entities). */
  skipStale?: boolean;
}

/**
 * Record a change and propagate staleness to every generated version that was
 * built from an older revision of this entity.
 *
 * Callers apply their own write first (so they control the SQL), then call this
 * with the before/after snapshots. Everything belongs in one transaction.
 */
export function commitChange<T extends Snapshot>(input: WriteRevisionInput<T>): string[] {
  const changed = recordRevision({
    db: input.db,
    projectId: input.projectId,
    entityType: input.entityType,
    entityId: input.entityId,
    revision: input.revision,
    before: input.before,
    after: input.after,
    deleted: input.deleted,
  });

  const isCreate = input.before === null;
  if (!input.skipStale && !isCreate && changed.length > 0) {
    markStale({
      db: input.db,
      projectId: input.projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      label: input.label,
      changedFields: changed,
    });
  }
  return changed;
}

export function listRevisions(db: Db, entityType: RevisableEntityType, entityId: string) {
  return db
    .select()
    .from(entityRevisions)
    .where(and(eq(entityRevisions.entityType, entityType), eq(entityRevisions.entityId, entityId)))
    .orderBy(desc(entityRevisions.revision))
    .all();
}

export function getRevision(db: Db, id: string) {
  return db.select().from(entityRevisions).where(eq(entityRevisions.id, id)).get();
}

export function getPreviousRevision(db: Db, entityType: string, entityId: string, revision: number) {
  const rows = db
    .select()
    .from(entityRevisions)
    .where(and(eq(entityRevisions.entityType, entityType), eq(entityRevisions.entityId, entityId)))
    .orderBy(desc(entityRevisions.revision))
    .all();
  return rows.find((r) => r.revision < revision) ?? null;
}
