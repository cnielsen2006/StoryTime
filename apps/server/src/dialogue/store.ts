import { eq } from 'drizzle-orm';
import { DialogueQuote, type DialogueAttribution, type DialogueUpdate } from '@storytime/shared';
import type { Db } from '../db/client.js';
import { characters, dialogueAttributions } from '../db/schema.js';
import { badRequest } from '../services/entities.js';

function parseQuotes(raw: string): DialogueQuote[] {
  try {
    const parsed = DialogueQuote.array().safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function readAttribution(db: Db, versionId: string): DialogueAttribution | null {
  const row = db.select().from(dialogueAttributions).where(eq(dialogueAttributions.versionId, versionId)).get();
  if (!row) return null;
  return {
    versionId: row.versionId,
    narratorId: row.narratorId,
    quotes: parseQuotes(row.quotes),
    source: row.source === 'manual' ? 'manual' : 'model',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface SaveAttributionInput {
  db: Db;
  projectId: string;
  versionId: string;
  narratorId: string | null;
  quotes: DialogueQuote[];
  source: 'model' | 'manual';
}

/** Insert or replace the attribution for a version. */
export function saveAttribution(input: SaveAttributionInput): DialogueAttribution {
  const { db, projectId, versionId, narratorId, quotes, source } = input;
  const now = Date.now();
  db.insert(dialogueAttributions)
    .values({ versionId, projectId, narratorId, quotes: JSON.stringify(quotes), source, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: dialogueAttributions.versionId,
      set: { narratorId, quotes: JSON.stringify(quotes), source, updatedAt: now },
    })
    .run();
  return readAttribution(db, versionId)!;
}

/** Apply the author's corrections, keeping the quote positions the model's pass found. */
export function correctAttribution(db: Db, projectId: string, versionId: string, update: DialogueUpdate) {
  const existing = readAttribution(db, versionId);
  if (!existing) throw badRequest('This version has no dialogue to correct yet. Assign voices first.');
  if (update.speakers.length !== existing.quotes.length) {
    throw badRequest(
      `Expected a speaker for each of the ${existing.quotes.length} quotes but received ${update.speakers.length}.`,
    );
  }

  const known = new Set(
    db
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.projectId, projectId))
      .all()
      .map((c) => c.id),
  );
  const checked = (id: string | null) => {
    if (id === null) return null;
    if (!known.has(id)) throw badRequest('One of the speakers is not a character in this project.');
    return id;
  };

  return saveAttribution({
    db,
    projectId,
    versionId,
    narratorId: checked(update.narratorId),
    quotes: existing.quotes.map((quote, index) => ({ ...quote, speaker: checked(update.speakers[index] ?? null) })),
    source: 'manual',
  });
}
