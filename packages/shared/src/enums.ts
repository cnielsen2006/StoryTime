import { z } from 'zod';

/** How a generation run turns the story bible into prose. Chosen per run. */
export const GENERATION_MODES = ['draft', 'chapters', 'scenes'] as const;
export const GenerationMode = z.enum(GENERATION_MODES);
export type GenerationMode = z.infer<typeof GenerationMode>;

export const GENERATION_MODE_LABELS: Record<GenerationMode, string> = {
  draft: 'Whole draft',
  chapters: 'Outline, then chapters',
  scenes: 'Scene cards',
};

/** What a run is asked to do. */
export const RUN_KINDS = ['outline', 'generate', 'update', 'split'] as const;
export const RunKind = z.enum(RUN_KINDS);
export type RunKind = z.infer<typeof RunKind>;

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export const RunStatus = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatus>;

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled'];

/** Anything that can be written to, versioned, or linked from an idea. */
export const ENTITY_TYPES = [
  'project',
  'story_parameters',
  'character',
  'character_relationship',
  'location',
  'plot_line',
  'plot_point',
  'chapter',
  'scene',
] as const;
export const EntityType = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof EntityType>;

/** Entity types an inbox idea may be filed against. */
export const LINKABLE_ENTITY_TYPES = [
  'character',
  'location',
  'plot_line',
  'plot_point',
  'story_parameters',
  'chapter',
  'scene',
] as const;
export const LinkableEntityType = z.enum(LINKABLE_ENTITY_TYPES);
export type LinkableEntityType = z.infer<typeof LinkableEntityType>;

/** Entity types that carry a revision counter and change history. */
export const REVISABLE_ENTITY_TYPES = [
  'story_parameters',
  'character',
  'location',
  'plot_line',
  'plot_point',
  'chapter',
  'scene',
] as const;
export const RevisableEntityType = z.enum(REVISABLE_ENTITY_TYPES);
export type RevisableEntityType = z.infer<typeof RevisableEntityType>;

/** What a generated version is attached to. */
export const VERSION_TARGET_TYPES = ['draft', 'chapter', 'scene', 'outline'] as const;
export const VersionTargetType = z.enum(VERSION_TARGET_TYPES);
export type VersionTargetType = z.infer<typeof VersionTargetType>;

export const PLOT_POINT_STATUSES = ['idea', 'draft', 'confirmed'] as const;
export const PlotPointStatus = z.enum(PLOT_POINT_STATUSES);
export type PlotPointStatus = z.infer<typeof PlotPointStatus>;

export const PLOT_LINE_KINDS = ['main', 'subplot', 'backstory'] as const;
export const PlotLineKind = z.enum(PLOT_LINE_KINDS);
export type PlotLineKind = z.infer<typeof PlotLineKind>;

export const CHARACTER_ROLES = ['protagonist', 'antagonist', 'supporting', 'minor'] as const;
export const CharacterRole = z.enum(CHARACTER_ROLES);
export type CharacterRole = z.infer<typeof CharacterRole>;

export const IDEA_STATUSES = ['inbox', 'triaged', 'archived'] as const;
export const IdeaStatus = z.enum(IDEA_STATUSES);
export type IdeaStatus = z.infer<typeof IdeaStatus>;

/** How out of date a generated version is relative to the bible it came from. */
export const STALE_LEVELS = ['none', 'soft', 'hard'] as const;
export const StaleLevel = z.enum(STALE_LEVELS);
export type StaleLevel = z.infer<typeof StaleLevel>;

export const STALE_RANK: Record<StaleLevel, number> = { none: 0, soft: 1, hard: 2 };

export const PROVIDER_IDS = ['anthropic', 'openai', 'ollama', 'mock'] as const;
export const ProviderId = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof ProviderId>;

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const Effort = z.enum(EFFORT_LEVELS);
export type Effort = z.infer<typeof Effort>;

/** How much of the bible a prompt carries when it must be trimmed to fit. */
export const BIBLE_LEVELS = ['full', 'compact', 'minimal'] as const;
export const BibleLevel = z.enum(BIBLE_LEVELS);
export type BibleLevel = z.infer<typeof BibleLevel>;

export const STOP_REASONS = ['end_turn', 'max_tokens', 'refusal', 'other'] as const;
export const StopReason = z.enum(STOP_REASONS);
export type StopReason = z.infer<typeof StopReason>;
