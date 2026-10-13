# StoryTime

Build books out of loose ideas. Collect characters, places, and half-formed plot
points over time, then have a model weave them into a manuscript, revise it, and
tell you when what you wrote no longer matches what you changed.

Runs locally. Single user, no accounts, no cloud storage. Your book lives in one
SQLite file under `data/`.

## What it does

**Start.** A book can begin empty, or you can pick a genre and have the model
invent one: a premise, a cast with histories and relationships, places with
sensory detail, and a plot skeleton with some beats deliberately left unsettled.
The questions it chose not to answer land in your inbox. What comes out is an
ordinary project, editable and revisable like any other, so treat every word of
it as a first draft.

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

**Revise in conversation.** Revise with AI opens a chat beside a chapter, or
beside the whole book. Ask what the model thinks, or tell it what to change:
"tighten the opening", "make Wren colder in the market scene", "cut the
flashback". When you ask for a change it rewrites the text as a new version and
says what it did; keep talking to refine it. Every rewrite is kept, can be
compared with what it replaced, and can be undone from the chat. It reads the
story bible too, so it keeps names and facts straight, and tells you when a
change means the bible needs updating. A conversation about the whole book
rewrites chapter by chapter and needs the manuscript to fit in one prompt;
beyond that, open a chapter instead.

**Listen.** Press Listen above any chapter to hear it read aloud, with the
paragraph being read highlighted. Pause, skip a paragraph, or click any
paragraph to read from there, and it carries on into the next chapter. Pick the
voice, speed and volume in Settings. By default the server reads with
[Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), a small open speech model
that sounds far more natural than most built-in voices and runs on the CPU
without sending text anywhere. The first time you listen it downloads about
90 MB into `data/models`. Every device on the LAN hears the same voices. You can
switch to your browser's own voices in Settings instead.

**Characters read their own lines.** Give each character a voice on the
Characters page (Suggest voices picks distinct ones from what the character
notes say, and you can hear and change each). The model then works out who
speaks every quoted line, and the reader performs them like a person would:
each character in their own voice, narration in the narrator's. If the story is
told in the first person, the narrator's voice is the narrator character's.
Voices are assigned right after a chapter is written or revised, or later for
text that already exists (Assign voices above the chapter, or Voices to check
and correct any line; corrections are kept). Speakers the model cannot place,
like a crowd or a stranger, use the narrator's voice. Voices are about reading
only: changing one never touches the story history or marks a chapter as out of
date.

**Stay in sync.** When you change a character after a chapter was written from
it, that chapter is flagged immediately, with the field that changed. Changes to
a character the chapter was *about* flag it for rewrite; changes to background
detail flag it more softly. Story parameters flag everything. Regenerate, or
mark it reviewed if you disagree.

**Back up.** Backups opens from the book list. Tick the stories to save, add a
label if you like, and each backup becomes one file in `data/backups` that holds
everything in those stories: the bible, every draft and its history, and the
revision chats. Settings and sign-in details are never included. Backups pile up
as a history you can download, upload from another machine, or delete. Restore
any of them, one story or several: either replace the current version, or bring
it back as a copy beside it. Replacing first saves the current version as a
safety backup (the newest 20 safety backups are kept; your own are never
deleted automatically), and a restore either finishes completely or changes
nothing.

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

**Invent a book** on the projects page generates a whole starting bible from a
genre. Without an API key it produces obvious placeholder content, so add a key
first if you want a real one.

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

Only one copy runs at a time. Launching again, by any of these or from VS Code,
stops the copy already running, closes its window, and starts fresh, so a
second double-click restarts the app. A launch only stops what it is about to
replace: running the API on its own leaves a separate web server alone. It never
touches a program that is not StoryTime; if one holds the port, it says so and
stops. `npm run stop` shuts StoryTime down without starting it again.

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
| Run StoryTime (LAN) | Both, plus a printed list of addresses to use |
| Run production build | Builds first, then serves from port 3001 |
| Run tests | The end-to-end suite |

Every entry that starts a server binds to all interfaces, so you can open the
app from a phone or another computer on the same network, not just this machine.
Both servers print the addresses to type when they start. **Run StoryTime (LAN)**
differs only in gathering those addresses into one list up front.

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

Any of these reach the app from another device:

- `start-lan.bat`, or `npm run dev:lan`
- Any VS Code launch entry that starts a server
- `npm run dev` with `HOST=0.0.0.0` set

All of them print the addresses to type on the other device. Use the one on your
normal network, usually the `192.168.x.x` address.

Plain `npm run dev` from a terminal still binds to this machine only, unless you
set `HOST=0.0.0.0` or put it in `.env`.

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
- `generation/ideate.ts` invents a whole project from a genre and writes it into
  the normal tables, resolving the names the model used into real ids and
  reporting anything it could not match.
- `dialogue/` finds the quoted lines in a version (`findQuotes`, in the shared
  package so the reader cuts paragraphs exactly as the server did) and asks the
  model who speaks each one. The answer is stored beside the version, never in
  its text, so exports and diffs stay clean.
- `chat/` and `generation/chat.ts` run revision conversations. The model
  answers in plain text with the full revised text of any section it changed
  inside `<revised_section>` tags; `chat/parse.ts` splits that as it streams, so
  the reply appears live and the rewritten text is applied only once complete.
- `backup/` writes and restores backups. It reads the table list from
  `backup/tables.ts`, which is the one place to add a table when the schema
  gains one (a test fails until you do). The file is gzipped NDJSON: a manifest
  line, then rows grouped by table.

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
- One generation runs per project at a time. A revision chat message counts as
  one, so a chat reply and a chapter run cannot overlap.
- Character voices only work with the Kokoro engine; browser voices read
  everything in one voice. Inner thoughts and dialogue set off by dashes rather
  than quotation marks are read as narration.
- Who speaks a line is the model's judgement. Long untagged exchanges are where
  it slips, which is what the Voices correction view is for.
- Kokoro has no emotion or pitch control: a character always sounds like their
  voice, at the speed set for reading.
