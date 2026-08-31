import { AppError, classifyError, diagnostics } from "./errors.js";

/**
 * Robust API Client with structured error handling, auto-retry, and circuit resiliency
 */

const parseResponseBody = async (res) => {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const json = async (res) => {
  const data = await parseResponseBody(res);
  if (!res.ok) {
    let errorObj;
    if (data && typeof data === "object" && data.error) {
      if (typeof data.error === "object") {
        errorObj = new AppError(data.error.message || `Request failed (${res.status})`, {
          code: data.error.code || `HTTP_${res.status}`,
          category: data.error.category || "request",
          status: res.status,
          diagnosticId: data.error.diagnostic_id,
          action: data.error.action,
          details: data.error.details,
        });
      } else {
        errorObj = new AppError(String(data.error), {
          status: res.status,
          code: `HTTP_${res.status}`,
          diagnosticId: data.diagnostic_id,
          action: data.action,
        });
      }
    } else {
      const msg = typeof data === "string" ? data : `Request failed (${res.status})`;
      errorObj = new AppError(msg, {
        status: res.status,
        code: `HTTP_${res.status}`,
      });
    }

    diagnostics.log(errorObj, { status: res.status, url: res.url });
    throw errorObj;
  }
  return data;
};

const getJson = async (url, attempts = 3, signal) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, { signal });
      return await json(res);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      lastError = error;

      // Don't retry client 4xx errors (except 408 / 429)
      if (error.status && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
        throw error;
      }

      if (attempt + 1 < attempts) {
        // Exponential backoff with jitter
        const backoff = 150 * (2 ** attempt) + Math.random() * 50;
        await new Promise(resolve => setTimeout(resolve, backoff));
      }
    }
  }

  const structured = classifyError(lastError);
  diagnostics.log(structured, { url, attempts });
  throw structured;
};

const cache = new Map();
const cachedJson = async (url, ttl = 5000, signal) => {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.time < ttl) return hit.value;
  const value = await getJson(url, 3, signal);
  cache.set(url, { time: Date.now(), value });
  return value;
};

const invalidate = prefix => {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
};

export const api = {
  health: () => getJson("/api/health", 1),
  models: (params = "", signal) => {
    let url = "/api/models";
    if (typeof params === "string") {
      url += `?q=${encodeURIComponent(params)}`;
    } else if (params && typeof params === "object") {
      const searchParams = new URLSearchParams();
      if (params.q) searchParams.set("q", params.q);
      if (params.tier && params.tier !== "all") searchParams.set("tier", params.tier);
      if (params.location && params.location !== "all") searchParams.set("location", params.location);
      if (params.family && params.family !== "all") searchParams.set("family", params.family);
      const queryString = searchParams.toString();
      if (queryString) url += `?${queryString}`;
    }
    return cachedJson(url, 2000, signal);
  },
  modelsMeta: (signal) => cachedJson("/api/models/meta", 4000, signal),
  model: (name, signal) => getJson(`/api/models/${encodeURIComponent(name)}`, 3, signal),
  pullModel: (name, signal) => fetch(`/api/models/${encodeURIComponent(name)}/pull`, { method: "POST", signal }),
  deleteModel: (name) => fetch(`/api/models/${encodeURIComponent(name)}`, { method: "DELETE" }).then(json),
  tools: () => cachedJson("/api/tools"),
  toolPolicies: () => cachedJson("/api/tools/policies"),
  updateToolPolicy: (name, body) => fetch(`/api/tools/policies/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(json).then(value => { invalidate("/api/tools/policies"); return value; }),
  toolActivity: () => getJson("/api/tools/activity"),
  workspaceSearch: (q, path = ".", signal) => getJson(`/api/workspace/search?q=${encodeURIComponent(q)}&path=${encodeURIComponent(path)}`, 3, signal),
  researchFetch: (url, signal) => fetch("/api/research/fetch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  }).then(json),
  researchExport: (path, title, notes) => fetch("/api/research/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, title, notes }),
  }).then(json),
  diagnostics: () => getJson("/api/diagnostics"),
  serverErrors: () => getJson("/api/diagnostics/errors"),
  clearServerErrors: () => fetch("/api/diagnostics/errors/clear", { method: "POST" }).then(json),
  exportDiagnostics: () => fetch("/api/diagnostics/export").then(json),
  feedback: (body) => fetch("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(json),
  convs: async (q = "", includeArchived = true, offset = 0, limit = 50) => {
    const result = await getJson(`/api/conversations?q=${encodeURIComponent(q)}&include_archived=${includeArchived}&offset=${offset}&limit=${limit}`);
    return result.items || result;
  },
  getConv: (id) => getJson(`/api/conversations/${encodeURIComponent(id)}`),
  delConv: (id) => fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" })
    .then(json)
    .then(value => { invalidate("/api/conversations"); return value; }),
  updateConv: (id, changes) => fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(changes),
  }).then(json).then(value => { invalidate("/api/conversations"); return value; }),
  duplicateConv: (id) => fetch(`/api/conversations/${encodeURIComponent(id)}/duplicate`, { method: "POST" }).then(json),
  exportConvs: (ids = []) => fetch(`/api/conversations/export?ids=${encodeURIComponent(ids.join(","))}`).then(json),
  importConvs: (payload) => fetch("/api/conversations/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then(json),
  bulkConvs: (ids, changes) => fetch("/api/conversations/bulk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids, ...changes }),
  }).then(json),
  recovery: () => fetch("/api/conversations/recovery").then(json),
  files: (path = ".", q = "", sort = "name", includeHidden = false, signal) => getJson(`/api/files?path=${encodeURIComponent(path)}&q=${encodeURIComponent(q)}&sort=${sort}&include_hidden=${includeHidden}`, 3, signal),
  fileMetadata: (path, signal) => getJson(`/api/files/metadata?path=${encodeURIComponent(path)}`, 3, signal),
  fileOperation: (operation, path, target) => fetch("/api/files/operation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, path, target }),
  }).then(json),
  read: (path, signal) => getJson(`/api/files/content?path=${encodeURIComponent(path)}`, 3, signal),
  write: (path, content, expected_modified) => fetch("/api/files/content", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, content, expected_modified }),
  }).then(json),
  agents: () => fetch("/api/agents").then(json),
  workspaceConfig: () => getJson("/api/workspace/config"),
  updateWorkspaceConfig: (body) => fetch("/api/workspace/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(json),
  readAgent: (path) => fetch(`/api/agents/content?path=${encodeURIComponent(path)}`).then(json),
  writeAgent: (path, content) => fetch("/api/agents/content", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, content }),
  }).then(json),
  agentTemplates: () => fetch("/api/agents/templates").then(json),
  validateAgent: (path, content) => fetch("/api/agents/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, content }),
  }).then(json),
  plugins: () => getJson("/api/plugins"),
  integrations: () => getJson("/api/integrations"),
  secrets: () => getJson("/api/secrets"),
  saveSecret: (body) => fetch("/api/secrets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(json).then(v => { invalidate("/api/secrets"); return v; }),
  deleteSecret: (id) => fetch(`/api/secrets/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }).then(json).then(v => { invalidate("/api/secrets"); return v; }),
  testSecret: (id) => fetch(`/api/secrets/${encodeURIComponent(id)}/test`, {
    method: "POST",
  }).then(json),
  mcpManifest: () => getJson("/api/mcp/manifest"),
  geminiStatus: () => getJson("/api/gemini/status"),
  geminiGenerate: (body) => fetch("/api/gemini/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(json),
  geminiGenerateImage: (body) => fetch("/api/gemini/generate-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(json),
  geminiSpeech: (body) => fetch("/api/gemini/speech", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(json),

  async *streamChat(body, signal) {
    let res;
    try {
      res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      const errorObj = classifyError(err);
      diagnostics.log(errorObj, { context: "streamChat:fetch" });
      throw errorObj;
    }

    if (!res.ok) {
      let errPayload;
      try {
        errPayload = await res.json();
      } catch {
        errPayload = { error: `Chat stream failed with status ${res.status}` };
      }
      const errorObj = new AppError(errPayload.error?.message || errPayload.error || `Stream failed (${res.status})`, {
        status: res.status,
        code: errPayload.error?.code || `HTTP_${res.status}`,
        category: errPayload.error?.category || "stream",
        diagnosticId: errPayload.error?.diagnostic_id,
        action: errPayload.error?.action,
        details: errPayload.error?.details,
      });
      diagnostics.log(errorObj, { context: "streamChat:response" });
      throw errorObj;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          let event = "message";
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (data) {
            try {
              const parsed = JSON.parse(data);
              if (event === "error") {
                const streamErr = new AppError(parsed.detail || parsed.error || "Stream error", {
                  code: parsed.code || "STREAM_ERROR",
                  category: parsed.category || "stream",
                  diagnosticId: parsed.diagnostic_id,
                  action: parsed.action,
                  details: parsed.details,
                });
                diagnostics.log(streamErr, { context: "streamChat:event:error" });
                yield { event, data: parsed, error: streamErr };
              } else {
                yield { event, data: parsed };
              }
            } catch (jsonErr) {
              console.warn("Failed to parse SSE line data:", data, jsonErr);
            }
          }
        }
        if (done) break;
      }
    } catch (streamErr) {
      if (streamErr.name === "AbortError") throw streamErr;
      const appErr = classifyError(streamErr);
      diagnostics.log(appErr, { context: "streamChat:reading" });
      throw appErr;
    }
  },
};
