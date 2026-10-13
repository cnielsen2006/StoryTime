import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Chapter, ChatScope, GeneratedVersion } from '@storytime/shared';
import {
  useChapters,
  useMakeVersionCurrent,
  useManuscript,
  useMarkReviewed,
  useProjectGraph,
  useSaveManualVersion,
  useScenes,
  useSplitDraft,
  useStartRun,
  useVersionDiff,
  useVersions,
} from '../api/hooks.js';
import { EmptyState, ErrorNote, Modal, Spinner, StaleBadge, TextArea, formatWhen } from '../components/ui.js';
import { ReadableText } from '../components/ReadableText.js';
import { RevisionChatPanel } from '../components/RevisionChatPanel.js';
import { getReadingSettings } from '../reading/settings.js';

export function ManuscriptPage() {
  const { projectId = '' } = useParams();
  const { data: chapters, isLoading } = useChapters(projectId);
  const { data: manuscript } = useManuscript(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Set when reading carried on from the previous chapter, so this one starts on its own.
  const [listenOnOpenId, setListenOnOpenId] = useState<string | null>(null);
  const splitDraft = useSplitDraft(projectId);
  const [chat, setChat] = useState<{ scope: ChatScope; title: string } | null>(null);
  const openChat = (scope: ChatScope, title: string) => setChat({ scope, title });
  const panel = chat ? (
    <RevisionChatPanel
      key={`${chat.scope.scopeType}:${chat.scope.scopeId}`}
      projectId={projectId}
      scope={chat.scope}
      title={chat.title}
      onClose={() => setChat(null)}
    />
  ) : null;

  useEffect(() => {
    if (!selectedId && chapters?.length) setSelectedId(chapters[0]!.id);
  }, [chapters, selectedId]);

  const selected = chapters?.find((c) => c.id === selectedId) ?? null;

  const continueReading = () => {
    if (!chapters || !getReadingSettings().continueToNext) return;
    const index = chapters.findIndex((c) => c.id === selectedId);
    const next = chapters.slice(index + 1).find((c) => c.currentVersionId);
    if (!next) return;
    setSelectedId(next.id);
    setListenOnOpenId(next.id);
  };

  if (isLoading) return <Spinner />;

  // Whole-draft mode produces one blob until it is split into chapters.
  if (chapters?.length === 0 && manuscript?.draft) {
    return (
      <div className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">Draft</h2>
            <p className="mt-1 text-sm text-ink-500">
              Written in one pass. Split it into chapters to edit and regenerate them separately.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              onClick={() => openChat({ scopeType: 'draft', scopeId: projectId }, manuscript.title)}
            >
              Revise with AI
            </button>
            <button className="btn-primary" onClick={() => splitDraft.mutate()} disabled={splitDraft.isPending}>
              {splitDraft.isPending ? 'Splitting…' : 'Split into chapters'}
            </button>
          </div>
        </div>
        <ErrorNote error={splitDraft.error} />
        <ReadableText text={manuscript.draft} className="card prose-manuscript max-w-none p-8 text-ink-800" />
        {panel}
      </div>
    );
  }

  if (chapters?.length === 0) {
    return (
      <EmptyState
        title="Nothing written yet"
        body="Generate an outline to create chapters, or write the whole draft in one pass and split it afterwards."
        action={
          <Link to={`/p/${projectId}/generate`} className="btn-primary">
            Go to Generate
          </Link>
        }
      />
    );
  }

  const switchChapter = (id: string) => {
    setSelectedId(id);
    setListenOnOpenId(null);
    // A conversation about one chapter follows the reader to the next.
    if (chat?.scope.scopeType === 'chapter') {
      const next = chapters?.find((c) => c.id === id);
      if (next) openChat({ scopeType: 'chapter', scopeId: id }, next.title);
    }
  };

  return (
    <div
      className={`grid gap-6 ${chat ? 'lg:grid-cols-1 lg:pr-[var(--chat-pad)]' : 'lg:grid-cols-[16rem_1fr]'}`}
      // Leaves room beside the chat panel on screens where the page would otherwise run underneath it.
      style={{ '--chat-pad': 'max(0px, calc(29rem - (100vw - 72rem) / 2 - 1.5rem))' } as CSSProperties}
    >
      <div className={`space-y-3 ${chat ? 'lg:hidden' : ''}`}>
        <button
          className="btn-secondary w-full text-xs"
          onClick={() => openChat({ scopeType: 'book', scopeId: projectId }, 'The whole book')}
          title="Talk through changes to the whole manuscript, and have them made chapter by chapter"
        >
          Revise the book with AI
        </button>
        <ul className="space-y-1">
          {chapters?.map((chapter, index) => (
            <li key={chapter.id}>
              <button
                onClick={() => switchChapter(chapter.id)}
                className={`w-full rounded-md px-3 py-2 text-left ${
                  selectedId === chapter.id ? 'bg-ink-800 text-white' : 'text-ink-700 hover:bg-ink-100'
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <span className={`text-xs ${selectedId === chapter.id ? 'text-white/50' : 'text-ink-400'}`}>
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{chapter.title}</span>
                </div>
                <div
                  className={`mt-0.5 flex items-center gap-2 text-xs ${
                    selectedId === chapter.id ? 'text-white/60' : 'text-ink-400'
                  }`}
                >
                  {chapter.currentVersionId ? `${chapter.wordCount.toLocaleString()}w` : 'unwritten'}
                  {chapter.staleLevel !== 'none' ? (
                    <span className={chapter.staleLevel === 'hard' ? 'text-red-400' : 'text-amber-400'}>●</span>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-w-0 space-y-4">
        {/* With the chat open the chapter list steps aside, so chapters are chosen here instead. */}
        {chat ? (
          <label className="hidden items-center gap-2 text-xs text-ink-500 lg:flex">
            Chapter
            <select
              className="rounded border border-ink-200 px-2 py-1 text-sm text-ink-800"
              value={selectedId ?? ''}
              onChange={(e) => switchChapter(e.target.value)}
            >
              {chapters?.map((chapter, index) => (
                <option key={chapter.id} value={chapter.id}>
                  {index + 1}. {chapter.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {selected ? (
          <ChapterView
            key={selected.id}
            projectId={projectId}
            chapter={selected}
            listenOnOpen={listenOnOpenId === selected.id}
            onListenFinished={continueReading}
            onChat={() => openChat({ scopeType: 'chapter', scopeId: selected.id }, selected.title)}
          />
        ) : null}
      </div>
      {panel}
    </div>
  );
}

function ChapterView({
  projectId,
  chapter,
  listenOnOpen,
  onListenFinished,
  onChat,
}: {
  projectId: string;
  chapter: Chapter;
  listenOnOpen: boolean;
  onListenFinished: () => void;
  onChat: () => void;
}) {
  const navigate = useNavigate();
  const { data: graph } = useProjectGraph(projectId);
  const { data: scenes } = useScenes(chapter.id);
  const { data: versions } = useVersions('chapter', chapter.id);

  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [editing, setEditing] = useState(false);

  const makeCurrent = useMakeVersionCurrent(projectId);
  const markReviewed = useMarkReviewed(projectId);
  const startRun = useStartRun(projectId);

  const active = versions?.find((v) => v.id === (viewingVersionId ?? chapter.currentVersionId)) ?? null;
  const sceneText = (scenes ?? []).filter((s) => s.currentVersionId);
  const hasScenes = (scenes?.length ?? 0) > 0;

  const regenerate = async () => {
    const { runId } = await startRun.mutateAsync({
      mode: hasScenes ? 'scenes' : 'chapters',
      kind: 'generate',
      targetIds: hasScenes ? sceneText.map((s) => s.id) : [chapter.id],
    });
    navigate(`/p/${projectId}/runs/${runId}`);
  };

  return (
    <div className="min-w-0 space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-ink-900">{chapter.title}</h2>
          <StaleBadge level={chapter.staleLevel} reasons={chapter.staleReasons} />
        </div>
        {chapter.summary ? <p className="text-sm text-ink-500">{chapter.summary}</p> : null}

        <div className="flex flex-wrap gap-1.5">
          <button className="btn-secondary text-xs" onClick={regenerate} disabled={startRun.isPending}>
            {chapter.currentVersionId ? 'Rewrite' : 'Write it'}
          </button>
          {chapter.currentVersionId || hasScenes ? (
            <button className="btn-secondary text-xs" onClick={onChat}>
              Revise with AI
            </button>
          ) : null}
          {chapter.currentVersionId ? (
            <>
              <button className="btn-secondary text-xs" onClick={() => setUpdating(true)}>
                Revise with instructions
              </button>
              <button className="btn-secondary text-xs" onClick={() => setEditing(true)}>
                Edit by hand
              </button>
              {versions && versions.length > 1 ? (
                <button className="btn-secondary text-xs" onClick={() => setComparing(true)}>
                  Compare versions
                </button>
              ) : null}
            </>
          ) : null}
          {chapter.staleLevel !== 'none' ? (
            <button
              className="btn-ghost text-xs"
              onClick={() => markReviewed.mutate({ kind: 'chapters', id: chapter.id })}
            >
              Mark as reviewed
            </button>
          ) : null}
        </div>

        <ErrorNote error={startRun.error} />
      </header>

      {chapter.staleLevel !== 'none' && chapter.staleReasons.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <strong className="font-semibold">
            {chapter.staleLevel === 'hard' ? 'The bible changed under this chapter.' : 'Background details changed.'}
          </strong>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {chapter.staleReasons.slice(-5).map((reason, index) => (
              <li key={`${reason.entityId}-${index}`}>
                {reason.label}
                {reason.field ? ` (${reason.field})` : ''} changed {formatWhen(reason.at)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasScenes ? (
        <SceneList projectId={projectId} chapterId={chapter.id} scenes={scenes ?? []} graph={graph} />
      ) : null}

      {versions && versions.length > 1 ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-400">Version</span>
          <select
            className="rounded border border-ink-200 px-2 py-1"
            value={viewingVersionId ?? chapter.currentVersionId ?? ''}
            onChange={(e) => setViewingVersionId(e.target.value)}
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                v{version.versionNo} · {formatWhen(version.createdAt)}
                {version.isCurrent ? ' (current)' : ''}
                {version.instructions ? ' · revised' : ''}
              </option>
            ))}
          </select>
          {active && !active.isCurrent ? (
            <button className="btn-secondary text-xs" onClick={() => makeCurrent.mutate(active.id)}>
              Make this the current version
            </button>
          ) : null}
        </div>
      ) : null}

      {active ? (
        <ReadableText
          text={active.content}
          versionId={active.id}
          chapterId={chapter.id}
          className="card prose-manuscript max-w-none p-8 text-ink-800"
          autoStart={listenOnOpen && active.isCurrent}
          onFinished={active.isCurrent ? onListenFinished : undefined}
        />
      ) : hasScenes ? null : (
        <EmptyState title="Not written yet" body="Use Write it above, or generate several chapters at once." />
      )}

      <UpdateModal
        open={updating}
        onClose={() => setUpdating(false)}
        projectId={projectId}
        targetType="chapter"
        targetId={chapter.id}
        label={chapter.title}
      />

      <ManualEditModal
        open={editing}
        onClose={() => setEditing(false)}
        projectId={projectId}
        targetType="chapter"
        targetId={chapter.id}
        initial={active?.content ?? ''}
      />

      <CompareModal
        open={comparing}
        onClose={() => setComparing(false)}
        versions={versions ?? []}
        currentId={chapter.currentVersionId}
      />
    </div>
  );
}

function SceneList({
  projectId,
  chapterId,
  scenes,
  graph,
}: {
  projectId: string;
  chapterId: string;
  scenes: Array<{ id: string; title: string; goal: string | null; currentVersionId: string | null; wordCount: number; staleLevel: string; povCharacterId: string | null; locationId: string | null }>;
  graph: { characters: Array<{ id: string; name: string }>; locations: Array<{ id: string; name: string }> } | undefined;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: versions } = useVersions('scene', openId ?? undefined);
  const characterNames = new Map((graph?.characters ?? []).map((c) => [c.id, c.name]));
  const locationNames = new Map((graph?.locations ?? []).map((l) => [l.id, l.name]));
  const current = versions?.find((v) => v.isCurrent);

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Scenes</h3>
      {scenes.map((scene, index) => (
        <div key={scene.id} className="card p-3">
          <button
            className="flex w-full items-center gap-2 text-left"
            onClick={() => setOpenId(openId === scene.id ? null : scene.id)}
          >
            <span className="text-xs text-ink-400">{index + 1}</span>
            <span className="flex-1 text-sm font-medium text-ink-800">{scene.title}</span>
            {scene.povCharacterId ? (
              <span className="chip">{characterNames.get(scene.povCharacterId) ?? 'unknown POV'}</span>
            ) : null}
            {scene.locationId ? <span className="chip">{locationNames.get(scene.locationId) ?? '—'}</span> : null}
            <span className="text-xs text-ink-400">
              {scene.currentVersionId ? `${scene.wordCount.toLocaleString()}w` : 'unwritten'}
            </span>
          </button>
          {scene.goal ? <p className="mt-1 pl-6 text-xs text-ink-500">{scene.goal}</p> : null}
          {openId === scene.id && current ? (
            <div className="mt-3 border-t border-ink-200 pt-3">
              <ReadableText
                text={current.content}
                versionId={current.id}
                chapterId={chapterId}
                className="prose-manuscript max-w-none text-sm text-ink-800"
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Revise the current text against written instructions, keeping the old version. */
function UpdateModal({
  open,
  onClose,
  projectId,
  targetType,
  targetId,
  label,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  targetType: string;
  targetId: string;
  label: string;
}) {
  const navigate = useNavigate();
  const [instructions, setInstructions] = useState('');
  const startRun = useStartRun(projectId);

  const submit = async () => {
    if (!instructions.trim()) return;
    const { runId } = await startRun.mutateAsync({
      mode: 'chapters',
      kind: 'update',
      targetType,
      targetId,
      instructions: instructions.trim(),
    });
    onClose();
    navigate(`/p/${projectId}/runs/${runId}`);
  };

  return (
    <Modal open={open} title={`Revise ${label}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-500">
          The current text stays as the baseline. Everything you do not mention is kept as close to the original as
          possible, and the old version is saved so you can go back.
        </p>
        <TextArea
          label="What should change"
          value={instructions}
          onChange={setInstructions}
          rows={5}
          placeholder="Cut the flashback. Make Wren more guarded in the second half. End on the door closing."
        />
        <ErrorNote error={startRun.error} />
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={!instructions.trim() || startRun.isPending}>
            Revise
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ManualEditModal({
  open,
  onClose,
  projectId,
  targetType,
  targetId,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  targetType: string;
  targetId: string;
  initial: string;
}) {
  const [text, setText] = useState(initial);
  const save = useSaveManualVersion(projectId);

  useEffect(() => setText(initial), [initial, open]);

  return (
    <Modal open={open} title="Edit by hand" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-ink-500">Saving creates a new version, so the generated one is still there.</p>
        <textarea
          className="field prose-manuscript max-w-none resize-y"
          rows={20}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={save.isPending || text === initial}
            onClick={async () => {
              await save.mutateAsync({ targetType, targetId, content: text });
              onClose();
            }}
          >
            Save as new version
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CompareModal({
  open,
  onClose,
  versions,
  currentId,
}: {
  open: boolean;
  onClose: () => void;
  versions: GeneratedVersion[];
  currentId: string | null;
}) {
  const [left, setLeft] = useState<string>('');
  const [right, setRight] = useState<string>('');

  useEffect(() => {
    if (!open || versions.length < 2) return;
    setRight(currentId ?? versions[0]!.id);
    setLeft(versions.find((v) => v.id !== (currentId ?? versions[0]!.id))?.id ?? versions[1]!.id);
  }, [open, versions, currentId]);

  const { data: diff, isLoading } = useVersionDiff(left, right);

  return (
    <Modal open={open} title="Compare versions" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Older</label>
            <select className="field" value={left} onChange={(e) => setLeft(e.target.value)}>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNo} · {formatWhen(v.createdAt)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Newer</label>
            <select className="field" value={right} onChange={(e) => setRight(e.target.value)}>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNo} · {formatWhen(v.createdAt)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isLoading ? <Spinner /> : null}

        {diff ? (
          <div className="prose-manuscript max-h-[28rem] max-w-none overflow-y-auto rounded-md border border-ink-200 p-4 text-sm">
            {diff.lines.map((line, index) => (
              <span
                key={index}
                className={
                  line.type === 'added'
                    ? 'bg-green-100 text-green-900'
                    : line.type === 'removed'
                      ? 'bg-red-100 text-red-900 line-through'
                      : 'text-ink-700'
                }
              >
                {line.value}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
