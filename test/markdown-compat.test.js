const test = require("node:test");
const assert = require("node:assert/strict");
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
