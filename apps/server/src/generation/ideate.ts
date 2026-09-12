import {
  SeedProjectResult,
  STORY_CATEGORIES,
  type SeedAudience,
  type SeedProjectRequest,
  type SeedProjectResponse,
  type SeedSize,
} from '@storytime/shared';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  characterExperiences,
  characterRelationships,
  characters,
  ideas,
  locations,
  plotLines,
  plotPointCharacters,
  plotPointLocations,
  plotPoints,
  projects,
  storyParameters,
} from '../db/schema.js';
import { DEFAULT_MODELS } from '../config.js';
import { createProvider, readSettings } from '../llm/registry.js';
import { ProviderError } from '../llm/types.js';
import { badRequest, newId, readCharacter, readLocation, readPlotLine, readPlotPoint, readStoryParameters } from '../services/entities.js';
import { recordRevision } from '../services/revisions.js';

/** Tables that carry a projectId and can be counted per project. */
type CountableTable = typeof characters | typeof locations | typeof plotLines | typeof plotPoints | typeof ideas;

const SIZE_GUIDANCE: Record<SeedSize, string> = {
  small: '2 characters, 2 locations, and 1 plot line with 4 to 6 points.',
  medium: '3 to 4 characters, 3 locations, and 2 plot lines: one main thread and one subplot, 5 to 8 points each.',
  large: '5 to 6 characters, 4 to 5 locations, and 3 plot lines: one main thread and two subplots, 6 to 9 points each.',
};

const AUDIENCE_GUIDANCE: Record<SeedAudience, string> = {
  any: 'Choose an audience that suits the premise, and set the content guidelines to match it.',
  children: 'Write for children aged 8 to 12. Peril is fine; no graphic violence, no romance beyond a crush, no on-page death of children.',
  'young-adult': 'Write for young adults, 14 and up. Grief, fear, and moral compromise are fine; keep violence non-graphic and romance restrained.',
  adult: 'Write for adults. You may treat difficult material seriously, but do not write anything gratuitous.',
};

/**
 * The system prompt for inventing a project.
 *
 * It is deliberately opinionated about *quality* rather than content: the point
 * is a bible with enough specific, contradictory human material in it that the
 * chapters written later have something to work with.
 */
function buildSystemPrompt(): string {
  return [
    'You invent original starting material for novels: a premise, a cast, places, and a plot skeleton.',
    '',
    'What makes this good:',
    '- Specific beats generic. "A lighthouse keeper who has signed the same logbook every night for eight years" is a character. "A brave young hero" is not.',
    '- Every character wants something concrete, and at least one of them wants something incompatible with what another wants.',
    '- Give people flaws that cause problems, not charming quirks.',
    '- Formative experiences should explain present behaviour. The reader should be able to trace a line from an event to a habit.',
    '- Locations need one true sensory detail each, the kind you only get from having imagined standing there.',
    '- The plot skeleton should have a spine that escalates, and leave some later beats genuinely unsettled.',
    '',
    'What to avoid:',
    '- Chosen ones, ancient prophecies, and amnesiac protagonists, unless the premise the author gave you asks for one.',
    '- Names that are just sounds. Names should suit the setting.',
    '- Beats that only exist to get to the next beat.',
    '- Restating the premise back as a summary instead of building on it.',
    '',
    'Reference characters and locations by their exact names when listing who appears in a plot point, and use the same spelling everywhere.',
  ].join('\n');
}

function buildTaskPrompt(request: SeedProjectRequest): string {
  const category = STORY_CATEGORIES.find((c) => c.id === request.category);
  if (!category) throw badRequest(`Unknown category "${request.category}".`);

  const lines = [
    `Invent a new book. Genre: ${category.label}.`,
    category.hint,
    '',
    `Scope: ${SIZE_GUIDANCE[request.size ?? 'medium']}`,
    AUDIENCE_GUIDANCE[request.audience ?? 'any'],
  ];

  if (request.targetLengthWords) {
    lines.push(`Target manuscript length: about ${request.targetLengthWords.toLocaleString()} words.`);
  }

  if (request.premise?.trim()) {
    lines.push(
      '',
      'The author has given you a starting point. Build on it rather than replacing it, and keep whatever is specific about it:',
      '',
      request.premise.trim(),
    );
  } else {
    lines.push('', 'The author has given you no starting point, so the premise is yours to choose.');
  }

  lines.push(
    '',
    'Also list three or four open questions: things you deliberately left undecided that the author should settle. Make them real decisions, not rhetorical ones.',
  );

  return lines.join('\n');
}

export interface IdeateOptions {
  request: SeedProjectRequest;
  signal?: AbortSignal;
}

/**
 * Ask the model for a whole story bible, then write it in as a real project.
 *
 * Everything lands through the same tables the UI edits, with creation
 * revisions recorded, so a generated project is indistinguishable from one
 * typed by hand and can be edited and revised the same way.
 */
export async function ideateProject(db: Db, options: IdeateOptions): Promise<SeedProjectResponse> {
  const { request } = options;
  const warnings: string[] = [];

  // This runs before any project exists, so resolve against the global
  // settings and then apply whatever the request overrode.
  const settings = readSettings(db);
  const providerId = request.provider ?? settings.defaultProvider;
  const provider = createProvider(db, providerId);
  const model =
    request.model?.trim() ||
    (providerId === settings.defaultProvider ? settings.defaultModel : '') ||
    DEFAULT_MODELS[providerId];
  const effort = request.effort ?? settings.defaultEffort;

  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;

  const result = await provider.generateStructured(
    {
      model,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: buildTaskPrompt(request) }],
      schema: SeedProjectResult,
      schemaName: 'seed_project',
      effort,
      maxTokens: 32_000,
    },
    signal,
  );

  const bible = result.data;
  if (bible.characters.length === 0) {
    throw new ProviderError('The model returned a story with no characters. Try again.', true);
  }

  const projectId = newId();

  db.transaction((tx) => {
    const txDb = tx as unknown as Db;

    tx.insert(projects)
      .values({
        id: projectId,
        title: bible.title.trim() || 'Untitled',
        description: bible.premise.trim() || null,
        provider: providerId,
        model,
        effort: request.effort ?? null,
      })
      .run();

    const params = bible.storyParameters;
    tx.insert(storyParameters)
      .values({
        id: newId(),
        projectId,
        audience: params.audience?.trim() || null,
        targetLengthWords: request.targetLengthWords ?? (params.targetLengthWords > 0 ? params.targetLengthWords : null),
        genre: params.genre?.trim() || null,
        tone: params.tone?.trim() || null,
        pov: params.pov?.trim() || null,
        tense: params.tense?.trim() || null,
        styleNotes: params.styleNotes?.trim() || null,
        contentGuidelines: params.contentGuidelines?.trim() || null,
        comparableTitles: JSON.stringify((params.comparableTitles ?? []).filter((t) => t.trim())),
      })
      .run();

    // --- Characters ---------------------------------------------------------

    const characterIds = new Map<string, string>();
    bible.characters.forEach((character, index) => {
      const id = newId();
      const name = character.name.trim() || `Character ${index + 1}`;
      characterIds.set(name.toLowerCase(), id);

      tx.insert(characters)
        .values({
          id,
          projectId,
          name,
          role: character.role,
          description: character.description?.trim() || null,
          appearance: character.appearance?.trim() || null,
          personality: character.personality?.trim() || null,
          backstory: character.backstory?.trim() || null,
          arcNotes: character.arcNotes?.trim() || null,
          sortOrder: index,
        })
        .run();

      (character.experiences ?? []).forEach((experience, expIndex) => {
        if (!experience.title?.trim()) return;
        tx.insert(characterExperiences)
          .values({
            id: newId(),
            characterId: id,
            sortOrder: expIndex,
            whenLabel: experience.whenLabel?.trim() || null,
            title: experience.title.trim(),
            description: experience.description?.trim() || null,
            impact: experience.impact?.trim() || null,
          })
          .run();
      });
    });

    // --- Relationships ------------------------------------------------------

    let droppedRelationships = 0;
    for (const relationship of bible.relationships ?? []) {
      const from = characterIds.get(relationship.fromCharacter?.trim().toLowerCase() ?? '');
      const to = characterIds.get(relationship.toCharacter?.trim().toLowerCase() ?? '');
      if (!from || !to || from === to) {
        droppedRelationships += 1;
        continue;
      }
      tx.insert(characterRelationships)
        .values({
          id: newId(),
          projectId,
          fromCharacterId: from,
          toCharacterId: to,
          kind: relationship.kind?.trim() || 'connected',
          description: relationship.description?.trim() || null,
        })
        .run();
    }
    if (droppedRelationships > 0) {
      warnings.push(
        `${droppedRelationships} relationship(s) named a character that is not in the cast and were skipped.`,
      );
    }

    // --- Locations ----------------------------------------------------------

    const locationIds = new Map<string, string>();
    bible.locations.forEach((location, index) => {
      const id = newId();
      const name = location.name.trim() || `Location ${index + 1}`;
      locationIds.set(name.toLowerCase(), id);

      tx.insert(locations)
        .values({
          id,
          projectId,
          name,
          description: location.description?.trim() || null,
          sensoryDetails: location.sensoryDetails?.trim() || null,
          rulesLore: location.rulesLore?.trim() || null,
          sortOrder: index,
        })
        .run();
    });

    // --- Plot ---------------------------------------------------------------

    let droppedLinks = 0;
    bible.plotLines.forEach((line, lineIndex) => {
      const lineId = newId();
      tx.insert(plotLines)
        .values({
          id: lineId,
          projectId,
          name: line.name.trim() || `Thread ${lineIndex + 1}`,
          description: line.description?.trim() || null,
          kind: line.kind,
          sortOrder: lineIndex,
        })
        .run();

      (line.points ?? []).forEach((point, pointIndex) => {
        if (!point.title?.trim()) return;
        const pointId = newId();
        tx.insert(plotPoints)
          .values({
            id: pointId,
            plotLineId: lineId,
            projectId,
            title: point.title.trim(),
            summary: point.summary?.trim() || null,
            status: point.status,
            sortOrder: pointIndex,
          })
          .run();

        for (const rawName of point.characters ?? []) {
          const characterId = characterIds.get(rawName?.trim().toLowerCase() ?? '');
          if (!characterId) {
            droppedLinks += 1;
            continue;
          }
          tx.insert(plotPointCharacters).values({ plotPointId: pointId, characterId }).onConflictDoNothing().run();
        }
        for (const rawName of point.locations ?? []) {
          const locationId = locationIds.get(rawName?.trim().toLowerCase() ?? '');
          if (!locationId) {
            droppedLinks += 1;
            continue;
          }
          tx.insert(plotPointLocations).values({ plotPointId: pointId, locationId }).onConflictDoNothing().run();
        }
      });
    });
    if (droppedLinks > 0) {
      warnings.push(`${droppedLinks} plot point link(s) named something not in the cast or locations and were skipped.`);
    }

    // --- Open questions land in the inbox -----------------------------------

    for (const question of bible.openQuestions ?? []) {
      if (!question?.trim()) continue;
      tx.insert(ideas)
        .values({ id: newId(), projectId, text: question.trim(), status: 'inbox' })
        .run();
    }

    recordCreationRevisions(txDb, projectId);
  });

  const counts = readCounts(db, projectId);
  return {
    projectId,
    title: bible.title.trim() || 'Untitled',
    premise: bible.premise.trim(),
    counts,
    warnings,
  };
}

function readCounts(db: Db, projectId: string): SeedProjectResponse['counts'] {
  const count = (table: CountableTable) =>
    db
      .select({ n: sql<number>`count(*)` })
      .from(table)
      .where(eq(table.projectId, projectId))
      .get()?.n ?? 0;

  return {
    characters: count(characters),
    locations: count(locations),
    plotLines: count(plotLines),
    plotPoints: count(plotPoints),
    ideas: count(ideas),
  };
}

/**
 * Give every generated row the creation revision the CRUD routes would have
 * written, so history and staleness work from the first edit.
 */
function recordCreationRevisions(db: Db, projectId: string) {
  const strip = <T extends Record<string, unknown>>(row: T) => {
    const { createdAt: _c, updatedAt: _u, ...rest } = row;
    return rest as Record<string, unknown>;
  };

  const params = readStoryParameters(db, projectId);
  recordRevision({
    db,
    projectId,
    entityType: 'story_parameters',
    entityId: params.id,
    revision: 1,
    before: null,
    after: strip(params),
  });

  for (const row of db.select().from(characters).where(eq(characters.projectId, projectId)).all()) {
    const character = readCharacter(db, row.id);
    recordRevision({
      db,
      projectId,
      entityType: 'character',
      entityId: row.id,
      revision: 1,
      before: null,
      after: {
        ...strip(character),
        experiences: character.experiences.map(({ id: _i, characterId: _ci, ...exp }) => exp),
      },
    });
  }
  for (const row of db.select().from(locations).where(eq(locations.projectId, projectId)).all()) {
    recordRevision({
      db,
      projectId,
      entityType: 'location',
      entityId: row.id,
      revision: 1,
      before: null,
      after: strip(readLocation(db, row.id)),
    });
  }
  for (const row of db.select().from(plotLines).where(eq(plotLines.projectId, projectId)).all()) {
    recordRevision({
      db,
      projectId,
      entityType: 'plot_line',
      entityId: row.id,
      revision: 1,
      before: null,
      after: strip(readPlotLine(db, row.id)),
    });
  }
  for (const row of db.select().from(plotPoints).where(eq(plotPoints.projectId, projectId)).all()) {
    recordRevision({
      db,
      projectId,
      entityType: 'plot_point',
      entityId: row.id,
      revision: 1,
      before: null,
      after: strip(readPlotPoint(db, row.id)),
    });
  }
}
