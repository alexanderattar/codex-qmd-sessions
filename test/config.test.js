const test = require("node:test");
const assert = require("node:assert/strict");

const lib = require("../lib");

test("validateConfig accepts a minimal production config", function () {
  const config = {
    outputDir: "/tmp/sessions",
    sessionsDir: "/tmp/codex-sessions",
    qmdCollectionName: "sessions",
    maxContextChars: 12000,
    maxTurns: 16,
    minSecondsBetweenEmbeds: 45,
    assistantHeading: "Codex",
    contextFiles: [],
  };

  const validation = lib.validateConfig(config, {
    requireOutputDir: true,
  });

  assert.deepEqual(validation.errors, []);
});

test("validateConfig rejects invalid assistant headings and contextFiles", function () {
  const validation = lib.validateConfig(
    {
      outputDir: "/tmp/sessions",
      sessionsDir: "/tmp/codex-sessions",
      assistantHeading: "Assistant",
      contextFiles: "AGENTS.md",
      maxContextChars: 0,
      maxTurns: -1,
      minSecondsBetweenEmbeds: -5,
    },
    {
      requireOutputDir: true,
    }
  );

  assert.match(validation.errors.join("\n"), /assistantHeading must be either/);
  assert.match(validation.errors.join("\n"), /contextFiles must be an array/);
  assert.match(validation.errors.join("\n"), /maxContextChars must be a number greater than or equal to 1/);
  assert.match(validation.errors.join("\n"), /maxTurns must be a number greater than or equal to 1/);
  assert.match(
    validation.errors.join("\n"),
    /minSecondsBetweenEmbeds must be a number greater than or equal to 0/
  );
});
