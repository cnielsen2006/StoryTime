import { eq } from 'drizzle-orm';
import type { Chapter, Effort, GenerationMode, ProviderId, RunCreate, Scene } from '@storytime/shared';
import type { Db } from '../db/client.js';
import { projects } from '../db/schema.js';
import { defaultBudgetTokens, fitToBudget } from '../bible/budget.js';
import type { BibleGraph, Focus } from '../bible/serialize.js';
import { buildSystemPrompt } from '../bible/prompts.js';
import { getProvider, type ResolvedProvider } from '../llm/registry.js';
import {
  readCharacters,
  readLocations,
  readPlotLines,
  readPlotPointsForProject,
  readRelationships,
  readStoryParameters,
  notFound,
} from '../services/entities.js';
import { readChapters, readScenes } from '../services/manuscript.js';

/** Load everything the serializer and prompts need, once per run. */
export function loadGraph(db: Db, projectId: string): BibleGraph {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw notFound('Project');

  const points = readPlotPointsForProject(db, projectId);
  const byLine = new Map<string, typeof points>();
  for (const point of points) {
    byLine.set(point.plotLineId, [...(byLine.get(point.plotLineId) ?? []), point]);
  }

  return {
    project: project as BibleGraph['project'],
    storyParameters: readStoryParameters(db, projectId),
    characters: readCharacters(db, projectId),
    relationships: readRelationships(db, projectId),
    locations: readLocations(db, projectId),
    plotLines: readPlotLines(db, projectId).map((line) => ({ ...line, points: byLine.get(line.id) ?? [] })),
  };
}

export interface RunContext {
  projectId: string;
  mode: GenerationMode;
  graph: BibleGraph;
  resolved: ResolvedProvider;
  providerId: ProviderId;
  model: string;
  effort: Effort;
  budgetTokens: number;
  chapters: Chapter[];
  scenes: Scene[];
}

export function buildRunContext(db: Db, projectId: string, input: RunCreate): RunContext {
  const graph = loadGraph(db, projectId);
  const resolved = getProvider(db, projectId, { effort: input.effort });
  const budgetTokens = graph.project.tokenBudget ?? defaultBudgetTokens(null);

  return {
    projectId,
    mode: input.mode,
    graph,
    resolved,
    providerId: resolved.providerId,
    model: resolved.model,
    effort: resolved.effort,
    budgetTokens,
    chapters: readChapters(db, projectId),
    scenes: readScenes(db, projectId),
  };
}

/** Serialize the bible at the richest level that fits, and build the system prompt. */
export function prepareBible(ctx: RunContext, focus: Focus, reserveOutputTokens: number) {
  const fitted = fitToBudget(ctx.graph, {
    focus,
    budgetTokens: ctx.budgetTokens,
    reserveOutputTokens,
  });
  return {
    ...fitted,
    systemPrompt: buildSystemPrompt(fitted.markdown, ctx.graph.storyParameters),
  };
}

/** Titles for the plot points a chapter or scene is responsible for. */
export function plotPointTitles(graph: BibleGraph, ids: string[]): string[] {
  if (ids.length === 0) return [];
  const wanted = new Set(ids);
  const titles: string[] = [];
  for (const line of graph.plotLines) {
    for (const point of line.points) {
      if (wanted.has(point.id)) {
        titles.push(point.summary?.trim() ? `${point.title} — ${point.summary.trim()}` : point.title);
      }
    }
  }
  return titles;
}

/** Characters and locations a set of plot points touches, for focusing the bible. */
export function focusFromPlotPoints(graph: BibleGraph, plotPointIds: string[]): Focus {
  const wanted = new Set(plotPointIds);
  const characterIds = new Set<string>();
  const locationIds = new Set<string>();
  for (const line of graph.plotLines) {
    for (const point of line.points) {
      if (!wanted.has(point.id)) continue;
      for (const id of point.characterIds) characterIds.add(id);
      for (const id of point.locationIds) locationIds.add(id);
    }
  }
  return {
    plotPointIds: [...wanted],
    characterIds: [...characterIds],
    locationIds: [...locationIds],
  };
}

export function mergeFocus(...focuses: Focus[]): Focus {
  const characterIds = new Set<string>();
  const locationIds = new Set<string>();
  const plotPointIds = new Set<string>();
  for (const focus of focuses) {
    for (const id of focus.characterIds ?? []) characterIds.add(id);
    for (const id of focus.locationIds ?? []) locationIds.add(id);
    for (const id of focus.plotPointIds ?? []) plotPointIds.add(id);
  }
  return { characterIds: [...characterIds], locationIds: [...locationIds], plotPointIds: [...plotPointIds] };
}

/** Last N characters of text, snapped to a sentence boundary where possible. */
export function tailOf(text: string, maxChars: number): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(-maxChars);
  const boundary = slice.search(/[.!?]["']?\s/);
  return boundary > 0 && boundary < slice.length - 40 ? slice.slice(boundary + 1).trim() : slice.trim();
}
