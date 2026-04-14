const test = require("node:test");
const assert = require("node:assert/strict");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const lib = require("../lib");

const fixturePath = path.join(__dirname, "fixtures", "rollout-sample.jsonl");

test("rendered markdown uses Codex headings by default", function () {
  const session = lib.parseRolloutTranscript({
    transcriptPath: fixturePath,
    rawText: fs.readFileSync(fixturePath, "utf8"),
  });
  const markdown = lib.renderSessionMarkdown(session);

  assert.match(markdown, /^# Session: /m);
  assert.match(markdown, /^## User$/m);
  assert.match(markdown, /^## Codex$/m);
  assert.doesNotMatch(markdown, /^## Claude$/m);

  const compatibleTurns = lib.extractCompatibleTurnsFromMarkdown(markdown);
  assert.equal(compatibleTurns.length, 4);
  assert.ok(
    compatibleTurns.every(function everyTurn(turn) {
      return /^## (User|Codex|System)/.test(turn) || /^## Claude/.test(turn);
    })
  );
});

test("rendered markdown can emit Claude headings for claude-qmd-sessions compatibility", function () {
  const session = lib.parseRolloutTranscript({
    transcriptPath: fixturePath,
    rawText: fs.readFileSync(fixturePath, "utf8"),
  });
  const markdown = lib.renderSessionMarkdown(session, {
    assistantHeading: "Claude",
  });

  assert.match(markdown, /^## Claude$/m);
  assert.doesNotMatch(markdown, /^## Codex$/m);

  const compatibleTurns = lib.extractCompatibleTurnsFromMarkdown(markdown);
  assert.equal(compatibleTurns.length, 4);
});

test("restored markdown turns strip local command transport noise", function () {
  const markdown = [
    "## User",
    "",
    "<local-command-caveat>Caveat text</local-command-caveat>",
    "<command-name>/exit</command-name>",
    "<command-message>exit</command-message>",
    "<local-command-stdout>Bye!</local-command-stdout>",
    "",
    "## Codex",
    "",
    "Actual answer here.",
    "",
  ].join("\n");

  const compatibleTurns = lib.extractCompatibleTurnsFromMarkdown(markdown);
  assert.equal(compatibleTurns.length, 1);
  assert.match(compatibleTurns[0], /^## Codex/m);
  assert.doesNotMatch(compatibleTurns[0], /local-command|command-name|Bye!/);
});

test("recent-turn restore prefers QMD-backed retrieval", function () {
  const originalExecSync = cp.execSync;
  const originalExecFileSync = cp.execFileSync;

  cp.execSync = function mockExecSync(command, options) {
    if (command === "which qmd") return "";
    if (command === "qmd collection list") {
      return "Collections (1):\n\nsessions (qmd://sessions/)\n";
    }
    throw new Error(`unexpected execSync call: ${command}`);
  };

  cp.execFileSync = function mockExecFileSync(binary, args, options) {
    assert.equal(binary, "qmd");

    if (args[0] === "ls" && args[1] === "sessions/development-codex-qmd-sessions-demo") {
      return [
        "  1.1 KB  Apr 13 12:00  qmd://sessions/development-codex-qmd-sessions-demo/2026-04-13-codex-newer.md",
        "  0.9 KB  Apr 12 12:00  qmd://sessions/development-codex-qmd-sessions-demo/2026-04-12-codex-older.md",
      ].join("\n");
    }

    if (args[0] === "get" && args[1] === "qmd://sessions/development-codex-qmd-sessions-demo/2026-04-13-codex-newer.md") {
      return [
        "# Session: newer",
        "",
        "## User",
        "",
        "Latest question",
        "",
        "## Codex",
        "",
        "Latest answer",
        "",
      ].join("\n");
    }

    if (args[0] === "get" && args[1] === "qmd://sessions/development-codex-qmd-sessions-demo/2026-04-12-codex-older.md") {
      return [
        "# Session: older",
        "",
        "## User",
        "",
        "Earlier question",
        "",
        "## Codex",
        "",
        "Earlier answer",
        "",
      ].join("\n");
    }

    throw new Error(`unexpected execFileSync call: ${args.join(" ")}`);
  };

  try {
    const restored = lib.collectRecentTurns(
      "/does/not/matter",
      "/Users/alexander/Development/codex-qmd-sessions-demo",
      4,
      4000,
      { qmdCollectionName: "sessions" }
    );

    assert.match(restored, /^\[Context restored via QMD: ~2 exchanges from 2 sessions\]/);
    assert.match(restored, /Earlier question/);
    assert.match(restored, /Latest answer/);
  } finally {
    cp.execSync = originalExecSync;
    cp.execFileSync = originalExecFileSync;
  }
});
