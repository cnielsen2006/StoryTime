import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { nanoid } from 'nanoid';
import type { Character, CharacterDetail, Location, PlotLine, PlotPoint, StoryParameters } from '@storytime/shared';
import type { Db } from '../db/client.js';
import {
  characterExperiences,
  characterRelationships,
  characters,
  ideaLinks,
  locations,
  plotLines,
  plotPointCharacters,
  plotPointLocations,
  plotPoints,
  storyParameters,
} from '../db/schema.js';

export const newId = () => nanoid(12);

/** Any table with an id and a user-controlled sort order. */
export type ReorderableTable = typeof characters | typeof locations | typeof plotLines | typeof plotPoints;

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const badRequest = (message: string) => new HttpError(400, message);
export const conflict = (message: string) => new HttpError(409, message);

export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Next position at the end of an ordered list. */
export function nextSortOrder(db: Db, table: typeof characters | typeof locations | typeof plotLines, projectId: string) {
  const row = db
    .select({ max: sql<number | null>`max(${table.sortOrder})` })
    .from(table)
    .where(eq(table.projectId, projectId))
    .get();
  return (row?.max ?? -1) + 1;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}

// --- Story parameters -------------------------------------------------------

export function readStoryParameters(db: Db, projectId: string): StoryParameters {
  const row = db.select().from(storyParameters).where(eq(storyParameters.projectId, projectId)).get();
  if (!row) throw notFound('Story parameters');
  return {
    ...row,
    comparableTitles: parseJsonArray(row.comparableTitles),
  };
}

// --- Characters -------------------------------------------------------------

export function readExperiences(db: Db, characterId: string) {
  return db
    .select()
    .from(characterExperiences)
    .where(eq(characterExperiences.characterId, characterId))
    .orderBy(asc(characterExperiences.sortOrder))
    .all();
}

export function readCharacter(db: Db, id: string): CharacterDetail {
  const row = db.select().from(characters).where(eq(characters.id, id)).get();
  if (!row) throw notFound('Character');
  return { ...(row as Character), experiences: readExperiences(db, id) };
}

export function readCharacters(db: Db, projectId: string): CharacterDetail[] {
  const rows = db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId))
    .orderBy(asc(characters.sortOrder), asc(characters.id))
    .all();
  if (rows.length === 0) return [];
  const all = db
    .select()
    .from(characterExperiences)
    .where(
      inArray(
        characterExperiences.characterId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(characterExperiences.sortOrder))
    .all();
  const byCharacter = new Map<string, typeof all>();
  for (const exp of all) {
    const list = byCharacter.get(exp.characterId) ?? [];
    list.push(exp);
    byCharacter.set(exp.characterId, list);
  }
  return rows.map((r) => ({ ...(r as Character), experiences: byCharacter.get(r.id) ?? [] }));
}

/** Replace a character's ordered experiences wholesale. */
export function writeExperiences(
  db: Db,
  characterId: string,
  items: Array<{ id?: string; whenLabel?: string | null; title: string; description?: string | null; impact?: string | null }>,
) {
  db.delete(characterExperiences).where(eq(characterExperiences.characterId, characterId)).run();
  items.forEach((item, index) => {
    db.insert(characterExperiences)
      .values({
        id: item.id ?? newId(),
        characterId,
        sortOrder: index,
        whenLabel: item.whenLabel ?? null,
        title: item.title,
        description: item.description ?? null,
        impact: item.impact ?? null,
      })
      .run();
  });
}

export function readRelationships(db: Db, projectId: string) {
  return db.select().from(characterRelationships).where(eq(characterRelationships.projectId, projectId)).all();
}

// --- Locations --------------------------------------------------------------

export function readLocation(db: Db, id: string): Location {
  const row = db.select().from(locations).where(eq(locations.id, id)).get();
  if (!row) throw notFound('Location');
  return row as Location;
}

export function readLocations(db: Db, projectId: string): Location[] {
  return db
    .select()
    .from(locations)
    .where(eq(locations.projectId, projectId))
    .orderBy(asc(locations.sortOrder), asc(locations.id))
    .all() as Location[];
}

// --- Plot -------------------------------------------------------------------

export function readPlotPointLinks(db: Db, plotPointIds: string[]) {
  const chars = plotPointIds.length
    ? db.select().from(plotPointCharacters).where(inArray(plotPointCharacters.plotPointId, plotPointIds)).all()
    : [];
  const locs = plotPointIds.length
    ? db.select().from(plotPointLocations).where(inArray(plotPointLocations.plotPointId, plotPointIds)).all()
    : [];
  const characterMap = new Map<string, string[]>();
  for (const row of chars) {
    characterMap.set(row.plotPointId, [...(characterMap.get(row.plotPointId) ?? []), row.characterId]);
  }
  const locationMap = new Map<string, string[]>();
  for (const row of locs) {
    locationMap.set(row.plotPointId, [...(locationMap.get(row.plotPointId) ?? []), row.locationId]);
  }
  return { characterMap, locationMap };
}

export function readPlotPoint(db: Db, id: string): PlotPoint {
  const row = db.select().from(plotPoints).where(eq(plotPoints.id, id)).get();
  if (!row) throw notFound('Plot point');
  const { characterMap, locationMap } = readPlotPointLinks(db, [id]);
  return {
    ...(row as Omit<PlotPoint, 'characterIds' | 'locationIds'>),
    characterIds: characterMap.get(id) ?? [],
    locationIds: locationMap.get(id) ?? [],
  };
}

export function readPlotPointsForProject(db: Db, projectId: string): PlotPoint[] {
  const rows = db
    .select()
    .from(plotPoints)
    .where(eq(plotPoints.projectId, projectId))
    .orderBy(asc(plotPoints.sortOrder), asc(plotPoints.id))
    .all();
  const { characterMap, locationMap } = readPlotPointLinks(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    ...(r as Omit<PlotPoint, 'characterIds' | 'locationIds'>),
    characterIds: characterMap.get(r.id) ?? [],
    locationIds: locationMap.get(r.id) ?? [],
  }));
}

export function readPlotLines(db: Db, projectId: string): PlotLine[] {
  return db
    .select()
    .from(plotLines)
    .where(eq(plotLines.projectId, projectId))
    .orderBy(asc(plotLines.sortOrder), asc(plotLines.id))
    .all() as PlotLine[];
}

export function readPlotLine(db: Db, id: string): PlotLine {
  const row = db.select().from(plotLines).where(eq(plotLines.id, id)).get();
  if (!row) throw notFound('Plot line');
  return row as PlotLine;
}

/**
 * Replace a plot point's character/location links, dropping any id that does not
 * belong to the same project.
 */
export function writePlotPointLinks(
  db: Db,
  projectId: string,
  plotPointId: string,
  characterIds: string[] | undefined,
  locationIds: string[] | undefined,
) {
  if (characterIds) {
    db.delete(plotPointCharacters).where(eq(plotPointCharacters.plotPointId, plotPointId)).run();
    const valid = characterIds.length
      ? db
          .select({ id: characters.id })
          .from(characters)
          .where(and(eq(characters.projectId, projectId), inArray(characters.id, characterIds)))
          .all()
          .map((r) => r.id)
      : [];
    for (const characterId of valid) {
      db.insert(plotPointCharacters).values({ plotPointId, characterId }).run();
    }
  }
  if (locationIds) {
    db.delete(plotPointLocations).where(eq(plotPointLocations.plotPointId, plotPointId)).run();
    const valid = locationIds.length
      ? db
          .select({ id: locations.id })
          .from(locations)
          .where(and(eq(locations.projectId, projectId), inArray(locations.id, locationIds)))
          .all()
          .map((r) => r.id)
      : [];
    for (const locationId of valid) {
      db.insert(plotPointLocations).values({ plotPointId, locationId }).run();
    }
  }
}

// --- Idea links -------------------------------------------------------------

/** idea_links has no FK on entityId, so deletions must sweep it by hand. */
export function deleteLinksFor(db: Db, entityType: string, entityIds: string[]) {
  if (entityIds.length === 0) return;
  db.delete(ideaLinks)
    .where(and(eq(ideaLinks.entityType, entityType), inArray(ideaLinks.entityId, entityIds)))
    .run();
}

/**
 * Apply a user-supplied ordering to a list, ignoring ids that are not in the
 * target set and leaving anything omitted at the end in its existing order.
 */
export function applyReorder(
  db: Db,
  table: ReorderableTable,
  scopeColumn: SQLiteColumn,
  scopeValue: string,
  orderedIds: string[],
) {
  const existing = db
    .select({ id: table.id })
    .from(table)
    .where(eq(scopeColumn, scopeValue))
    .orderBy(asc(table.sortOrder), asc(table.id))
    .all()
    .map((r) => r.id as string);
  const known = new Set(existing);
  const ordered = orderedIds.filter((id) => known.has(id));
  const rest = existing.filter((id) => !ordered.includes(id));
  [...ordered, ...rest].forEach((id, index) => {
    db.update(table).set({ sortOrder: index }).where(eq(table.id, id)).run();
  });
}
