const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const DEFAULT_CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const DEFAULT_SESSIONS_DIR = path.join(DEFAULT_CODEX_HOME, "sessions");
const DEFAULT_STATE_PATH = path.join(DEFAULT_CODEX_HOME, "codex-qmd-sessions-state.json");
const LOCAL_CONFIG_PATH = path.join(__dirname, "config.json");
const DEFAULT_USER_CONFIG_PATH = path.join(
  DEFAULT_CODEX_HOME,
  "codex-qmd-sessions",
  "config.json"
);
const VALID_ASSISTANT_HEADINGS = new Set(["Claude", "Codex"]);
const DEFAULT_CONFIG_PATH = determineDefaultConfigPath();

const DEFAULT_CONFIG = {
  sessionsDir: DEFAULT_SESSIONS_DIR,
  qmdCollectionName: "sessions",
  loadContextOnStartup: true,
  maxContextChars: 14000,
  maxTurns: 100,
  enableEmbed: true,
  minSecondsBetweenEmbeds: 45,
  includeToolSummaries: false,
  assistantHeading: "Codex",
  contextFiles: [],
  debug: false,
  statePath: DEFAULT_STATE_PATH,
};

function determineDefaultConfigPath() {
  if (process.env.CODEX_QMD_SESSIONS_CONFIG) {
    return resolveHomePath(process.env.CODEX_QMD_SESSIONS_CONFIG);
  }
  if (fs.existsSync(LOCAL_CONFIG_PATH)) {
    return LOCAL_CONFIG_PATH;
  }
  return DEFAULT_USER_CONFIG_PATH;
}

function resolveHomePath(value) {
  if (typeof value !== "string" || !value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolveContextFile(value, cwd) {
  if (typeof value !== "string" || !value) return value;
  const withHome = resolveHomePath(value);
  if (!cwd) return withHome;
  return withHome.replace(/\{cwd\}/g, cwd);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readConfig(configPath) {
  const resolvedConfigPath = resolveHomePath(configPath || DEFAULT_CONFIG_PATH);
  let raw;

  try {
    raw = readJsonFile(resolvedConfigPath);
  } catch (error) {
    return null;
  }

  return normalizeConfig(raw, resolvedConfigPath);
}

function normalizeConfig(rawConfig, resolvedConfigPath) {
  const merged = Object.assign({}, DEFAULT_CONFIG, rawConfig || {});
  merged.sessionsDir = resolveHomePath(merged.sessionsDir || DEFAULT_SESSIONS_DIR);
  merged.outputDir = resolveHomePath(merged.outputDir);
  merged.statePath = resolveHomePath(merged.statePath || DEFAULT_STATE_PATH);
  merged.contextFiles = Array.isArray(merged.contextFiles) ? merged.contextFiles.slice() : [];
  if (merged.assistantHeading === undefined || merged.assistantHeading === null || merged.assistantHeading === "") {
    merged.assistantHeading = DEFAULT_CONFIG.assistantHeading;
  } else if (/^claude$/i.test(String(merged.assistantHeading))) {
    merged.assistantHeading = "Claude";
  } else if (/^codex$/i.test(String(merged.assistantHeading))) {
    merged.assistantHeading = "Codex";
  }
  merged.configPath = resolvedConfigPath || null;
  return merged;
}

function validateConfig(config, options) {
  const requireOutputDir = Boolean(options && options.requireOutputDir);
  const errors = [];
  const warnings = [];

  if (!config) {
    return {
      errors: [
        `Config not found. Set CODEX_QMD_SESSIONS_CONFIG or create ${DEFAULT_USER_CONFIG_PATH}.`,
      ],
      warnings,
    };
  }

  if (requireOutputDir && !config.outputDir) {
    errors.push("outputDir is required.");
  }

  if (config.sessionsDir && !fs.existsSync(config.sessionsDir)) {
    warnings.push(`sessionsDir does not exist yet: ${config.sessionsDir}`);
  }

  if (config.outputDir && !path.isAbsolute(config.outputDir)) {
    warnings.push(`outputDir is not absolute: ${config.outputDir}`);
  }

  if (config.outputDir) {
    const parentDir = path.dirname(config.outputDir);
    if (!fs.existsSync(parentDir)) {
      warnings.push(`outputDir parent does not exist yet: ${parentDir}`);
    }
  }

  if (config.assistantHeading && !VALID_ASSISTANT_HEADINGS.has(config.assistantHeading)) {
    errors.push('assistantHeading must be either "Codex" or "Claude".');
  }

  if (!Array.isArray(config.contextFiles)) {
    errors.push("contextFiles must be an array.");
  }

  const positiveFields = [
    ["maxContextChars", 1],
    ["maxTurns", 1],
    ["minSecondsBetweenEmbeds", 0],
  ];
  for (const [field, minimum] of positiveFields) {
    if (config[field] === undefined || config[field] === null) continue;
    const numeric = Number(config[field]);
    if (!Number.isFinite(numeric) || numeric < minimum) {
      errors.push(`${field} must be a number greater than or equal to ${minimum}.`);
    }
  }

  if (!config.qmdCollectionName || !String(config.qmdCollectionName).trim()) {
    warnings.push("qmdCollectionName is empty; qmd collection checks will be skipped.");
  }

  return { errors, warnings };
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeTextFileAtomic(filePath, content) {
  ensureDirectory(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}

function sanitizeSegment(value, fallback) {
  const sanitized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || fallback;
}

function deriveProjectName(cwd) {
  if (typeof cwd !== "string" || !cwd) return "misc";

  const parts = cwd.split(path.sep).filter(Boolean);
  if (parts.length >= 2) {
    return sanitizeSegment(parts.slice(-2).join("-"), "misc");
  }
  if (parts.length === 1) {
    return sanitizeSegment(parts[0], "misc");
  }
  return "misc";
}

function isoDate(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

function dateFromTranscriptPath(transcriptPath) {
  if (typeof transcriptPath !== "string") return null;
  const match = /[/\\](\d{4})[/\\](\d{2})[/\\](\d{2})[/\\]rollout-/.exec(transcriptPath);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function normalizeWhitespace(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}

function stripLocalCommandTags(text) {
  return String(text || "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
    .replace(/<local-command-stderr>[\s\S]*?<\/local-command-stderr>/g, "");
}

function stripSystemTags(text) {
  return normalizeWhitespace(
    stripLocalCommandTags(String(text || "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ""))
  );
}

function extractTextFromContent(content) {
  if (typeof content === "string") return stripSystemTags(content);
  if (!Array.isArray(content)) return "";

  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (typeof block.text === "string" && /^(input_text|output_text|text)$/.test(block.type || "")) {
      const cleaned = stripSystemTags(block.text);
      if (cleaned) parts.push(cleaned);
      continue;
    }
    if (typeof block.refusal === "string") {
      const cleaned = stripSystemTags(block.refusal);
      if (cleaned) parts.push(cleaned);
    }
  }

  return parts.join("\n\n").trim();
}

function formatUserMessage(payload) {
  if (!payload || typeof payload !== "object") return "";

  const parts = [];
  const message = normalizeWhitespace(payload.message);
  if (message) parts.push(message);

  const localImages = Array.isArray(payload.local_images) ? payload.local_images.length : 0;
  const images = Array.isArray(payload.images) ? payload.images.length : 0;
  const totalImages = localImages + images;

  if (!message && totalImages > 0) {
    parts.push(totalImages === 1 ? "[User attached 1 image]" : `[User attached ${totalImages} images]`);
  }

  return parts.join("\n\n").trim();
}

function toolEventName(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.name === "string" && payload.name) return payload.name;
  if (typeof payload.type === "string" && payload.type) return payload.type;
  return null;
}

function shortSessionId(sessionId, transcriptPath) {
  const compact = String(sessionId || "").replace(/-/g, "");
  if (compact.length >= 12) return compact.slice(0, 12);
  return crypto.createHash("sha1").update(String(transcriptPath || sessionId || "unknown")).digest("hex").slice(0, 12);
}

function transcriptSessionIdFromFilename(transcriptPath) {
  if (typeof transcriptPath !== "string") return null;
  const base = path.basename(transcriptPath);
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(base);
  return match ? match[1] : null;
}

function slugifyTitle(text, fallback) {
  const base = sanitizeSegment(text, "");
  if (base) return base.slice(0, 48);
  return sanitizeSegment(fallback, "session");
}

function firstLine(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return "";
  return normalized.split("\n")[0].trim();
}

function mergeConversationItems(items) {
  const merged = [];

  for (const item of items) {
    if (!item || !item.text) continue;
    const text = normalizeWhitespace(item.text);
    if (!text) continue;

    const previous = merged[merged.length - 1];
    if (previous && previous.role === item.role) {
      previous.text += "\n\n" + text;
      if (item.timestamp) previous.timestamp = previous.timestamp || item.timestamp;
      if (item.rawType) previous.rawTypes.push(item.rawType);
      continue;
    }

    merged.push({
      role: item.role,
      text,
      timestamp: item.timestamp || null,
      rawTypes: item.rawType ? [item.rawType] : [],
    });
  }

  return merged;
}

function summarizeToolEvents(toolEvents) {
  const counts = new Map();

  for (const event of toolEvents) {
    const name = sanitizeSegment(event.name || event.type || "tool", "tool");
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([name, count]) => `${name} x${count}`)
    .join(", ");
}

function parseRolloutTranscript(options) {
  const transcriptPath = options && options.transcriptPath ? options.transcriptPath : null;
  const includeToolSummaries = Boolean(options && options.includeToolSummaries);
  const debug = Boolean(options && options.debug);
  const rawText =
    options && typeof options.rawText === "string"
      ? options.rawText
      : fs.readFileSync(transcriptPath, "utf8");

  const meta = {
    provider: "Codex",
    sessionId: transcriptSessionIdFromFilename(transcriptPath),
    transcriptPath,
    startedAt: null,
    date: dateFromTranscriptPath(transcriptPath),
    cwd: null,
    project: null,
    model: null,
    source: null,
    title: null,
    slug: null,
    shortId: null,
  };

  const warnings = [];
  const conversation = [];
  const toolEvents = [];
  const lines = rawText.split(/\n/);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line || !line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      warnings.push({
        line: index + 1,
        type: "parse_error",
        message: error.message,
      });
      continue;
    }

    const recordType = record.type;

    if (recordType === "session_meta") {
      const payload = record.payload || {};
      meta.sessionId = payload.id || meta.sessionId;
      meta.startedAt = payload.timestamp || record.timestamp || meta.startedAt;
      meta.date = meta.date || isoDate(meta.startedAt);
      meta.cwd = payload.cwd || meta.cwd;
      meta.source = payload.source || meta.source;
      continue;
    }

    if (recordType === "turn_context") {
      const payload = record.payload || {};
      meta.cwd = payload.cwd || meta.cwd;
      meta.model = payload.model || meta.model;
      continue;
    }

    if (recordType === "event_msg") {
      const payload = record.payload || {};

      if (payload.type === "user_message") {
        const text = formatUserMessage(payload);
        if (text) {
          conversation.push({
            role: "User",
            text,
            timestamp: record.timestamp || null,
            rawType: "event_msg.user_message",
          });
        }
        continue;
      }

      if (
        debug &&
        payload.type &&
        !/^(agent_message|token_count|task_started|task_complete|context_compacted|item_completed)$/.test(payload.type)
      ) {
        warnings.push({
          line: index + 1,
          type: "unknown_event_msg",
          rawType: payload.type,
        });
      }
      continue;
    }

    if (recordType === "response_item") {
      const payload = record.payload || {};

      if (payload.type === "message" && payload.role === "assistant") {
        const text = extractTextFromContent(payload.content);
        if (text) {
          conversation.push({
            role: "Claude",
            text,
            timestamp: record.timestamp || null,
            rawType: "response_item.message.assistant",
          });
        }
        continue;
      }

      if (
        payload.type === "function_call" ||
        payload.type === "custom_tool_call" ||
        payload.type === "web_search_call"
      ) {
        toolEvents.push({
          timestamp: record.timestamp || null,
          type: payload.type,
          name: toolEventName(payload),
        });
        continue;
      }

      if (
        debug &&
        payload.type &&
        !/^(function_call_output|custom_tool_call_output|reasoning|message)$/.test(payload.type)
      ) {
        warnings.push({
          line: index + 1,
          type: "unknown_response_item",
          rawType: payload.type,
        });
      }
      continue;
    }

    if (debug && recordType && !/^compacted$/.test(recordType)) {
      warnings.push({
        line: index + 1,
        type: "unknown_record_type",
        rawType: recordType,
      });
    }
  }

  const turns = mergeConversationItems(conversation);
  const fallbackId = meta.sessionId || transcriptSessionIdFromFilename(transcriptPath) || "unknown-session";
  meta.project = deriveProjectName(meta.cwd);
  meta.shortId = shortSessionId(fallbackId, transcriptPath);
  meta.title = firstLine((turns.find((turn) => turn.role === "User") || {}).text) || fallbackId;
  meta.slug = slugifyTitle(meta.title, fallbackId);
  meta.date = meta.date || "unknown-date";

  if (includeToolSummaries && toolEvents.length > 0) {
    turns.push({
      role: "System",
      text: "Tool summary: " + summarizeToolEvents(toolEvents),
      timestamp: null,
      rawTypes: ["tool_summary"],
    });
  }

  return {
    meta,
    turns,
    toolEvents,
    warnings,
  };
}

function normalizeAssistantHeading(value) {
  const normalized = String(value || DEFAULT_CONFIG.assistantHeading || "").toLowerCase();
  return normalized === "claude" ? "Claude" : "Codex";
}

function renderSessionMarkdown(session, options) {
  const meta = session.meta || {};
  const transcriptPath = meta.transcriptPath ? path.resolve(meta.transcriptPath) : "unknown";
  const assistantHeading = normalizeAssistantHeading(options && options.assistantHeading);

  let output = `# Session: ${meta.title || meta.sessionId || "untitled"}\n\n`;
  output += `**Date:** ${meta.date || "unknown"}  \n`;
  output += `**Project:** ${meta.project || "misc"}  \n`;
  output += `**Provider:** Codex  \n`;
  output += `**Session ID:** ${meta.sessionId || "unknown"}  \n`;
  if (meta.model) {
    output += `**Model:** ${meta.model}  \n`;
  }
  output += `**Transcript Path:** ${transcriptPath}\n\n`;
  output += "---\n\n";

  for (const turn of session.turns || []) {
    const heading =
      turn.role === "Claude"
        ? assistantHeading
        : turn.role;
    output += `## ${heading}\n\n`;
    output += `${turn.text}\n\n`;
  }

  return output;
}

function buildOutputPath(session, outputDir) {
  const meta = session.meta || {};
  const project = sanitizeSegment(meta.project || "misc", "misc");
  const shortId = sanitizeSegment(meta.shortId || shortSessionId(meta.sessionId, meta.transcriptPath), "session");
  const slug = sanitizeSegment(meta.slug || meta.sessionId || "session", "session");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(meta.date || "") ? meta.date : "unknown-date";
  const fileName = `${date}-codex-${slug}-${shortId}.md`;
  return path.join(outputDir, project, fileName);
}

function writeSessionMarkdown(session, outputDir, options) {
  if (!outputDir) {
    throw new Error("An output directory is required.");
  }
  if (!session || !Array.isArray(session.turns) || session.turns.length === 0) {
    return { status: "empty", outputPath: null, changed: false };
  }

  const outputPath = buildOutputPath(session, outputDir);
  const content = renderSessionMarkdown(session, options);
  const existedBeforeWrite = fs.existsSync(outputPath);
  ensureDirectory(path.dirname(outputPath));

  if (existedBeforeWrite) {
    const existing = fs.readFileSync(outputPath, "utf8");
    if (existing === content) {
      return { status: "unchanged", outputPath, changed: false };
    }
  }

  writeTextFileAtomic(outputPath, content);
  return {
    status: existedBeforeWrite ? "updated" : "created",
    outputPath,
    changed: true,
  };
}

function convertTranscriptFile(transcriptPath, options) {
  const session = parseRolloutTranscript({
    transcriptPath,
    includeToolSummaries: options.includeToolSummaries,
    debug: options.debug,
  });
  const writeResult = writeSessionMarkdown(session, options.outputDir, options);
  return {
    transcriptPath,
    session,
    warnings: session.warnings,
    outputPath: writeResult.outputPath,
    status: writeResult.status,
    changed: writeResult.changed,
  };
}

function walkFiles(dirPath, predicate, result) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch (error) {
    return result;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (error) {
      continue;
    }
    if (stat.isDirectory()) {
      walkFiles(fullPath, predicate, result);
    } else if (predicate(fullPath)) {
      result.push(fullPath);
    }
  }

  return result;
}

function listTranscriptPaths(sessionsDir) {
  const result = walkFiles(
    sessionsDir,
    function matchRollout(filePath) {
      return /^rollout-.*\.jsonl$/i.test(path.basename(filePath));
    },
    []
  );
  result.sort();
  return result;
}

function peekSessionMeta(transcriptPath) {
  const fd = fs.openSync(transcriptPath, "r");
  const buffer = Buffer.alloc(65536);
  const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);

  const text = buffer.toString("utf8", 0, bytesRead);
  const lines = text.split(/\n/);
  const meta = {
    sessionId: transcriptSessionIdFromFilename(transcriptPath),
    cwd: null,
    timestamp: null,
  };

  for (const line of lines) {
    if (!line || !line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record.type === "session_meta") {
        const payload = record.payload || {};
        meta.sessionId = payload.id || meta.sessionId;
        meta.cwd = payload.cwd || meta.cwd;
        meta.timestamp = payload.timestamp || record.timestamp || meta.timestamp;
        break;
      }
    } catch (error) {
      continue;
    }
  }

  return meta;
}

function findTranscriptPathForSession(sessionId, sessionsDir) {
  const transcripts = listTranscriptPaths(sessionsDir);

  for (const transcriptPath of transcripts) {
    if (transcriptSessionIdFromFilename(transcriptPath) === sessionId) {
      return transcriptPath;
    }
  }

  for (const transcriptPath of transcripts) {
    if (peekSessionMeta(transcriptPath).sessionId === sessionId) {
      return transcriptPath;
    }
  }

  return null;
}

function convertAllTranscripts(options) {
  const results = [];
  const transcripts = listTranscriptPaths(options.sessionsDir);

  for (const transcriptPath of transcripts) {
    try {
      results.push(convertTranscriptFile(transcriptPath, options));
    } catch (error) {
      results.push({
        transcriptPath,
        session: null,
        warnings: [
          {
            line: null,
            type: "conversion_error",
            message: error.message,
          },
        ],
        outputPath: null,
        status: "error",
        changed: false,
        error: error.message,
      });
    }
  }

  return results;
}

function cwdToProject(cwd) {
  return deriveProjectName(cwd);
}

function extractCompatibleTurnsFromMarkdown(markdown) {
  const sections = String(markdown || "").split(/^(?=## )/m);
  const compatible = [];

  for (const section of sections) {
    const match = /^(## (User|Claude|Codex|System))\n\n([\s\S]*)$/m.exec(section);
    if (!match) continue;

    const heading = match[1];
    const body = stripSystemTags(match[3] || "");
    if (!body) continue;
    compatible.push(`${heading}\n\n${body}\n`);
  }

  return compatible;
}

function qmdExecFile(args, options) {
  return cp.execFileSync("qmd", args, Object.assign({
    encoding: "utf8",
    timeout: 10000,
  }, options || {}));
}

function parseQmdDocumentUris(output, collectionName) {
  const matches = String(output || "").match(/qmd:\/\/[^\s)]+\.md\b/g) || [];
  const allowedPrefix = collectionName ? `qmd://${collectionName}/` : null;
  const seen = new Set();
  const uris = [];

  for (const match of matches) {
    if (allowedPrefix && !match.startsWith(allowedPrefix)) continue;
    if (seen.has(match)) continue;
    seen.add(match);
    uris.push(match);
  }

  return uris;
}

function qmdListUris(collectionName, subpath) {
  if (!collectionName) return [];

  const target = subpath ? `${collectionName}/${subpath}` : collectionName;
  try {
    return parseQmdDocumentUris(qmdExecFile(["ls", target]), collectionName);
  } catch (error) {
    return [];
  }
}

function qmdSearchUris(collectionName, query, limit) {
  if (!collectionName || !query) return [];

  try {
    return parseQmdDocumentUris(
      qmdExecFile([
        "search",
        query,
        "-c",
        collectionName,
        "--files",
        "-n",
        String(limit || 24),
      ]),
      collectionName
    );
  } catch (error) {
    return [];
  }
}

function qmdGetDocument(uri) {
  try {
    return qmdExecFile(["get", uri], { timeout: 15000 });
  } catch (error) {
    return "";
  }
}

function collectRecentTurnsFromFiles(outputDir, cwd, turnsLimit, charsLimit) {
  if (!outputDir) return null;
  const markdownFiles = walkFiles(
    outputDir,
    function matchMarkdown(filePath) {
      return filePath.endsWith(".md");
    },
    []
  );

  if (markdownFiles.length === 0) return null;

  const project = cwdToProject(cwd);
  const projectPrefix = project ? path.join(outputDir, project) + path.sep : null;
  const currentProject = [];
  const otherProjects = [];

  for (const filePath of markdownFiles) {
    if (projectPrefix && filePath.startsWith(projectPrefix)) {
      currentProject.push(filePath);
    } else {
      otherProjects.push(filePath);
    }
  }

  currentProject.sort().reverse();
  otherProjects.sort().reverse();

  const orderedFiles = currentProject.concat(otherProjects);
  const collected = [];
  let totalChars = 0;
  let sessionsUsed = 0;

  for (const filePath of orderedFiles) {
    if (collected.length >= turnsLimit || totalChars >= charsLimit) break;

    const fileTurns = extractCompatibleTurnsFromMarkdown(fs.readFileSync(filePath, "utf8"));
    if (fileTurns.length === 0) continue;

    let added = 0;
    for (let index = fileTurns.length - 1; index >= 0; index--) {
      const turn = fileTurns[index];
      if (collected.length >= turnsLimit) break;
      if (totalChars + turn.length > charsLimit && collected.length > 0) break;
      collected.unshift(turn);
      totalChars += turn.length;
      added += 1;
    }

    if (added > 0) sessionsUsed += 1;
  }

  if (collected.length === 0) return null;

  const exchanges = Math.floor(collected.length / 2);
  return `[Context restored: ~${exchanges} exchanges from ${sessionsUsed} session${sessionsUsed === 1 ? "" : "s"}]\n\n${collected.join("\n")}`;
}

function collectRecentTurnsFromQmd(collectionName, cwd, turnsLimit, charsLimit) {
  if (!collectionName || !qmdAvailable() || !qmdCollectionExists(collectionName)) {
    return null;
  }

  const project = cwdToProject(cwd);
  const candidateUris = [];
  const seen = new Set();

  function appendUris(uris) {
    const ordered = uris.slice().sort().reverse();
    for (const uri of ordered) {
      if (seen.has(uri)) continue;
      seen.add(uri);
      candidateUris.push(uri);
    }
  }

  if (project) {
    appendUris(qmdListUris(collectionName, project));
  }

  if (candidateUris.length === 0 && project) {
    appendUris(qmdSearchUris(collectionName, project.replace(/-/g, " "), 24));
  }

  if (candidateUris.length === 0) {
    appendUris(qmdListUris(collectionName));
  }

  if (candidateUris.length === 0) {
    return null;
  }

  const collected = [];
  let totalChars = 0;
  let sessionsUsed = 0;

  for (const uri of candidateUris) {
    if (collected.length >= turnsLimit || totalChars >= charsLimit) break;

    const markdown = qmdGetDocument(uri);
    if (!markdown) continue;

    const fileTurns = extractCompatibleTurnsFromMarkdown(markdown);
    if (fileTurns.length === 0) continue;

    let added = 0;
    for (let index = fileTurns.length - 1; index >= 0; index--) {
      const turn = fileTurns[index];
      if (collected.length >= turnsLimit) break;
      if (totalChars + turn.length > charsLimit && collected.length > 0) break;
      collected.unshift(turn);
      totalChars += turn.length;
      added += 1;
    }

    if (added > 0) {
      sessionsUsed += 1;
    }
  }

  if (collected.length === 0) {
    return null;
  }

  const exchanges = Math.floor(collected.length / 2);
  return `[Context restored via QMD: ~${exchanges} exchanges from ${sessionsUsed} session${sessionsUsed === 1 ? "" : "s"}]\n\n${collected.join("\n")}`;
}

function collectRecentTurns(outputDir, cwd, maxTurns, maxChars, options) {
  const turnsLimit = Number(maxTurns || DEFAULT_CONFIG.maxTurns);
  const charsLimit = Number(maxChars || DEFAULT_CONFIG.maxContextChars);
  const settings = options && typeof options === "object" ? options : {};
  const collectionName = settings.qmdCollectionName || DEFAULT_CONFIG.qmdCollectionName;

  const qmdContext = collectRecentTurnsFromQmd(
    collectionName,
    cwd,
    turnsLimit,
    charsLimit
  );
  if (qmdContext) {
    return qmdContext;
  }

  return collectRecentTurnsFromFiles(outputDir, cwd, turnsLimit, charsLimit);
}

function loadContextFiles(contextFiles, cwd) {
  if (!Array.isArray(contextFiles) || contextFiles.length === 0) return [];

  const loaded = [];

  for (const fileTemplate of contextFiles) {
    const resolved = resolveContextFile(fileTemplate, cwd);
    if (!resolved) continue;

    try {
      const content = fs.readFileSync(resolved, "utf8").trim();
      if (!content) continue;
      loaded.push(`# ${path.basename(resolved)}\n\n${content}`);
    } catch (error) {
      continue;
    }
  }

  return loaded;
}

function qmdAvailable() {
  try {
    cp.execSync("which qmd", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch (error) {
    return false;
  }
}

function listQmdCollections() {
  try {
    return cp.execSync("qmd collection list", {
      encoding: "utf8",
      timeout: 10000,
    });
  } catch (error) {
    return "";
  }
}

function qmdCollectionExists(collectionName) {
  if (!collectionName) return true;
  const output = listQmdCollections();
  const matcher = new RegExp(`^${escapeRegExp(collectionName)}\\s+\\(qmd://`, "m");
  return matcher.test(output);
}

function isEmbedRunning() {
  try {
    cp.execSync('pgrep -f "qmd.*embed"', {
      stdio: "ignore",
      timeout: 5000,
    });
    return true;
  } catch (error) {
    return false;
  }
}

function readState(statePath) {
  try {
    return readJsonFile(statePath);
  } catch (error) {
    return {};
  }
}

function writeState(statePath, state) {
  ensureDirectory(path.dirname(statePath));
  writeTextFileAtomic(statePath, JSON.stringify(state, null, 2) + "\n");
}

function runQmdUpdateAndEmbed(config, options) {
  if (!qmdAvailable()) {
    return { status: "unavailable" };
  }

  if (!qmdCollectionExists(config.qmdCollectionName)) {
    return {
      status: "missing_collection",
      collectionName: config.qmdCollectionName,
    };
  }

  const statePath = config.statePath || DEFAULT_STATE_PATH;
  const now = Date.now();
  const minSeconds = Number(config.minSecondsBetweenEmbeds || 0);
  const state = readState(statePath);
  const lastRunAt = state.lastRunAt ? Date.parse(state.lastRunAt) : 0;

  if (!options.force && minSeconds > 0 && lastRunAt && now - lastRunAt < minSeconds * 1000) {
    return {
      status: "throttled",
      secondsRemaining: Math.ceil((minSeconds * 1000 - (now - lastRunAt)) / 1000),
    };
  }

  try {
    cp.execSync("qmd update", {
      stdio: "ignore",
      timeout: 120000,
    });
  } catch (error) {
    return {
      status: "update_failed",
      message: error.message,
    };
  }

  let embedStatus = "skipped";
  if (config.enableEmbed !== false) {
    if (isEmbedRunning()) {
      embedStatus = "already_running";
    } else {
      try {
        cp.execSync("qmd embed", {
          stdio: "ignore",
          timeout: 120000,
        });
        embedStatus = "completed";
      } catch (error) {
        return {
          status: "embed_failed",
          message: error.message,
        };
      }
    }
  }

  writeState(statePath, {
    lastRunAt: new Date(now).toISOString(),
  });

  return {
    status: "updated",
    embedStatus,
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_USER_CONFIG_PATH,
  DEFAULT_SESSIONS_DIR,
  buildOutputPath,
  collectRecentTurns,
  convertAllTranscripts,
  convertTranscriptFile,
  dateFromTranscriptPath,
  deriveProjectName,
  extractCompatibleTurnsFromMarkdown,
  findTranscriptPathForSession,
  listTranscriptPaths,
  loadContextFiles,
  parseRolloutTranscript,
  qmdAvailable,
  qmdCollectionExists,
  readConfig,
  renderSessionMarkdown,
  runQmdUpdateAndEmbed,
  validateConfig,
};
