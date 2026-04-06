#!/usr/bin/env node

const path = require("path");
const packageInfo = require("./package.json");
const lib = require("./lib");

function usage() {
  console.error(
    [
      "Usage:",
      "  node convert-sessions.js [outputDir] [--config <path>] [--transcript <path> | --session <id> | --scan]",
      "  node convert-sessions.js --print-config [--config <path>]",
      "  node convert-sessions.js --help",
      "  node convert-sessions.js --version",
      "",
      "Examples:",
      "  node convert-sessions.js /path/to/output --transcript ~/.codex/sessions/2026/04/06/rollout-....jsonl",
      "  node convert-sessions.js --config ./config.json --session 019ca294-2709-7183-87c9-b0d2f5dbddb0",
      "  node convert-sessions.js --config ./config.json --scan",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const parsed = {
    configPath: null,
    outputDir: null,
    transcriptPath: null,
    sessionId: null,
    scan: false,
    debug: false,
    includeToolSummaries: null,
    sessionsDir: null,
    help: false,
    version: false,
    printConfig: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--config" && argv[index + 1]) {
      parsed.configPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--output-dir" && argv[index + 1]) {
      parsed.outputDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--sessions-dir" && argv[index + 1]) {
      parsed.sessionsDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--transcript" && argv[index + 1]) {
      parsed.transcriptPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--session" && argv[index + 1]) {
      parsed.sessionId = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--scan") {
      parsed.scan = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      parsed.version = true;
      continue;
    }

    if (arg === "--print-config") {
      parsed.printConfig = true;
      continue;
    }

    if (arg === "--debug") {
      parsed.debug = true;
      continue;
    }

    if (arg === "--include-tool-summaries") {
      parsed.includeToolSummaries = true;
      continue;
    }

    if (!parsed.outputDir && !arg.startsWith("--")) {
      parsed.outputDir = arg;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return parsed;
}

function mergeRuntimeConfig(flags) {
  const fileConfig = lib.readConfig(flags.configPath) || {};
  const config = Object.assign({}, fileConfig);

  if (flags.outputDir) config.outputDir = path.resolve(flags.outputDir);
  if (flags.sessionsDir) config.sessionsDir = path.resolve(flags.sessionsDir);
  if (flags.includeToolSummaries !== null) config.includeToolSummaries = flags.includeToolSummaries;
  if (flags.debug) config.debug = true;

  if (!config.outputDir) {
    throw new Error("No outputDir configured. Provide one in config.json or as the first argument.");
  }

  config.outputDir = path.resolve(config.outputDir);
  config.sessionsDir = config.sessionsDir || lib.DEFAULT_SESSIONS_DIR;
  return config;
}

function validateRuntimeConfig(config, requireOutputDir) {
  const validation = lib.validateConfig(config, {
    requireOutputDir,
  });
  if (validation.errors.length > 0) {
    throw new Error(validation.errors.join(" "));
  }
  for (const warning of validation.warnings) {
    console.error(`[warn] ${warning}`);
  }
}

function printWarnings(result) {
  if (!Array.isArray(result.warnings) || result.warnings.length === 0) return;
  for (const warning of result.warnings) {
    const suffix = warning.rawType ? ` (${warning.rawType})` : "";
    const message = warning.message ? ` ${warning.message}` : "";
    console.error(
      `[warn] ${result.transcriptPath}:${warning.line || "?"} ${warning.type || "warning"}${suffix}${message}`
    );
  }
}

function summarize(results) {
  const counts = {
    created: 0,
    updated: 0,
    unchanged: 0,
    empty: 0,
    error: 0,
  };

  for (const result of results) {
    if (Object.prototype.hasOwnProperty.call(counts, result.status)) {
      counts[result.status] += 1;
    }
  }

  console.log(
    `Created: ${counts.created}  Updated: ${counts.updated}  Unchanged: ${counts.unchanged}  Empty: ${counts.empty}`
  );
}

function main() {
  let flags;
  try {
    flags = parseArgs(process.argv.slice(2));
  } catch (error) {
    usage();
    console.error(error.message);
    process.exit(1);
  }

  if (flags.help) {
    usage();
    return;
  }

  if (flags.version) {
    console.log(packageInfo.version);
    return;
  }

  let config;
  try {
    config = mergeRuntimeConfig(flags);
    validateRuntimeConfig(config, !flags.printConfig);
  } catch (error) {
    usage();
    console.error(error.message);
    process.exit(1);
  }

  if (flags.printConfig) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  const specificModes = [flags.transcriptPath, flags.sessionId, flags.scan].filter(Boolean).length;
  if (specificModes > 1) {
    console.error("Choose only one of --transcript, --session, or --scan.");
    process.exit(1);
  }

  const results = [];

  if (flags.transcriptPath) {
    const transcriptPath = path.resolve(flags.transcriptPath);
    let result;
    try {
      result = lib.convertTranscriptFile(transcriptPath, config);
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
    results.push(result);
    if (config.debug) printWarnings(result);
    if (result.outputPath) console.log(result.outputPath);
    summarize(results);
    return;
  }

  if (flags.sessionId) {
    const transcriptPath = lib.findTranscriptPathForSession(flags.sessionId, config.sessionsDir);
    if (!transcriptPath) {
      console.error(`No rollout transcript found for session ${flags.sessionId}`);
      process.exit(1);
    }

    let result;
    try {
      result = lib.convertTranscriptFile(transcriptPath, config);
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
    results.push(result);
    if (config.debug) printWarnings(result);
    if (result.outputPath) console.log(result.outputPath);
    summarize(results);
    return;
  }

  for (const result of lib.convertAllTranscripts(config)) {
    results.push(result);
    if (config.debug || result.status === "error") printWarnings(result);
  }

  summarize(results);
  if (results.some((result) => result.status === "error")) {
    process.exitCode = 1;
  }
}

main();
