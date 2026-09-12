import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = () => Date.now();

/** Columns every row carries. */
const stamps = {
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
};

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  provider: text('provider'),
  model: text('model'),
  effort: text('effort'),
  tokenBudget: integer('token_budget'),
  ...stamps,
});

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
});

export const storyParameters = sqliteTable('story_parameters', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  audience: text('audience'),
  targetLengthWords: integer('target_length_words'),
  genre: text('genre'),
  tone: text('tone'),
  pov: text('pov'),
  tense: text('tense'),
  styleNotes: text('style_notes'),
  contentGuidelines: text('content_guidelines'),
  comparableTitles: text('comparable_titles').notNull().default('[]'),
  revision: integer('revision').notNull().default(1),
  ...stamps,
});

export const characters = sqliteTable(
  'characters',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role').notNull().default('supporting'),
    description: text('description'),
    appearance: text('appearance'),
    personality: text('personality'),
    backstory: text('backstory'),
    arcNotes: text('arc_notes'),
    sortOrder: integer('sort_order').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    ...stamps,
  },
  (t) => [index('characters_project_idx').on(t.projectId, t.sortOrder)],
);

export const characterExperiences = sqliteTable(
  'character_experiences',
  {
    id: text('id').primaryKey(),
    characterId: text('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    whenLabel: text('when_label'),
    title: text('title').notNull(),
    description: text('description'),
    impact: text('impact'),
  },
  (t) => [index('character_experiences_character_idx').on(t.characterId, t.sortOrder)],
);

export const characterRelationships = sqliteTable(
  'character_relationships',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fromCharacterId: text('from_character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    toCharacterId: text('to_character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    description: text('description'),
    ...stamps,
  },
  (t) => [index('character_relationships_project_idx').on(t.projectId)],
);

export const locations = sqliteTable(
  'locations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    sensoryDetails: text('sensory_details'),
    rulesLore: text('rules_lore'),
    sortOrder: integer('sort_order').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    ...stamps,
  },
  (t) => [index('locations_project_idx').on(t.projectId, t.sortOrder)],
);

export const plotLines = sqliteTable(
  'plot_lines',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind').notNull().default('main'),
    sortOrder: integer('sort_order').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    ...stamps,
  },
  (t) => [index('plot_lines_project_idx').on(t.projectId, t.sortOrder)],
);

export const plotPoints = sqliteTable(
  'plot_points',
  {
    id: text('id').primaryKey(),
    plotLineId: text('plot_line_id')
      .notNull()
      .references(() => plotLines.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary'),
    status: text('status').notNull().default('idea'),
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    ...stamps,
  },
  (t) => [
    index('plot_points_line_idx').on(t.plotLineId, t.sortOrder),
    index('plot_points_project_idx').on(t.projectId),
  ],
);

export const plotPointCharacters = sqliteTable(
  'plot_point_characters',
  {
    plotPointId: text('plot_point_id')
      .notNull()
      .references(() => plotPoints.id, { onDelete: 'cascade' }),
    characterId: text('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.plotPointId, t.characterId] })],
);

export const plotPointLocations = sqliteTable(
  'plot_point_locations',
  {
    plotPointId: text('plot_point_id')
      .notNull()
      .references(() => plotPoints.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.plotPointId, t.locationId] })],
);

export const ideas = sqliteTable(
  'ideas',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    status: text('status').notNull().default('inbox'),
    ...stamps,
  },
  (t) => [index('ideas_project_status_idx').on(t.projectId, t.status, t.createdAt)],
);

/**
 * Polymorphic: an idea can be filed against any entity type. There is no FK on
 * entityId, so entity deletion must clean these up (see services/links.ts).
 */
export const ideaLinks = sqliteTable(
  'idea_links',
  {
    id: text('id').primaryKey(),
    ideaId: text('idea_id')
      .notNull()
      .references(() => ideas.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    note: text('note'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex('idea_links_unique').on(t.ideaId, t.entityType, t.entityId),
    index('idea_links_entity_idx').on(t.entityType, t.entityId),
  ],
);

export const generationRuns = sqliteTable(
  'generation_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    kind: text('kind').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    effort: text('effort').notNull(),
    instructions: text('instructions'),
    status: text('status').notNull().default('queued'),
    bibleMarkdown: text('bible_markdown'),
    bibleHash: text('bible_hash'),
    estimatedInputTokens: integer('estimated_input_tokens'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    error: text('error'),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('generation_runs_project_idx').on(t.projectId, t.createdAt)],
);

/**
 * Every draft the model ever produced for a target. Rows are never deleted by
 * regeneration; rolling back just repoints the owner's currentVersionId.
 */
export const generatedVersions = sqliteTable(
  'generated_versions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    runId: text('run_id'),
    versionNo: integer('version_no').notNull(),
    content: text('content').notNull(),
    wordCount: integer('word_count').notNull().default(0),
    instructions: text('instructions'),
    parentVersionId: text('parent_version_id'),
    bibleHash: text('bible_hash'),
    stopReason: text('stop_reason'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex('generated_versions_target_no').on(t.targetType, t.targetId, t.versionNo),
    index('generated_versions_target_idx').on(t.targetType, t.targetId, t.createdAt),
    index('generated_versions_project_idx').on(t.projectId),
  ],
);

/** What the prompt behind a version actually contained, and at which revision. */
export const versionEntityRefs = sqliteTable(
  'version_entity_refs',
  {
    versionId: text('version_id')
      .notNull()
      .references(() => generatedVersions.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    entityRevision: integer('entity_revision').notNull(),
    focus: integer('focus').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.entityType, t.entityId] }),
    index('version_entity_refs_entity_idx').on(t.entityType, t.entityId),
  ],
);

export const chapters = sqliteTable(
  'chapters',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    title: text('title').notNull(),
    summary: text('summary'),
    plotPointIds: text('plot_point_ids').notNull().default('[]'),
    currentVersionId: text('current_version_id'),
    staleLevel: text('stale_level').notNull().default('none'),
    staleReasons: text('stale_reasons').notNull().default('[]'),
    revision: integer('revision').notNull().default(1),
    ...stamps,
  },
  (t) => [index('chapters_project_idx').on(t.projectId, t.sortOrder)],
);

export const scenes = sqliteTable(
  'scenes',
  {
    id: text('id').primaryKey(),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    title: text('title').notNull(),
    summary: text('summary'),
    goal: text('goal'),
    povCharacterId: text('pov_character_id'),
    locationId: text('location_id'),
    plotPointIds: text('plot_point_ids').notNull().default('[]'),
    currentVersionId: text('current_version_id'),
    staleLevel: text('stale_level').notNull().default('none'),
    staleReasons: text('stale_reasons').notNull().default('[]'),
    revision: integer('revision').notNull().default(1),
    ...stamps,
  },
  (t) => [
    index('scenes_chapter_idx').on(t.chapterId, t.sortOrder),
    index('scenes_project_idx').on(t.projectId),
  ],
);

export const entityRevisions = sqliteTable(
  'entity_revisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    revision: integer('revision').notNull(),
    snapshot: text('snapshot').notNull(),
    summary: text('summary').notNull().default(''),
    deleted: integer('deleted').notNull().default(0),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex('entity_revisions_unique').on(t.entityType, t.entityId, t.revision),
    index('entity_revisions_entity_idx').on(t.entityType, t.entityId, t.createdAt),
  ],
);
