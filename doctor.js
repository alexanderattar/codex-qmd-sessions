#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");

const lib = require("./lib");
const packageInfo = require("./package.json");

function parseArgs(argv) {
  const parsed = {
    configPath: null,
    cwd: process.cwd(),
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--config" && argv[index + 1]) {
      parsed.configPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--cwd" && argv[index + 1]) {
      parsed.cwd = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
  }

  return parsed;
}

function usage() {
  console.log(
    [
      "Usage:",
      "  codex-qmd-sessions-doctor [--config <path>] [--cwd <path>] [--json]",
      "",
      "Checks config discovery, Codex hook wiring, QMD availability, and collection presence.",
    ].join("\n")
  );
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function findHookFiles(cwd) {
  return [
    path.join(os.homedir(), ".codex", "hooks.json"),
    path.join(cwd, ".codex", "hooks.json"),
  ].filter(function dedupe(filePath, index, items) {
    return items.indexOf(filePath) === index;
  });
}

function readHookConfig(filePath) {
  try {
    return readJsonFile(filePath);
  } catch (error) {
    return null;
  }
}

function findCommandEntries(value, results) {
  if (Array.isArray(value)) {
    for (const item of value) {
      findCommandEntries(item, results);
    }
    return results;
  }

  if (!value || typeof value !== "object") {
    return results;
  }

  if (value.type === "command" && typeof value.command === "string") {
    results.push(value.command);
  }

  for (const nested of Object.values(value)) {
    findCommandEntries(nested, results);
  }

  return results;
}

function codexHooksEnabled() {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  if (!fs.existsSync(configPath)) {
    return {
      filePath: configPath,
      enabled: false,
      reason: "missing",
    };
  }

  const text = fs.readFileSync(configPath, "utf8");
  const featuresBlock = /\[features\][\s\S]*?(?=\n\[|$)/.exec(text);
  const enabled = featuresBlock ? /codex_hooks\s*=\s*true\b/.test(featuresBlock[0]) : false;

  return {
    filePath: configPath,
    enabled,
    reason: enabled ? "enabled" : "disabled",
  };
}

function detectConfiguredHooks(cwd) {
  const hookFiles = findHookFiles(cwd);
  const matches = [];

  for (const hookFile of hookFiles) {
    if (!fs.existsSync(hookFile)) continue;
    const parsed = readHookConfig(hookFile);
    if (!parsed) {
      matches.push({
        filePath: hookFile,
        status: "invalid_json",
        commands: [],
      });
      continue;
    }

    const commands = findCommandEntries(parsed, []);
    const matchingCommands = commands.filter(function isCodexQmdHook(command) {
      return /codex-qmd-sessions-hook|codex-qmd-sessions[\/\\]hook\.js/.test(command);
    });

    matches.push({
      filePath: hookFile,
      status: matchingCommands.length > 0 ? "configured" : "present",
      commands: matchingCommands,
    });
  }

  return matches;
}

function buildChecks(flags) {
  const checks = [];
  const config = lib.readConfig(flags.configPath);
  const validation = lib.validateConfig(config, {
    requireOutputDir: true,
  });

  checks.push({
    label: "package",
    status: "ok",
    detail: `${packageInfo.name}@${packageInfo.version}`,
  });

  checks.push({
    label: "config file",
    status: config ? "ok" : "error",
    detail: config ? config.configPath : `Not found. Expected ${lib.DEFAULT_CONFIG_PATH}`,
  });

  for (const error of validation.errors) {
    checks.push({
      label: "config",
      status: "error",
      detail: error,
    });
  }

  for (const warning of validation.warnings) {
    checks.push({
      label: "config",
      status: "warn",
      detail: warning,
    });
  }

  if (config && config.outputDir) {
    checks.push({
      label: "outputDir",
      status: fs.existsSync(config.outputDir) ? "ok" : "warn",
      detail: config.outputDir,
    });
  }

  if (config && config.sessionsDir) {
    checks.push({
      label: "sessionsDir",
      status: fs.existsSync(config.sessionsDir) ? "ok" : "warn",
      detail: config.sessionsDir,
    });
  }

  checks.push({
    label: "assistant heading",
    status: "ok",
    detail: config ? config.assistantHeading : "unknown",
  });

  if (config && config.assistantHeading === "Codex") {
    checks.push({
      label: "compatibility",
      status: "warn",
      detail:
        'Claude-side restore logic only understands "## Claude". Use assistantHeading "Claude" if you need drop-in compatibility with claude-qmd-sessions restore.',
    });
  }

  checks.push({
    label: "qmd",
    status: lib.qmdAvailable() ? "ok" : "warn",
    detail: lib.qmdAvailable() ? "qmd is on PATH" : "qmd is not on PATH",
  });

  if (config && lib.qmdAvailable()) {
    checks.push({
      label: "qmd collection",
      status: lib.qmdCollectionExists(config.qmdCollectionName) ? "ok" : "warn",
      detail: config.qmdCollectionName || "(skipped)",
    });
  }

  const hooksStatus = codexHooksEnabled();
  checks.push({
    label: "codex_hooks",
    status: hooksStatus.enabled ? "ok" : "warn",
    detail: `${hooksStatus.filePath} (${hooksStatus.reason})`,
  });

  const configuredHooks = detectConfiguredHooks(flags.cwd);
  if (configuredHooks.length === 0) {
    checks.push({
      label: "hooks.json",
      status: "warn",
      detail: "No global or repo-local hooks.json found",
    });
  } else {
    for (const hookFile of configuredHooks) {
      checks.push({
        label: "hooks.json",
        status:
          hookFile.status === "configured"
            ? "ok"
            : hookFile.status === "invalid_json"
              ? "error"
              : "warn",
        detail:
          hookFile.status === "configured"
            ? `${hookFile.filePath} (${hookFile.commands.join("; ")})`
            : hookFile.status === "invalid_json"
              ? `${hookFile.filePath} contains invalid JSON`
              : `${hookFile.filePath} exists but does not reference codex-qmd-sessions-hook`,
      });
    }
  }

  return checks;
}

function printChecks(checks) {
  for (const check of checks) {
    const prefix =
      check.status === "ok" ? "[ok]" : check.status === "warn" ? "[warn]" : "[error]";
    console.log(`${prefix} ${check.label}: ${check.detail}`);
  }
}

function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    usage();
    return;
  }

  const checks = buildChecks(flags);
  if (flags.json) {
    console.log(JSON.stringify({ checks }, null, 2));
  } else {
    printChecks(checks);
  }

  if (checks.some((check) => check.status === "error")) {
    process.exitCode = 1;
  }
}

main();
