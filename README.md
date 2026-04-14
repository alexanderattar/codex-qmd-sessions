# codex-qmd-sessions

`codex-qmd-sessions` is a standalone Codex-native companion to [`claude-qmd-sessions`](https://github.com/wbelk/claude-qmd-sessions). It converts Codex CLI rollout transcripts into QMD-compatible markdown without modifying the user’s working Claude setup.

The design goal is coexistence, not replacement:

- Claude remains untouched.
- Codex gets its own converter and hook script.
- Both providers can write into the same markdown corpus.
- The generated markdown stays close to the existing `qmd-sessions` markdown contract so mixed corpora remain readable and searchable.

## Inspired by claude-qmd-sessions

This project is directly inspired by [wbelk/claude-qmd-sessions](https://github.com/wbelk/claude-qmd-sessions).

That project established the workflow that made this worth building in the first place:

- converting local CLI transcripts into readable markdown
- keeping those notes inside a QMD-indexed corpus
- using hooks to keep the markdown and index fresh
- restoring recent context from the saved session notes

`codex-qmd-sessions` keeps that operating model because it is practical and already proven. The main difference is that Codex transcript storage and hook semantics are different enough that the parser and hook integration needed to be implemented as a separate Codex-specific tool rather than patched into the existing Claude code paths.

## Architecture

- `convert-sessions.js`: converts one rollout transcript, one session id, or a full `~/.codex/sessions` scan into markdown.
- `lib.js`: owns config loading, defensive rollout parsing, markdown rendering, output naming, recent-turn restore, and QMD update/embed gating.
- `hook.js`: handles Codex `SessionStart` and `Stop` hooks.
- `refresh.js`: prints reusable recent context from the shared markdown corpus.
- `test/`: fixture-driven parser and markdown-compat tests.

## Why this is separate from claude-qmd-sessions

Codex transcripts are not Claude JSONL. Codex currently writes internal rollout logs under `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, with record types such as:

- `session_meta`
- `turn_context`
- `response_item`
- `event_msg`

That schema is richer, noisier, and explicitly unstable. This repo keeps Codex-specific parsing isolated while reusing the markdown contract and QMD workflow that already works for Claude.

## Status

This project is intentionally small, but it is no longer just a one-off local script:

- defensive rollout parser with fixture tests
- idempotent markdown export
- Codex `SessionStart` + `Stop` hook integration
- QMD update/embed throttling
- install-time diagnostics via `codex-qmd-sessions-doctor`
- user-level config fallback for global installs

The main remaining risk is upstream: Codex rollout JSONL is an internal format and can change without notice.

## Install

You can run this in two supported ways.

### Option A: clone the repo

1. Clone this repo somewhere outside your main working repos.
2. Copy `config.json.example` to `config.json` in the repo root.
3. Point `outputDir` at your QMD/Obsidian sessions folder.

### Option B: install as a package

1. Install globally once published:

```bash
npm install -g codex-qmd-sessions
```

2. Create a config at:

```text
~/.codex/codex-qmd-sessions/config.json
```

3. Copy `config.json.example` there and edit it.

You can always override config discovery with:

```bash
export CODEX_QMD_SESSIONS_CONFIG=/absolute/path/to/config.json
```

## Codex setup

1. Point `outputDir` at the same sessions markdown root already used by your Claude exporter if you want both providers in one corpus.
2. Enable Codex hooks in `~/.codex/config.toml`:

```toml
[features]
codex_hooks = true
```

3. Copy `hooks.example.json` into either:

- `~/.codex/hooks.json`
- `<repo>/.codex/hooks.json`

4. If you are using a cloned repo instead of a global install, replace `codex-qmd-sessions-hook` in `hooks.example.json` with:

```bash
node /absolute/path/to/codex-qmd-sessions/hook.js --config /absolute/path/to/config.json
```

5. Run:

```bash
codex-qmd-sessions-doctor
```

That command checks the config file, Codex hook flag, `hooks.json`, QMD availability, and collection presence.

At the moment, the package name is available on npm, but publishing still requires an authenticated npm account on the publishing machine.

## Config

Example config:

```json
{
  "outputDir": "/absolute/path/to/your/shared/sessions-markdown",
  "sessionsDir": "~/.codex/sessions",
  "qmdCollectionName": "sessions",
  "loadContextOnStartup": true,
  "maxContextChars": 14000,
  "maxTurns": 100,
  "enableEmbed": true,
  "minSecondsBetweenEmbeds": 45,
  "includeToolSummaries": false,
  "assistantHeading": "Codex",
  "contextFiles": [],
  "debug": false
}
```

Notes:

- `outputDir`: markdown root shared with `claude-qmd-sessions` if desired.
- default config path:
  - repo-local `./config.json` when present
  - otherwise `~/.codex/codex-qmd-sessions/config.json`
- `qmdCollectionName`: used both for startup retrieval and as a presence guard before `qmd update` / `qmd embed`. Current `qmd update` is global, so this is not a per-collection target flag.
- `loadContextOnStartup`: applies to `SessionStart` with `source=startup`. `resume` always attempts to load recent indexed context.
- `contextFiles`: optional extra files to inject through `additionalContext`. Use this sparingly. Codex already handles `AGENTS.md` natively, so duplicating `AGENTS.md` here is usually a bad idea.
- `minSecondsBetweenEmbeds`: throttles `qmd update` and `qmd embed` because Codex `Stop` is turn-scoped, not session-scoped.
- `assistantHeading`: `Codex` or `Claude`. `Codex` is the default because this tool exports Codex sessions. Set `Claude` only if you need drop-in compatibility with the current hardcoded restore logic in `claude-qmd-sessions`.

## Usage

Convert one transcript:

```bash
node convert-sessions.js --config ./config.json --transcript ~/.codex/sessions/2026/04/06/rollout-....jsonl
```

Convert one session by id:

```bash
node convert-sessions.js --config ./config.json --session 019ca294-2709-7183-87c9-b0d2f5dbddb0
```

Bulk scan everything under `~/.codex/sessions`:

```bash
node convert-sessions.js --config ./config.json --scan
```

Emit restorable recent context manually:

```bash
node refresh.js
```

Run tests:

```bash
npm test
```

Run diagnostics:

```bash
codex-qmd-sessions-doctor
```

## Markdown contract

Generated files default to Codex-native headings:

```md
# Session: Build the standalone converter

**Date:** 2026-04-06
**Project:** my-project
**Provider:** Codex
**Session ID:** 019ca294-2709-7183-87c9-b0d2f5dbddb0
**Transcript Path:** /Users/yourname/.codex/sessions/2026/04/06/rollout-....jsonl

---

## User

...

## Codex

...
```

This repo’s own restore logic accepts:

- `## User`
- `## Codex`
- `## Claude`
- `## System`

If you need Claude-side restore compatibility, set:

```json
{
  "assistantHeading": "Claude"
}
```

The compatibility break is only with the current Claude-side restore parser.

## Output layout

Files are written as:

```text
<outputDir>/<project>/<date>-codex-<slug>-<shortid>.md
```

Example:

```text
/vault/sessions/my-project/2026-04-06-codex-build-standalone-converter-019ca2942709.md
```

This keeps Codex files sortable, deterministic, and clearly separated from Claude filenames without forcing a new collection.

## Hook behavior

### SessionStart

- Matches `startup|resume`.
- Loads optional `contextFiles`.
- Loads recent indexed session context from the configured QMD collection, with raw markdown scanning only as a fallback when QMD is unavailable.
- Returns `hookSpecificOutput.additionalContext` so Codex sees the restored context as extra developer context.

### Stop

- Uses `transcript_path` when the hook payload includes it.
- Falls back to session-id lookup if needed.
- Converts the active transcript to markdown.
- Runs `qmd update` and optionally `qmd embed`, but only when the markdown actually changed and the throttle window has elapsed.

## Example `~/.codex/hooks.json`

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "codex-qmd-sessions-hook",
            "statusMessage": "Loading Codex session context"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "codex-qmd-sessions-hook",
            "statusMessage": "Syncing Codex session markdown"
          }
        ]
      }
    ]
  }
}
```

## Known limitations

- Codex rollout JSONL is an internal format and may change. Unknown lines are skipped by design.
- The parser prefers `event_msg.user_message` for user turns so it does not ingest the system-injected instruction wrappers that also appear as `response_item` user messages.
- Tool activity is omitted from markdown by default because the goal is searchable conversation context, not raw trajectory dumps.
- `Stop` is turn-scoped. There is no true Codex session-end hook today, so QMD refresh has to be throttled.
- `PreToolUse` and `PostToolUse` currently apply only to Bash tool events, which is not enough to build a full Claude-style compaction flow.
- `qmd update` is global in current QMD CLI behavior, so `qmdCollectionName` is used as a safety check rather than a targeted update flag.

## Production checklist

Before calling this done or sharing it with other people, the minimum bar should be:

- `npm test` passes
- `codex-qmd-sessions-doctor` shows no errors
- a real Codex session creates a note in the target markdown corpus
- a second Codex session can restore recent context from that note
- `qmd update` sees the created note in the intended collection
- hooks are installed either globally or repo-locally, not both by accident
- `assistantHeading` is chosen intentionally:
  - `Codex` for semantic correctness
  - `Claude` only for Claude-side restore compatibility

## Recommended release work

The repo is usable now. The next cleanup steps to make it broadly shareable are:

1. Publish it under a stable GitHub repo URL and npm package name.
2. Add CI that runs `npm test` on push and pull request.
3. Add a couple more fixture tests for alternate rollout record shapes.
4. Add an end-to-end smoke test script that exercises `SessionStart` and `Stop` against a sample transcript.
5. Cut a `0.1.x` release only after testing against at least one fresh machine or user account.

Supporting project files:

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [RELEASING.md](./RELEASING.md)

## Sources used for this implementation

- `claude-qmd-sessions` source:
  - [convert-sessions.js](https://github.com/wbelk/claude-qmd-sessions/blob/main/convert-sessions.js)
  - [hook.js](https://github.com/wbelk/claude-qmd-sessions/blob/main/hook.js)
  - [lib.js](https://github.com/wbelk/claude-qmd-sessions/blob/main/lib.js)
  - [refresh.js](https://github.com/wbelk/claude-qmd-sessions/blob/main/refresh.js)
- Official Codex docs:
  - [Features](https://developers.openai.com/codex/cli/features/)
  - [Hooks](https://developers.openai.com/codex/hooks/)
  - [Advanced Config](https://developers.openai.com/codex/config-advanced/)
