import type {
  BibleLevel,
  CharacterDetail,
  Location,
  PlotLineWithPoints,
  PlotPoint,
  Project,
  Relationship,
  StoryParameters,
} from '@storytime/shared';

/** Everything the serializer needs. Loaded once per run, then read-only. */
export interface BibleGraph {
  project: Project;
  storyParameters: StoryParameters;
  characters: CharacterDetail[];
  relationships: Relationship[];
  locations: Location[];
  plotLines: PlotLineWithPoints[];
}

/** Which entities this particular piece of writing is *about*. */
export interface Focus {
  characterIds?: string[];
  locationIds?: string[];
  plotPointIds?: string[];
}

export interface EntityRef {
  entityType: string;
  entityId: string;
  entityRevision: number;
  focus: boolean;
}

export interface SerializedBible {
  markdown: string;
  refs: EntityRef[];
  chars: number;
}

/**
 * Short stable tags let structured outputs point back at real rows without
 * printing full ids inline everywhere.
 */
export const tag = (prefix: string, id: string) => `[${prefix}:${id}]`;

function section(title: string, body: string[]): string[] {
  return body.length > 0 ? ['', `## ${title}`, ...body] : [];
}

function field(label: string, value: string | null | undefined): string[] {
  const trimmed = value?.trim();
  return trimmed ? [`- **${label}:** ${trimmed}`] : [];
}

function paragraph(label: string, value: string | null | undefined): string[] {
  const trimmed = value?.trim();
  return trimmed ? [`**${label}.** ${trimmed}`] : [];
}

function parametersSection(params: StoryParameters, project: Project): string[] {
  const lines = [
    ...field('Working title', project.title),
    ...field('Intended audience', params.audience),
    ...field('Genre', params.genre),
    ...field('Tone', params.tone),
    ...field('Point of view', params.pov),
    ...field('Tense', params.tense),
    ...(params.targetLengthWords ? [`- **Target length:** ~${params.targetLengthWords.toLocaleString()} words`] : []),
    ...(params.comparableTitles.length ? [`- **Comparable titles:** ${params.comparableTitles.join('; ')}`] : []),
    ...field('Style notes', params.styleNotes),
    ...field('Content guidelines', params.contentGuidelines),
  ];
  return section('Story parameters', lines);
}

function characterBlock(character: CharacterDetail, level: BibleLevel, isFocus: boolean): string[] {
  const heading = `### ${character.name} ${tag('C', character.id)}`;
  const roleLine = `*${character.role}*`;

  // Background cast collapse to a line or two so the focus characters dominate.
  if (!isFocus && level !== 'full') {
    const oneLine = character.description?.trim() ?? '';
    if (level === 'minimal') return [heading, `${roleLine}${oneLine ? ` — ${oneLine}` : ''}`];
    return [
      heading,
      `${roleLine}${oneLine ? ` — ${oneLine}` : ''}`,
      ...paragraph('Personality', character.personality),
    ].filter(Boolean);
  }

  const lines = [
    heading,
    roleLine,
    ...paragraph('Description', character.description),
    ...paragraph('Appearance', character.appearance),
    ...paragraph('Personality', character.personality),
    ...paragraph('Backstory', character.backstory),
  ];

  if (character.experiences.length > 0) {
    lines.push('', '**Experiences (in order):**');
    for (const exp of character.experiences) {
      const when = exp.whenLabel?.trim() ? `${exp.whenLabel.trim()} — ` : '';
      const detail = exp.description?.trim() ? ` ${exp.description.trim()}` : '';
      const impact = exp.impact?.trim() ? ` *(Left them: ${exp.impact.trim()})*` : '';
      lines.push(`- ${when}**${exp.title}**.${detail}${impact}`);
    }
  }

  lines.push(...paragraph('Arc', character.arcNotes));
  return lines;
}

function locationBlock(location: Location, level: BibleLevel, isFocus: boolean): string[] {
  const heading = `### ${location.name} ${tag('L', location.id)}`;
  if (!isFocus && level === 'minimal') {
    const oneLine = location.description?.trim() ?? '';
    return [heading, oneLine].filter(Boolean);
  }
  if (!isFocus && level === 'compact') {
    return [heading, ...paragraph('Description', location.description)];
  }
  return [
    heading,
    ...paragraph('Description', location.description),
    ...paragraph('Sensory detail', location.sensoryDetails),
    ...paragraph('Rules and lore', location.rulesLore),
  ];
}

function plotPointLine(point: PlotPoint, index: number, names: Map<string, string>): string {
  const parts = [`${index + 1}. **${point.title}** ${tag('PP', point.id)} *(${point.status})*`];
  if (point.summary?.trim()) parts.push(`— ${point.summary.trim()}`);
  const who = point.characterIds.map((id) => names.get(id)).filter(Boolean);
  const where = point.locationIds.map((id) => names.get(id)).filter(Boolean);
  const meta: string[] = [];
  if (who.length) meta.push(`who: ${who.join(', ')}`);
  if (where.length) meta.push(`where: ${where.join(', ')}`);
  if (meta.length) parts.push(`{${meta.join('; ')}}`);
  return parts.join(' ');
}

/**
 * Render the project as deterministic markdown.
 *
 * Determinism matters twice over: the same inputs must produce byte-identical
 * output so prompt caching hits, and so the bible hash is a meaningful record of
 * what a version was written from.
 */
export function serializeBible(
  graph: BibleGraph,
  options: { focus?: Focus; level?: BibleLevel } = {},
): SerializedBible {
  const level = options.level ?? 'full';
  const focus = options.focus ?? {};
  const focusCharacters = new Set(focus.characterIds ?? []);
  const focusLocations = new Set(focus.locationIds ?? []);
  const focusPoints = new Set(focus.plotPointIds ?? []);
  const anyFocus = focusCharacters.size + focusLocations.size + focusPoints.size > 0;

  const refs: EntityRef[] = [];
  const lines: string[] = ['# STORY BIBLE'];

  lines.push(...parametersSection(graph.storyParameters, graph.project));
  refs.push({
    entityType: 'story_parameters',
    entityId: graph.storyParameters.id,
    entityRevision: graph.storyParameters.revision,
    focus: true,
  });

  // Characters, focus first so the important ones lead even after trimming.
  const characterNames = new Map<string, string>();
  for (const character of graph.characters) characterNames.set(character.id, character.name);
  for (const location of graph.locations) characterNames.set(location.id, location.name);

  const sortedCharacters = [...graph.characters].sort((a, b) => {
    const aFocus = focusCharacters.has(a.id) ? 0 : 1;
    const bFocus = focusCharacters.has(b.id) ? 0 : 1;
    if (aFocus !== bFocus) return aFocus - bFocus;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id.localeCompare(b.id);
  });

  const characterLines: string[] = [];
  for (const character of sortedCharacters) {
    const isFocus = !anyFocus || focusCharacters.has(character.id);
    characterLines.push(...characterBlock(character, level, isFocus), '');
    refs.push({
      entityType: 'character',
      entityId: character.id,
      entityRevision: character.revision,
      focus: anyFocus && focusCharacters.has(character.id),
    });
  }
  lines.push(...section('Characters', characterLines));

  // Relationships are cheap and high value, so they survive every trim level.
  const relationshipLines = graph.relationships
    .filter((rel) => characterNames.has(rel.fromCharacterId) && characterNames.has(rel.toCharacterId))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((rel) => {
      const from = characterNames.get(rel.fromCharacterId);
      const to = characterNames.get(rel.toCharacterId);
      const detail = rel.description?.trim() ? ` — ${rel.description.trim()}` : '';
      return `- ${from} → ${to}: **${rel.kind}**${detail}`;
    });
  lines.push(...section('Relationships', relationshipLines));

  const sortedLocations = [...graph.locations].sort((a, b) => {
    const aFocus = focusLocations.has(a.id) ? 0 : 1;
    const bFocus = focusLocations.has(b.id) ? 0 : 1;
    if (aFocus !== bFocus) return aFocus - bFocus;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id.localeCompare(b.id);
  });

  const locationLines: string[] = [];
  for (const location of sortedLocations) {
    const isFocus = !anyFocus || focusLocations.has(location.id);
    locationLines.push(...locationBlock(location, level, isFocus), '');
    refs.push({
      entityType: 'location',
      entityId: location.id,
      entityRevision: location.revision,
      focus: anyFocus && focusLocations.has(location.id),
    });
  }
  lines.push(...section('Locations', locationLines));

  const plotLineBlocks: string[] = [];
  for (const line of [...graph.plotLines].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))) {
    const points = [...line.points].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

    // At tighter levels, drop loose ideas that this piece is not about.
    const kept = points.filter((point) => {
      if (level === 'full') return true;
      if (focusPoints.has(point.id)) return true;
      if (level === 'compact') return point.status !== 'idea';
      return point.status === 'confirmed';
    });
    if (kept.length === 0 && !line.description?.trim()) continue;

    plotLineBlocks.push(`### ${line.name} ${tag('P', line.id)}`, `*${line.kind}*`);
    if (line.description?.trim()) plotLineBlocks.push(line.description.trim());
    kept.forEach((point, index) => plotLineBlocks.push(plotPointLine(point, index, characterNames)));
    plotLineBlocks.push('');

    refs.push({ entityType: 'plot_line', entityId: line.id, entityRevision: line.revision, focus: false });
    for (const point of kept) {
      refs.push({
        entityType: 'plot_point',
        entityId: point.id,
        entityRevision: point.revision,
        focus: anyFocus && focusPoints.has(point.id),
      });
    }
  }
  lines.push(...section('Plot lines', plotLineBlocks));

  const markdown = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { markdown, refs, chars: markdown.length };
}
