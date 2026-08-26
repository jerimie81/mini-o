import { api } from "./api.js";
import { Chat } from "./chat.js";
import { FilePanel } from "./files.js";
import { ToolPanel } from "./tools.js";
import { migratePreferences as migratePreferenceSchema } from "./preferences.js";
import { diagnostics, installGlobalErrorHandlers, classifyError } from "./errors.js";

window.MiniO = window.MiniO || {
  commands: new Map(),
  panels: new Map(),
  registerCommand(name, fn) { this.commands.set(name, fn); },
  registerPanel(name, render) { this.panels.set(name, render); }
};

const storage = {
  get(key, fallback) {
    try { return localStorage.getItem(`mini-o.${key}`) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`mini-o.${key}`, value); } catch { /* private browsing */ }
  },
};
migratePreferenceSchema(localStorage);

const state = {
  model: storage.get("model", "minimax-m3:cloud"),
  conversationId: null,
  messages: [],
  useTools: storage.get("tools", "true") !== "false",
  attachedFiles: [],
  showArchived: false,
  options: JSON.parse(storage.get("generation-options", "{}")),
  favoriteModels: JSON.parse(storage.get("favorite-models", "[]")),
};
const messages = document.getElementById("messages");
const sidebar = document.getElementById("conversation-sidebar");
const rightPanel = document.getElementById("right-panel");
const scrim = document.getElementById("scrim");
const chat = new Chat(state);
const files = new FilePanel();
const tools = new ToolPanel();

function draftKey(id = "new") { return `draft.${id}`; }
function restoreDraft(id = "new") {
  const input = document.getElementById("input");
  input.value = storage.get(draftKey(id), "");
  input.dispatchEvent(new Event("input"));
}
function saveDraft() { storage.set(draftKey(state.conversationId || "new"), document.getElementById("input").value); }

function installPanelResizing() {
  const root = document.documentElement;
  const handles = [
    { element: document.querySelector(".resize-handle-sidebar"), variable: "--sidebar-width", storageKey: "sidebar-width", min: 220, max: 520, direction: 1 },
    { element: document.querySelector(".resize-handle-workspace"), variable: "--panel-width", storageKey: "workspace-width", min: 280, max: 640, direction: -1 },
  ];

  function currentWidth(variable) {
    return parseFloat(getComputedStyle(root).getPropertyValue(variable)) || 0;
  }
  function setWidth(item, width) {
    const otherVariable = item.variable === "--sidebar-width" ? "--panel-width" : "--sidebar-width";
    const available = window.innerWidth - currentWidth(otherVariable) - 360;
    const max = Math.min(item.max, Math.max(item.min, available));
    const next = Math.round(Math.max(item.min, Math.min(max, width)));
    root.style.setProperty(item.variable, `${next}px`);
    item.element?.setAttribute("aria-valuenow", String(next));
    return next;
  }
  function restore(item) {
    const saved = Number(storage.get(item.storageKey, ""));
    if (Number.isFinite(saved) && saved > 0) setWidth(item, saved);
  }

  handles.forEach(item => {
    if (!item.element) return;
    restore(item);
    let startX = 0;
    let startWidth = 0;
    const stop = () => {
      if (!document.body.classList.contains("resizing-panels")) return;
      document.body.classList.remove("resizing-panels");
      item.element.releasePointerCapture?.(item.pointerId);
      storage.set(item.storageKey, String(currentWidth(item.variable)));
    };
    item.element.addEventListener("pointerdown", event => {
      if (window.matchMedia("(max-width: 1100px)").matches) return;
      event.preventDefault();
      item.pointerId = event.pointerId;
      startX = event.clientX;
      startWidth = currentWidth(item.variable);
      item.element.setPointerCapture?.(event.pointerId);
      document.body.classList.add("resizing-panels");
    });
    item.element.addEventListener("pointermove", event => {
      if (!document.body.classList.contains("resizing-panels")) return;
      setWidth(item, startWidth + (event.clientX - startX) * item.direction);
    });
    item.element.addEventListener("pointerup", stop);
    item.element.addEventListener("pointercancel", stop);
    item.element.addEventListener("lostpointercapture", stop);
    item.element.addEventListener("keydown", event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 16 * item.direction : -16 * item.direction;
      const next = setWidth(item, currentWidth(item.variable) + delta);
      storage.set(item.storageKey, String(next));
    });
  });
}

installPanelResizing();

function updateSendState() {
  const send = document.getElementById("send");
  send.disabled = !state.model;
  send.title = state.model ? "Send message" : "Choose a model first";
}

function setStatus(status, label) {
  const dot = document.getElementById("status");
  dot.className = `status-dot ${status}`;
  dot.setAttribute("aria-label", label);
  document.getElementById("status-text").textContent = label;
  document.getElementById("announcer")?.replaceChildren(document.createTextNode(label));
}

function notify(kind, message, timeout = 4800, diagnosticId = null) {
  const host = document.getElementById("notifications");
  if (!host) return;
  const history = JSON.parse(storage.get("notification-history", "[]"));
  history.unshift({ kind, message, time: new Date().toISOString(), diagnosticId });
  storage.set("notification-history", JSON.stringify(history.slice(0, 50)));

  const notice = document.createElement("div");
  notice.className = `notice ${kind}`;
  notice.setAttribute("role", kind === "error" ? "alert" : "status");

  const msgSpan = document.createElement("span");
  msgSpan.textContent = message;
  notice.appendChild(msgSpan);

  if (diagnosticId) {
    const diagBtn = document.createElement("button");
    diagBtn.type = "button";
    diagBtn.className = "notice-diag-btn";
    diagBtn.textContent = "Log";
    diagBtn.title = `View diagnostic ${diagnosticId}`;
    diagBtn.onclick = () => showDiagnosticsModal(diagnosticId);
    notice.appendChild(diagBtn);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Dismiss notification");
  close.onclick = () => notice.remove();
  notice.appendChild(close);

  host.appendChild(notice);
  window.setTimeout(() => notice.remove(), timeout);
}

// Global error handlers installation
installGlobalErrorHandlers((kind, message) => notify(kind, message));

function confirmAction(title, body, onConfirm) {
  showModal(title, `<p>${body}</p>`, `<div class="modal-actions"><button class="secondary modal-close">Cancel</button><button class="danger" id="confirm-action">Confirm</button></div>`);
  document.getElementById("confirm-action").onclick = () => { closeModal(); onConfirm(); };
}

document.addEventListener("mini-o:notice", event => notify(event.detail?.kind || "success", event.detail?.message || "Completed", 4800, event.detail?.diagnosticId));

document.getElementById("notifications-button").onclick = () => {
  const history = JSON.parse(storage.get("notification-history", "[]"));
  showModal(
    "Notification history",
    history.length
      ? `<ul class="notification-history-list">${history.map(item => `
          <li class="notification-item ${item.kind}">
            <span class="badge ${item.kind === 'error' ? 'badge-error' : 'badge-info'}">${item.kind}</span>
            <span class="notification-text">${item.message}</span>
            <small>${new Date(item.time).toLocaleTimeString()}</small>
            ${item.diagnosticId ? `<button class="secondary btn-inline-diag" data-diag="${item.diagnosticId}">View</button>` : ''}
          </li>
        `).join("")}</ul>`
      : "<p class='empty-state'>No notifications yet.</p>",
    '<div class="modal-actions"><button class="secondary" id="clear-notifications">Clear history</button><button class="secondary" id="open-diag-center">Diagnostic Logs</button><button class="primary modal-close">Close</button></div>'
  );
  document.getElementById("clear-notifications").onclick = () => { storage.set("notification-history", "[]"); closeModal(); };
  document.getElementById("open-diag-center")?.addEventListener("click", () => { closeModal(); showDiagnosticsModal(); });
  document.querySelectorAll(".btn-inline-diag").forEach(btn => {
    btn.onclick = () => { closeModal(); showDiagnosticsModal(btn.dataset.diag); };
  });
};

async function showDiagnosticsModal(highlightId = null) {
  let serverLogs = [];
  try {
    const res = await api.serverErrors();
    serverLogs = res.errors || [];
  } catch {
    // server unreachable
  }
  const clientLogs = diagnostics.getLogs();

  const combined = [
    ...clientLogs.map(l => ({ ...l, source: "Client" })),
    ...serverLogs.map(l => ({ ...l, source: "Server" })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const renderLogList = (items, filter = "") => {
    const needle = filter.toLowerCase();
    const filtered = items.filter(item =>
      !needle ||
      (item.id && item.id.toLowerCase().includes(needle)) ||
      (item.message && item.message.toLowerCase().includes(needle)) ||
      (item.category && item.category.toLowerCase().includes(needle)) ||
      (item.code && item.code.toLowerCase().includes(needle))
    );

    if (!filtered.length) {
      return "<p class='empty-state'>No errors recorded in diagnostic logs.</p>";
    }

    return filtered.map(item => `
      <article class="diag-log-item ${item.id === highlightId ? 'highlighted' : ''}">
        <div class="diag-log-header">
          <span class="badge ${item.source === 'Server' ? 'badge-server' : 'badge-client'}">${item.source}</span>
          <span class="badge ${item.status >= 500 ? 'badge-error' : 'badge-warning'}">${item.code || 'ERROR'}</span>
          <strong class="diag-id">${item.id}</strong>
          <span class="diag-time">${new Date(item.timestamp).toLocaleTimeString()}</span>
        </div>
        <p class="diag-msg">${item.message}</p>
        ${item.action ? `<p class="diag-action">💡 <em>Action:</em> ${item.action}</p>` : ''}
        ${item.details?.stack ? `<details class="diag-stack"><summary>Stack Trace</summary><pre>${item.details.stack}</pre></details>` : ''}
        <div class="diag-actions">
          <button type="button" class="secondary copy-diag-id" data-id="${item.id}">Copy ID</button>
          <button type="button" class="secondary copy-diag-json" data-raw='${JSON.stringify(item).replace(/'/g, "&apos;")}'>Copy JSON</button>
        </div>
      </article>
    `).join("");
  };

  showModal(
    "Diagnostics & System Error Log",
    `
      <div class="diag-modal-header">
        <input id="diag-search" placeholder="Filter diagnostics by ID, category, message…" value="${highlightId || ''}" />
        <span class="field-help">Real-time error trace recording client & server events</span>
      </div>
      <div id="diag-log-container" class="diag-log-container">
        ${renderLogList(combined, highlightId || "")}
      </div>
    `,
    `
      <div class="modal-actions">
        <button class="secondary" id="clear-diag-logs">Clear All Logs</button>
        <button class="secondary" id="export-diag-logs">Export Report (JSON)</button>
        <button class="primary modal-close">Close</button>
      </div>
    `
  );

  const container = document.getElementById("diag-log-container");
  const searchInput = document.getElementById("diag-search");

  searchInput.oninput = (e) => {
    container.innerHTML = renderLogList(combined, e.target.value);
    bindCopyButtons();
  };

  function bindCopyButtons() {
    document.querySelectorAll(".copy-diag-id").forEach(btn => {
      btn.onclick = async () => {
        await navigator.clipboard.writeText(btn.dataset.id);
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "Copy ID"; }, 1200);
      };
    });
    document.querySelectorAll(".copy-diag-json").forEach(btn => {
      btn.onclick = async () => {
        await navigator.clipboard.writeText(btn.dataset.raw);
        btn.textContent = "Copied JSON!";
        setTimeout(() => { btn.textContent = "Copy JSON"; }, 1200);
      };
    });
  }

  bindCopyButtons();

  document.getElementById("clear-diag-logs").onclick = async () => {
    diagnostics.clear();
    await api.clearServerErrors().catch(() => {});
    container.innerHTML = "<p class='empty-state'>All diagnostic logs cleared.</p>";
    notify("success", "Diagnostic error logs cleared");
  };

  document.getElementById("export-diag-logs").onclick = () => {
    const report = {
      format: "mini-o.diagnostics.export",
      version: 1,
      exported_at: new Date().toISOString(),
      client_diagnostics: diagnostics.getLogs(),
      server_diagnostics: serverLogs,
      environment: {
        userAgent: navigator.userAgent,
        online: navigator.onLine,
        theme: storage.get("theme", "dark"),
      },
    };
    downloadJson("mini-o-diagnostics-report.json", report);
    notify("success", "Diagnostic report downloaded");
  };
}

document.addEventListener("mini-o:open-diagnostics", event => {
  showDiagnosticsModal(event.detail?.id);
});

document.getElementById("research-mode").onclick = () => {
  const notes = [];
  let controller;
  showModal(
    "Research mode",
    `<p>Fetch public sources with provenance, deduplicate them, and export notes locally.</p>
     <label>Source URL <input id="research-url" type="url" placeholder="https://example.com/article"></label>
     <label>Research notes <textarea id="research-notes" placeholder="Working notes and synthesis questions"></textarea></label>
     <div id="research-sources" class="research-sources"></div>`,
    `<div class="modal-actions">
       <button class="secondary" id="research-fetch">Fetch source</button>
       <button class="secondary" id="research-cancel">Cancel request</button>
       <button class="secondary" id="research-insert">Insert sources in chat</button>
       <button class="secondary" id="research-export">Export notes</button>
       <button class="primary modal-close">Close</button>
     </div>`
  );
  const list = document.getElementById("research-sources");
  document.getElementById("research-fetch").onclick = async () => {
    const url = document.getElementById("research-url").value.trim();
    if (!url || notes.some(note => note.url === url)) return notify("warning", "Enter a new public URL");
    controller = new AbortController();
    try {
      const source = await api.researchFetch(url, controller.signal);
      notes.push(source);
      const item = document.createElement("article");
      item.innerHTML = `<strong></strong><a target="_blank" rel="noopener"></a><p></p>`;
      item.querySelector("strong").textContent = source.title || url;
      item.querySelector("a").href = source.url;
      item.querySelector("a").textContent = source.url;
      item.querySelector("p").textContent = source.content.slice(0, 300);
      list.appendChild(item);
    } catch (error) {
      if (error.name !== "AbortError") notify("error", error.message);
    }
  };
  document.getElementById("research-cancel").onclick = () => controller?.abort();
  document.getElementById("research-insert").onclick = () => {
    const context = notes.map(note => `${note.title || note.url}\n${note.url}\n${note.content.slice(0, 2000)}`).join("\n\n");
    const input = document.getElementById("input");
    input.value += `${input.value ? "\n\n" : ""}Research sources:\n${context}\n\nNotes:\n${document.getElementById("research-notes").value}`;
    input.dispatchEvent(new Event("input"));
    closeModal();
    input.focus();
  };
  document.getElementById("research-export").onclick = async () => {
    if (!notes.length) return;
    await api.researchExport("research-notes.json", "Research notes", notes.map(note => ({ ...note, notes: document.getElementById("research-notes").value })));
    notify("success", "Research notes exported to the workspace");
  };
};

function showModal(title, body, actions = "") {
  const modal = document.getElementById("modal");
  modal.innerHTML = `<div class="modal-card"><h3 id="modal-title">${title}</h3>${body}${actions}</div>`;
  modal.classList.remove("hidden");
  modal.querySelector("button")?.focus();
}
function closeModal() { document.getElementById("modal").classList.add("hidden"); }

function setPanel(panel, open) {
  panel.classList.toggle("collapsed", !open);
  const isMobile = window.matchMedia("(max-width: 1100px)").matches;
  scrim.classList.toggle("hidden", !isMobile || (sidebar.classList.contains("collapsed") && rightPanel.classList.contains("collapsed")));
  if (panel === rightPanel) storage.set("workspace-open", String(open));
  if (panel === sidebar) storage.set("sidebar-open", String(open));
}

const configure = {
  toolPolicies: {},
  async load() {
    const list = document.getElementById("agent-list");
    try {
      const workspace = await api.workspaceConfig();
      document.getElementById("workspace-dir").value = workspace.workspace_dir;
      document.getElementById("allowed-roots").value = workspace.allowed_roots.join("\n");
      document.getElementById("config-file-path").textContent = workspace.config_file || "mini-o.config.json";
      this.toolPolicies = workspace.tools || {};
      this.renderToolPolicies();
      const entries = await api.agents();
      list.innerHTML = entries.length ? "" : "<p class='empty-state'>No AGENT.md files yet.</p>";
      entries.forEach(e => {
        const b = document.createElement("button");
        b.className = "file-entry";
        b.textContent = `${e.path} (${e.size} bytes)`;
        b.onclick = () => this.open(e.path);
        list.appendChild(b);
      });
    } catch (e) { list.textContent = e.message; }
  },
  async open(path) {
    const r = await api.readAgent(path);
    document.getElementById("agent-path").value = path;
    document.getElementById("agent-text").value = r.content;
    document.getElementById("agent-preview").textContent = `Applies to: ${path.split("/").slice(0, -1).join("/") || "workspace root"}\n${r.content.slice(0, 300)}`;
  },
  async save() {
    const path = document.getElementById("agent-path").value.trim();
    if (!path) return;
    const content = document.getElementById("agent-text").value;
    const validation = await api.validateAgent(path, content);
    if (!validation.valid) throw new Error(validation.errors.join("; "));
    await api.writeAgent(path, content);
    await this.load();
  },
  async saveWorkspace() {
    const workspaceDir = document.getElementById("workspace-dir").value.trim();
    const roots = document.getElementById("allowed-roots").value.split("\n").map(value => value.trim()).filter(Boolean);
    const tools = {};
    document.querySelectorAll("#config-tool-list [data-tool]").forEach(card => {
      const name = card.dataset.tool;
      tools[name] = {
        enabled: card.querySelector("[data-policy-enabled]").checked,
        mode: card.querySelector("[data-policy-mode]").value,
        scope: card.querySelector("[data-policy-scope]").value,
      };
    });
    const result = await api.updateWorkspaceConfig({ workspace_dir: workspaceDir, allowed_roots: roots, tools });
    document.getElementById("workspace-dir").value = result.workspace_dir;
    document.getElementById("allowed-roots").value = result.allowed_roots.join("\n");
    document.getElementById("workspace-config-status").textContent = "Saved and applied immediately.";
    this.toolPolicies = result.tools || tools;
    await files.load(".");
  },
  renderToolPolicies() {
    const list = document.getElementById("config-tool-list");
    list.innerHTML = "";
    Object.entries(this.toolPolicies).forEach(([name, policy]) => {
      const card = document.createElement("article");
      card.className = "config-tool-card";
      card.dataset.tool = name;
      const title = document.createElement("strong");
      title.textContent = name;
      const enabled = document.createElement("label");
      enabled.className = "toggle";
      enabled.innerHTML = `<input type="checkbox" data-policy-enabled> Enabled`;
      enabled.querySelector("input").checked = policy.enabled !== false;
      const mode = document.createElement("select");
      mode.dataset.policyMode = "";
      mode.setAttribute("aria-label", `${name} permission`);
      mode.innerHTML = "<option value='allow'>Allow</option><option value='confirm'>Confirm</option><option value='deny'>Deny</option>";
      mode.value = policy.mode || "confirm";
      const scope = document.createElement("select");
      scope.dataset.policyScope = "";
      scope.setAttribute("aria-label", `${name} approval scope`);
      scope.innerHTML = "<option value='once'>Once</option><option value='conversation'>Conversation</option><option value='session'>Session</option>";
      scope.value = policy.scope || "conversation";
      card.append(title, enabled, mode, scope);
      list.appendChild(card);
    });
  },
};

export const modelHub = {
  cachedCatalog: [],
  activeCategoryFilter: "all",
  systemHardware: null,

  async fetchHardwareInfo() {
    try {
      this.systemHardware = await api.hardware();
    } catch {
      this.systemHardware = null;
    }
  },

  renderHostHardwareBanner(containerId = "") {
    const hw = this.systemHardware;
    if (!hw) return "";

    const platformIcon = hw.platform === "win32" ? "🪟 Windows" : (hw.platform === "darwin" ? "🍎 macOS" : "🐧 Linux");
    const ramInfo = `${hw.total_ram_gb} GB RAM (${hw.free_ram_gb} GB Free)`;
    const cpuInfo = `${hw.cpus} Cores (${hw.arch})`;
    const tier = hw.local_model_fit_tier || "Standard Execution Host";

    return `
      <div class="host-hardware-banner" ${containerId ? `id="${containerId}"` : ""}>
        <div class="host-hardware-row">
          <span class="host-hardware-title">🖥️ Host Machine Profile</span>
          <span class="host-specs-summary">${platformIcon} · ${ramInfo} · ${cpuInfo}</span>
        </div>
        <div class="host-specs-chips">
          <span class="host-spec-chip">Host RAM: <strong>${hw.total_ram_gb} GB</strong></span>
          <span class="host-spec-chip">Avail Free: <strong>${hw.free_ram_gb} GB</strong></span>
          <span class="host-spec-chip">CPU Threads: <strong>${hw.cpus}</strong></span>
          <span class="host-spec-chip" style="color:var(--accent);">Execution Fit: <strong>${tier}</strong></span>
        </div>
      </div>
    `;
  },

  renderActiveHero(model) {
    if (!model) return;
    const titleEl = document.getElementById("active-model-title");
    const idEl = document.getElementById("active-model-id");
    const ctxEl = document.getElementById("active-model-ctx");
    const capEl = document.getElementById("active-model-cap");
    const providerBadge = document.getElementById("active-model-provider-badge");
    const typePill = document.getElementById("active-model-type-pill");
    const headerCurrent = document.getElementById("current-model");

    const isCloud = model.category === "cloud" || model.provider === "google" || model.provider === "minimax" || model.name?.includes(":cloud");
    const providerName = model.provider_display || (isCloud ? "Cloud Frontier" : "Local Open-Weights");
    const hwProfile = model.hardware_profile;
    const speed = hwProfile?.estimated_tokens_per_sec || (isCloud ? "~100-140 tok/s" : "~35-70 tok/s");

    if (titleEl) titleEl.textContent = model.display_name || model.name;
    if (idEl) idEl.textContent = model.name;
    if (ctxEl) ctxEl.textContent = model.context_window ? `${model.context_window} ctx` : (isCloud ? "1M ctx" : "32k ctx");
    if (capEl) {
      capEl.textContent = `⚡ ${speed} · ${isCloud ? "0 MB RAM (Cloud)" : `${model.parameter_size || "Local"}`}`;
    }
    if (providerBadge) providerBadge.textContent = providerName;
    if (typePill) {
      if (isCloud) {
        typePill.textContent = "☁️ Cloud (0 RAM)";
        typePill.className = "model-type-pill cloud";
      } else {
        typePill.textContent = model.installed ? "💻 Local Ready" : "📥 Available";
        typePill.className = `model-type-pill ${model.installed ? "local" : ""}`;
      }
    }
    if (headerCurrent) {
      headerCurrent.textContent = `${state.favoriteModels.includes(model.name) ? "★ " : ""}${model.display_name || model.name}`;
      headerCurrent.title = `Active Model: ${model.name} (${providerName}) · Speed: ${speed}. Click to switch (Ctrl+M)`;
    }
  },

  populateDropdown(models, searchQuery = "") {
    const select = document.getElementById("model-select");
    if (!select) return;
    select.innerHTML = "";

    const q = (searchQuery || "").toLowerCase().trim();
    const filtered = models.filter(m =>
      !q ||
      m.name.toLowerCase().includes(q) ||
      (m.display_name && m.display_name.toLowerCase().includes(q)) ||
      (m.provider_display && m.provider_display.toLowerCase().includes(q)) ||
      (m.tags && m.tags.some(t => t.toLowerCase().includes(q)))
    );

    if (filtered.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No matching models found";
      select.appendChild(opt);
      return;
    }

    const favs = filtered.filter(m => state.favoriteModels.includes(m.name));
    const cloudModels = filtered.filter(m => !state.favoriteModels.includes(m.name) && (m.category === "cloud" || m.provider === "google" || m.provider === "minimax" || m.name.includes(":cloud")));
    const localInstalled = filtered.filter(m => !state.favoriteModels.includes(m.name) && !cloudModels.includes(m) && m.installed);
    const downloadable = filtered.filter(m => !state.favoriteModels.includes(m.name) && !cloudModels.includes(m) && !m.installed);

    const addGroup = (label, items) => {
      if (!items.length) return;
      const grp = document.createElement("optgroup");
      grp.label = label;
      items.forEach(model => {
        const opt = document.createElement("option");
        opt.value = model.name;
        const isCloud = model.category === "cloud" || model.provider === "google" || model.provider === "minimax" || model.name.includes(":cloud");
        const badge = state.favoriteModels.includes(model.name) ? "★ " : (isCloud ? "☁️ " : (model.installed ? "💻 " : "📥 "));
        const hwSpeed = model.hardware_profile?.estimated_tokens_per_sec ? ` · ${model.hardware_profile.estimated_tokens_per_sec}` : "";
        const sizeInfo = isCloud ? "Cloud API (0 RAM)" : (model.installed ? formatBytes(model.size) : `${model.download_size_est || "Download"}`);
        opt.textContent = `${badge}${model.display_name || model.name} (${model.parameter_size || sizeInfo}${hwSpeed})`;
        grp.appendChild(opt);
      });
      select.appendChild(grp);
    };

    addGroup("★ Favorited Models", favs);
    addGroup("☁️ Cloud Frontier Models (Zero Host RAM Load)", cloudModels);
    addGroup("💻 Installed Local Models", localInstalled);
    addGroup("📦 Open-Weights Catalog (Ready to Pull)", downloadable);

    if (state.model && filtered.some(m => m.name === state.model)) {
      select.value = state.model;
    } else if (filtered.length > 0) {
      select.value = filtered[0].name;
    }
  },

  renderWorkspacePanel(category = "all", searchQuery = "") {
    const list = document.getElementById("tab-models-list");
    if (!list) return;

    this.activeCategoryFilter = category;
    const q = (searchQuery || document.getElementById("tab-model-search")?.value || "").toLowerCase().trim();

    let models = this.cachedCatalog;
    if (category === "favorites") {
      models = models.filter(m => state.favoriteModels.includes(m.name));
    } else if (category === "cloud") {
      models = models.filter(m => m.category === "cloud" || m.provider === "google" || m.provider === "minimax" || m.name.includes(":cloud"));
    } else if (category === "installed") {
      models = models.filter(m => m.installed);
    } else if (category === "best_fit") {
      models = models.filter(m => m.machine_fit?.status === "optimal" || m.machine_fit?.status === "cloud_zero_load");
    } else if (category !== "all") {
      models = models.filter(m => m.category === category || (m.tags && m.tags.includes(category)));
    }

    if (q) {
      models = models.filter(m =>
        m.name.toLowerCase().includes(q) ||
        (m.display_name && m.display_name.toLowerCase().includes(q)) ||
        (m.provider_display && m.provider_display.toLowerCase().includes(q)) ||
        (m.description && m.description.toLowerCase().includes(q)) ||
        (m.tags && m.tags.some(t => t.toLowerCase().includes(q))) ||
        (m.machine_fit?.recommendation && m.machine_fit.recommendation.toLowerCase().includes(q))
      );
    }

    const hostBannerHtml = this.renderHostHardwareBanner();

    if (!models.length) {
      list.innerHTML = `${hostBannerHtml}<p class="empty-state">No models match the filter "${category}" ${q ? `with query "${q}"` : ""}.</p>`;
      return;
    }

    const cardsHtml = models.map(model => {
      const isActive = model.name === state.model;
      const isFav = state.favoriteModels.includes(model.name);
      const isCloud = model.category === "cloud" || model.provider === "google" || model.provider === "minimax" || model.name.includes(":cloud");
      const fit = model.machine_fit || {
        badge: isCloud ? "☁️ Zero Local RAM Load" : "⚡ Local Execution",
        badge_class: isCloud ? "badge-fit-cloud" : "badge-fit-optimal",
        recommendation: isCloud ? "Runs over cloud connection with 0 MB local host memory required." : "Runs locally on your host CPU / GPU."
      };
      const hw = model.hardware_profile || {};

      return `
        <article class="model-list-card ${isActive ? 'active-model' : ''}" data-model="${model.name}">
          <div class="model-card-top">
            <div class="model-card-title-group">
              <strong class="model-card-title">${model.display_name || model.name}</strong>
              <span class="model-card-provider">${model.provider_display || (isCloud ? "Cloud Frontier" : "Local Open-Weights")} · <code style="font-size:10px;">${model.name}</code></span>
            </div>
            <div class="model-card-badges">
              ${isFav ? '<span class="model-badge-fav" title="Favorited">★</span>' : ''}
              <span class="badge-machine-fit ${fit.badge_class}">${fit.badge}</span>
            </div>
          </div>

          <p class="model-card-desc">${model.description || "High-performance model for workspace automation, coding, and chat."}</p>

          <div class="model-hw-metrics">
            <div class="hw-metric-cell">
              <span class="hw-metric-label">RAM Req</span>
              <span class="hw-metric-val">${isCloud ? "0 MB" : `${hw.rec_ram_gb || hw.min_ram_gb || 4} GB`}</span>
            </div>
            <div class="hw-metric-cell">
              <span class="hw-metric-label">Est. Speed</span>
              <span class="hw-metric-val" style="color:var(--accent);">${hw.estimated_tokens_per_sec || (isCloud ? "~120 tok/s" : "~45 tok/s")}</span>
            </div>
            <div class="hw-metric-cell">
              <span class="hw-metric-label">Latency</span>
              <span class="hw-metric-val">${hw.time_to_first_token_ms || (isCloud ? "<200ms" : "~350ms")}</span>
            </div>
            <div class="hw-metric-cell">
              <span class="hw-metric-label">Context</span>
              <span class="hw-metric-val">${model.context_window || "32k"}</span>
            </div>
          </div>

          <div class="model-card-tags">
            ${(model.tags || []).map(t => `<span class="model-card-tag">#${t}</span>`).join("")}
          </div>

          <div class="model-card-footer">
            <span class="model-card-specs-brief">${model.parameter_size || "Standard"} · ${model.quantization_level || (isCloud ? "Cloud API" : "GGUF")}</span>
            <div class="model-card-buttons">
              <button type="button" class="secondary btn-model-specs" data-model="${model.name}" title="View Machine Compatibility & Technical Specs">Specs</button>
              ${isActive
                ? '<button type="button" class="primary" disabled style="opacity:0.8;">Active</button>'
                : (isCloud || model.installed
                    ? `<button type="button" class="primary btn-model-activate" data-model="${model.name}">Switch</button>`
                    : `<button type="button" class="secondary btn-model-pull" data-model="${model.name}">Pull (${model.download_size_est || "Download"})</button>`
                  )
              }
            </div>
          </div>
        </article>
      `;
    }).join("");

    list.innerHTML = `${hostBannerHtml}${cardsHtml}`;

    // Bind event handlers inside workspace panel
    list.querySelectorAll(".btn-model-activate").forEach(btn => {
      btn.onclick = () => modelHub.setActiveModel(btn.dataset.model);
    });
    list.querySelectorAll(".btn-model-specs").forEach(btn => {
      btn.onclick = () => modelHub.openSpecsModal(btn.dataset.model);
    });
    list.querySelectorAll(".btn-model-pull").forEach(btn => {
      btn.onclick = () => modelHub.pullModel(btn.dataset.model);
    });
  },

  setActiveModel(modelName) {
    if (!modelName) return;
    state.model = modelName;
    storage.set("model", state.model);

    const select = document.getElementById("model-select");
    if (select) select.value = state.model;

    const found = this.cachedCatalog.find(m => m.name === modelName);
    this.renderActiveHero(found || { name: modelName });
    updateFavoriteButton();
    updateSendState();

    // Re-render workspace panel if visible
    this.renderWorkspacePanel(this.activeCategoryFilter);

    notify("success", `Active model switched to ${found?.display_name || modelName}`);
  },

  toggleFavorite(modelName) {
    if (!modelName) return;
    state.favoriteModels = state.favoriteModels.includes(modelName)
      ? state.favoriteModels.filter(n => n !== modelName)
      : [...state.favoriteModels, modelName];
    storage.set("favorite-models", JSON.stringify(state.favoriteModels));
    updateFavoriteButton();
    this.populateDropdown(this.cachedCatalog, document.getElementById("model-search")?.value || "");
    this.renderWorkspacePanel(this.activeCategoryFilter);
  },

  openHubModal(initialCategory = "all") {
    let currentCat = initialCategory;
    const renderHubGrid = (cat, search = "") => {
      const q = search.toLowerCase().trim();
      let list = this.cachedCatalog;
      if (cat === "favorites") list = list.filter(m => state.favoriteModels.includes(m.name));
      else if (cat === "cloud") list = list.filter(m => m.category === "cloud" || m.provider === "google" || m.provider === "minimax" || m.name.includes(":cloud"));
      else if (cat === "installed") list = list.filter(m => m.installed);
      else if (cat === "best_fit") list = list.filter(m => m.machine_fit?.status === "optimal" || m.machine_fit?.status === "cloud_zero_load");
      else if (cat !== "all") list = list.filter(m => m.category === cat || (m.tags && m.tags.includes(cat)));

      if (q) {
        list = list.filter(m =>
          m.name.toLowerCase().includes(q) ||
          (m.display_name && m.display_name.toLowerCase().includes(q)) ||
          (m.provider_display && m.provider_display.toLowerCase().includes(q)) ||
          (m.description && m.description.toLowerCase().includes(q)) ||
          (m.tags && m.tags.some(t => t.toLowerCase().includes(q))) ||
          (m.machine_fit?.recommendation && m.machine_fit.recommendation.toLowerCase().includes(q))
        );
      }

      if (!list.length) {
        return '<p class="empty-state" style="grid-column: 1 / -1;">No matching models found in this category.</p>';
      }

      return list.map(m => {
        const isActive = m.name === state.model;
        const isFav = state.favoriteModels.includes(m.name);
        const isCloud = m.category === "cloud" || m.provider === "google" || m.provider === "minimax" || m.name.includes(":cloud");
        const fit = m.machine_fit || {
          badge: isCloud ? "☁️ Zero Local RAM" : "⚡ Local Execution",
          badge_class: isCloud ? "badge-fit-cloud" : "badge-fit-optimal",
          recommendation: isCloud ? "Runs over cloud connection with 0 MB local host memory required." : "Runs locally on your host."
        };
        const hw = m.hardware_profile || {};

        return `
          <div class="modal-hub-model-box ${isActive ? 'is-active' : ''}">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <span class="model-provider-badge">${m.provider_display || (isCloud ? "Cloud" : "Local")}</span>
                <button type="button" class="icon-button hub-fav-btn" data-model="${m.name}" title="Toggle Favorite" style="padding:0; border:0; font-size:14px; color:${isFav ? '#f59e0b' : 'var(--text-muted)'}; background:transparent;">${isFav ? '★' : '☆'}</button>
              </div>
              <h4 style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
                <span>${m.display_name || m.name}</span>
                <span class="badge-machine-fit ${fit.badge_class}" style="font-size:9px; padding:1px 6px;">${fit.badge}</span>
              </h4>
              <p style="margin-top:4px;">${m.description || ""}</p>
              
              <div class="model-hw-metrics" style="margin-top:6px;">
                <div class="hw-metric-cell">
                  <span class="hw-metric-label">RAM Req</span>
                  <span class="hw-metric-val">${isCloud ? "0 MB" : `${hw.rec_ram_gb || hw.min_ram_gb || 4} GB`}</span>
                </div>
                <div class="hw-metric-cell">
                  <span class="hw-metric-label">Speed</span>
                  <span class="hw-metric-val" style="color:var(--accent);">${hw.estimated_tokens_per_sec || (isCloud ? "~120 t/s" : "~45 t/s")}</span>
                </div>
                <div class="hw-metric-cell">
                  <span class="hw-metric-label">Context</span>
                  <span class="hw-metric-val">${m.context_window || "32k"}</span>
                </div>
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; border-top:1px solid var(--border); padding-top:8px;">
              <button type="button" class="secondary hub-specs-btn" data-model="${m.name}" style="font-size:11px; padding:3px 8px; width:auto;">Specs</button>
              ${isActive
                ? '<span class="badge" style="background:var(--accent); color:#fff; font-size:10px;">Active</span>'
                : (isCloud || m.installed
                    ? `<button type="button" class="primary hub-switch-btn" data-model="${m.name}" style="font-size:11px; padding:4px 10px; width:auto;">Select</button>`
                    : `<button type="button" class="secondary hub-pull-btn" data-model="${m.name}" style="font-size:11px; padding:4px 8px; width:auto;">Pull (${m.download_size_est || "Download"})</button>`
                  )
              }
            </div>
          </div>
        `;
      }).join("");
    };

    const hostBannerHtml = this.renderHostHardwareBanner("modal-host-banner");

    showModal(
      "✨ AI Model Hub & Machine Compatibility",
      `
      ${hostBannerHtml}
      <div class="modal-hub-search-bar">
        <input id="modal-hub-search-input" placeholder="Search models by name, machine fit, tags, architecture, provider…" autofocus />
      </div>
      <div class="models-tab-filter-pills" id="modal-hub-filter-pills" style="margin-bottom: 12px;">
        <button class="filter-pill ${currentCat === 'all' ? 'active' : ''}" data-cat="all">All</button>
        <button class="filter-pill ${currentCat === 'favorites' ? 'active' : ''}" data-cat="favorites">★ Favorites</button>
        <button class="filter-pill ${currentCat === 'best_fit' ? 'active' : ''}" data-cat="best_fit">⚡ Best Machine Fit</button>
        <button class="filter-pill ${currentCat === 'cloud' ? 'active' : ''}" data-cat="cloud">☁️ Cloud Frontier</button>
        <button class="filter-pill ${currentCat === 'installed' ? 'active' : ''}" data-cat="installed">💻 Local Installed</button>
        <button class="filter-pill ${currentCat === 'reasoning' ? 'active' : ''}" data-cat="reasoning">🧠 Reasoning</button>
        <button class="filter-pill ${currentCat === 'coding' ? 'active' : ''}" data-cat="coding">💻 Coding</button>
        <button class="filter-pill ${currentCat === 'vision' ? 'active' : ''}" data-cat="vision">👁️ Vision</button>
      </div>
      <div class="modal-hub-body" id="modal-hub-grid">
        ${renderHubGrid(currentCat)}
      </div>
      `,
      `
      <div class="modal-actions" style="justify-content:space-between; align-items:center;">
        <button type="button" class="secondary" id="modal-pull-custom-btn" style="width:auto;">＋ Pull Custom Model</button>
        <button type="button" class="primary modal-close" style="width:auto;">Done</button>
      </div>
      `
    );

    // Expand modal card sizing for Model Hub
    document.querySelector("#modal .modal-card")?.classList.add("modal-model-hub");

    const grid = document.getElementById("modal-hub-grid");
    const searchInput = document.getElementById("modal-hub-search-input");
    const pills = document.querySelectorAll("#modal-hub-filter-pills .filter-pill");

    const refreshGrid = () => {
      if (grid) {
        grid.innerHTML = renderHubGrid(currentCat, searchInput?.value || "");
        bindGridActions();
      }
    };

    const bindGridActions = () => {
      grid.querySelectorAll(".hub-switch-btn").forEach(btn => {
        btn.onclick = () => {
          modelHub.setActiveModel(btn.dataset.model);
          refreshGrid();
        };
      });
      grid.querySelectorAll(".hub-fav-btn").forEach(btn => {
        btn.onclick = () => {
          modelHub.toggleFavorite(btn.dataset.model);
          refreshGrid();
        };
      });
      grid.querySelectorAll(".hub-specs-btn").forEach(btn => {
        btn.onclick = () => {
          modelHub.openSpecsModal(btn.dataset.model);
        };
      });
      grid.querySelectorAll(".hub-pull-btn").forEach(btn => {
        btn.onclick = () => {
          modelHub.pullModel(btn.dataset.model);
        };
      });
    };

    pills.forEach(pill => {
      pill.onclick = () => {
        pills.forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        currentCat = pill.dataset.cat;
        refreshGrid();
      };
    });

    if (searchInput) {
      let timer;
      searchInput.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(refreshGrid, 120);
      };
    }

    document.getElementById("modal-pull-custom-btn")?.addEventListener("click", () => {
      const custom = prompt("Enter Ollama model tag to pull (e.g. llama3.1, deepseek-r1:14b, mistral, codellama):");
      if (custom?.trim()) {
        modelHub.pullModel(custom.trim());
      }
    });

    bindGridActions();
  },

  async openSpecsModal(modelName) {
    let model = this.cachedCatalog.find(m => m.name === modelName);
    if (!model) {
      try {
        model = await api.model(modelName);
      } catch {
        model = { name: modelName, display_name: modelName };
      }
    }

    const isCloud = model.category === "cloud" || model.provider === "google" || model.provider === "minimax" || model.name.includes(":cloud");
    const caps = model.capabilities || ["chat", "streaming"];
    const useCases = model.use_cases || ["General reasoning and workspace execution"];
    const tags = model.tags || [];
    const hw = model.hardware_profile || {};
    const fit = model.machine_fit || {
      badge: isCloud ? "☁️ Zero Local Hardware Load (Cloud)" : "⚡ Local Execution",
      badge_class: isCloud ? "badge-fit-cloud" : "badge-fit-optimal",
      headline: isCloud ? "Frontier Cloud Inference — 0 MB Local RAM / VRAM used" : "Runs locally on this machine with direct hardware offloading",
      recommendation: isCloud ? "Executes over encrypted cloud connection. Local host CPU, RAM, and GPU remain 100% free." : "Executes locally via Ollama. Performance depends on host RAM and GPU VRAM."
    };
    const scores = hw.benchmark_scores || { coding: 90, reasoning: 92, speed: 95, context: 95 };

    showModal(
      `🔬 Model Specs & Machine Execution: ${model.display_name || model.name}`,
      `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="color:var(--text); font-weight:600; font-size:13px;">${model.display_name || model.name}</span>
        <span class="badge-machine-fit ${fit.badge_class}">${fit.badge}</span>
      </div>
      <p style="color:var(--text-muted); font-size:12px; margin:0 0 10px;">${model.description || "Specifications, hardware requirements, and execution details."}</p>
      
      <!-- Machine Fit & Execution Profile -->
      <div class="machine-run-card">
        <div class="machine-run-header">
          <span class="machine-run-title">🖥️ How This Model Runs On Your Machine</span>
          <span style="font-size:10px; font-family:var(--mono); color:var(--accent);">${hw.execution_type === 'cloud_api' ? 'Cloud Cluster' : 'Local Host'}</span>
        </div>
        <p style="font-weight:600; font-size:12px; color:var(--text); margin:2px 0;">${fit.headline || ""}</p>
        <p class="machine-run-rec">${fit.recommendation || ""}</p>
        
        <div class="model-hw-metrics" style="margin-top:6px;">
          <div class="hw-metric-cell">
            <span class="hw-metric-label">Min RAM</span>
            <span class="hw-metric-val">${isCloud ? "0 MB" : `${hw.min_ram_gb || 4} GB`}</span>
          </div>
          <div class="hw-metric-cell">
            <span class="hw-metric-label">Rec RAM</span>
            <span class="hw-metric-val">${isCloud ? "0 MB" : `${hw.rec_ram_gb || 8} GB`}</span>
          </div>
          <div class="hw-metric-cell">
            <span class="hw-metric-label">VRAM Target</span>
            <span class="hw-metric-val">${isCloud ? "0 GB" : `${hw.rec_vram_gb || 0} GB`}</span>
          </div>
          <div class="hw-metric-cell">
            <span class="hw-metric-label">Est. Speed</span>
            <span class="hw-metric-val" style="color:var(--accent);">${hw.estimated_tokens_per_sec || "~80 tok/s"}</span>
          </div>
          <div class="hw-metric-cell">
            <span class="hw-metric-label">TTFT Latency</span>
            <span class="hw-metric-val">${hw.time_to_first_token_ms || "<200ms"}</span>
          </div>
        </div>
      </div>

      <!-- Technical Architecture Specs Grid -->
      <div class="spec-grid" style="margin-top:10px;">
        <div class="spec-item">
          <span class="spec-label">Model Identifier</span>
          <span class="spec-value">${model.name}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Provider & Architecture</span>
          <span class="spec-value">${model.provider_display || (isCloud ? "Cloud Frontier" : "Open-Weights")}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Parameter Size</span>
          <span class="spec-value">${model.parameter_size || (isCloud ? "Frontier Scale" : "Standard")}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Context Window</span>
          <span class="spec-value" style="color:var(--accent); font-weight:600;">${model.context_window || "32,000 tokens"}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Quantization / Delivery</span>
          <span class="spec-value">${model.quantization_level || (isCloud ? "Cloud API (Zero VRAM)" : "GGUF Q4_K_M")}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Installation Status</span>
          <span class="spec-value">${isCloud ? "Cloud Active (Instant)" : (model.installed ? "Local Ready" : "Available to Pull")}</span>
        </div>
      </div>

      <!-- Performance Benchmark Meters -->
      <div style="margin-top:10px; background:var(--surface-raised); padding:10px 12px; border-radius:var(--radius-md); border:1px solid var(--border);">
        <span class="spec-label" style="display:block; margin-bottom:6px;">Performance Benchmark Indices</span>
        <div class="benchmark-row">
          <span class="benchmark-label">Coding</span>
          <div class="benchmark-track"><div class="benchmark-fill" style="width:${scores.coding}%;"></div></div>
          <span class="benchmark-val">${scores.coding}%</span>
        </div>
        <div class="benchmark-row">
          <span class="benchmark-label">Reasoning</span>
          <div class="benchmark-track"><div class="benchmark-fill" style="width:${scores.reasoning}%; background: #10b981;"></div></div>
          <span class="benchmark-val">${scores.reasoning}%</span>
        </div>
        <div class="benchmark-row">
          <span class="benchmark-label">Speed/TTFT</span>
          <div class="benchmark-track"><div class="benchmark-fill" style="width:${scores.speed}%; background: #f59e0b;"></div></div>
          <span class="benchmark-val">${scores.speed}%</span>
        </div>
        <div class="benchmark-row">
          <span class="benchmark-label">Context Depth</span>
          <div class="benchmark-track"><div class="benchmark-fill" style="width:${scores.context}%; background: #8b5cf6;"></div></div>
          <span class="benchmark-val">${scores.context}%</span>
        </div>
      </div>

      <div style="margin-top:10px;">
        <span class="spec-label">Model Capabilities</span>
        <div class="spec-caps-list">
          ${caps.map(c => `<span class="spec-cap-pill">✓ ${c}</span>`).join("")}
        </div>
      </div>

      <div style="margin-top:10px;">
        <span class="spec-label">Recommended Use Cases</span>
        <ul style="margin:4px 0 0 16px; padding:0; font-size:12px; color:var(--text-muted);">
          ${useCases.map(u => `<li>${u}</li>`).join("")}
        </ul>
      </div>

      <div style="margin-top:10px;">
        <span class="spec-label">Category Tags</span>
        <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;">
          ${tags.map(t => `<span class="model-card-tag">#${t}</span>`).join("")}
        </div>
      </div>
      `,
      `
      <div class="modal-actions">
        ${model.name !== state.model
          ? (isCloud || model.installed
              ? `<button type="button" class="primary" id="modal-specs-activate" data-model="${model.name}">Activate This Model</button>`
              : `<button type="button" class="primary" id="modal-specs-pull" data-model="${model.name}">Pull Model (${model.download_size_est || "Download"})</button>`
            )
          : '<button type="button" class="secondary" disabled>Currently Active Model</button>'
        }
        <button type="button" class="secondary modal-close">Close</button>
      </div>
      `
    );

    document.getElementById("modal-specs-activate")?.addEventListener("click", (e) => {
      modelHub.setActiveModel(e.currentTarget.dataset.model);
      closeModal();
    });
    document.getElementById("modal-specs-pull")?.addEventListener("click", (e) => {
      modelHub.pullModel(e.currentTarget.dataset.model);
      closeModal();
    });
  },

  async pullModel(name) {
    if (!name?.trim()) return;
    const trimmed = name.trim();
    notify("info", `Initiating download for ${trimmed}…`);

    const pullBtn = document.getElementById("pull-model");
    if (pullBtn) {
      pullBtn.disabled = true;
      pullBtn.textContent = `Pulling ${trimmed}…`;
    }

    try {
      const res = await api.pullModel(trimmed);
      if (!res.ok && res.status !== 200) {
        throw new Error(`Download request failed: ${res.statusText}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Stream response unavailable");

      const decoder = new TextDecoder();
      let buffer = "";
      let latestStatus = "Starting pull…";

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          const line = block.split("\n").find(x => x.startsWith("data: "));
          if (line) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.status) {
                latestStatus = parsed.status;
                if (parsed.completed && parsed.total) {
                  const pct = Math.round((parsed.completed / parsed.total) * 100);
                  latestStatus = `${parsed.status} (${pct}%)`;
                }
              }
            } catch {}
          }
        }

        if (pullBtn) pullBtn.textContent = latestStatus;
        if (done) break;
      }

      notify("success", `Model ${trimmed} successfully installed and ready!`);
      await loadModels();
      modelHub.setActiveModel(trimmed);
    } catch (err) {
      notify("error", `Model pull failed: ${err.message}`);
    } finally {
      if (pullBtn) {
        pullBtn.disabled = false;
        pullBtn.textContent = "＋ Pull model";
      }
    }
  },
};

async function loadModels() {
  state.modelRequest?.abort();
  state.modelRequest = new AbortController();
  const searchInput = document.getElementById("model-search");
  const clearBtn = document.getElementById("model-search-clear");
  if (clearBtn && searchInput) {
    clearBtn.classList.toggle("hidden", !searchInput.value);
  }

  setStatus("", "Checking models & connection…");
  try {
    await modelHub.fetchHardwareInfo();
    const models = await api.models("", state.modelRequest.signal);
    modelHub.cachedCatalog = models;

    modelHub.populateDropdown(models, searchInput?.value || "");

    // If current model is not set or not in catalog, fallback to MiniMax M3 default
    if (!state.model || !models.some(m => m.name === state.model)) {
      const preferred = models.find(m => m.name === "minimax-m3:cloud") || models[0];
      if (preferred) {
        state.model = preferred.name;
        storage.set("model", state.model);
      }
    }

    const currentObj = models.find(m => m.name === state.model) || { name: state.model };
    modelHub.renderActiveHero(currentObj);
    modelHub.renderWorkspacePanel(modelHub.activeCategoryFilter, document.getElementById("tab-model-search")?.value || "");

    updateFavoriteButton();
    updateSendState();
    setStatus("online", `Ready · ${models.length} models available`);
  } catch (error) {
    if (error.name === "AbortError") return;
    const select = document.getElementById("model-select");
    if (select) select.innerHTML = "<option value=''>Model server offline</option>";
    document.getElementById("current-model").textContent = "No model";
    updateSendState();
    setStatus("offline", "Server offline");
  }
}

function formatBytes(value) {
  if (!value || value === 0) return "Cloud AI";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = value, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

async function loadConversations() {
  const list = document.getElementById("conversation-list");
  try {
    const entries = await api.convs(document.getElementById("conversation-search")?.value || "", state.showArchived);
    list.innerHTML = entries.length ? "" : "<li class='empty-state'>No saved chats yet.</li>";
    entries.forEach(conversation => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.textContent = conversation.title || "Untitled chat";
      button.title = `${conversation.messages} messages`;
      button.classList.toggle("active", conversation.id === state.conversationId);
      button.tabIndex = 0;
      button.onclick = async () => {
        try {
          const full = await api.getConv(conversation.id);
          state.conversationId = full.id;
          state.messages = full.messages;
          state.model = full.model;
          state.options = full.options || state.options;
          document.getElementById("model-select").value = state.model;
          document.getElementById("current-model").textContent = state.model;
          messages.innerHTML = "";
          full.messages.filter(m => ["user", "assistant"].includes(m.role)).forEach(m => chat.addMessage(m.role, m.content || ""));
          setPanel(sidebar, false);
          restoreDraft(state.conversationId);
        } catch (e) {
          notify("error", `Failed to load conversation: ${e.message}`);
        }
      };
      const menu = document.createElement("button");
      menu.className = "conversation-menu icon-button";
      menu.textContent = "⋯";
      menu.title = "Conversation actions";
      menu.onclick = event => { event.stopPropagation(); conversationActions(conversation); };
      item.append(button, menu);
      list.appendChild(item);
    });
    const buttons = [...list.querySelectorAll("button")];
    buttons.forEach((button, index) => button.onkeydown = event => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    });
  } catch (e) { list.textContent = e.message; }
}

function conversationActions(conversation) {
  showModal("Conversation actions", `<p>${conversation.title || "Untitled chat"}</p>`, `<div class="modal-actions"><button class="secondary" id="rename-conversation">Rename</button><button class="secondary" id="duplicate-conversation">Duplicate</button><button class="secondary" id="pin-conversation">${conversation.pinned ? "Unpin" : "Pin"}</button><button class="secondary" id="archive-conversation">${conversation.archived ? "Unarchive" : "Archive"}</button><button class="danger" id="delete-conversation">Delete</button></div>`);
  document.getElementById("rename-conversation").onclick = async () => { const title = prompt("Conversation title", conversation.title || ""); if (title?.trim()) { await api.updateConv(conversation.id, { title: title.trim() }); closeModal(); loadConversations(); } };
  document.getElementById("duplicate-conversation").onclick = async () => { await api.duplicateConv(conversation.id); closeModal(); loadConversations(); };
  document.getElementById("pin-conversation").onclick = async () => { await api.updateConv(conversation.id, { pinned: !conversation.pinned }); closeModal(); loadConversations(); };
  document.getElementById("archive-conversation").onclick = async () => { await api.updateConv(conversation.id, { archived: !conversation.archived }); closeModal(); loadConversations(); };
  document.getElementById("delete-conversation").onclick = () => confirmAction("Delete conversation?", "This permanently removes the local saved record.", async () => { await api.delConv(conversation.id); loadConversations(); });
}

function selectTab(name) {
  document.querySelectorAll(".tab").forEach(tab => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === `tab-${name}`));
  storage.set("tab", name);
  if (name === "models") modelHub.renderWorkspacePanel(modelHub.activeCategoryFilter);
  if (name === "configure") configure.load();
  if (name === "integrations") integrations.load();
}

const integrations = {
  async load() {
    const pluginList = document.getElementById("plugin-list");
    const integrationList = document.getElementById("integration-list");
    try {
      const [plugins, catalog] = await Promise.all([api.plugins(), api.integrations()]);
      pluginList.replaceChildren(...(plugins.length ? plugins.map(item => this.card(item, true)) : [this.empty("No local plugins installed.")]));
      integrationList.replaceChildren(...(catalog.items?.length ? catalog.items.map(item => this.card(item, false)) : [this.empty("No integration targets published.")]));
    } catch (error) {
      pluginList.textContent = error.message;
      integrationList.textContent = error.message;
    }
  },
  empty(message) { const p = document.createElement("p"); p.className = "empty-state"; p.textContent = message; return p; },
  card(item, plugin) {
    const article = document.createElement("article"); article.className = "integration-card";
    const heading = document.createElement("div"); heading.className = "integration-card-heading";
    const title = document.createElement("strong"); title.textContent = item.name;
    const status = document.createElement("span"); status.className = "badge"; status.textContent = plugin ? `v${item.version}` : item.status;
    heading.append(title, status);
    const description = document.createElement("p"); description.textContent = item.description || `${item.kind || "Integration"} via ${item.transport || "local plugin"}.`;
    const details = document.createElement("p"); details.className = "field-help"; details.textContent = `${(item.platforms || []).join(", ")} · ${(item.capabilities || []).join(", ") || "manifest only"}`;
    article.append(heading, description, details); return article;
  },
};

function clearChat() {
  state.conversationId = null;
  state.messages = [];
  messages.innerHTML = document.getElementById("welcome")?.outerHTML || "";
  bindWelcomeCards();
  restoreDraft();
}

document.getElementById("new-chat").onclick = () => confirmAction("Start a new chat?", "The current unsent draft will be preserved, but this chat view will be cleared.", clearChat);

function bindWelcomeCards() {
  document.querySelectorAll(".welcome-card").forEach(card => card.onclick = () => {
    document.getElementById("input").value = card.dataset.prompt;
    document.getElementById("input").focus();
  });
}

document.getElementById("model-select").onchange = event => {
  modelHub.setActiveModel(event.target.value);
};

document.getElementById("favorite-model").onclick = () => {
  if (!state.model) return;
  modelHub.toggleFavorite(state.model);
};

function updateFavoriteButton() {
  const button = document.getElementById("favorite-model");
  if (!button) return;
  const favorite = state.favoriteModels.includes(state.model);
  button.textContent = favorite ? "★ Favorited" : "☆ Favorite";
  button.setAttribute("aria-pressed", String(favorite));
}

document.getElementById("refresh-models").onclick = loadModels;

// Model Hub & Hero Card Triggers
document.getElementById("open-model-hub-btn")?.addEventListener("click", () => modelHub.openHubModal("all"));
document.getElementById("browse-model-hub")?.addEventListener("click", () => modelHub.openHubModal("all"));
document.getElementById("active-model-card")?.addEventListener("click", () => modelHub.openHubModal("all"));
document.getElementById("current-model")?.addEventListener("click", () => modelHub.openHubModal("all"));

// Models Tab Filter Pills in Workspace Panel
document.querySelectorAll("#tab-model-filters .filter-pill").forEach(pill => {
  pill.addEventListener("click", () => {
    document.querySelectorAll("#tab-model-filters .filter-pill").forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    modelHub.renderWorkspacePanel(pill.dataset.cat);
  });
});

// Models Tab Search in Workspace Panel
document.getElementById("tab-model-search")?.addEventListener("input", (e) => {
  modelHub.renderWorkspacePanel(modelHub.activeCategoryFilter, e.target.value);
});

// Models Tab Refresh
document.getElementById("tab-refresh-models")?.addEventListener("click", loadModels);

// Search and Clear in Sidebar
const searchInput = document.getElementById("model-search");
const searchClearBtn = document.getElementById("model-search-clear");
if (searchInput) {
  searchInput.oninput = (() => {
    let timer;
    return () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (searchClearBtn) searchClearBtn.classList.toggle("hidden", !searchInput.value);
        modelHub.populateDropdown(modelHub.cachedCatalog, searchInput.value);
      }, 150);
    };
  })();
}
if (searchClearBtn && searchInput) {
  searchClearBtn.onclick = () => {
    searchInput.value = "";
    searchClearBtn.classList.add("hidden");
    modelHub.populateDropdown(modelHub.cachedCatalog, "");
    searchInput.focus();
  };
}

window.addEventListener("offline", () => setStatus("offline", "Browser offline"));
window.addEventListener("online", () => { setStatus("", "Rechecking connection…"); loadModels(); });
window.setInterval(() => { if (document.visibilityState !== "hidden" && !document.querySelector(".status-dot.busy")) loadModels(); }, 60000);

document.getElementById("model-details").onclick = () => {
  if (!state.model) return;
  modelHub.openSpecsModal(state.model);
};

document.getElementById("pull-model").onclick = () => {
  const name = prompt("Ollama model name or tag to pull (e.g., llama3.1, deepseek-r1:14b, mistral, codellama):", "llama3.1");
  if (name?.trim()) {
    modelHub.pullModel(name.trim());
  }
};

document.getElementById("model-search").oninput = (() => { let timer; return () => { clearTimeout(timer); timer = setTimeout(loadModels, 180); }; })();
document.getElementById("conversation-search").oninput = (() => { let timer; return () => { clearTimeout(timer); timer = setTimeout(loadConversations, 180); }; })();
document.getElementById("conversation-sort").onclick = () => { state.showArchived = !state.showArchived; loadConversations(); };

document.getElementById("generation-settings").onclick = () => {
  const o = state.options;
  showModal(
    "Generation settings",
    `<p>These settings configure Ollama and Gemini Cloud AI parameters.</p>
     <label>Temperature <input id="opt-temperature" type="number" min="0" max="2" step=".1" value="${o.temperature ?? 0.7}"></label>
     <label>Top-p <input id="opt-top-p" type="number" min="0" max="1" step=".05" value="${o.top_p ?? 0.9}"></label>
     <label>Top-k <input id="opt-top-k" type="number" min="1" max="200" value="${o.top_k ?? 40}"></label>
     <label>Seed <input id="opt-seed" type="number" min="0" max="2147483647" value="${o.seed ?? ""}"></label>
     <label>Context window <input id="opt-num-ctx" type="number" min="256" max="131072" value="${o.num_ctx ?? 4096}"></label>
     <label>Token limit <input id="opt-num-predict" type="number" min="-1" max="131072" value="${o.num_predict ?? -1}"></label>
     <fieldset style="margin-top: 10px; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 10px;">
       <legend style="padding: 0 6px; font-weight: 600;">✨ Gemini Specifics</legend>
       <label class="toggle" style="margin-bottom: 8px;"><input id="opt-grounding" type="checkbox" ${o.enableGrounding ? "checked" : ""}> Enable Google Search Grounding</label>
       <label>Voice (TTS)
         <select id="opt-tts-voice">
           <option value="Kore" ${o.ttsVoice === "Kore" ? "selected" : ""}>Kore (Natural Female)</option>
           <option value="Fenrir" ${o.ttsVoice === "Fenrir" ? "selected" : ""}>Fenrir (Warm Male)</option>
           <option value="Aoede" ${o.ttsVoice === "Aoede" ? "selected" : ""}>Aoede (Clear Female)</option>
           <option value="Puck" ${o.ttsVoice === "Puck" ? "selected" : ""}>Puck (Playful Male)</option>
           <option value="Charon" ${o.ttsVoice === "Charon" ? "selected" : ""}>Charon (Deep Male)</option>
         </select>
       </label>
       <label>Thinking Budget (Tokens for 3.7 Flash) <input id="opt-thinking-budget" type="number" min="0" max="65536" step="512" value="${o.thinkingBudget ?? 0}"></label>
     </fieldset>`,
    '<div class="modal-actions"><button class="secondary" id="reset-generation">Reset defaults</button><button class="primary" id="save-generation">Save settings</button></div>'
  );
  document.getElementById("reset-generation").onclick = () => {
    state.options = {};
    storage.set("generation-options", "{}");
    closeModal();
    notify("success", "Generation defaults restored");
  };
  document.getElementById("save-generation").onclick = async () => {
    state.options = {
      temperature: Number(document.getElementById("opt-temperature").value),
      top_p: Number(document.getElementById("opt-top-p").value),
      top_k: Number(document.getElementById("opt-top-k").value),
      num_ctx: Number(document.getElementById("opt-num-ctx").value),
      num_predict: Number(document.getElementById("opt-num-predict").value),
      enableGrounding: document.getElementById("opt-grounding").checked,
      ttsVoice: document.getElementById("opt-tts-voice").value,
      thinkingBudget: Number(document.getElementById("opt-thinking-budget").value) || 0,
    };
    const seed = document.getElementById("opt-seed").value;
    if (seed !== "") state.options.seed = Number(seed);
    storage.set("generation-options", JSON.stringify(state.options));
    if (state.conversationId) await api.updateConv(state.conversationId, { options: state.options });
    closeModal();
    notify("success", "Generation settings saved");
  };
};

const imageBtn = document.getElementById("gemini-image-btn");
if (imageBtn) {
  imageBtn.onclick = () => {
    showModal(
      "🎨 Generate Visual with Imagen 3 / Gemini",
      `<p>Create visuals using Google Imagen 3. Generated images can be saved to your workspace and pasted into conversation.</p>
       <label>Prompt
         <textarea id="img-prompt" rows="3" placeholder="A futuristic laboratory with holographic interface, clean lighting, 8k render..."></textarea>
       </label>
       <label>Aspect Ratio
         <select id="img-aspect-ratio">
           <option value="1:1">1:1 Square</option>
           <option value="16:9">16:9 Landscape</option>
           <option value="9:16">9:16 Portrait</option>
           <option value="4:3">4:3 Standard</option>
           <option value="3:4">3:4 Vertical</option>
         </select>
       </label>
       <label>Workspace File Name (optional)
         <input id="img-filename" placeholder="visual_asset.png" />
       </label>
       <div id="img-preview-container" style="margin-top: 10px; display: none; text-align: center;">
         <img id="img-result-preview" style="max-width: 100%; max-height: 280px; border-radius: 8px; border: 1px solid var(--border);" />
       </div>
       <p id="img-status" class="field-help" style="margin-top: 8px;"></p>`,
      `<div class="modal-actions">
         <button class="secondary modal-close">Cancel</button>
         <button class="primary" id="btn-do-generate-img">Generate Image</button>
         <button class="secondary hidden" id="btn-insert-chat-img">Insert in Chat</button>
       </div>`
    );

    let lastGeneratedDataUrl = "";

    document.getElementById("btn-do-generate-img").onclick = async () => {
      const promptText = document.getElementById("img-prompt").value.trim();
      if (!promptText) {
        notify("warning", "Please provide an image prompt");
        return;
      }
      const aspectRatio = document.getElementById("img-aspect-ratio").value;
      const savePath = document.getElementById("img-filename").value.trim();
      const statusEl = document.getElementById("img-status");
      const btn = document.getElementById("btn-do-generate-img");

      btn.disabled = true;
      btn.textContent = "Generating…";
      statusEl.textContent = "Sending request to Google Imagen 3…";

      try {
        const res = await api.geminiGenerateImage({
          prompt: promptText,
          aspectRatio,
          savePath: savePath || undefined,
        });

        if (res.image_url) {
          lastGeneratedDataUrl = res.image_url;
          const preview = document.getElementById("img-result-preview");
          preview.src = res.image_url;
          document.getElementById("img-preview-container").style.display = "block";
          document.getElementById("btn-insert-chat-img").classList.remove("hidden");
          statusEl.textContent = res.saved_path ? `Image saved to ${res.saved_path}` : "Visual generated successfully!";
          notify("success", "Visual asset created!");
          if (res.saved_path) files.load();
        }
      } catch (err) {
        statusEl.textContent = `Error: ${err.message}`;
        notify("error", `Image generation failed: ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = "Generate Image";
      }
    };

    document.getElementById("btn-insert-chat-img").onclick = () => {
      if (lastGeneratedDataUrl) {
        const promptText = document.getElementById("img-prompt").value.trim() || "Generated visual";
        const currentInput = document.getElementById("input").value;
        document.getElementById("input").value = (currentInput ? currentInput + "\n\n" : "") + `![${promptText}](${lastGeneratedDataUrl})`;
        document.getElementById("input").dispatchEvent(new Event("input"));
        closeModal();
      }
    };
  };
}

document.getElementById("toggle-theme").onclick = () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  storage.set("theme", theme);
};

function preferencesSnapshot() {
  const values = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("mini-o.")) values[key.slice(8)] = localStorage.getItem(key);
  }
  return { format: "mini-o.preferences", version: 1, values };
}

function downloadJson(name, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function applyAppearance() {
  const selected = storage.get("theme", "dark");
  document.documentElement.dataset.theme = selected === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : selected;
  document.documentElement.dataset.density = storage.get("density", "comfortable");
  document.documentElement.dataset.fontSize = storage.get("font-size", "normal");
  document.documentElement.dataset.messageWidth = storage.get("message-width", "standard");
}

function openSettings() {
  const theme = storage.get("theme", "dark"), density = storage.get("density", "comfortable"), fontSize = storage.get("font-size", "normal"), width = storage.get("message-width", "standard");
  showModal(
    "Settings & Diagnostics",
    `<input id="setting-filter" placeholder="Search settings…" aria-label="Search settings">
     <fieldset><legend>Appearance</legend>
       <label>Theme <select id="pref-theme"><option>system</option><option>light</option><option>dark</option><option>high-contrast</option></select></label>
       <label>Density <select id="pref-density"><option>comfortable</option><option>compact</option></select></label>
       <label>Font size <select id="pref-font"><option>normal</option><option>small</option><option>large</option></select></label>
       <label>Message width <select id="pref-width"><option>standard</option><option>narrow</option><option>wide</option></select></label>
     </fieldset>
     <fieldset><legend>System Health & Error Diagnostics</legend>
       <p>Mini-O maintains active real-time diagnostics for network connections, model streams, file concurrency, and sandbox execution.</p>
       <div class="modal-actions" style="justify-content: flex-start; margin-top: 6px;">
         <button class="secondary" id="settings-open-diagnostics">Open Diagnostics Log Viewer</button>
       </div>
     </fieldset>`,
    '<div class="modal-actions"><button class="secondary" id="reset-settings">Reset appearance</button><button class="secondary" id="export-preferences">Export preferences</button><button class="secondary" id="import-preferences">Import preferences</button><button class="secondary" id="send-feedback">Feedback</button><button class="primary" id="save-appearance">Save settings</button></div>'
  );
  document.getElementById("pref-theme").value = theme;
  document.getElementById("pref-density").value = density;
  document.getElementById("pref-font").value = fontSize;
  document.getElementById("pref-width").value = width;

  document.getElementById("settings-open-diagnostics")?.addEventListener("click", () => {
    closeModal();
    showDiagnosticsModal();
  });

  document.getElementById("setting-filter").oninput = event => {
    const needle = event.target.value.toLowerCase();
    document.querySelectorAll("#modal label, #modal fieldset").forEach(item => item.hidden = needle && !item.textContent.toLowerCase().includes(needle));
  };
  document.getElementById("reset-settings").onclick = () => {
    ["theme", "density", "font-size", "message-width"].forEach(key => localStorage.removeItem(`mini-o.${key}`));
    applyAppearance();
    notify("success", "Appearance reset");
  };
  document.getElementById("save-appearance").onclick = () => {
    storage.set("theme", document.getElementById("pref-theme").value);
    storage.set("density", document.getElementById("pref-density").value);
    storage.set("font-size", document.getElementById("pref-font").value);
    storage.set("message-width", document.getElementById("pref-width").value);
    applyAppearance();
    closeModal();
    notify("success", "Settings saved");
  };
  document.getElementById("export-preferences").onclick = () => downloadJson("mini-o-preferences.json", preferencesSnapshot());
  document.getElementById("import-preferences").onclick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      try {
        const payload = JSON.parse(await input.files[0].text());
        if (payload.format !== "mini-o.preferences" || payload.version !== 1) throw new Error("Unsupported preferences file");
        Object.entries(payload.values || {}).forEach(([key, value]) => localStorage.setItem(`mini-o.${key}`, value));
        applyAppearance();
        notify("success", "Preferences imported");
      } catch (error) {
        notify("error", error.message);
      }
    };
    input.click();
  };
  document.getElementById("send-feedback").onclick = async () => {
    const description = prompt("Describe the issue or feedback");
    if (description?.trim()) {
      await api.feedback({ description: description.trim() });
      notify("success", "Feedback saved locally");
    }
  };
}

const settingsGroups = new MutationObserver(() => {
  const modal = document.getElementById("modal");
  if (!modal?.textContent.includes("Settings & Diagnostics") || modal.querySelector(".settings-groups")) return;
  const groups = document.createElement("div");
  groups.className = "settings-groups";
  ["General", "Appearance", "Models", "Workspace", "Diagnostics"].forEach(name => {
    const item = document.createElement("span");
    item.className = "badge";
    item.textContent = name;
    groups.appendChild(item);
  });
  modal.querySelector(".modal-card")?.prepend(groups);
});
settingsGroups.observe(document.getElementById("modal"), { childList: true, subtree: true });

document.getElementById("open-about").onclick = async () => {
  let pkgInfo = {
    available: true,
    platforms: {
      windows: {
        available: true,
        filename: "mini-o-0.1.0-windows-x64.zip",
        size: 920000,
        quick_start: "Expand-Archive mini-o-0.1.0-windows-x64.zip && cd mini-o-windows && .\\start-mini-o.bat",
      },
      debian: {
        available: true,
        filename: "mini-o_0.1.0-1_amd64.deb",
        size: 897440,
        install_command: "sudo dpkg -i mini-o_0.1.0-1_amd64.deb && sudo apt-get install -f",
      },
    },
  };

  try {
    const res = await fetch("/api/package/info");
    if (res.ok) {
      const data = await res.json();
      if (data.platforms) pkgInfo = data;
    }
  } catch {
    // fallback
  }

  const winPkg = pkgInfo.platforms?.windows || { filename: "mini-o-0.1.0-windows-x64.zip", size: 920000, quick_start: "Expand-Archive mini-o-0.1.0-windows-x64.zip ; .\\start-mini-o.bat" };
  const debPkg = pkgInfo.platforms?.debian || { filename: "mini-o_0.1.0-1_amd64.deb", size: 897440, install_command: "sudo dpkg -i mini-o_0.1.0-1_amd64.deb && sudo apt-get install -f" };
  const winSizeKb = winPkg.size ? `${Math.round(winPkg.size / 1024)} KB` : "900 KB";
  const debSizeKb = debPkg.size ? `${Math.round(debPkg.size / 1024)} KB` : "880 KB";

  showModal(
    "About Mini-O / Redrum AI",
    `<p>Mini-O is a local-first personal AI workspace and companion with resilient error diagnostics and local Ollama execution on Windows and Linux.</p>
     <ul>
       <li><strong>Version:</strong> 0.1.0-1</li>
       <li><strong>Cross-Platform Support:</strong> Windows 10/11 (Native x64/ARM64) &amp; Linux (Debian/Ubuntu/WSL2)</li>
       <li><strong>Windows Launchers:</strong> Batch (<code>mini-o.cmd</code>, <code>start-mini-o.bat</code>), PowerShell (<code>mini-o.ps1</code>), VBScript (<code>mini-o.vbs</code>), and Inno Setup (<code>installer.iss</code>)</li>
       <li><strong>Diagnostics:</strong> Full Client &amp; Server Trace Hierarchy</li>
       <li><strong>Privacy:</strong> Local-first storage and approved workspace roots</li>
     </ul>

     <div class="platform-tabs" role="tablist">
       <button type="button" class="platform-tab-btn active" data-target="win-view">🪟 Windows (.zip / .bat / .ps1)</button>
       <button type="button" class="platform-tab-btn" data-target="deb-view">🐧 Linux (.deb)</button>
     </div>

     <div id="win-view" class="win-card">
       <div class="win-card-header">
         <span class="win-title">🪟 Windows Native Portable Distribution</span>
         <span class="badge badge-server">${winPkg.filename}</span>
         <span class="badge">${winSizeKb}</span>
       </div>
       <p class="field-help" style="margin:0;">Double-click <code>start-mini-o.bat</code> or run in PowerShell:</p>
       <div class="win-snippet">${winPkg.quick_start || "Expand-Archive mini-o-0.1.0-windows-x64.zip ; cd mini-o-windows ; .\\start-mini-o.bat"}</div>
       <div class="win-actions">
         <a href="/api/download/windows" class="btn-download-win" download="${winPkg.filename}">⬇ Download Windows Package (.zip)</a>
         <button type="button" class="secondary" id="copy-win-cmd" data-cmd="${winPkg.quick_start || "Expand-Archive mini-o-0.1.0-windows-x64.zip ; cd mini-o-windows ; .\\start-mini-o.bat"}">📋 Copy PowerShell Command</button>
       </div>
     </div>

     <div id="deb-view" class="deb-card hidden">
       <div class="deb-card-header">
         <span class="deb-title">📦 Debian Package (.deb) Distribution</span>
         <span class="badge badge-server">${debPkg.filename}</span>
         <span class="badge">${debSizeKb}</span>
       </div>
       <p class="field-help" style="margin:0;">Test or deploy on Debian, Ubuntu, Linux Mint, Pop!_OS, or WSL2.</p>
       <div class="deb-snippet">${debPkg.install_command || `sudo dpkg -i ${debPkg.filename} && sudo apt-get install -f`}</div>
       <div class="deb-actions">
         <a href="/api/download/deb" class="btn-download-deb" download="${debPkg.filename}">⬇ Download .deb Package</a>
         <button type="button" class="secondary" id="copy-install-cmd" data-cmd="${debPkg.install_command || `sudo dpkg -i ${debPkg.filename} && sudo apt-get install -f`}">📋 Copy Install Command</button>
       </div>
     </div>`,
    '<div class="modal-actions"><button class="secondary" id="open-diagnostics-btn">Diagnostic Center</button><button class="secondary" id="open-settings">Settings & privacy</button><button class="primary modal-close">Close</button></div>'
  );

  document.querySelectorAll(".platform-tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".platform-tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const targetId = btn.dataset.target;
      const winView = document.getElementById("win-view");
      const debView = document.getElementById("deb-view");
      if (targetId === "win-view") {
        winView?.classList.remove("hidden");
        debView?.classList.add("hidden");
      } else {
        debView?.classList.remove("hidden");
        winView?.classList.add("hidden");
      }
    };
  });

  document.getElementById("copy-win-cmd")?.addEventListener("click", (e) => {
    const cmd = e.currentTarget.dataset.cmd;
    navigator.clipboard?.writeText(cmd);
    notify("success", "PowerShell launch command copied to clipboard");
  });

  document.getElementById("copy-install-cmd")?.addEventListener("click", (e) => {
    const cmd = e.currentTarget.dataset.cmd;
    navigator.clipboard?.writeText(cmd);
    notify("success", "Debian install command copied to clipboard");
  });
};

document.addEventListener("click", event => {
  if (event.target.id === "open-settings") { closeModal(); openSettings(); }
  if (event.target.id === "open-diagnostics-btn") { closeModal(); showDiagnosticsModal(); }
});

document.getElementById("modal").onclick = event => {
  if (event.target.id === "modal" || event.target.classList.contains("modal-close")) closeModal();
};

document.getElementById("enable-tools").checked = state.useTools;
document.getElementById("enable-tools").onchange = event => {
  state.useTools = event.target.checked;
  storage.set("tools", state.useTools);
};
const confirmTools = document.getElementById("confirm-tools");
confirmTools.checked = JSON.parse(storage.get("confirmedTools", "[]")).length > 0;
confirmTools.onchange = event => storage.set("confirmedTools", JSON.stringify(event.target.checked ? ["write_file", "run_python", "run_shell", "web_fetch"] : []));

document.querySelectorAll(".tab").forEach(tab => tab.onclick = () => selectTab(tab.dataset.tab));
document.querySelectorAll(".tab").forEach((tab, index, tabs) => tab.onkeydown = event => {
  if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key.includes("Left") || event.key.includes("Up") ? -1 : 1) + tabs.length) % tabs.length;
  tabs[next].focus(); tabs[next].click();
});

document.getElementById("open-files").onclick = () => { setPanel(rightPanel, true); selectTab("files"); };
document.getElementById("toggle-right-panel").onclick = () => setPanel(rightPanel, rightPanel.classList.contains("collapsed"));
document.getElementById("close-right-panel").onclick = () => setPanel(rightPanel, false);
document.getElementById("toggle-sidebar").onclick = () => setPanel(sidebar, sidebar.classList.contains("collapsed"));
scrim.onclick = () => { setPanel(sidebar, false); setPanel(rightPanel, false); };

document.getElementById("attach").onclick = async () => {
  setPanel(rightPanel, true); selectTab("files");
  notify("success", "Choose a file from Workspace; double-click attaches it.");
};

document.addEventListener("mini-o:attach", async event => {
  const path = event.detail?.path;
  if (!path || state.attachedFiles.includes(path)) return;
  try {
    await api.read(path);
    state.attachedFiles.push(path);
    renderAttachments();
    notify("success", `Attached ${path}`);
  } catch (e) {
    notify("error", e.message);
  }
});

document.addEventListener("mini-o:insert-context", event => {
  const input = document.getElementById("input");
  input.value += `${input.value ? "\n\n" : ""}[Workspace context: ${event.detail.path}]\n${event.detail.preview}`;
  input.dispatchEvent(new Event("input"));
  input.focus();
  notify("success", `Inserted context from ${event.detail.path}`);
});

function renderAttachments() {
  const activeFiles = document.getElementById("active-files");
  activeFiles.innerHTML = "";
  state.attachedFiles.forEach((file, index) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.draggable = true;
    chip.dataset.index = index;
    chip.textContent = file;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${file}`);
    remove.onclick = () => {
      state.attachedFiles = state.attachedFiles.filter(item => item !== file);
      renderAttachments();
    };
    chip.appendChild(remove);
    chip.ondragover = event => event.preventDefault();
    chip.ondrop = event => {
      const from = Number(event.dataTransfer.getData("text/plain"));
      if (!Number.isInteger(from)) return;
      const [item] = state.attachedFiles.splice(from, 1);
      state.attachedFiles.splice(index, 0, item);
      renderAttachments();
    };
    chip.ondragstart = event => event.dataTransfer.setData("text/plain", String(index));
    activeFiles.appendChild(chip);
  });
}

document.getElementById("agent-save").onclick = async () => {
  try {
    await configure.save();
    notify("success", "Agent instructions saved");
  } catch (e) {
    notify("error", e.message);
  }
};
document.getElementById("workspace-config-save").onclick = async () => {
  try {
    await configure.saveWorkspace();
    notify("success", "File access updated");
  } catch (e) {
    notify("error", e.message);
  }
};
document.getElementById("workspace-config-reload").onclick = () => configure.load().catch(error => notify("error", error.message));
document.getElementById("refresh-integrations").onclick = () => integrations.load().catch(error => notify("error", error.message));

document.getElementById("agent-new").onclick = () => {
  document.getElementById("agent-path").value = "AGENT.md";
  document.getElementById("agent-text").value = "# Agent instructions\n\n";
};

document.getElementById("agent-template").onclick = async () => {
  try {
    const templates = await api.agentTemplates();
    showModal("AGENT.md templates", templates.map(t => `<button class="template-choice" data-template="${t.id}">${t.name}</button>`).join(""));
    document.querySelectorAll(".template-choice").forEach(button => button.onclick = () => {
      const template = templates.find(t => t.id === button.dataset.template);
      document.getElementById("agent-path").value = document.getElementById("agent-path").value || "AGENT.md";
      document.getElementById("agent-text").value = template.content;
      closeModal();
    });
  } catch (e) {
    notify("error", e.message);
  }
};

bindWelcomeCards();
const input = document.getElementById("input");
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
});
input.addEventListener("input", saveDraft);

document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && (event.key === "m" || event.key === "M")) {
    event.preventDefault();
    modelHub.openHubModal("all");
    return;
  }
  if (event.key === "Escape") {
    if (!document.getElementById("modal").classList.contains("hidden")) { closeModal(); return; }
  } else return;
  const editor = document.getElementById("file-editor");
  if (!editor.classList.contains("hidden")) { editor.classList.add("hidden"); return; }
  setPanel(sidebar, false); setPanel(rightPanel, false);
});

applyAppearance();
document.querySelector(".shortcut-hint").textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↵ to send · ⇧↵ newline" : "Enter to send · Shift+Enter newline";
const savedTab = storage.get("tab", "files");
selectTab(savedTab);
setPanel(sidebar, storage.get("sidebar-open", "true") !== "false");
setPanel(rightPanel, storage.get("workspace-open", "true") !== "false");
loadModels(); loadConversations(); files.load(); tools.render(); restoreDraft();

api.recovery().then(records => {
  if (records.length) notify("warning", `${records.length} conversation${records.length === 1 ? "" : "s"} can be recovered after an interrupted stream`);
}).catch(() => {});

requestAnimationFrame(() => document.documentElement.classList.add("shell-ready"));

if (storage.get("onboarding-seen", "false") !== "true") {
  (async () => {
    let diagnostic = "Connection check underway…";
    try {
      const health = await api.health();
      diagnostic = health.status === "ok" ? "Workspace server is connected." : "Mini-O server is starting up.";
    } catch (error) {
      diagnostic = `Mini-O connection diagnostic: ${error.message}`;
    }
    showModal(
      "Welcome to Mini-O Workspace",
      `<p>Your chats, workspace files, and diagnostic logs stay local and private.</p>
       <p><strong>System diagnostic:</strong> ${diagnostic}</p>
       <ol>
         <li>Select a model from the header dropdown.</li>
         <li>Browse and edit files in the right Workspace panel.</li>
         <li>Inspect error traces in <strong>Settings & Diagnostics</strong> anytime.</li>
       </ol>`,
      '<div class="modal-actions"><button class="primary modal-close" id="finish-onboarding">Get started</button></div>'
    );
  })();
}

document.addEventListener("click", event => {
  if (event.target.id === "finish-onboarding") storage.set("onboarding-seen", "true");
});
