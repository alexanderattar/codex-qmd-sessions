#!/usr/bin/env node

const path = require("path");
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
      continue;
    }
  }

  return parsed;
}

function readInput(callback) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", function onData(chunk) {
    input += chunk;
  });
  process.stdin.on("end", function onEnd() {
    callback(input);
  });
}

function writeJson(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function loadConfig(configPath) {
  const config = lib.readConfig(configPath);
  if (!config) return null;
  if (config.outputDir) {
    config.outputDir = path.resolve(config.outputDir);
  }
  return config;
}

function handleSessionStart(data, config) {
  const source = data.source;
  const cwd = data.cwd || process.cwd();
  const contextParts = [];
  const status = [];

  const fileContext = lib.loadContextFiles(config.contextFiles, cwd);
  if (fileContext.length > 0) {
    contextParts.push(fileContext.join("\n\n---\n\n"));
    status.push(`[codex-qmd-sessions] Loaded ${fileContext.length} extra context file${fileContext.length === 1 ? "" : "s"}`);
  }

  const shouldLoadRecent = source === "resume" || (source === "startup" && config.loadContextOnStartup);
  if (shouldLoadRecent && config.outputDir) {
    const recentContext = lib.collectRecentTurns(
      config.outputDir,
      cwd,
      config.maxTurns,
      config.maxContextChars
    );
    if (recentContext) {
      contextParts.push(recentContext);
      status.push("[codex-qmd-sessions] Loaded recent indexed session context");
    } else {
      status.push("[codex-qmd-sessions] No recent indexed session context found");
    }
  }

  const response = {
    continue: true,
  };

  if (status.length > 0) {
    response.systemMessage = status.join("\n");
  }

  if (contextParts.length > 0) {
    response.hookSpecificOutput = {
      hookEventName: "SessionStart",
      additionalContext: contextParts.join("\n\n---\n\n"),
    };
  }

  writeJson(response);
}

function handleStop(data, config) {
  const transcriptPath = data.transcript_path;
  const sessionId = data.session_id;

  if (!config.outputDir) {
    writeJson({ continue: true });
    return;
  }

  let targetTranscriptPath = transcriptPath;
  if (!targetTranscriptPath && sessionId) {
    targetTranscriptPath = lib.findTranscriptPathForSession(sessionId, config.sessionsDir);
  }

  if (!targetTranscriptPath) {
    writeJson({
      continue: true,
      systemMessage: "[codex-qmd-sessions] No transcript path available for Stop hook",
    });
    return;
  }

  let result;
  try {
    result = lib.convertTranscriptFile(targetTranscriptPath, config);
  } catch (error) {
    writeJson({
      continue: true,
      systemMessage: `[codex-qmd-sessions] Conversion failed: ${error.message}`,
    });
    return;
  }

  if (!result.changed) {
    writeJson({ continue: true });
    return;
  }

  const qmdResult = lib.runQmdUpdateAndEmbed(config, { force: false });
  if (qmdResult.status === "updated" || qmdResult.status === "throttled" || qmdResult.status === "unavailable" || qmdResult.status === "missing_collection") {
    writeJson({ continue: true });
    return;
  }

  writeJson({
    continue: true,
    systemMessage: `[codex-qmd-sessions] QMD refresh issue: ${qmdResult.status}`,
  });
}

readInput(function onInput(input) {
  const flags = parseArgs(process.argv.slice(2));
  let data;
  try {
    data = JSON.parse(input || "{}");
  } catch (error) {
    writeJson({ continue: true });
    return;
  }

  const config = loadConfig(flags.configPath);
  if (!config) {
    writeJson({ continue: true });
    return;
  }

  if (data.hook_event_name === "SessionStart") {
    handleSessionStart(data, config);
    return;
  }

  if (data.hook_event_name === "Stop") {
    handleStop(data, config);
    return;
  }

  writeJson({ continue: true });
});
