import { z } from 'zod';
import { StaleLevel, StopReason, VersionTargetType } from './enums.js';
import { Chapter, Scene } from './schemas/manuscript.js';
import { Character, CharacterDetail, Relationship } from './schemas/character.js';
import { Location } from './schemas/location.js';
import { OutlineResult } from './schemas/llm.js';
import { PlotLineWithPoints } from './schemas/plot.js';
import { Project, StoryParameters } from './schemas/project.js';

/** Everything the UI needs to render a project at a glance. */
export const ProjectGraph = z.object({
  project: Project,
  storyParameters: StoryParameters,
  characters: z.array(CharacterDetail),
  relationships: z.array(Relationship),
  locations: z.array(Location),
  plotLines: z.array(PlotLineWithPoints),
  chapters: z.array(Chapter),
  scenes: z.array(Scene),
  counts: z.object({
    characters: z.number().int(),
    locations: z.number().int(),
    plotLines: z.number().int(),
    plotPoints: z.number().int(),
    ideasInbox: z.number().int(),
    chapters: z.number().int(),
    scenes: z.number().int(),
    staleTargets: z.number().int(),
    words: z.number().int(),
  }),
});
export type ProjectGraph = z.infer<typeof ProjectGraph>;

/**
 * Events pushed over SSE while a run executes. Every event carries a
 * monotonic `seq` so a reconnecting client can replay from Last-Event-ID.
 */
export type RunEvent =
  | { seq: number; type: 'status'; message: string }
  | { seq: number; type: 'target_started'; targetType: VersionTargetType; targetId: string; label: string }
  | { seq: number; type: 'text'; targetId: string; delta: string }
  | { seq: number; type: 'target_done'; targetType: VersionTargetType; targetId: string; versionId: string; wordCount: number }
  | { seq: number; type: 'outline'; outline: OutlineResult }
  | { seq: number; type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens: number }
  | { seq: number; type: 'done'; status: 'succeeded' | 'cancelled'; stopReason: StopReason | null }
  | { seq: number; type: 'error'; message: string; retryable: boolean };

export type RunEventType = RunEvent['type'];

export interface StaleSummaryItem {
  targetType: VersionTargetType;
  targetId: string;
  label: string;
  staleLevel: StaleLevel;
  reasons: string[];
}

