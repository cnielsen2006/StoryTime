import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb, type Db } from './client.js';
import { runMigrations } from './migrate.js';
import {
  characterExperiences,
  characterRelationships,
  characters,
  ideaLinks,
  ideas,
  locations,
  plotLines,
  plotPointCharacters,
  plotPointLocations,
  plotPoints,
  projects,
  storyParameters,
} from './schema.js';
import { newId, readCharacter, readLocation, readPlotLine, readPlotPoint, readStoryParameters } from '../services/entities.js';
import { recordRevision } from '../services/revisions.js';

const SEED_TITLE = 'The Lantern Keeper';

export interface SeedResult {
  projectId: string;
  created: boolean;
}

/**
 * A small but complete project so the app is usable the moment it starts.
 * Uses the mock provider so it runs with no API key and no network.
 */
export function seed(db: Db, { force = false }: { force?: boolean } = {}): SeedResult {
  const existing = db.select().from(projects).where(eq(projects.title, SEED_TITLE)).get();
  if (existing && !force) {
    return { projectId: existing.id, created: false };
  }
  if (existing && force) {
    db.delete(projects).where(eq(projects.id, existing.id)).run();
  }

  const projectId = newId();

  db.transaction((tx) => {
    tx.insert(projects)
      .values({
        id: projectId,
        title: SEED_TITLE,
        description: 'A lighthouse keeper on a drowning coast discovers the lamp is keeping something out, not guiding ships in.',
        provider: 'mock',
        model: 'mock-fast',
        effort: 'high',
      })
      .run();

    tx.insert(storyParameters)
      .values({
        id: newId(),
        projectId,
        audience: 'Young adult, 14 and up',
        targetLengthWords: 60_000,
        genre: 'Coastal fantasy with a slow-burn mystery',
        tone: 'Wistful and salt-worn, with sharp moments of dread',
        pov: 'First person, Isolde',
        tense: 'Past tense',
        styleNotes:
          'Short paragraphs. Concrete sensory detail over abstraction. Let silences do work. Avoid ornate metaphor stacking.',
        contentGuidelines:
          'Peril and grief are fine. No graphic violence, no romance beyond a held hand, no on-page death of children.',
        comparableTitles: JSON.stringify(['The Scorpio Races', 'A Monster Calls', 'The Girl Who Drank the Moon']),
      })
      .run();

    // --- Characters ---------------------------------------------------------

    const isolde = newId();
    const wren = newId();
    const keeperMarrow = newId();

    tx.insert(characters)
      .values([
        {
          id: isolde,
          projectId,
          name: 'Isolde Vance',
          role: 'protagonist',
          description: 'Seventeen, apprenticed to the lighthouse since her mother vanished. Practical to a fault.',
          appearance: 'Wind-chapped hands, a too-large oilskin coat, hair cropped short so it stays out of the lamp works.',
          personality: 'Watchful. Answers questions with questions. Trusts machinery more than people, and says so.',
          backstory:
            'Raised in the keeper cottage. Her mother walked into the water during a fogbank eight years ago and did not come back. Isolde has kept the lamp lit every night since, alone for the last two.',
          arcNotes: 'From keeping the light out of duty, to understanding what it holds back, to choosing to let it go dark.',
          sortOrder: 0,
        },
        {
          id: wren,
          projectId,
          name: 'Wren Halloway',
          role: 'supporting',
          description: 'A mainland surveyor sent to condemn the lighthouse. Arrives with clipboards and leaves with questions.',
          appearance: 'City boots ruined within a day. Freckles. Always cold, never says so.',
          personality: 'Cheerfully nosy. Fills silences Isolde would rather keep. Braver than they look.',
          backstory: 'Took the posting to escape a family firm. Expected three weeks of measurements and a quiet report.',
          arcNotes: 'From outsider with a form to fill in, to the only person who believes Isolde.',
          sortOrder: 1,
        },
        {
          id: keeperMarrow,
          projectId,
          name: 'Keeper Marrow',
          role: 'antagonist',
          description: 'The previous keeper, presumed drowned. Still walks the tide line on nights the lamp falters.',
          appearance: 'Salt-crusted coat, always wet, never dripping.',
          personality: 'Patient in the way weather is patient. Speaks in tides and old rules.',
          backstory: 'Kept the light for forty years and made a bargain to keep keeping it. The bargain outlived the man.',
          arcNotes: 'Revealed less as a villain than as a warning about what keeping the light costs.',
          sortOrder: 2,
        },
      ])
      .run();

    tx.insert(characterExperiences)
      .values([
        {
          id: newId(),
          characterId: isolde,
          sortOrder: 0,
          whenLabel: 'Age nine',
          title: 'The fogbank',
          description: 'Her mother walked down to the water during a fog so thick the lamp could not cut it, and did not return.',
          impact: 'A conviction that the light must never fail, and a refusal to go near the water at night.',
        },
        {
          id: newId(),
          characterId: isolde,
          sortOrder: 1,
          whenLabel: 'Age fourteen',
          title: 'First solo winter',
          description: 'Kept the lamp alone through a season of storms after the relief keeper never arrived.',
          impact: 'Proof she can do it alone, which becomes the thing she hides behind.',
        },
        {
          id: newId(),
          characterId: isolde,
          sortOrder: 2,
          whenLabel: 'Two years ago',
          title: 'The ledger in the lamp room',
          description: 'Found Marrow’s logbook bricked into the wall, every entry after a certain date written in a different hand.',
          impact: 'The first crack in her belief that the lighthouse is only a lighthouse.',
        },
        {
          id: newId(),
          characterId: wren,
          sortOrder: 0,
          whenLabel: 'Six months ago',
          title: 'The resignation that was refused',
          description: 'Tried to leave the family surveying firm and was handed the lighthouse posting instead.',
          impact: 'Arrives determined to do the job badly enough to be dismissed.',
        },
        {
          id: newId(),
          characterId: wren,
          sortOrder: 1,
          whenLabel: 'First night on the island',
          title: 'Something on the tide line',
          description: 'Saw a figure standing in the surf that was gone when the beam came round.',
          impact: 'Stops trying to be dismissed.',
        },
        {
          id: newId(),
          characterId: keeperMarrow,
          sortOrder: 0,
          whenLabel: 'Forty years ago',
          title: 'The bargain',
          description: 'Agreed to keep the lamp burning without fail, in exchange for the sea sparing the village.',
          impact: 'Bound to the light past death.',
        },
      ])
      .run();

    tx.insert(characterRelationships)
      .values([
        {
          id: newId(),
          projectId,
          fromCharacterId: isolde,
          toCharacterId: wren,
          kind: 'reluctant ally',
          description: 'Isolde resents the interruption, then finds she talks to Wren more than she has talked to anyone in years.',
        },
        {
          id: newId(),
          projectId,
          fromCharacterId: keeperMarrow,
          toCharacterId: isolde,
          kind: 'predecessor and warning',
          description: 'Marrow wants Isolde to take the bargain on. He frames it as inheritance, not trap.',
        },
      ])
      .run();

    // --- Locations ----------------------------------------------------------

    const lighthouse = newId();
    const village = newId();
    const tideline = newId();

    tx.insert(locations)
      .values([
        {
          id: lighthouse,
          projectId,
          name: 'Cormorant Light',
          description: 'A granite tower on a tidal island, reachable on foot for four hours either side of low water.',
          sensoryDetails:
            'Oil and brass polish. The lamp gear ticking like a slow clock. Wind finding the one window that never seals.',
          rulesLore:
            'The lamp must be lit before full dark. A night unlit has never been tested twice. The keeper’s logbook must be signed nightly, and the signature must be the keeper’s own.',
          sortOrder: 0,
        },
        {
          id: village,
          projectId,
          name: 'Saltmere',
          description: 'A shrinking fishing village on the mainland shore, half its houses boarded and waiting.',
          sensoryDetails: 'Nets drying, tar, woodsmoke. Gulls that have learned the sound of a door opening.',
          rulesLore: 'Nobody from Saltmere goes out to the island after dark. Nobody says why out loud.',
          sortOrder: 1,
        },
        {
          id: tideline,
          projectId,
          name: 'The causeway',
          description: 'The gravel spit joining island to shore, swallowed twice a day.',
          sensoryDetails: 'Wet shingle that shifts underfoot. The smell of things uncovered. Water arriving from both sides at once.',
          rulesLore: 'What walks the causeway at the turn of the tide is not always walking toward the shore.',
          sortOrder: 2,
        },
      ])
      .run();

    // --- Plot ---------------------------------------------------------------

    const mainLine = newId();
    const subLine = newId();

    tx.insert(plotLines)
      .values([
        {
          id: mainLine,
          projectId,
          name: 'What the light keeps out',
          description: 'Isolde discovers the lighthouse is a seal, not a signal, and must decide whether to keep the bargain.',
          kind: 'main',
          sortOrder: 0,
        },
        {
          id: subLine,
          projectId,
          name: 'The survey',
          description: 'Wren is sent to condemn the tower, and their report becomes the deadline the story runs against.',
          kind: 'subplot',
          sortOrder: 1,
        },
      ])
      .run();

    const points: Array<{
      id: string;
      lineId: string;
      title: string;
      summary: string;
      status: 'idea' | 'draft' | 'confirmed';
      order: number;
      characters: string[];
      locations: string[];
    }> = [
      {
        id: newId(),
        lineId: mainLine,
        title: 'The lamp fails for ninety seconds',
        summary: 'A gear slips during a storm. In the dark, something on the causeway gets closer than it has before.',
        status: 'confirmed',
        order: 0,
        characters: [isolde],
        locations: [lighthouse, tideline],
      },
      {
        id: newId(),
        lineId: mainLine,
        title: 'Marrow speaks from the tide line',
        summary: 'The drowned keeper addresses Isolde by name and tells her the logbook must keep being signed.',
        status: 'confirmed',
        order: 1,
        characters: [isolde, keeperMarrow],
        locations: [tideline],
      },
      {
        id: newId(),
        lineId: mainLine,
        title: 'The second handwriting',
        summary: 'Isolde matches the later logbook entries to her mother’s hand, dated after she vanished.',
        status: 'confirmed',
        order: 2,
        characters: [isolde, wren],
        locations: [lighthouse],
      },
      {
        id: newId(),
        lineId: mainLine,
        title: 'The bargain explained',
        summary: 'Marrow lays out the terms: the light stands between Saltmere and what the sea kept. A keeper must always sign.',
        status: 'draft',
        order: 3,
        characters: [isolde, keeperMarrow],
        locations: [tideline, village],
      },
      {
        id: newId(),
        lineId: mainLine,
        title: 'Isolde lets the lamp go dark',
        summary: 'The climax. She refuses the inheritance and finds out what the light was actually for.',
        status: 'idea',
        order: 4,
        characters: [isolde, wren, keeperMarrow],
        locations: [lighthouse],
      },
      {
        id: newId(),
        lineId: subLine,
        title: 'Wren arrives with a condemnation order',
        summary: 'The survey gives the tower six weeks. Isolde reads it as an eviction and Wren as a formality.',
        status: 'confirmed',
        order: 0,
        characters: [isolde, wren],
        locations: [lighthouse, village],
      },
      {
        id: newId(),
        lineId: subLine,
        title: 'Wren stops filing honest reports',
        summary: 'After the causeway, Wren starts writing what the firm wants to hear to buy the lighthouse time.',
        status: 'draft',
        order: 1,
        characters: [wren],
        locations: [village],
      },
      {
        id: newId(),
        lineId: subLine,
        title: 'Saltmere votes on the tower',
        summary: 'A village meeting where nobody will say out loud why the light matters.',
        status: 'idea',
        order: 2,
        characters: [wren, isolde],
        locations: [village],
      },
    ];

    for (const point of points) {
      tx.insert(plotPoints)
        .values({
          id: point.id,
          plotLineId: point.lineId,
          projectId,
          title: point.title,
          summary: point.summary,
          status: point.status,
          sortOrder: point.order,
        })
        .run();
      for (const characterId of point.characters) {
        tx.insert(plotPointCharacters).values({ plotPointId: point.id, characterId }).run();
      }
      for (const locationId of point.locations) {
        tx.insert(plotPointLocations).values({ plotPointId: point.id, locationId }).run();
      }
    }

    // --- Inbox --------------------------------------------------------------

    const ideaRows = [
      {
        id: newId(),
        text: 'The lamp gear ticks at exactly the rhythm of a heartbeat at rest. Isolde notices when hers speeds up and the lamp does not.',
        status: 'triaged' as const,
        link: { entityType: 'location' as const, entityId: lighthouse, note: 'Sensory detail for the lamp room.' },
      },
      {
        id: newId(),
        text: 'Wren keeps a tally of days on the inside of the clipboard. The number stops mattering around day nine.',
        status: 'triaged' as const,
        link: { entityType: 'character' as const, entityId: wren, note: 'Small character beat for the arc.' },
      },
      {
        id: newId(),
        text: 'What if the thing the light keeps out is not hostile, just patient? It has been waiting for someone to stop signing.',
        status: 'inbox' as const,
        link: null,
      },
      {
        id: newId(),
        text: 'Chapter opening idea: describe a night by the order of the tasks, not by what happens. Oil, wick, glass, signature, wait.',
        status: 'inbox' as const,
        link: null,
      },
      {
        id: newId(),
        text: 'Does Isolde’s mother appear, or only her handwriting? Leaning toward only the handwriting. Decide before chapter twelve.',
        status: 'inbox' as const,
        link: null,
      },
    ];

    for (const idea of ideaRows) {
      tx.insert(ideas).values({ id: idea.id, projectId, text: idea.text, status: idea.status }).run();
      if (idea.link) {
        tx.insert(ideaLinks)
          .values({
            id: newId(),
            ideaId: idea.id,
            entityType: idea.link.entityType,
            entityId: idea.link.entityId,
            note: idea.link.note,
          })
          .run();
      }
    }
  });

  // Seeded rows are inserted directly for speed, so give each one the "created"
  // history entry that the CRUD routes would have written.
  recordCreationRevisions(db, projectId);

  return { projectId, created: true };
}

/** Backfill revision 1 for every revisable entity in a freshly seeded project. */
function recordCreationRevisions(db: Db, projectId: string) {
  const strip = <T extends Record<string, unknown>>(row: T) => {
    const { createdAt: _c, updatedAt: _u, ...rest } = row;
    return rest as Record<string, unknown>;
  };

  db.transaction((tx) => {
    const txDb = tx as unknown as Db;

    const params = readStoryParameters(txDb, projectId);
    recordRevision({
      db: txDb,
      projectId,
      entityType: 'story_parameters',
      entityId: params.id,
      revision: 1,
      before: null,
      after: strip(params),
    });

    for (const row of txDb.select().from(characters).where(eq(characters.projectId, projectId)).all()) {
      const character = readCharacter(txDb, row.id);
      recordRevision({
        db: txDb,
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

    for (const row of txDb.select().from(locations).where(eq(locations.projectId, projectId)).all()) {
      recordRevision({
        db: txDb,
        projectId,
        entityType: 'location',
        entityId: row.id,
        revision: 1,
        before: null,
        after: strip(readLocation(txDb, row.id)),
      });
    }

    for (const row of txDb.select().from(plotLines).where(eq(plotLines.projectId, projectId)).all()) {
      recordRevision({
        db: txDb,
        projectId,
        entityType: 'plot_line',
        entityId: row.id,
        revision: 1,
        before: null,
        after: strip(readPlotLine(txDb, row.id)),
      });
    }

    for (const row of txDb.select().from(plotPoints).where(eq(plotPoints.projectId, projectId)).all()) {
      recordRevision({
        db: txDb,
        projectId,
        entityType: 'plot_point',
        entityId: row.id,
        revision: 1,
        before: null,
        after: strip(readPlotPoint(txDb, row.id)),
      });
    }
  });
}

async function main() {
  const { db } = getDb();
  runMigrations(db);
  const force = process.argv.includes('--force');
  const result = seed(db, { force });
  if (result.created) {
    console.log(`Seeded "${SEED_TITLE}" into ${config.dbPath}`);
    console.log(`Project id: ${result.projectId}`);
  } else {
    console.log(`"${SEED_TITLE}" already exists (${result.projectId}). Pass --force to replace it.`);
  }
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('db/seed.ts');
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
