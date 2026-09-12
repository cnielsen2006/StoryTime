# StoryTime

Build books out of loose ideas. Collect characters, places, and half-formed plot
points over time, then have a model weave them into a manuscript, revise it, and
tell you when what you wrote no longer matches what you changed.

Runs locally. Single user, no accounts, no cloud storage. Your book lives in one
SQLite file under `data/`.

## What it does

**Collect.** A quick-capture inbox takes anything you type without asking where
it belongs. File ideas later against a character, a place, or a plot point, or
turn one straight into a new entity. An idea can touch several things at once.

**Organise.** Characters carry descriptions, appearance, personality, backstory,
relationships, and an ordered list of formative experiences. Locations carry
sensory detail and their own rules. Plot lines hold ordered plot points, each
marked as a loose idea, taking shape, or confirmed, and each linked to the
characters and places it involves. Story parameters set audience, length, genre,
tone, point of view, tense, style, and hard content limits.

**Generate.** Choose how to work at the start of every run:

| Mode | What happens |
|---|---|
| Whole draft | One pass, start to finish. Best for short work. Split into chapters afterwards. |
| Outline, then chapters | Plan the chapters, edit the plan, then write them one at a time with continuity carried forward. |
| Scene cards | Break chapters into scenes with a point of view, a place, and a goal, then write scene by scene. |

**Revise.** Every generated version is kept. Revise a chapter with written
instructions and the prior text stays as the baseline, so unmentioned parts are
left alone. Compare any two versions, roll back to an earlier one, or edit by
hand and save that as a new version.

**Stay in sync.** When you change a character after a chapter was written from
it, that chapter is flagged immediately, with the field that changed. Changes to
a character the chapter was *about* flag it for rewrite; changes to background
detail flag it more softly. Story parameters flag everything. Regenerate, or
mark it reviewed if you disagree.

## Quick start

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed      # optional: a sample project that works offline
npm run dev
```

Open http://localhost:5173. The seeded project uses the mock provider, so it runs
with no API key and no network.

To use a real model, put a key in `.env` and pick the provider in Settings:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Model providers

Four providers behind one interface, swappable per project in Parameters or
globally in Settings.

| Provider | Notes |
|---|---|
| Claude (Anthropic) | Default for real work. Streams with adaptive thinking, caches the story bible between chapters, and uses structured outputs for outlines. |
| OpenAI | Streaming plus schema-validated structured outputs. |
| Ollama | Local models over HTTP. Lower the token budget in Parameters for small context windows. |
| Mock | Deterministic placeholder prose. No network, no cost. Used by the tests. |

## Sharing on your network

Set `HOST=0.0.0.0` in `.env` and run `npm run build && npm start`. The server
then serves the built front end on port 3001, reachable from other machines on
your network. There is no authentication, so only do this on a network you trust.

## Layout

```
packages/shared    Zod schemas and types used by both server and web
apps/server        Fastify API, SQLite via Drizzle, prompt assembly, generation
apps/web           React front end
data/              Your SQLite database (gitignored)
```

Inside the server, the pieces worth knowing:

- `bible/serialize.ts` turns the database into deterministic markdown. Same
  inputs, same bytes, so prompt caching works and each version records exactly
  what it was written from.
- `bible/budget.ts` renders that at the richest level that fits the token budget,
  and reports what it left out.
- `generation/runner.ts` runs the three modes, streams progress over
  server-sent events, and saves versions with the entity revisions behind them.
- `services/staleness.ts` compares those recorded revisions against the current
  ones to decide what is out of date.

## Commands

```bash
npm run dev        # server on 3001, web on 5173
npm test           # end-to-end suite against the mock provider
npm run typecheck  # both packages
npm run build      # production build
npm run db:seed -- --force   # replace the sample project
```

## Limits worth knowing

- Whole-draft mode stitches long books together from several responses and can
  show seams. Outline mode handles full-length books better.
- Changing story parameters flags every written chapter, which is correct but
  noisy. "Mark as reviewed" is the escape hatch.
- Export is Markdown and plain text. No DOCX or EPUB yet.
- One generation runs per project at a time.
