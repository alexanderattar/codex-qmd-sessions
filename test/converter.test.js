const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const lib = require("../lib");

const fixturePath = path.join(__dirname, "fixtures", "rollout-sample.jsonl");

test("parseRolloutTranscript builds a compact conversational model", function () {
  const session = lib.parseRolloutTranscript({
    transcriptPath: fixturePath,
    rawText: fs.readFileSync(fixturePath, "utf8"),
    debug: true,
  });

  assert.equal(session.meta.provider, "Codex");
  assert.equal(session.meta.sessionId, "019ca294-2709-7183-87c9-b0d2f5dbddb0");
  assert.equal(session.meta.project, "development-codex-qmd-sessions-demo");
  assert.equal(session.meta.model, "gpt-5.4");

  assert.equal(session.turns.length, 4);
  assert.deepEqual(
    session.turns.map(function roles(turn) {
      return turn.role;
    }),
    ["User", "Claude", "User", "Claude"]
  );

  assert.match(session.turns[0].text, /Build the standalone Codex converter\./);
  assert.match(session.turns[1].text, /I’m inspecting the rollout structure/);
  assert.match(session.turns[1].text, /The first markdown export is ready\./);
  assert.equal(session.toolEvents.length, 2);
  assert.ok(session.warnings.some((warning) => warning.type === "parse_error"));
});

test("buildOutputPath creates stable codex-prefixed filenames", function () {
  const session = lib.parseRolloutTranscript({
    transcriptPath: fixturePath,
    rawText: fs.readFileSync(fixturePath, "utf8"),
  });

  const outputPath = lib.buildOutputPath(session, "/tmp/shared-sessions");
  assert.equal(
    outputPath,
    "/tmp/shared-sessions/development-codex-qmd-sessions-demo/2026-04-06-codex-build-the-standalone-codex-converter-019ca2942709.md"
  );
});
