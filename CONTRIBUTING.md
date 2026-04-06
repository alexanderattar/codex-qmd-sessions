# Contributing

## Scope

`codex-qmd-sessions` is intentionally narrow:

- parse Codex rollout transcripts defensively
- export searchable markdown into an existing QMD/Obsidian sessions corpus
- restore recent markdown context on `SessionStart`
- refresh QMD on `Stop` without destabilizing the user’s existing Claude setup

Do not turn it into a general multi-provider framework unless the simple Codex path is already stable.

## Development workflow

1. Copy `config.json.example` to `config.json` only for local testing.
2. Point `outputDir` at a scratch folder unless you are intentionally testing a real vault.
3. Run:

```bash
npm test
node ./doctor.js --config ./config.json
```

4. When testing hooks, prefer a repo-local `.codex/hooks.json` in a scratch repo before touching `~/.codex/hooks.json`.

## Parser rules

Codex rollout JSONL is an internal format and may change.

When updating the parser:

- treat unknown record types as non-fatal
- prefer warnings over hard failures
- avoid dumping raw JSON blobs into markdown
- keep the neutral internal model small
- add or update a fixture test for any new record shape you support

## Markdown contract

Generated markdown should stay close to the existing `qmd-sessions` convention:

- `# Session: ...`
- metadata block
- `## User`
- `## Codex` by default
- optional compatibility mode for `## Claude`

If you change headings, output layout, or filename derivation, document the compatibility impact explicitly.

## Release quality bar

Before merging or publishing:

- `npm test` passes
- `npm pack --dry-run` contains only intended files
- `doctor` reports no errors
- a real transcript converts successfully
- a real `SessionStart` restore still works
- a real `Stop` hook still updates the markdown corpus safely
