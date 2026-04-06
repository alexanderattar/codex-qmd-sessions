#!/usr/bin/env node

const lib = require("./lib");

function parseArgs(argv) {
  const parsed = {
    configPath: null,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--config" && argv[index + 1]) {
      parsed.configPath = argv[index + 1];
      index += 1;
    }
  }

  return parsed;
}

const flags = parseArgs(process.argv.slice(2));
const config = lib.readConfig(flags.configPath);

if (!config || !config.outputDir) {
  console.error(
    `No outputDir configured. Set CODEX_QMD_SESSIONS_CONFIG or create ${lib.DEFAULT_CONFIG_PATH}.`
  );
  process.exit(1);
}

const cwd = process.cwd();
const parts = [];
const fileContext = lib.loadContextFiles(config.contextFiles, cwd);
if (fileContext.length > 0) {
  parts.push(fileContext.join("\n\n---\n\n"));
}

const recentContext = lib.collectRecentTurns(
  config.outputDir,
  cwd,
  config.maxTurns,
  config.maxContextChars
);

if (recentContext) {
  parts.push(recentContext);
}

if (parts.length === 0) {
  console.error("No context available.");
  process.exit(1);
}

process.stdout.write(parts.join("\n\n---\n\n") + "\n");
