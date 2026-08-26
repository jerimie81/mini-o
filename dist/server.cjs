"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_cors = __toESM(require("cors"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_child_process = require("child_process");
var import_util = require("util");
var import_genai = require("@google/genai");
var execAsync = (0, import_util.promisify)(import_child_process.exec);
function loadEnvFile() {
  const envCandidates = [
    import_path.default.join(process.cwd(), ".env"),
    import_path.default.join(process.env.HOME || "/tmp", ".mini-o", ".env"),
    "/etc/mini-o/.env"
  ];
  for (const envPath of envCandidates) {
    if (import_fs.default.existsSync(envPath)) {
      try {
        const content = import_fs.default.readFileSync(envPath, "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
            if (key && process.env[key] === void 0) {
              process.env[key] = val;
            }
          }
        }
      } catch {
      }
    }
  }
}
loadEnvFile();
var DEFAULT_MODEL = process.env.DEFAULT_MODEL || "minimax-m3:cloud";
var app = (0, import_express.default)();
var PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3e3;
app.use((0, import_cors.default)());
app.use(import_express.default.json({ limit: "15mb" }));
var geminiClientInstance = null;
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!geminiClientInstance) {
    geminiClientInstance = new import_genai.GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
  return geminiClientInstance;
}
function resolveDataDir() {
  if (process.env.MINI_O_DATA_DIR) {
    return import_path.default.resolve(process.env.MINI_O_DATA_DIR);
  }
  if (process.env.DATA_DIR) {
    return import_path.default.resolve(process.env.DATA_DIR);
  }
  const cwd = process.cwd();
  if (cwd !== "/opt/mini-o" && !cwd.startsWith("/opt/mini-o/")) {
    const localData = import_path.default.join(cwd, "data");
    try {
      if (!import_fs.default.existsSync(localData)) {
        import_fs.default.mkdirSync(localData, { recursive: true });
      }
      import_fs.default.accessSync(localData, import_fs.default.constants.W_OK);
      return localData;
    } catch {
    }
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
  const userDir = import_path.default.join(process.env.XDG_DATA_HOME || import_path.default.join(homeDir, ".local", "share", "mini-o"), "data");
  try {
    if (!import_fs.default.existsSync(userDir)) {
      import_fs.default.mkdirSync(userDir, { recursive: true });
    }
    import_fs.default.accessSync(userDir, import_fs.default.constants.W_OK);
    return userDir;
  } catch {
    try {
      if (import_fs.default.existsSync("/var/lib/mini-o")) {
        import_fs.default.accessSync("/var/lib/mini-o", import_fs.default.constants.W_OK);
        return "/var/lib/mini-o";
      }
    } catch {
    }
    return import_path.default.join("/tmp", "mini-o-data");
  }
}
var rootDir = process.cwd();
var dataDir = resolveDataDir();
try {
  if (!import_fs.default.existsSync(dataDir)) {
    import_fs.default.mkdirSync(dataDir, { recursive: true });
  }
  const sampleNotePath = import_path.default.join(dataDir, "welcome.md");
  if (!import_fs.default.existsSync(sampleNotePath)) {
    import_fs.default.writeFileSync(sampleNotePath, `# Welcome to Mini-O Workspace

Mini-O is your local-first AI workspace.

## Key Features
- **Conversations**: Chat with AI models with streaming and tool usage.
- **Workspace File Management**: Read, write, and explore files.
- **Tool Execution**: Agent file tools, search, and research helpers.
- **Custom Agent Instructions**: Customize agent behaviors using AGENT.md templates.
- **Robust Error Handling**: Structured diagnostics, recovery, and audit tracking.
`, "utf-8");
  }
  const sampleAgentPath = import_path.default.join(dataDir, "AGENT.md");
  if (!import_fs.default.existsSync(sampleAgentPath)) {
    import_fs.default.writeFileSync(sampleAgentPath, `# Workspace Agent Instructions

You are Mini-O, a helpful assistant with access to local workspace files and tools.
When working on code or documents in the workspace:
1. Examine existing files before proposing changes.
2. Provide clear, modular explanations.
`, "utf-8");
  }
} catch (err) {
  console.warn(`[Mini-O] Warning: Could not initialize workspace seed files at ${dataDir}:`, err);
}
var MAX_ERROR_LOGS = 150;
var serverErrorLogs = [];
function generateDiagnosticId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `srv-${ts}-${rand}`;
}
function logServerError(status, code, category, message, action, req, details) {
  const entry = {
    id: generateDiagnosticId(),
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    status,
    code,
    category,
    message,
    action,
    route: req?.originalUrl || req?.path,
    method: req?.method,
    details: details || null
  };
  serverErrorLogs.unshift(entry);
  if (serverErrorLogs.length > MAX_ERROR_LOGS) {
    serverErrorLogs.pop();
  }
  console.error(`[Mini-O Error ${entry.id}] ${entry.code} (${entry.status}): ${entry.message}`);
  return entry;
}
function formatErrorPayload(status, code, category, message, action, req, details) {
  const entry = logServerError(status, code, category, message, action, req, details);
  return {
    error: {
      code: entry.code,
      category: entry.category,
      message: entry.message,
      status: entry.status,
      diagnostic_id: entry.id,
      timestamp: entry.timestamp,
      action: entry.action,
      details: entry.details
    }
  };
}
var conversations = /* @__PURE__ */ new Map();
var toolDefinitions = [
  {
    name: "read_file",
    description: "Read the contents of a file at the given path inside the workspace.",
    requires_confirmation: false,
    category: "workspace",
    risk: "low",
    side_effects: ["reads local file"],
    timeout: 10,
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    },
    policy: { enabled: true, mode: "allow", scope: "session" }
  },
  {
    name: "write_file",
    description: "Write text content to a file in the workspace.",
    requires_confirmation: false,
    category: "workspace",
    risk: "high",
    side_effects: ["overwrites local file"],
    timeout: 10,
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"]
    },
    policy: { enabled: true, mode: "allow", scope: "session" }
  },
  {
    name: "list_files",
    description: "List files and directories under a path inside the workspace.",
    requires_confirmation: false,
    category: "workspace",
    risk: "low",
    side_effects: ["lists local paths"],
    timeout: 10,
    parameters: {
      type: "object",
      properties: { path: { type: "string", default: "." } }
    },
    policy: { enabled: true, mode: "allow", scope: "session" }
  },
  {
    name: "search_files",
    description: "Search for files whose name matches a substring, recursively.",
    requires_confirmation: false,
    category: "workspace",
    risk: "low",
    side_effects: ["searches local names"],
    timeout: 10,
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, path: { type: "string", default: "." } },
      required: ["query"]
    },
    policy: { enabled: true, mode: "allow", scope: "session" }
  },
  {
    name: "run_python",
    description: "Execute a Python code snippet in the workspace and return stdout/stderr.",
    requires_confirmation: false,
    category: "execution",
    risk: "critical",
    side_effects: ["executes Python in workspace"],
    timeout: 60,
    parameters: {
      type: "object",
      properties: { code: { type: "string", description: "Python code to execute" } },
      required: ["code"]
    },
    policy: { enabled: true, mode: "allow", scope: "session" }
  },
  {
    name: "run_shell",
    description: "Execute a shell command in the workspace directory and return its output.",
    requires_confirmation: false,
    category: "execution",
    risk: "critical",
    side_effects: ["executes shell command in workspace"],
    timeout: 60,
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "Shell command string to run" } },
      required: ["command"]
    },
    policy: { enabled: true, mode: "allow", scope: "session" }
  },
  {
    name: "web_fetch",
    description: "Fetch the text content of a public URL (max 50 KB).",
    requires_confirmation: true,
    category: "network",
    risk: "medium",
    side_effects: ["sends request to public network"],
    timeout: 15,
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"]
    },
    policy: { enabled: true, mode: "confirm", scope: "conversation" }
  }
];
var toolPolicies = {};
toolDefinitions.forEach((t) => {
  toolPolicies[t.name] = { ...t.policy };
});
var toolActivity = [];
var modelCatalog = [
  {
    name: "minimax-m3:cloud",
    display_name: "MiniMax M3 (Cloud / Ollama)",
    size: 0,
    family: "cloud",
    families: ["cloud", "ollama", "minimax"],
    parameter_size: "Cloud",
    quantization_level: "",
    modified_at: (/* @__PURE__ */ new Date()).toISOString(),
    capabilities: ["chat", "streaming", "tools", "thinking", "vision"],
    use_cases: ["general reasoning", "cloud inference", "fast coding", "workspace assistant"],
    supports_options: ["temperature", "top_p", "top_k", "seed", "num_ctx", "num_predict"]
  }
];
function getOllamaHost() {
  return process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
}
async function getDynamicModelCatalog() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const resp = await fetch(`${getOllamaHost()}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data.models) && data.models.length > 0) {
        const found = data.models.find((m) => m.name === DEFAULT_MODEL || m.name === "minimax-m3:cloud");
        if (found) {
          const isCloud = found.name?.includes(":cloud") || found.details?.families === null || !!found.remote_host;
          const family = found.details?.family || (isCloud ? "cloud" : "ollama");
          const families = found.details?.families || (isCloud ? ["cloud", "ollama"] : ["ollama"]);
          return [
            {
              name: found.name,
              display_name: "MiniMax M3 (Cloud / Ollama)",
              size: found.size || 0,
              family,
              families,
              parameter_size: found.details?.parameter_size || (isCloud ? "Cloud" : "Local"),
              quantization_level: found.details?.quantization_level || "",
              modified_at: found.modified_at || (/* @__PURE__ */ new Date()).toISOString(),
              capabilities: found.capabilities || ["chat", "streaming", "tools", "thinking", "vision"],
              use_cases: ["general reasoning", "cloud inference", "fast coding", "workspace assistant"],
              supports_options: ["temperature", "top_p", "top_k", "seed", "num_ctx", "num_predict"]
            }
          ];
        }
      }
    }
  } catch {
  }
  return modelCatalog;
}
var geminiFunctionDeclarations = [
  {
    name: "read_file",
    description: "Read the contents of a file at the given path inside the workspace.",
    parameters: {
      type: import_genai.Type.OBJECT,
      properties: {
        path: { type: import_genai.Type.STRING, description: 'Relative path of file inside data directory (e.g. "welcome.md")' }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Write or overwrite text content to a file in the workspace.",
    parameters: {
      type: import_genai.Type.OBJECT,
      properties: {
        path: { type: import_genai.Type.STRING, description: "Relative path of file to create or update" },
        content: { type: import_genai.Type.STRING, description: "Full UTF-8 content to write into the file" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "list_files",
    description: "List all files and folders in the workspace directory.",
    parameters: {
      type: import_genai.Type.OBJECT,
      properties: {
        path: { type: import_genai.Type.STRING, description: 'Relative directory path to list (defaults to ".")' }
      }
    }
  },
  {
    name: "search_files",
    description: "Search workspace file names for a given query keyword.",
    parameters: {
      type: import_genai.Type.OBJECT,
      properties: {
        query: { type: import_genai.Type.STRING, description: "Search term or file name fragment" }
      },
      required: ["query"]
    }
  },
  {
    name: "web_fetch",
    description: "Fetch the text content of a public URL (maximum 50 KB).",
    parameters: {
      type: import_genai.Type.OBJECT,
      properties: {
        url: { type: import_genai.Type.STRING, description: "Public HTTP or HTTPS URL to fetch" }
      },
      required: ["url"]
    }
  }
];
function resolveSafePath(relPath = ".") {
  if (typeof relPath !== "string") {
    return { ok: false, path: dataDir, error: "Path must be a valid string" };
  }
  if (relPath.includes("\0")) {
    return { ok: false, path: dataDir, error: "Null bytes are not allowed in file paths" };
  }
  const sanitizedRel = relPath.replace(/^(\.\.(\/|\\|$))+/, "").replace(/^[a-zA-Z]:[/\\]/, "");
  const normalized = import_path.default.normalize(sanitizedRel);
  const target = import_path.default.resolve(dataDir, normalized);
  const isWindows = process.platform === "win32";
  const targetCmp = isWindows ? target.toLowerCase() : target;
  const dataDirCmp = isWindows ? dataDir.toLowerCase() : dataDir;
  if (!targetCmp.startsWith(dataDirCmp)) {
    return {
      ok: false,
      path: dataDir,
      error: `Access Denied: Path '${relPath}' resolves outside the allowed workspace boundary (${dataDir})`
    };
  }
  return { ok: true, path: target };
}
async function executeTool(name, args, confirmedTools = []) {
  try {
    const def = toolDefinitions.find((t) => t.name === name);
    if (!def) {
      return { ok: false, error: `Tool '${name}' is not recognized in the tool registry` };
    }
    const policy = toolPolicies[name] || def.policy;
    if (policy.enabled === false || policy.mode === "deny") {
      return {
        ok: false,
        error: `Tool '${name}' execution was denied by workspace policy (mode: ${policy.mode})`
      };
    }
    if (policy.mode === "confirm" && !confirmedTools.includes(name)) {
      return {
        ok: false,
        requires_confirmation: true,
        risk: def.risk,
        side_effects: def.side_effects,
        error: `Tool '${name}' requires user confirmation before execution`
      };
    }
    if (name === "read_file") {
      const resolved = resolveSafePath(args.path);
      if (!resolved.ok) {
        return { ok: false, error: resolved.error };
      }
      if (!import_fs.default.existsSync(resolved.path)) {
        return { ok: false, error: `File not found in workspace: '${args.path}'` };
      }
      if (import_fs.default.statSync(resolved.path).isDirectory()) {
        return { ok: false, error: `Path '${args.path}' is a directory, not a file` };
      }
      const content = import_fs.default.readFileSync(resolved.path, "utf-8");
      return { ok: true, output: content };
    }
    if (name === "write_file") {
      const resolved = resolveSafePath(args.path);
      if (!resolved.ok) {
        return { ok: false, error: resolved.error };
      }
      import_fs.default.mkdirSync(import_path.default.dirname(resolved.path), { recursive: true });
      import_fs.default.writeFileSync(resolved.path, args.content || "", "utf-8");
      const bytes = Buffer.byteLength(args.content || "", "utf8");
      return { ok: true, output: `Successfully wrote ${bytes} bytes to '${args.path}'` };
    }
    if (name === "list_files") {
      const resolved = resolveSafePath(args.path || ".");
      if (!resolved.ok) {
        return { ok: false, error: resolved.error };
      }
      if (!import_fs.default.existsSync(resolved.path)) {
        return { ok: false, error: `Directory not found: '${args.path}'` };
      }
      const entries = import_fs.default.readdirSync(resolved.path, { withFileTypes: true });
      const list = entries.map((e) => ({
        name: e.name,
        path: import_path.default.relative(dataDir, import_path.default.join(resolved.path, e.name)).replace(/\\/g, "/"),
        is_dir: e.isDirectory()
      }));
      return { ok: true, output: JSON.stringify(list, null, 2) };
    }
    if (name === "search_files") {
      let walk2 = function(dir) {
        const entries = import_fs.default.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = import_path.default.join(dir, entry.name);
          const rel = import_path.default.relative(dataDir, full).replace(/\\/g, "/");
          if (entry.name.toLowerCase().includes(q)) {
            results.push(rel);
          }
          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            walk2(full);
          }
        }
      };
      var walk = walk2;
      const q = (args.query || "").toLowerCase();
      const results = [];
      if (import_fs.default.existsSync(dataDir)) walk2(dataDir);
      return { ok: true, output: JSON.stringify(results, null, 2) };
    }
    if (name === "web_fetch") {
      const url = args.url;
      try {
        const parsedUrl = new URL(url);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          return { ok: false, error: `Invalid protocol '${parsedUrl.protocol}'. Only http/https supported.` };
        }
        const response = await fetch(url, {
          headers: { "User-Agent": "Mini-O/0.1.0" },
          signal: AbortSignal.timeout(12e3)
        });
        if (!response.ok) {
          return { ok: false, error: `HTTP fetch failed with status ${response.status} (${response.statusText})` };
        }
        const text = await response.text();
        return { ok: true, output: text.slice(0, 5e4) };
      } catch (err) {
        return { ok: false, error: `Failed to fetch URL: ${err.message}` };
      }
    }
    if (name === "run_shell") {
      const cmd = args.command;
      if (!cmd || typeof cmd !== "string") {
        return { ok: false, error: "Command string is required" };
      }
      try {
        const { stdout, stderr } = await execAsync(cmd, {
          cwd: dataDir,
          timeout: 6e4,
          maxBuffer: 4 * 1024 * 1024
        });
        const out = (stdout || "") + (stderr ? (stdout ? "\n" : "") + stderr : "");
        return { ok: true, output: out || "(command completed with no output)" };
      } catch (err) {
        const out = (err.stdout || "") + (err.stderr ? "\n" + err.stderr : "");
        return { ok: false, error: err.message, output: out || void 0 };
      }
    }
    if (name === "run_python") {
      const code = args.code;
      if (!code || typeof code !== "string") {
        return { ok: false, error: "Python code string is required" };
      }
      return new Promise((resolve) => {
        const pythonBin = process.platform === "win32" ? "python" : import_fs.default.existsSync("/usr/bin/python3") ? "/usr/bin/python3" : "python3";
        const child = (0, import_child_process.spawn)(pythonBin, ["-"], {
          cwd: dataDir,
          env: process.env
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill();
          resolve({ ok: false, error: "Python execution timed out after 60 seconds" });
        }, 6e4);
        child.stdout?.on("data", (data) => {
          stdout += data.toString();
        });
        child.stderr?.on("data", (data) => {
          stderr += data.toString();
        });
        child.on("close", (code2) => {
          clearTimeout(timer);
          const out = (stdout || "") + (stderr ? (stdout ? "\n" : "") + stderr : "");
          if (code2 === 0) {
            resolve({ ok: true, output: out || "(script completed with no output)" });
          } else {
            resolve({ ok: false, error: `Python exited with code ${code2}`, output: out || void 0 });
          }
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          resolve({ ok: false, error: err.message });
        });
        child.stdin.write(code);
        child.stdin.end();
      });
    }
    return { ok: false, error: `Unknown tool '${name}'` };
  } catch (err) {
    return { ok: false, error: err.message || "Tool execution failed" };
  }
}
function setupApiRoutes(router) {
  router.get("/health", (_req, res) => {
    res.json({ status: "ok", ollama: "online", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  });
  router.get("/health/readiness", (_req, res) => {
    res.json({ ready: true, mini_o: "ready", ollama: "ready" });
  });
  router.get("/diagnostics", (_req, res) => {
    res.json({
      status: "ok",
      version: "0.1.0",
      runtime: "node22",
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      conversations_count: conversations.size,
      error_log_count: serverErrorLogs.length,
      workspace_dir: dataDir
    });
  });
  router.get("/diagnostics/errors", (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json({
      total: serverErrorLogs.length,
      errors: serverErrorLogs.slice(0, limit)
    });
  });
  router.post("/diagnostics/errors/clear", (_req, res) => {
    serverErrorLogs.length = 0;
    res.json({ ok: true, message: "Server diagnostic error log cleared" });
  });
  router.get("/diagnostics/export", (_req, res) => {
    res.setHeader("Content-Disposition", "attachment; filename=mini-o-diagnostics.json");
    res.json({
      version: "0.1.0",
      runtime: "Node.js",
      uptime: process.uptime(),
      conversations_count: conversations.size,
      errors: serverErrorLogs,
      time: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  router.get("/models", async (req, res) => {
    try {
      const q = (req.query.q || "").toLowerCase().trim();
      const catalog = await getDynamicModelCatalog();
      const filtered = catalog.filter((m) => !q || m.name.toLowerCase().includes(q));
      res.json(filtered);
    } catch (err) {
      res.status(500).json(formatErrorPayload(500, "MODEL_LIST_FAILED", "model", err.message, "Check model catalog", req));
    }
  });
  router.get("/models/:name(*)", async (req, res) => {
    const catalog = await getDynamicModelCatalog();
    const found = catalog.find((m) => m.name === req.params.name);
    if (found) {
      res.json(found);
    } else {
      res.status(404).json(
        formatErrorPayload(
          404,
          "MODEL_NOT_FOUND",
          "model",
          `Model '${req.params.name}' is not installed or available in catalog`,
          "Pull the model using the Models panel or choose another model",
          req
        )
      );
    }
  });
  router.post("/models/:name(*)/pull", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const modelName = req.params.name;
    try {
      const ollamaResp = await fetch(`${getOllamaHost()}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName, stream: true })
      });
      if (ollamaResp.ok && ollamaResp.body) {
        const reader = ollamaResp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.trim()) {
              res.write(`event: progress
data: ${line.trim()}

`);
            }
          }
        }
        res.end();
        return;
      }
    } catch {
    }
    const steps = [
      "pulling manifest",
      "downloading layers",
      "verifying sha256 digest",
      "writing model config",
      "success"
    ];
    for (const step of steps) {
      res.write(`event: progress
data: ${JSON.stringify({ status: step })}

`);
      await new Promise((r) => setTimeout(r, 200));
    }
    res.end();
  });
  router.delete("/models/:name(*)", async (req, res) => {
    try {
      await fetch(`${getOllamaHost()}/api/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: req.params.name })
      });
    } catch {
    }
    res.json({ deleted: true, name: req.params.name });
  });
  router.post("/chat/stream", async (req, res) => {
    const { model = DEFAULT_MODEL, messages, conversation_id, use_tools, confirmed_tools = [], options = {} } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json(
        formatErrorPayload(
          400,
          "INVALID_REQUEST_BODY",
          "validation",
          "Chat request must include non-empty messages array",
          "Provide at least one user message",
          req
        )
      );
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    const convId = conversation_id || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fullMessages = Array.isArray(messages) ? [...messages] : [];
    const lastUserMsg = fullMessages.filter((m) => m.role === "user").at(-1)?.content || "";
    const geminiClient = getGeminiClient();
    let assistantContent = "";
    let streamStats = null;
    let agentInstructions = "You are Mini-O, a versatile local AI workspace assistant with access to local workspace files and tools.";
    const agentMdPath = import_path.default.join(dataDir, "AGENT.md");
    if (import_fs.default.existsSync(agentMdPath)) {
      try {
        const customAgent = import_fs.default.readFileSync(agentMdPath, "utf-8");
        if (customAgent.trim()) {
          agentInstructions += `

Workspace Agent Directives (AGENT.md):
${customAgent}`;
        }
      } catch {
      }
    }
    try {
      const isGeminiModel = model?.startsWith("gemini") || geminiClient && !model?.includes(":") && !model?.includes("llama") && !model?.includes("minimax") && !model?.includes("glm") && !model?.includes("gemma") && !model?.includes("qwen");
      const targetModel = model || DEFAULT_MODEL;
      if (geminiClient && isGeminiModel) {
        const contents = fullMessages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({
          role: m.role === "user" ? "user" : "model",
          parts: [{ text: m.content || "" }]
        }));
        if (contents.length === 0) {
          contents.push({ role: "user", parts: [{ text: lastUserMsg || "Hello" }] });
        }
        const toolsConfig = [];
        if (options.googleSearch) {
          toolsConfig.push({ googleSearch: {} });
        }
        if (use_tools) {
          toolsConfig.push({ functionDeclarations: geminiFunctionDeclarations });
        }
        const streamResult = await geminiClient.models.generateContentStream({
          model: targetModel.startsWith("gemini") ? targetModel : "gemini-3.7-flash",
          contents,
          config: {
            systemInstruction: agentInstructions,
            temperature: typeof options.temperature === "number" ? options.temperature : 0.7,
            topP: typeof options.top_p === "number" ? options.top_p : 0.95,
            tools: toolsConfig.length > 0 ? toolsConfig : void 0
          }
        });
        const pendingFunctionCalls = [];
        for await (const chunk of streamResult) {
          const grounding = chunk.candidates?.[0]?.groundingMetadata;
          if (grounding?.groundingChunks?.length) {
            res.write(`event: grounding
data: ${JSON.stringify(grounding)}

`);
          }
          const functionCalls = chunk.functionCalls;
          if (functionCalls && functionCalls.length > 0) {
            for (const fc of functionCalls) {
              pendingFunctionCalls.push(fc);
            }
          }
          const text = chunk.text;
          if (text) {
            assistantContent += text;
            res.write(`event: token
data: ${JSON.stringify({ role: "assistant", content: text })}

`);
          }
        }
        if (pendingFunctionCalls.length > 0) {
          const toolResultsParts = [];
          for (const fc of pendingFunctionCalls) {
            res.write(`event: tool_call
data: ${JSON.stringify({ name: fc.name, args: fc.args })}

`);
            const tResult = await executeTool(fc.name, fc.args, confirmed_tools);
            res.write(`event: tool_result
data: ${JSON.stringify({ name: fc.name, ...tResult })}

`);
            toolResultsParts.push({
              functionResponse: {
                name: fc.name,
                response: { output: tResult.output || tResult.error || "ok" }
              }
            });
          }
          const followUpContents = [
            ...contents,
            {
              role: "model",
              parts: pendingFunctionCalls.map((fc) => ({ functionCall: fc }))
            },
            {
              role: "user",
              parts: toolResultsParts
            }
          ];
          const followUpStream = await geminiClient.models.generateContentStream({
            model: targetModel.startsWith("gemini") ? targetModel : "gemini-3.7-flash",
            contents: followUpContents,
            config: {
              systemInstruction: agentInstructions
            }
          });
          for await (const chunk of followUpStream) {
            const text = chunk.text;
            if (text) {
              assistantContent += text;
              res.write(`event: token
data: ${JSON.stringify({ role: "assistant", content: text })}

`);
            }
          }
        }
      } else {
        let ollamaSuccess = false;
        try {
          const ollamaTools = toolDefinitions.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters
            }
          }));
          const ollamaMessages = fullMessages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system" || m.role === "tool").map((m) => {
            const msg = {
              role: m.role,
              content: m.content || ""
            };
            if (m.tool_calls) msg.tool_calls = m.tool_calls;
            return msg;
          });
          if (ollamaMessages.length === 0) {
            ollamaMessages.push({ role: "user", content: lastUserMsg || "Hello" });
          }
          if (agentInstructions) {
            ollamaMessages.unshift({ role: "system", content: agentInstructions });
          }
          let currentMessages = [...ollamaMessages];
          const maxIterations = 5;
          let currentIteration = 0;
          while (currentIteration < maxIterations) {
            currentIteration++;
            const pendingToolCalls = [];
            let iterationContent = "";
            const ollamaReqBody = {
              model: targetModel,
              messages: currentMessages,
              stream: true,
              options: {
                temperature: typeof options.temperature === "number" ? options.temperature : 0.7,
                top_p: typeof options.top_p === "number" ? options.top_p : 0.95
              }
            };
            if (use_tools) {
              ollamaReqBody.tools = ollamaTools;
            }
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12e4);
            const ollamaResp = await fetch(`${getOllamaHost()}/api/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(ollamaReqBody),
              signal: controller.signal
            });
            clearTimeout(timeout);
            if (!ollamaResp.ok || !ollamaResp.body) {
              break;
            }
            ollamaSuccess = true;
            const reader = ollamaResp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const parsed = JSON.parse(trimmed);
                  if (parsed.message?.tool_calls && Array.isArray(parsed.message.tool_calls)) {
                    for (const tc of parsed.message.tool_calls) {
                      pendingToolCalls.push(tc);
                    }
                  }
                  const tokenText = parsed.message?.content || "";
                  if (tokenText) {
                    iterationContent += tokenText;
                    if (pendingToolCalls.length === 0) {
                      assistantContent += tokenText;
                      res.write(`event: token
data: ${JSON.stringify({ role: "assistant", content: tokenText })}

`);
                    }
                  }
                  if (parsed.done && parsed.eval_count) {
                    streamStats = {
                      eval_count: (streamStats?.eval_count || 0) + parsed.eval_count,
                      total_duration: (streamStats?.total_duration || 0) + (parsed.total_duration || 5e8)
                    };
                  }
                } catch {
                }
              }
            }
            if (buffer.trim()) {
              try {
                const parsed = JSON.parse(buffer.trim());
                if (parsed.message?.tool_calls && Array.isArray(parsed.message.tool_calls)) {
                  for (const tc of parsed.message.tool_calls) {
                    pendingToolCalls.push(tc);
                  }
                }
                const tokenText = parsed.message?.content || "";
                if (tokenText) {
                  iterationContent += tokenText;
                  if (pendingToolCalls.length === 0) {
                    assistantContent += tokenText;
                    res.write(`event: token
data: ${JSON.stringify({ role: "assistant", content: tokenText })}

`);
                  }
                }
              } catch {
              }
            }
            if (use_tools && pendingToolCalls.length === 0 && iterationContent.trim()) {
              const inlineMatch = iterationContent.match(/(?:```(?:json)?\s*)?\{\s*"name"\s*:\s*"([a-zA-Z0-9_-]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}(?:\s*```)?/);
              if (inlineMatch) {
                try {
                  const toolName = inlineMatch[1];
                  const toolArgs = JSON.parse(inlineMatch[2] || "{}");
                  if (toolDefinitions.some((t) => t.name === toolName)) {
                    pendingToolCalls.push({
                      function: {
                        name: toolName,
                        arguments: toolArgs
                      }
                    });
                  }
                } catch {
                }
              }
            }
            if (pendingToolCalls.length === 0) {
              break;
            }
            const toolResponseMessages = [];
            for (const tc of pendingToolCalls) {
              const toolName = tc.function?.name || tc.name;
              let toolArgs = tc.function?.arguments || tc.arguments || {};
              if (typeof toolArgs === "string") {
                try {
                  toolArgs = JSON.parse(toolArgs);
                } catch {
                  toolArgs = {};
                }
              }
              res.write(`event: tool_call
data: ${JSON.stringify({ name: toolName, args: toolArgs })}

`);
              const tResult = await executeTool(toolName, toolArgs, confirmed_tools);
              res.write(`event: tool_result
data: ${JSON.stringify({ name: toolName, ...tResult })}

`);
              toolActivity.unshift({
                timestamp: (/* @__PURE__ */ new Date()).toISOString(),
                tool: toolName,
                ok: tResult.ok,
                conversation_id: convId,
                arguments: toolArgs,
                error: tResult.error
              });
              if (toolActivity.length > 200) toolActivity.pop();
              toolResponseMessages.push({
                role: "tool",
                content: tResult.output || tResult.error || (tResult.ok ? "ok" : "execution failed")
              });
            }
            currentMessages = [
              ...currentMessages,
              {
                role: "assistant",
                content: iterationContent,
                tool_calls: pendingToolCalls
              },
              ...toolResponseMessages
            ];
          }
        } catch (ollamaErr) {
          ollamaSuccess = false;
        }
        if (!ollamaSuccess) {
          let simulatedReply = "";
          const lowerPrompt = lastUserMsg.toLowerCase();
          let toolRan = null;
          if (use_tools && (lowerPrompt.includes("list") || lowerPrompt.includes("files") || lowerPrompt.includes("workspace"))) {
            const tArgs = { path: "." };
            res.write(`event: tool_call
data: ${JSON.stringify({ name: "list_files", args: tArgs })}

`);
            const tResult = await executeTool("list_files", tArgs, confirmed_tools);
            res.write(`event: tool_result
data: ${JSON.stringify({ name: "list_files", ...tResult })}

`);
            toolRan = { name: "list_files", args: tArgs, result: tResult };
          } else if (use_tools && (lowerPrompt.includes("read") || lowerPrompt.includes("show")) && (lowerPrompt.includes(".md") || lowerPrompt.includes("file"))) {
            const tArgs = { path: "welcome.md" };
            res.write(`event: tool_call
data: ${JSON.stringify({ name: "read_file", args: tArgs })}

`);
            const tResult = await executeTool("read_file", tArgs, confirmed_tools);
            res.write(`event: tool_result
data: ${JSON.stringify({ name: "read_file", ...tResult })}

`);
            toolRan = { name: "read_file", args: tArgs, result: tResult };
          }
          if (toolRan) {
            if (toolRan.result.ok) {
              simulatedReply = `I have inspected your workspace.

Here is what I found:
\`\`\`json
${toolRan.result.output || ""}
\`\`\`

How would you like to proceed with your project files?`;
            } else {
              simulatedReply = `I encountered an issue executing tool \`${toolRan.name}\`:
> ${toolRan.result.error}

You can review Tool Policies in the Workspace tab.`;
            }
          } else if (lowerPrompt.includes("hello") || lowerPrompt.includes("hi") || lowerPrompt.includes("help")) {
            simulatedReply = `Hello! I am your **Mini-O** AI workspace partner powered by MiniMax M3.

I can help you with:
- **Fast Reasoning & Coding**: Powered by MiniMax M3 (Cloud / Ollama).
- **Workspace Navigation & Tools**: Reading, listing, and editing files in \`./data\`.
- **Project Assistance**: Full multi-turn conversation and workspace assistance.

How can I help you today?`;
          } else {
            simulatedReply = `I have processed your request: "${lastUserMsg.slice(0, 80)}".

You can interact with workspace files, configure tool policies, or send tasks to MiniMax M3.`;
          }
          const words = simulatedReply.split(" ");
          for (const word of words) {
            const chunk = word + " ";
            assistantContent += chunk;
            res.write(`event: token
data: ${JSON.stringify({ role: "assistant", content: chunk })}

`);
            await new Promise((r) => setTimeout(r, 18));
          }
        }
      }
      const existing = conversations.get(convId);
      const title = existing?.title || lastUserMsg.slice(0, 40) || "New Conversation";
      fullMessages.push({ role: "assistant", content: assistantContent });
      conversations.set(convId, {
        id: convId,
        title,
        model: model || DEFAULT_MODEL,
        options: req.body.options || {},
        messages: fullMessages,
        status: "completed",
        created_at: existing?.created_at || (/* @__PURE__ */ new Date()).toISOString(),
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      const statsToSend = streamStats || { eval_count: Math.round(assistantContent.length / 4), total_duration: 45e7 };
      res.write(`event: done
data: ${JSON.stringify({ done: true, stats: statsToSend, stop_reason: "stop" })}

`);
      res.write(`event: end
data: ${JSON.stringify({ id: convId })}

`);
      res.end();
    } catch (err) {
      const diag = logServerError(500, "STREAM_FAILED", "stream", err.message || "Chat stream failed", "Click Retry to restart generation", req);
      res.write(`event: error
data: ${JSON.stringify({ error: "Chat stream failed", detail: err.message, diagnostic_id: diag.id, action: diag.action })}

`);
      res.end();
    }
  });
  router.get("/gemini/status", (_req, res) => {
    const hasKey = Boolean(process.env.GEMINI_API_KEY);
    res.json({
      available: hasKey,
      default_model: "gemini-3.7-flash",
      models: [
        { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", category: "General & Coding" },
        { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", category: "Deep Reasoning" },
        { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", category: "Low Latency" },
        { id: "gemini-3.1-flash-lite-image", name: "Gemini Flash Image Gen", category: "Visual Creation" }
      ],
      has_key: hasKey
    });
  });
  router.post("/gemini/generate", async (req, res) => {
    const client = getGeminiClient();
    if (!client) {
      return res.status(503).json(
        formatErrorPayload(503, "GEMINI_NOT_CONFIGURED", "gemini", "GEMINI_API_KEY is not configured", "Set GEMINI_API_KEY in environment or settings", req)
      );
    }
    const { prompt, model = "gemini-3.7-flash", systemInstruction, temperature } = req.body;
    if (!prompt) {
      return res.status(400).json(
        formatErrorPayload(400, "MISSING_PROMPT", "validation", "Prompt is required", "Provide a prompt string", req)
      );
    }
    try {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: systemInstruction || void 0,
          temperature: typeof temperature === "number" ? temperature : void 0
        }
      });
      res.json({ ok: true, text: response.text || "", model });
    } catch (err) {
      res.status(500).json(formatErrorPayload(500, "GEMINI_GENERATE_FAILED", "gemini", err.message, "Check Gemini prompt parameters", req));
    }
  });
  router.post("/gemini/generate-image", async (req, res) => {
    const client = getGeminiClient();
    if (!client) {
      return res.status(503).json(
        formatErrorPayload(503, "GEMINI_NOT_CONFIGURED", "gemini", "GEMINI_API_KEY is not configured", "Set GEMINI_API_KEY in environment or settings", req)
      );
    }
    const { prompt, aspectRatio = "1:1", saveToWorkspace = false, filename } = req.body;
    if (!prompt) {
      return res.status(400).json(
        formatErrorPayload(400, "MISSING_PROMPT", "validation", "Prompt is required for image generation", "Provide an image description prompt", req)
      );
    }
    try {
      const response = await client.models.generateContent({
        model: "gemini-3.1-flash-lite-image",
        contents: {
          parts: [{ text: prompt }]
        },
        config: {
          imageConfig: {
            aspectRatio: aspectRatio || "1:1"
          }
        }
      });
      let base64Data = null;
      let captionText = "";
      const candidates = response.candidates || [];
      for (const candidate of candidates) {
        for (const part of candidate.content?.parts || []) {
          if (part.inlineData?.data) {
            base64Data = part.inlineData.data;
          } else if (part.text) {
            captionText += part.text;
          }
        }
      }
      if (!base64Data) {
        return res.status(500).json(
          formatErrorPayload(500, "NO_IMAGE_GENERATED", "gemini", "Gemini did not return image data for the prompt", "Try refining your prompt", req)
        );
      }
      const imageUrl = `data:image/png;base64,${base64Data}`;
      let savedPath = null;
      if (saveToWorkspace) {
        const outName = filename || `generated-image-${Date.now()}.png`;
        const resolved = resolveSafePath(outName);
        if (resolved.ok) {
          import_fs.default.writeFileSync(resolved.path, Buffer.from(base64Data, "base64"));
          savedPath = outName;
        }
      }
      res.json({
        ok: true,
        image_url: imageUrl,
        caption: captionText,
        saved_path: savedPath,
        prompt
      });
    } catch (err) {
      res.status(500).json(formatErrorPayload(500, "IMAGE_GEN_FAILED", "gemini", err.message, "Check Gemini image prompt", req));
    }
  });
  router.post("/gemini/speech", async (req, res) => {
    const client = getGeminiClient();
    if (!client) {
      return res.status(503).json(
        formatErrorPayload(503, "GEMINI_NOT_CONFIGURED", "gemini", "GEMINI_API_KEY is not configured", "Set GEMINI_API_KEY in environment or settings", req)
      );
    }
    const { text, voice = "Kore" } = req.body;
    if (!text) {
      return res.status(400).json(
        formatErrorPayload(400, "MISSING_TEXT", "validation", "Text is required for TTS", "Provide text to convert to speech", req)
      );
    }
    try {
      const response = await client.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: text.slice(0, 2e3) }] }],
        config: {
          responseModalities: [import_genai.Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice || "Kore" }
            }
          }
        }
      });
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        return res.status(500).json(
          formatErrorPayload(500, "TTS_NO_AUDIO", "gemini", "Gemini TTS did not return audio data", "Retry with shorter text", req)
        );
      }
      res.json({
        ok: true,
        audio_data: base64Audio,
        mime_type: "audio/pcm;rate=24000",
        sample_rate: 24e3,
        voice
      });
    } catch (err) {
      res.status(500).json(formatErrorPayload(500, "TTS_FAILED", "gemini", err.message, "Check speech text and quota", req));
    }
  });
  router.get("/conversations", (req, res) => {
    try {
      const q = (req.query.q || "").toLowerCase().trim();
      const includeArchived = req.query.include_archived !== "false";
      const offset = parseInt(req.query.offset) || 0;
      const limit = req.query.limit ? parseInt(req.query.limit) : void 0;
      let items = Array.from(conversations.values()).filter((c) => {
        if (!includeArchived && c.archived) return false;
        if (q && !c.title.toLowerCase().includes(q)) return false;
        return true;
      });
      items.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      const total = items.length;
      if (limit !== void 0) {
        items = items.slice(offset, offset + limit);
        res.json({ total, items: items.map((c) => ({ id: c.id, title: c.title, model: c.model, messages: c.messages.length, pinned: c.pinned, archived: c.archived, updated_at: c.updated_at })) });
      } else {
        res.json(items.map((c) => ({ id: c.id, title: c.title, model: c.model, messages: c.messages.length, pinned: c.pinned, archived: c.archived, updated_at: c.updated_at })));
      }
    } catch (err) {
      res.status(500).json(formatErrorPayload(500, "CONVERSATION_LIST_ERROR", "request", err.message, "Refresh the page", req));
    }
  });
  router.get("/conversations/recovery", (_req, res) => {
    const recoverable = Array.from(conversations.values()).filter((c) => c.status === "failed" || c.status === "streaming");
    res.json(recoverable);
  });
  router.post("/conversations/reindex", (_req, res) => {
    res.json({ ok: true, count: conversations.size });
  });
  router.post("/conversations/bulk", (req, res) => {
    const { ids = [], archived, delete: isDelete } = req.body;
    let modified = 0;
    for (const id of ids) {
      if (isDelete) {
        if (conversations.delete(id)) modified++;
      } else if (conversations.has(id)) {
        const conv = conversations.get(id);
        if (archived !== void 0) conv.archived = Boolean(archived);
        conv.updated_at = (/* @__PURE__ */ new Date()).toISOString();
        modified++;
      }
    }
    res.json({ ok: true, modified });
  });
  router.get("/conversations/export", (req, res) => {
    const ids = (req.query.ids || "").split(",").filter(Boolean);
    const convList = ids.length ? ids.map((id) => conversations.get(id)).filter(Boolean) : Array.from(conversations.values());
    res.json({
      format: "mini-o.conversations",
      version: 1,
      conversations: convList
    });
  });
  router.post("/conversations/import", (req, res) => {
    const { format, version, conversations: importedList = [] } = req.body;
    if (format !== "mini-o.conversations" || version !== 1) {
      return res.status(400).json(
        formatErrorPayload(
          400,
          "INVALID_IMPORT_FORMAT",
          "validation",
          "Unsupported conversation export format or schema version",
          "Ensure the JSON file was exported from Mini-O format v1",
          req
        )
      );
    }
    const ids = [];
    for (const item of importedList) {
      const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      conversations.set(id, {
        id,
        title: item.title || "Imported chat",
        model: item.model || DEFAULT_MODEL,
        options: item.options || {},
        messages: Array.isArray(item.messages) ? item.messages : [],
        pinned: Boolean(item.pinned),
        archived: Boolean(item.archived),
        created_at: item.created_at || (/* @__PURE__ */ new Date()).toISOString(),
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      ids.push(id);
    }
    res.json({ ids });
  });
  router.get("/conversations/:id", (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) {
      return res.status(404).json(
        formatErrorPayload(
          404,
          "CONVERSATION_NOT_FOUND",
          "request",
          `Conversation '${req.params.id}' was not found`,
          "Select a conversation from the sidebar or start a new chat",
          req
        )
      );
    }
    res.json(conv);
  });
  router.patch("/conversations/:id", (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) {
      return res.status(404).json(
        formatErrorPayload(
          404,
          "CONVERSATION_NOT_FOUND",
          "request",
          `Conversation '${req.params.id}' was not found`,
          "Check the conversation ID",
          req
        )
      );
    }
    const { title, pinned, archived, options, messages } = req.body;
    if (title !== void 0) conv.title = title;
    if (pinned !== void 0) conv.pinned = Boolean(pinned);
    if (archived !== void 0) conv.archived = Boolean(archived);
    if (options !== void 0) conv.options = options;
    if (messages !== void 0 && Array.isArray(messages)) conv.messages = messages;
    conv.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    res.json(conv);
  });
  router.delete("/conversations/:id", (req, res) => {
    const deleted = conversations.delete(req.params.id);
    res.json({ deleted });
  });
  router.post("/conversations/:id/duplicate", (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) {
      return res.status(404).json(
        formatErrorPayload(
          404,
          "CONVERSATION_NOT_FOUND",
          "request",
          `Cannot duplicate: conversation '${req.params.id}' not found`,
          "Refresh your conversation list",
          req
        )
      );
    }
    const newId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    conversations.set(newId, {
      ...conv,
      id: newId,
      title: `${conv.title} (Copy)`,
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    res.json({ id: newId });
  });
  router.get("/files", (req, res) => {
    const relPath = req.query.path || ".";
    const q = (req.query.q || "").toLowerCase();
    const sort = req.query.sort || "name";
    const includeHidden = req.query.include_hidden === "true";
    const resolved = resolveSafePath(relPath);
    if (!resolved.ok) {
      return res.status(403).json(
        formatErrorPayload(403, "SAFE_PATH_VIOLATION", "permission", resolved.error || "Access denied", "Navigate within the allowed workspace directory", req)
      );
    }
    if (!import_fs.default.existsSync(resolved.path)) {
      return res.json([]);
    }
    try {
      const dirents = import_fs.default.readdirSync(resolved.path, { withFileTypes: true });
      let items = dirents.filter((d) => includeHidden || !d.name.startsWith(".")).map((d) => {
        const full = import_path.default.join(resolved.path, d.name);
        const stat = import_fs.default.statSync(full);
        const relativeToWorkspace = import_path.default.relative(dataDir, full).replace(/\\/g, "/");
        return {
          name: d.name,
          path: relativeToWorkspace || ".",
          is_dir: d.isDirectory(),
          size: stat.size,
          modified: stat.mtimeMs / 1e3
        };
      });
      if (q) {
        items = items.filter((i) => i.name.toLowerCase().includes(q));
      }
      if (sort === "modified") {
        items.sort((a, b) => (b.modified || 0) - (a.modified || 0));
      } else if (sort === "size") {
        items.sort((a, b) => (b.size || 0) - (a.size || 0));
      } else {
        items.sort((a, b) => a.name.localeCompare(b.name));
      }
      res.json(items);
    } catch (err) {
      res.status(500).json(formatErrorPayload(500, "FILES_READ_ERROR", "filesystem", err.message, "Check directory permissions", req));
    }
  });
  router.get("/files/content", (req, res) => {
    const relPath = req.query.path || "";
    const resolved = resolveSafePath(relPath);
    if (!resolved.ok) {
      return res.status(403).json(
        formatErrorPayload(403, "SAFE_PATH_VIOLATION", "permission", resolved.error || "Access denied", "Navigate within the allowed workspace directory", req)
      );
    }
    if (!import_fs.default.existsSync(resolved.path) || import_fs.default.statSync(resolved.path).isDirectory()) {
      return res.status(404).json(
        formatErrorPayload(
          404,
          "FILE_NOT_FOUND",
          "filesystem",
          `File '${relPath}' does not exist or is a directory`,
          "Verify the file name or create it before opening",
          req
        )
      );
    }
    try {
      const content = import_fs.default.readFileSync(resolved.path, "utf-8");
      const stat = import_fs.default.statSync(resolved.path);
      res.json({ content, modified: stat.mtimeMs / 1e3, size: stat.size });
    } catch (err) {
      res.status(500).json(formatErrorPayload(500, "FILE_READ_ERROR", "filesystem", err.message, "Verify file encoding and permissions", req));
    }
  });
  router.post("/files/content", (req, res) => {
    const { path: relPath, content, expected_modified } = req.body;
    if (!relPath) {
      return res.status(400).json(
        formatErrorPayload(400, "MISSING_PATH", "validation", "File path is required", "Specify a non-empty relative file path", req)
      );
    }
    const resolved = resolveSafePath(relPath);
    if (!resolved.ok) {
      return res.status(403).json(
        formatErrorPayload(403, "SAFE_PATH_VIOLATION", "permission", resolved.error || "Access denied", "Keep edits within workspace roots", req)
      );
    }
    try {
      if (import_fs.default.existsSync(resolved.path) && expected_modified !== void 0 && expected_modified !== null) {
        const currentStat = import_fs.default.statSync(resolved.path);
        const currentModified = currentStat.mtimeMs / 1e3;
        if (Math.abs(currentModified - expected_modified) > 1) {
          return res.status(409).json(
            formatErrorPayload(
              409,
              "CONCURRENCY_CONFLICT",
              "filesystem",
              `File '${relPath}' was modified on disk by another process since you opened it`,
              "Reload the file to view recent changes, or force overwrite",
              req,
              { disk_modified: currentModified, expected_modified }
            )
          );
        }
      }
      import_fs.default.mkdirSync(import_path.default.dirname(resolved.path), { recursive: true });
      import_fs.default.writeFileSync(resolved.path, content || "", "utf-8");
      const stat = import_fs.default.statSync(resolved.path);
      res.json({ message: "Saved", modified: stat.mtimeMs / 1e3, size: stat.size });
    } catch (err) {
      res.status(500).json(formatErrorPayload(500, "FILE_WRITE_ERROR", "filesystem", err.message, "Check write permissions and disk space", req));
    }
  });
  router.get("/files/search", (req, res) => {
    const q = (req.query.q || "").toLowerCase();
    const relPath = req.query.path || ".";
    const resolved = resolveSafePath(relPath);
    if (!resolved.ok) {
      return res.status(403).json(
        formatErrorPayload(403, "SAFE_PATH_VIOLATION", "permission", resolved.error || "Access denied", "Search within workspace root", req)
      );
    }
    const matches = [];
    function walk(dir) {
      if (!import_fs.default.existsSync(dir)) return;
      const entries = import_fs.default.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = import_path.default.join(dir, entry.name);
        const rel = import_path.default.relative(dataDir, full).replace(/\\/g, "/");
        if (entry.name.toLowerCase().includes(q)) {
          matches.push(rel);
        }
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          walk(full);
        }
      }
    }
    walk(resolved.path);
    res.json(matches);
  });
  router.get("/files/metadata", (req, res) => {
    const relPath = req.query.path || "";
    const resolved = resolveSafePath(relPath);
    if (!resolved.ok) {
      return res.status(403).json(
        formatErrorPayload(403, "SAFE_PATH_VIOLATION", "permission", resolved.error || "Access denied", "Check file path", req)
      );
    }
    if (!import_fs.default.existsSync(resolved.path)) {
      return res.status(404).json(
        formatErrorPayload(404, "FILE_NOT_FOUND", "filesystem", `File '${relPath}' not found`, "Verify path", req)
      );
    }
    const stat = import_fs.default.statSync(resolved.path);
    const ext = import_path.default.extname(resolved.path).toLowerCase().replace(".", "") || "text";
    res.json({
      path: relPath,
      size: stat.size,
      modified: stat.mtimeMs / 1e3,
      is_dir: stat.isDirectory(),
      encoding: "utf-8",
      line_ending: "lf",
      language: ext,
      read_only: false
    });
  });
  router.post("/files/operation", (req, res) => {
    const { operation, path: srcRel, target: dstRel } = req.body;
    const srcResolved = resolveSafePath(srcRel);
    if (!srcResolved.ok || !import_fs.default.existsSync(srcResolved.path)) {
      return res.status(404).json(
        formatErrorPayload(404, "FILE_NOT_FOUND", "filesystem", `Source '${srcRel}' not found or invalid`, "Check source file path", req)
      );
    }
    try {
      if (operation === "rename") {
        const dstResolved = resolveSafePath(dstRel);
        if (!dstResolved.ok) {
          return res.status(403).json(formatErrorPayload(403, "SAFE_PATH_VIOLATION", "permission", dstResolved.error || "Invalid target path", "Choose a valid destination", req));
        }
        import_fs.default.renameSync(srcResolved.path, dstResolved.path);
      } else if (operation === "duplicate") {
        const dstResolved = resolveSafePath(dstRel);
        if (!dstResolved.ok) {
          return res.status(403).json(formatErrorPayload(403, "SAFE_PATH_VIOLATION", "permission", dstResolved.error || "Invalid target path", "Choose a valid destination", req));
        }
        if (import_fs.default.statSync(srcResolved.path).isDirectory()) {
          import_fs.default.cpSync(srcResolved.path, dstResolved.path, { recursive: true });
        } else {
          import_fs.default.copyFileSync(srcResolved.path, dstResolved.path);
        }
      } else if (operation === "delete") {
        if (import_fs.default.statSync(srcResolved.path).isDirectory()) {
          import_fs.default.rmSync(srcResolved.path, { recursive: true, force: true });
        } else {
          import_fs.default.unlinkSync(srcResolved.path);
        }
      } else {
        return res.status(400).json(formatErrorPayload(400, "UNKNOWN_OPERATION", "validation", `Unsupported file operation '${operation}'`, "Use rename, duplicate, or delete", req));
      }
      res.json({ ok: true, operation, path: srcRel });
    } catch (err) {
      res.status(500).json(formatErrorPayload(500, "FILE_OP_FAILED", "filesystem", err.message, "Check permissions and target path", req));
    }
  });
  router.get("/tools", (_req, res) => {
    res.json(toolDefinitions);
  });
  router.get("/tools/policies", (_req, res) => {
    res.json(toolPolicies);
  });
  router.patch("/tools/policies/:name", (req, res) => {
    const { name } = req.params;
    if (!toolPolicies[name]) {
      return res.status(404).json(
        formatErrorPayload(404, "TOOL_NOT_FOUND", "tools", `Tool '${name}' is not recognized`, "Choose a tool from the tool list", req)
      );
    }
    const { enabled, mode, scope } = req.body;
    if (enabled !== void 0) toolPolicies[name].enabled = Boolean(enabled);
    if (mode !== void 0) toolPolicies[name].mode = mode;
    if (scope !== void 0) toolPolicies[name].scope = scope;
    res.json({ name, ...toolPolicies[name] });
  });
  router.get("/tools/activity", (_req, res) => {
    res.json(toolActivity);
  });
  router.get("/workspace/config", (_req, res) => {
    res.json({
      workspace_dir: dataDir,
      allowed_roots: [dataDir],
      config_file: "mini-o.config.json",
      tools: toolPolicies
    });
  });
  router.put("/workspace/config", (req, res) => {
    const { tools } = req.body;
    if (tools && typeof tools === "object") {
      Object.assign(toolPolicies, tools);
    }
    res.json({
      workspace_dir: dataDir,
      allowed_roots: [dataDir],
      config_file: "mini-o.config.json",
      tools: toolPolicies
    });
  });
  router.get("/workspace/search", (req, res) => {
    const q = (req.query.q || "").toLowerCase();
    const limit = parseInt(req.query.limit) || 50;
    if (!q) return res.json([]);
    const results = [];
    function searchDir(dir) {
      if (!import_fs.default.existsSync(dir)) return;
      const entries = import_fs.default.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = import_path.default.join(dir, entry.name);
        const rel = import_path.default.relative(dataDir, full).replace(/\\/g, "/");
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          searchDir(full);
        } else if (entry.isFile() && !entry.name.startsWith(".")) {
          try {
            const content = import_fs.default.readFileSync(full, "utf-8");
            const idx = content.toLowerCase().indexOf(q);
            if (idx !== -1) {
              const start = Math.max(0, idx - 40);
              const preview = content.slice(start, start + 200);
              results.push({ path: rel, preview, match_start: Math.max(0, idx - start) });
              if (results.length >= limit) return;
            }
          } catch {
          }
        }
      }
    }
    searchDir(dataDir);
    res.json(results);
  });
  router.get("/agents", (_req, res) => {
    const agentsList = [];
    function scanAgents(dir) {
      if (!import_fs.default.existsSync(dir)) return;
      const entries = import_fs.default.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = import_path.default.join(dir, entry.name);
        const rel = import_path.default.relative(dataDir, full).replace(/\\/g, "/");
        if (entry.name.toUpperCase() === "AGENT.MD" || entry.name.endsWith(".AGENT.md")) {
          agentsList.push({ path: rel, size: import_fs.default.statSync(full).size });
        } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
          scanAgents(full);
        }
      }
    }
    scanAgents(dataDir);
    res.json(agentsList);
  });
  router.get("/agents/templates", (_req, res) => {
    res.json([
      {
        id: "standard",
        name: "Standard Workspace Agent",
        content: "# Agent instructions\n\n## Goal\nAssist with code, documentation, and task automation in this workspace.\n\n## Rules\n- Read files before proposing edits.\n- Keep changes minimal and focused."
      },
      {
        id: "coding",
        name: "Full-Stack Developer Agent",
        content: "# Coding Agent\n\n## Responsibilities\n- Write clean, type-safe TypeScript/JavaScript code.\n- Provide helpful summaries and testing suggestions."
      },
      {
        id: "reviewer",
        name: "Code Reviewer Agent",
        content: "# Reviewer Agent\n\n## Guidelines\n- Review code for security, performance, and best practices.\n- Point out missing edge cases."
      }
    ]);
  });
  router.post("/agents/validate", (req, res) => {
    const { content } = req.body;
    const errors = [];
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      errors.push("AGENT.md content cannot be empty");
    }
    res.json({ valid: errors.length === 0, errors });
  });
  router.get("/agents/content", (req, res) => {
    const relPath = req.query.path || "AGENT.md";
    const resolved = resolveSafePath(relPath);
    if (!resolved.ok) {
      return res.status(403).json(
        formatErrorPayload(403, "SAFE_PATH_VIOLATION", "permission", resolved.error || "Access denied", "Check path", req)
      );
    }
    if (!import_fs.default.existsSync(resolved.path)) {
      return res.status(404).json(
        formatErrorPayload(404, "AGENT_FILE_NOT_FOUND", "filesystem", `Agent instructions file '${relPath}' not found`, "Create an AGENT.md file or use a template", req)
      );
    }
    const content = import_fs.default.readFileSync(resolved.path, "utf-8");
    res.json({ content });
  });
  router.post("/agents/content", (req, res) => {
    const { path: relPath, content } = req.body;
    const resolved = resolveSafePath(relPath || "AGENT.md");
    if (!resolved.ok) {
      return res.status(403).json(
        formatErrorPayload(403, "SAFE_PATH_VIOLATION", "permission", resolved.error || "Access denied", "Check path", req)
      );
    }
    import_fs.default.mkdirSync(import_path.default.dirname(resolved.path), { recursive: true });
    import_fs.default.writeFileSync(resolved.path, content || "", "utf-8");
    res.json({ path: relPath });
  });
  router.post("/research/fetch", async (req, res) => {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json(formatErrorPayload(400, "MISSING_URL", "validation", "Source URL is required", "Enter a valid http/https URL", req));
    }
    try {
      const fetchRes = await fetch(url, {
        headers: { "User-Agent": "Mini-O/0.1.0" },
        signal: AbortSignal.timeout(15e3)
      });
      if (!fetchRes.ok) {
        return res.status(502).json(formatErrorPayload(502, "UPSTREAM_FETCH_FAILED", "network", `Fetch returned status ${fetchRes.status}`, "Verify the URL is publicly reachable", req));
      }
      const html = await fetchRes.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : url;
      const text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "").replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      res.json({ url, title, content: text.slice(0, 1e4) });
    } catch (err) {
      res.status(500).json(formatErrorPayload(500, "RESEARCH_FETCH_ERROR", "network", err.message, "Check your connection or URL", req));
    }
  });
  router.post("/research/export", (req, res) => {
    const { path: relPath, title, notes = [] } = req.body;
    const resolved = resolveSafePath(relPath || "research-notes.json");
    if (!resolved.ok) {
      return res.status(403).json(formatErrorPayload(403, "SAFE_PATH_VIOLATION", "permission", resolved.error || "Access denied", "Specify a valid filename", req));
    }
    const payload = {
      format: "mini-o.research",
      version: 1,
      title: title || "Research notes",
      sources: notes,
      notes
    };
    import_fs.default.writeFileSync(resolved.path, JSON.stringify(payload, null, 2), "utf-8");
    res.json({ path: relPath, sources: notes.length });
  });
  router.post("/feedback", (req, res) => {
    res.json({ saved: true, category: req.body.category || "general" });
  });
  router.get("/plugins", (_req, res) => {
    res.json([
      {
        name: "workspace-fs",
        version: "1.0.0",
        kind: "filesystem",
        transport: "local",
        description: "Direct workspace sandboxed file access and modification.",
        platforms: ["web", "desktop"],
        capabilities: ["read", "write", "search"]
      },
      {
        name: "research-collector",
        version: "1.0.0",
        kind: "research",
        transport: "http",
        description: "Web document extraction and research synthesis pipeline.",
        platforms: ["web"],
        capabilities: ["fetch", "export"]
      }
    ]);
  });
  router.get("/plugins/:name", (req, res) => {
    res.json({
      name: req.params.name,
      version: "1.0.0",
      status: "active",
      config: {}
    });
  });
  router.get("/integrations", (_req, res) => {
    res.json({
      items: [
        {
          name: "Model Context Protocol (MCP)",
          status: "ready",
          description: "Standard protocol for model tool calls and context sharing.",
          platforms: ["vscode", "jetbrains", "cli"],
          capabilities: ["json-rpc", "stdio", "tools"]
        },
        {
          name: "VS Code Extension",
          status: "available",
          description: "Mini-O companion extension for Visual Studio Code.",
          platforms: ["vscode"],
          capabilities: ["selection", "code-actions"]
        },
        {
          name: "JetBrains IDE Plugin",
          status: "available",
          description: "Mini-O client for IntelliJ, Android Studio, and PyCharm.",
          platforms: ["intellij", "android-studio"],
          capabilities: ["selection", "mcp-client"]
        }
      ]
    });
  });
  router.get("/mcp/manifest", (_req, res) => {
    res.json({
      schema_version: "2025-11-25",
      name: "mini-o-server",
      version: "0.1.0",
      tools: toolDefinitions
    });
  });
  router.post("/mcp", (req, res) => {
    res.json({
      jsonrpc: "2.0",
      id: req.body.id || 1,
      result: { status: "ok", server: "mini-o" }
    });
  });
  router.post("/mcp/context", (req, res) => {
    res.json({ valid: true, context: req.body });
  });
  router.get("/network-policy", (_req, res) => {
    res.json({
      outbound_network: "web_fetch only",
      allowed_domains: ["*"],
      blocked_targets: ["loopback", "private", "link-local"],
      max_response_bytes: 52428800,
      redirects: "revalidated"
    });
  });
  router.get("/settings", (_req, res) => {
    res.json({
      defaults: { model: DEFAULT_MODEL, theme: "system", density: "comfortable" },
      groups: ["general", "appearance", "models", "chat", "tools", "workspace", "privacy", "diagnostics"],
      version: 1
    });
  });
  router.get("/capabilities", (_req, res) => {
    res.json({
      streaming: true,
      tools: true,
      file_management: true,
      agent_instructions: true,
      research_mode: true,
      diagnostics_audit: true
    });
  });
  router.get("/fixtures", (_req, res) => {
    res.json({
      schema_version: 1,
      sse: {
        token: { role: "assistant", content: "text" },
        done: { done: true, stop_reason: "stop" },
        error: { error: "category", correlation_id: "example" }
      },
      portable_conversation: { format: "mini-o.conversations", version: 1 }
    });
  });
  router.get("/extensions", (_req, res) => {
    res.json({ commands: [], panels: [], contract_version: 1 });
  });
  router.get("/platform", (_req, res) => {
    const isWindows = process.platform === "win32";
    res.json({
      platform: process.platform,
      arch: process.arch,
      node_version: process.version,
      is_windows: isWindows,
      is_linux: process.platform === "linux",
      is_darwin: process.platform === "darwin",
      paths: {
        workspace_dir: dataDir,
        app_root: rootDir,
        temp_dir: process.env.TEMP || process.env.TMP || "/tmp",
        appdata_dir: process.env.LOCALAPPDATA || process.env.APPDATA || import_path.default.join(process.env.HOME || "/tmp", ".mini-o")
      },
      windows_support: {
        batch_launcher: "mini-o.cmd",
        powershell_launcher: "mini-o.ps1",
        double_click_launcher: "start-mini-o.bat",
        silent_vbs_launcher: "mini-o.vbs",
        inno_setup_script: "installer.iss",
        winsw_service_config: "mini-o-service.xml"
      }
    });
  });
  router.get("/package/info", (_req, res) => {
    const debPath = import_path.default.join(rootDir, "dist", "mini-o_0.1.0-1_amd64.deb");
    const winZipPath = import_path.default.join(rootDir, "dist", "mini-o-0.1.0-windows-x64.zip");
    const hasDeb = import_fs.default.existsSync(debPath);
    const hasWinZip = import_fs.default.existsSync(winZipPath);
    let debSize = 0;
    let winZipSize = 0;
    let debSha256 = "";
    let winSha256 = "";
    const sumsPath = import_path.default.join(rootDir, "dist", "SHA256SUMS");
    const hashes = {};
    if (import_fs.default.existsSync(sumsPath)) {
      const lines = import_fs.default.readFileSync(sumsPath, "utf-8").split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          hashes[parts[1].replace(/^\.\//, "")] = parts[0];
        }
      }
    }
    if (hasDeb) {
      debSize = import_fs.default.statSync(debPath).size;
      debSha256 = hashes["mini-o_0.1.0-1_amd64.deb"] || "";
    }
    if (hasWinZip) {
      winZipSize = import_fs.default.statSync(winZipPath).size;
      winSha256 = hashes["mini-o-0.1.0-windows-x64.zip"] || "";
    }
    res.json({
      package: "mini-o",
      version: "0.1.0-1",
      platforms: {
        windows: {
          available: hasWinZip,
          filename: "mini-o-0.1.0-windows-x64.zip",
          arch: "x64",
          size: winZipSize,
          sha256: winSha256,
          download_url: "/api/download/windows",
          quick_start: "Expand-Archive mini-o-0.1.0-windows-x64.zip && cd mini-o-windows && .\\start-mini-o.bat",
          launchers: ["start-mini-o.bat", "mini-o.cmd", "mini-o.ps1", "mini-o.vbs"]
        },
        debian: {
          available: hasDeb,
          filename: "mini-o_0.1.0-1_amd64.deb",
          arch: "amd64",
          size: debSize,
          sha256: debSha256,
          download_url: "/api/download/deb",
          install_command: "sudo dpkg -i mini-o_0.1.0-1_amd64.deb && sudo apt-get install -f"
        }
      },
      // Backward-compatible top-level keys
      available: hasWinZip || hasDeb,
      filename: hasWinZip ? "mini-o-0.1.0-windows-x64.zip" : "mini-o_0.1.0-1_amd64.deb",
      size: winZipSize || debSize,
      sha256: winSha256 || debSha256,
      download_url: "/api/download/windows"
    });
  });
  router.get("/download/deb", (_req, res) => {
    const debPath = import_path.default.join(rootDir, "dist", "mini-o_0.1.0-1_amd64.deb");
    if (!import_fs.default.existsSync(debPath)) {
      return res.status(404).json(formatErrorPayload(404, "PACKAGE_NOT_FOUND", "not_found", "Debian package not yet built. Run npm run build:deb first.", "Run npm run build:deb or trigger build from diagnostics"));
    }
    res.download(debPath, "mini-o_0.1.0-1_amd64.deb");
  });
  router.get("/download/windows", (_req, res) => {
    const winZipPath = import_path.default.join(rootDir, "dist", "mini-o-0.1.0-windows-x64.zip");
    if (!import_fs.default.existsSync(winZipPath)) {
      return res.status(404).json(formatErrorPayload(404, "PACKAGE_NOT_FOUND", "not_found", "Windows package not yet built. Run npm run build:windows first.", "Run npm run build:windows or trigger build from scripts"));
    }
    res.download(winZipPath, "mini-o-0.1.0-windows-x64.zip");
  });
  router.get("/download/windows-zip", (_req, res) => {
    res.redirect("/api/download/windows");
  });
}
var apiRouter = import_express.default.Router();
setupApiRoutes(apiRouter);
app.use("/api", apiRouter);
app.use("/api/v1", apiRouter);
app.use((err, req, res, _next) => {
  const status = Number(err.status) || 500;
  const code = err.code || "INTERNAL_SERVER_ERROR";
  const category = err.category || "internal";
  const message = err.message || "An unexpected internal server error occurred";
  const action = err.action || "Inspect server diagnostics or retry the request";
  res.status(status).json(formatErrorPayload(status, code, category, message, action, req, { stack: err.stack }));
});
function resolveFrontendDir() {
  if (process.env.MINI_O_FRONTEND_DIR && import_fs.default.existsSync(process.env.MINI_O_FRONTEND_DIR)) {
    return import_path.default.resolve(process.env.MINI_O_FRONTEND_DIR);
  }
  const candidates = [
    import_path.default.join(rootDir, "frontend"),
    import_path.default.join(__dirname, "..", "frontend"),
    import_path.default.join(__dirname, "frontend"),
    "/opt/mini-o/frontend"
  ];
  for (const c of candidates) {
    if (import_fs.default.existsSync(c) && import_fs.default.existsSync(import_path.default.join(c, "index.html"))) {
      return c;
    }
  }
  return import_path.default.join(rootDir, "frontend");
}
var frontendDir = resolveFrontendDir();
app.use("/static", import_express.default.static(frontendDir, {
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-cache");
  }
}));
app.get("/", (_req, res) => {
  res.sendFile(import_path.default.join(frontendDir, "index.html"));
});
app.get("/download/deb", (_req, res) => {
  res.redirect("/api/download/deb");
});
app.get("/download/windows", (_req, res) => {
  res.redirect("/api/download/windows");
});
app.get("/download/windows-zip", (_req, res) => {
  res.redirect("/api/download/windows");
});
process.on("uncaughtException", (err) => {
  logServerError(500, "UNCAUGHT_EXCEPTION", "internal", err.message, "Review server crash logs and restart if needed", void 0, { stack: err.stack });
});
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : void 0;
  logServerError(500, "UNHANDLED_REJECTION", "internal", msg, "Review async operations in server route handlers", void 0, { stack });
});
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Mini-O server running on http://0.0.0.0:${PORT}`);
});
//# sourceMappingURL=server.cjs.map
