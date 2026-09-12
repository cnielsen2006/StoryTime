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

Double-click **`start.bat`**. It installs dependencies on first run, creates
`.env`, applies migrations, starts both servers, and opens the browser.

Or from a terminal:

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

## Ways to start it

| Launcher | What it does |
|---|---|
| `start.bat` | Dev mode on http://localhost:5173, opens the browser for you. The usual one. |
| `start-lan.bat` | Same, but reachable from other devices. Prints the addresses to type on them. |
| `start-production.bat` | Builds first, then serves everything from http://localhost:3001. No dev tooling running. |
| `create-shortcuts.ps1` | Puts "StoryTime" and "StoryTime (LAN)" on your desktop. Add `-Remove` to take them off again. |

### In VS Code

Press F5, or pick from the Run and Debug dropdown. Entries are grouped: the
**Run** ones start things normally with no debugger attached, the **Debug** ones
stop at breakpoints.

Run, no debugger:

| Entry | What starts |
|---|---|
| Run StoryTime (server + web) | Both, the usual choice |
| Run API server only | Just the API on port 3001 |
| Run web only (Vite) | Just the front end on port 5173 |
| Run StoryTime (LAN) | Both, reachable from other devices |
| Run production build | Builds first, then serves from port 3001 |
| Run tests | The end-to-end suite |

Debug, breakpoints active:

| Entry | What it attaches to |
|---|---|
| Debug StoryTime (server + web) | Both through npm |
| Debug API server | The API directly under the debugger, best for server breakpoints |
| Debug web (Chrome) | Front-end code in Chrome |
| Debug tests / Debug current test file | Vitest, all tests or just the open file |

Compounds start more than one at once: **Run StoryTime and open browser**,
**Run server + web separately** (two terminals, so you can restart one without
the other), and **Debug StoryTime (server + browser)**.

Browser entries wait for Vite to answer before opening, so they do not land on a
connection error.

Ctrl+Shift+B runs the build. There is also a **Set up StoryTime** task that does
install, migrate, and seed in one go.

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

Run `start-lan.bat`, or `npm run dev:lan`. Both bind to every interface and print
the addresses to type on the other device.

There is no password on this app. Anyone who can reach the address can read and
edit your book, so only do this on a network you trust.

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
npm run dev:lan    # same, reachable from other devices
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
