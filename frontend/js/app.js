import { api } from "./api.js";
import { Chat } from "./chat.js";
import { FilePanel } from "./files.js";
import { ToolPanel } from "./tools.js";
import { migratePreferences as migratePreferenceSchema } from "./preferences.js";
import { diagnostics, installGlobalErrorHandlers, classifyError } from "./errors.js";
import { AndroidPreview } from "./android-preview.js";

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
  modelLocationFilter: storage.get("model-location-filter", "all"),
  modelTierFilter: storage.get("model-tier-filter", "all"),
  availableModels: [],
  modelMeta: { total: 0, cloud: 0, local: 0, free: 0, paid: 0, families: [] },
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
function showCustomModal(content) {
  const modal = document.getElementById("modal");
  modal.innerHTML = content;
  modal.classList.remove("hidden");
  modal.querySelector("button, input")?.focus();
}
function closeModal() { document.getElementById("modal").classList.add("hidden"); }

let lastPanelStateBeforeFullscreen = null;

function updateFullscreenButtonState() {
  const sidebarCollapsed = sidebar.classList.contains("collapsed");
  const rightPanelCollapsed = rightPanel.classList.contains("collapsed");
  const isFullscreen = sidebarCollapsed && rightPanelCollapsed;
  const fsBtn = document.getElementById("toggle-fullscreen");
  if (fsBtn) {
    fsBtn.classList.toggle("active", isFullscreen);
    fsBtn.title = isFullscreen ? "Exit full screen terminal (Alt+F)" : "Full screen terminal (Alt+F)";
    fsBtn.setAttribute("aria-pressed", String(isFullscreen));
  }
}

function setPanel(panel, open) {
  panel.classList.toggle("collapsed", !open);
  const appEl = document.getElementById("app");
  if (panel === sidebar) {
    appEl?.classList.toggle("sidebar-collapsed", !open);
    const toggleBtn = document.getElementById("toggle-sidebar");
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", String(open));
      toggleBtn.title = open ? "Collapse sidebar (Ctrl+B)" : "Expand sidebar (Ctrl+B)";
    }
    storage.set("sidebar-open", String(open));
  }
  if (panel === rightPanel) {
    appEl?.classList.toggle("right-panel-collapsed", !open);
    const toggleBtn = document.getElementById("toggle-right-panel");
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", String(open));
      toggleBtn.title = open ? "Collapse workspace (Ctrl+J)" : "Expand workspace (Ctrl+J)";
    }
    storage.set("workspace-open", String(open));
  }
  const isMobile = window.matchMedia("(max-width: 1100px)").matches;
  scrim.classList.toggle("hidden", !isMobile || (sidebar.classList.contains("collapsed") && rightPanel.classList.contains("collapsed")));
  updateFullscreenButtonState();
}

function toggleFullscreenTerminal() {
  const sidebarCollapsed = sidebar.classList.contains("collapsed");
  const rightPanelCollapsed = rightPanel.classList.contains("collapsed");
  const isFullscreen = sidebarCollapsed && rightPanelCollapsed;

  if (isFullscreen) {
    const prevSidebar = lastPanelStateBeforeFullscreen?.sidebar ?? true;
    const prevRight = lastPanelStateBeforeFullscreen?.rightPanel ?? true;
    setPanel(sidebar, prevSidebar);
    setPanel(rightPanel, prevRight);
    notify("success", "Exited full screen mode");
  } else {
    lastPanelStateBeforeFullscreen = {
      sidebar: !sidebarCollapsed,
      rightPanel: !rightPanelCollapsed,
    };
    setPanel(sidebar, false);
    setPanel(rightPanel, false);
    notify("success", "Full screen terminal activated");
  }
}

const providerPresets = {
  github: { name: "GitHub Personal Token", key: "GITHUB_TOKEN", placeholder: "ghp_... or github_pat_...", instanceUrl: false, repoPlaceholder: "https://github.com/org/repo (or Global)" },
  gitlab: { name: "GitLab Personal Access Token", key: "GITLAB_TOKEN", placeholder: "glpat-...", instanceUrl: true, repoPlaceholder: "https://gitlab.com/org/project (or Global)" },
  bitbucket: { name: "Bitbucket App Password", key: "BITBUCKET_TOKEN", placeholder: "App password or token...", instanceUrl: false, repoPlaceholder: "https://bitbucket.org/workspace/repo" },
  git: { name: "Custom Git Repository Token", key: "GIT_TOKEN", placeholder: "Token or password...", instanceUrl: true, repoPlaceholder: "https://git.example.com/org/repo" },
  gemini: { name: "Google Gemini API Key", key: "GEMINI_API_KEY", placeholder: "AIzaSy...", instanceUrl: false, repoPlaceholder: "Global (Google AI Studio / Gemini API)" },
  anthropic: { name: "Anthropic Claude API Key", key: "ANTHROPIC_API_KEY", placeholder: "sk-ant-...", instanceUrl: false, repoPlaceholder: "Global (Anthropic Claude API)" },
  openai: { name: "OpenAI API Key", key: "OPENAI_API_KEY", placeholder: "sk-...", instanceUrl: false, repoPlaceholder: "Global (OpenAI API)" },
  huggingface: { name: "Hugging Face Access Token", key: "HF_TOKEN", placeholder: "hf_...", instanceUrl: false, repoPlaceholder: "Global (Hugging Face Hub)" },
  custom: { name: "Custom Variable / Secret", key: "", placeholder: "Secret value...", instanceUrl: false, repoPlaceholder: "Target Scope / Global" },
};

const workspaceMenu = {
  activeTab: "secrets",

  async open(tab = "secrets") {
    this.activeTab = tab;
    this.renderModal();
    await this.loadTab(tab);
  },

  renderModal() {
    const html = `
      <div class="modal-card modal-card-wide">
        <div class="menu-modal-header">
          <div class="menu-modal-title">
            <h3>Workspace Menu &amp; Configuration</h3>
            <p>Manage repository secrets, tool policies, file sandbox, and IDE integrations</p>
          </div>
          <button class="icon-button modal-close" title="Close menu" aria-label="Close menu">×</button>
        </div>
        <div class="menu-tabs" role="tablist">
          <button class="menu-tab-btn ${this.activeTab === "secrets" ? "active" : ""}" data-menu-tab="secrets">🔑 Secrets &amp; API Keys</button>
          <button class="menu-tab-btn ${this.activeTab === "workspace" ? "active" : ""}" data-menu-tab="workspace">📁 File &amp; Sandbox Config</button>
          <button class="menu-tab-btn ${this.activeTab === "tools" ? "active" : ""}" data-menu-tab="tools">🛠️ Tool Policies</button>
          <button class="menu-tab-btn ${this.activeTab === "integrations" ? "active" : ""}" data-menu-tab="integrations">🔌 Integrations &amp; MCP</button>
          <button class="menu-tab-btn ${this.activeTab === "settings" ? "active" : ""}" data-menu-tab="settings">⚙️ Settings &amp; Diagnostics</button>
        </div>
        <div class="menu-modal-body">
          <!-- Pane: Secrets -->
          <div id="pane-secrets" class="menu-tab-pane ${this.activeTab === "secrets" ? "active" : ""}">
            <p class="secrets-intro">
              Add API keys and tokens for GitHub, GitLab, Bitbucket, custom Git repos, or AI providers (Google Gemini, OpenAI, Claude). Secrets are stored on this machine and securely loaded for repository and tool operations.
            </p>

            <section class="secrets-form-card">
              <h4 id="secret-form-title">Add New Secret or Repository Key</h4>
              <div class="secrets-grid-2">
                <div class="secrets-field">
                  <label for="secret-provider">Service / Provider</label>
                  <select id="secret-provider">
                    <option value="github">GitHub (GITHUB_TOKEN / Personal Access Token)</option>
                    <option value="gitlab">GitLab (GITLAB_TOKEN / Personal Access Token)</option>
                    <option value="bitbucket">Bitbucket (BITBUCKET_TOKEN / App Password)</option>
                    <option value="git">Custom Git Repository (GIT_TOKEN)</option>
                    <option value="gemini">Google Gemini (GEMINI_API_KEY)</option>
                    <option value="anthropic">Anthropic Claude (ANTHROPIC_API_KEY)</option>
                    <option value="openai">OpenAI (OPENAI_API_KEY)</option>
                    <option value="huggingface">Hugging Face (HF_TOKEN)</option>
                    <option value="custom">Custom Secret / Variable</option>
                  </select>
                </div>
                <div class="secrets-field">
                  <label for="secret-name">Friendly Name</label>
                  <input id="secret-name" placeholder="e.g. GitHub Personal Token" value="GitHub Personal Token" />
                </div>
              </div>

              <div class="secrets-grid-2">
                <div class="secrets-field">
                  <label for="secret-key">Environment Variable Key</label>
                  <input id="secret-key" placeholder="e.g. GITHUB_TOKEN" value="GITHUB_TOKEN" />
                </div>
                <div class="secrets-field">
                  <label for="secret-repo">Target Repository / Scope</label>
                  <input id="secret-repo" placeholder="e.g. https://github.com/org/repo (or Global)" />
                </div>
              </div>

              <div class="secrets-field" id="secret-instance-url-field" style="display: none;">
                <label for="secret-instance-url">Instance / API Base URL (for self-hosted Git)</label>
                <input id="secret-instance-url" placeholder="https://gitlab.example.com" />
              </div>

              <div class="secrets-field">
                <label for="secret-value">Secret / Token Value</label>
                <div class="secret-input-wrap">
                  <input id="secret-value" type="password" placeholder="Paste your API key, PAT token, or secret value…" autocomplete="off" />
                  <button type="button" class="btn-toggle-mask" id="btn-toggle-secret-visibility" title="Toggle visibility">👁️</button>
                </div>
              </div>

              <div class="secrets-field">
                <label for="secret-description">Description / Notes (Optional)</label>
                <input id="secret-description" placeholder="e.g. Fine-grained PAT with repo and workflow read/write permissions" />
              </div>

              <div class="modal-actions" style="margin-top: 4px; justify-content: flex-start;">
                <button type="button" class="primary" id="btn-save-secret">Save Secret</button>
                <button type="button" class="secondary" id="btn-reset-secret-form" style="width: auto;">Clear Form</button>
              </div>
            </section>

            <div class="secrets-list-header">
              <h4>Configured Secrets &amp; Repository Keys (<span id="secrets-count">0</span>)</h4>
              <button type="button" class="secondary" id="btn-refresh-secrets" style="width: auto; padding: 4px 10px; font-size: 11.5px;">↻ Refresh</button>
            </div>
            <div id="secrets-list-container" class="secrets-cards"></div>
          </div>

          <!-- Pane: Workspace Sandbox & Config -->
          <div id="pane-workspace" class="menu-tab-pane ${this.activeTab === "workspace" ? "active" : ""}">
            <section class="config-section" style="margin: 0;">
              <h3>File Sandbox &amp; Root Access</h3>
              <p class="field-help">Choose the primary workspace directory and approved parent roots Mini-O may access. The workspace is always included in the sandbox boundary.</p>
              <p class="config-file-path"><span>Active policy file:</span> <code id="menu-config-file-path">mini-o.config.json</code></p>
              <label>Primary workspace <input id="menu-workspace-dir" placeholder="/home/me/project" /></label>
              <label>Allowed directories <textarea id="menu-allowed-roots" rows="3" placeholder="One absolute directory per line"></textarea></label>
              <div class="config-actions">
                <button id="menu-workspace-config-save" class="primary">Save Workspace Policy</button>
                <button id="menu-workspace-config-reload" class="secondary">Reload</button>
              </div>
              <p id="menu-workspace-config-status" class="field-help" role="status"></p>
            </section>

            <section class="config-section" style="margin: 0;">
              <h3>AGENT.md Custom Instructions</h3>
              <p class="field-help">Define custom behavioral guidelines, tool rules, and project context for this workspace.</p>
              <div class="file-toolbar" style="padding: 4px 0; border: 0;">
                <button id="menu-agent-new" class="secondary" style="width: auto;">New AGENT.md</button>
                <button id="menu-agent-template" class="secondary" style="width: auto;">Templates</button>
                <button id="menu-agent-save" class="primary" style="width: auto;">Save AGENT.md</button>
              </div>
              <input id="menu-agent-path" placeholder="AGENT.md or subfolder/AGENT.md" />
              <textarea id="menu-agent-text" placeholder="Agent instructions for this workspace" rows="8"></textarea>
              <div id="menu-agent-list" class="file-tree" style="max-height: 120px;"></div>
              <div id="menu-agent-preview" class="preview"></div>
            </section>
          </div>

          <!-- Pane: Tool Policies -->
          <div id="pane-tools" class="menu-tab-pane ${this.activeTab === "tools" ? "active" : ""}">
            <div class="config-section" style="margin: 0;">
              <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                <div>
                  <h3 style="margin: 0;">Tool Execution Policies</h3>
                  <p class="field-help" style="margin: 2px 0 0;">Control execution policies for shell commands, file modifications, and network access.</p>
                </div>
                <label class="toggle"><input type="checkbox" id="menu-confirm-tools" /> <span>Allow tools requiring confirmation</span></label>
              </div>
              <div id="menu-tool-list" class="tool-list" style="margin-top: 10px; max-height: 480px; overflow-y: auto;"></div>
            </div>
          </div>

          <!-- Pane: Integrations -->
          <div id="pane-integrations" class="menu-tab-pane ${this.activeTab === "integrations" ? "active" : ""}">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <p class="field-help" style="margin: 0; flex: 1;">Connect Mini-O to editors, IDEs, and platform adapters through permissioned interfaces.</p>
              <button id="menu-refresh-integrations" class="secondary" style="width: auto; padding: 4px 10px; font-size: 12px;">Refresh catalog</button>
            </div>
            <section class="integration-section" style="margin: 0;">
              <h3>Local plugins</h3>
              <div id="menu-plugin-list" class="integration-list"></div>
            </section>
            <section class="integration-section" style="margin: 0;">
              <h3>IDE and platform adapters</h3>
              <div id="menu-integration-list" class="integration-list"></div>
            </section>
          </div>

          <!-- Pane: Settings -->
          <div id="pane-settings" class="menu-tab-pane ${this.activeTab === "settings" ? "active" : ""}">
            <fieldset><legend>Appearance</legend>
              <label>Theme <select id="menu-pref-theme"><option>system</option><option>light</option><option>dark</option><option>high-contrast</option></select></label>
              <label>Density <select id="menu-pref-density"><option>comfortable</option><option>compact</option></select></label>
              <label>Font size <select id="menu-pref-font"><option>normal</option><option>small</option><option>large</option></select></label>
              <label>Message width <select id="menu-pref-width"><option>standard</option><option>narrow</option><option>wide</option></select></label>
            </fieldset>
            <fieldset><legend>System Health &amp; Error Diagnostics</legend>
              <p style="font-size: 12px; color: var(--text-muted); margin: 4px 0 8px;">Mini-O maintains active real-time diagnostics for network connections, model streams, file concurrency, and sandbox execution.</p>
              <div class="modal-actions" style="justify-content: flex-start; margin-top: 6px;">
                <button class="secondary" id="menu-open-diagnostics" style="width: auto;">Open Diagnostics Log Viewer</button>
                <button class="secondary" id="menu-reset-settings" style="width: auto;">Reset appearance</button>
              </div>
            </fieldset>
            <div class="modal-actions" style="margin-top: 8px;">
              <button class="secondary" id="menu-export-preferences" style="width: auto;">Export preferences</button>
              <button class="secondary" id="menu-import-preferences" style="width: auto;">Import preferences</button>
              <button class="primary" id="menu-save-appearance" style="width: auto;">Save appearance</button>
            </div>
          </div>
        </div>
      </div>
    `;

    showCustomModal(html);
    this.bindModalEvents();
  },

  switchTab(name) {
    this.activeTab = name;
    document.querySelectorAll(".menu-tab-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.menuTab === name);
    });
    document.querySelectorAll(".menu-tab-pane").forEach(pane => {
      pane.classList.toggle("active", pane.id === `pane-${name}`);
    });
    this.loadTab(name);
  },

  async loadTab(name) {
    if (name === "secrets") await this.loadSecrets();
    if (name === "workspace") await this.loadWorkspace();
    if (name === "tools") await this.loadTools();
    if (name === "integrations") await this.loadIntegrations();
    if (name === "settings") this.loadSettings();
  },

  bindModalEvents() {
    // Tab switching
    document.querySelectorAll(".menu-tab-btn").forEach(btn => {
      btn.onclick = () => this.switchTab(btn.dataset.menuTab);
    });

    // Provider select preset autofill
    const providerSelect = document.getElementById("secret-provider");
    if (providerSelect) {
      providerSelect.onchange = () => {
        const preset = providerPresets[providerSelect.value] || providerPresets.custom;
        const nameInput = document.getElementById("secret-name");
        const keyInput = document.getElementById("secret-key");
        const valInput = document.getElementById("secret-value");
        const repoInput = document.getElementById("secret-repo");
        const instanceField = document.getElementById("secret-instance-url-field");

        if (nameInput) nameInput.value = preset.name;
        if (keyInput) keyInput.value = preset.key;
        if (valInput) valInput.placeholder = preset.placeholder;
        if (repoInput) repoInput.placeholder = preset.repoPlaceholder;
        if (instanceField) instanceField.style.display = preset.instanceUrl ? "flex" : "none";
      };
    }

    // Toggle secret visibility
    const toggleMaskBtn = document.getElementById("btn-toggle-secret-visibility");
    if (toggleMaskBtn) {
      toggleMaskBtn.onclick = () => {
        const input = document.getElementById("secret-value");
        if (input) {
          input.type = input.type === "password" ? "text" : "password";
          toggleMaskBtn.textContent = input.type === "password" ? "👁️" : "🔒";
        }
      };
    }

    // Save secret
    document.getElementById("btn-save-secret")?.addEventListener("click", () => this.saveSecret());
    document.getElementById("btn-reset-secret-form")?.addEventListener("click", () => this.resetSecretForm());
    document.getElementById("btn-refresh-secrets")?.addEventListener("click", () => this.loadSecrets());

    // Workspace Sandbox & AGENT.md
    document.getElementById("menu-workspace-config-save")?.addEventListener("click", () => this.saveWorkspace());
    document.getElementById("menu-workspace-config-reload")?.addEventListener("click", () => this.loadWorkspace());
    document.getElementById("menu-agent-save")?.addEventListener("click", () => this.saveAgent());
    document.getElementById("menu-agent-new")?.addEventListener("click", () => {
      document.getElementById("menu-agent-path").value = "AGENT.md";
      document.getElementById("menu-agent-text").value = "# Agent instructions\n\n";
    });
    document.getElementById("menu-agent-template")?.addEventListener("click", () => this.showAgentTemplates());

    // Tools
    const confirmTools = document.getElementById("menu-confirm-tools");
    if (confirmTools) {
      confirmTools.checked = JSON.parse(storage.get("confirmedTools", "[]")).length > 0;
      confirmTools.onchange = event => storage.set("confirmedTools", JSON.stringify(event.target.checked ? ["write_file", "run_python", "run_shell", "web_fetch"] : []));
    }

    // Integrations
    document.getElementById("menu-refresh-integrations")?.addEventListener("click", () => this.loadIntegrations());

    // Settings
    document.getElementById("menu-open-diagnostics")?.addEventListener("click", () => {
      closeModal();
      showDiagnosticsModal();
    });
    document.getElementById("menu-reset-settings")?.addEventListener("click", () => {
      ["theme", "density", "font-size", "message-width"].forEach(key => localStorage.removeItem(`mini-o.${key}`));
      applyAppearance();
      this.loadSettings();
      notify("success", "Appearance reset");
    });
    document.getElementById("menu-save-appearance")?.addEventListener("click", () => {
      storage.set("theme", document.getElementById("menu-pref-theme").value);
      storage.set("density", document.getElementById("menu-pref-density").value);
      storage.set("font-size", document.getElementById("menu-pref-font").value);
      storage.set("message-width", document.getElementById("menu-pref-width").value);
      applyAppearance();
      notify("success", "Appearance settings saved");
    });
    document.getElementById("menu-export-preferences")?.addEventListener("click", () => downloadJson("mini-o-preferences.json", preferencesSnapshot()));
    document.getElementById("menu-import-preferences")?.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json";
      input.onchange = async () => {
        try {
          const payload = JSON.parse(await input.files[0].text());
          if (payload.format !== "mini-o.preferences" || payload.version !== 1) throw new Error("Unsupported preferences file");
          Object.entries(payload.values || {}).forEach(([key, value]) => localStorage.setItem(`mini-o.${key}`, value));
          applyAppearance();
          this.loadSettings();
          notify("success", "Preferences imported");
        } catch (error) {
          notify("error", error.message);
        }
      };
      input.click();
    });
  },

  async loadSecrets() {
    const container = document.getElementById("secrets-list-container");
    const countEl = document.getElementById("secrets-count");
    if (!container) return;
    try {
      const list = await api.secrets();
      if (countEl) countEl.textContent = String(list.length);
      if (!list.length) {
        container.innerHTML = `
          <div class="empty-state" style="border: 1px dashed var(--border); border-radius: var(--radius-md); padding: 20px;">
            <p>No repository tokens or API keys configured yet.</p>
            <p class="field-help">Use the form above to add a secret for GitHub, GitLab, or AI providers.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = "";
      list.forEach(item => {
        const card = document.createElement("article");
        card.className = "secret-card";
        card.dataset.id = item.id;

        const top = document.createElement("div");
        top.className = "secret-card-top";

        const identity = document.createElement("div");
        identity.className = "secret-identity";

        const providerBadge = document.createElement("span");
        providerBadge.className = `badge ${item.provider === "github" ? "badge-server" : item.provider === "gitlab" ? "badge-warning" : item.provider === "gemini" ? "badge-info" : "badge-client"}`;
        providerBadge.textContent = (item.provider || "custom").toUpperCase();

        const name = document.createElement("span");
        name.className = "secret-name";
        name.textContent = item.name;

        const key = document.createElement("code");
        key.className = "secret-env-key";
        key.textContent = item.key;

        identity.append(providerBadge, name, key);

        const masked = document.createElement("span");
        masked.className = "secret-masked";
        masked.textContent = item.maskedValue || "••••••••";

        top.append(identity, masked);

        const meta = document.createElement("div");
        meta.className = "secret-meta";
        if (item.targetRepo) {
          const repoSpan = document.createElement("span");
          repoSpan.innerHTML = `<strong>Scope:</strong> ${item.targetRepo}`;
          meta.appendChild(repoSpan);
        }
        if (item.instanceUrl) {
          const urlSpan = document.createElement("span");
          urlSpan.innerHTML = `<strong>URL:</strong> ${item.instanceUrl}`;
          meta.appendChild(urlSpan);
        }
        if (item.description) {
          const descSpan = document.createElement("span");
          descSpan.textContent = item.description;
          meta.appendChild(descSpan);
        }
        const updatedSpan = document.createElement("span");
        updatedSpan.textContent = `Updated: ${new Date(item.updatedAt || item.createdAt).toLocaleDateString()}`;
        meta.appendChild(updatedSpan);

        const testResultContainer = document.createElement("div");
        testResultContainer.className = "secret-test-result";
        testResultContainer.style.display = item.lastTestStatus ? "block" : "none";
        if (item.lastTestStatus === "ok") {
          testResultContainer.className = "secret-test-result success";
          testResultContainer.textContent = `✓ ${item.lastTestMessage || "Connection active"}`;
        } else if (item.lastTestStatus === "error") {
          testResultContainer.className = "secret-test-result error";
          testResultContainer.textContent = `✗ ${item.lastTestMessage || "Authentication failed"}`;
        }

        const actions = document.createElement("div");
        actions.className = "secret-actions";

        const testBtn = document.createElement("button");
        testBtn.type = "button";
        testBtn.className = "secondary";
        testBtn.textContent = "⚡ Test Connection";
        testBtn.onclick = async () => {
          testBtn.disabled = true;
          testBtn.textContent = "Testing…";
          try {
            const res = await api.testSecret(item.id);
            testResultContainer.style.display = "block";
            testResultContainer.className = `secret-test-result ${res.status === "ok" ? "success" : "error"}`;
            testResultContainer.textContent = res.message;
            if (res.status === "ok") notify("success", res.message);
            else notify("warning", res.message);
          } catch (err) {
            testResultContainer.style.display = "block";
            testResultContainer.className = "secret-test-result error";
            testResultContainer.textContent = err.message;
            notify("error", `Test failed: ${err.message}`);
          } finally {
            testBtn.disabled = false;
            testBtn.textContent = "⚡ Test Connection";
          }
        };

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "danger";
        delBtn.textContent = "Delete";
        delBtn.onclick = () => {
          confirmAction(`Delete secret "${item.name}"?`, "This will permanently remove the credential from local storage.", async () => {
            try {
              await api.deleteSecret(item.id);
              notify("success", "Secret deleted");
              await this.loadSecrets();
            } catch (err) {
              notify("error", err.message);
            }
          });
        };

        actions.append(testBtn, delBtn);
        card.append(top, meta, testResultContainer, actions);
        container.appendChild(card);
      });
    } catch (err) {
      if (container) container.innerHTML = `<div class="error-banner"><p>${err.message}</p></div>`;
    }
  },

  async saveSecret() {
    const provider = document.getElementById("secret-provider")?.value || "custom";
    const name = document.getElementById("secret-name")?.value.trim();
    const key = document.getElementById("secret-key")?.value.trim();
    const value = document.getElementById("secret-value")?.value.trim();
    const targetRepo = document.getElementById("secret-repo")?.value.trim();
    const instanceUrl = document.getElementById("secret-instance-url")?.value.trim();
    const description = document.getElementById("secret-description")?.value.trim();

    if (!name) return notify("warning", "Please provide a name for this secret");
    if (!key) return notify("warning", "Please provide an environment variable key (e.g. GITHUB_TOKEN)");
    if (!value) return notify("warning", "Please provide the secret or token value");

    try {
      await api.saveSecret({
        provider,
        name,
        key,
        value,
        targetRepo: targetRepo || undefined,
        instanceUrl: instanceUrl || undefined,
        description: description || undefined,
      });

      notify("success", `Secret "${name}" (${key}) saved successfully`);
      this.resetSecretForm();
      await this.loadSecrets();
    } catch (err) {
      notify("error", `Failed to save secret: ${err.message}`);
    }
  },

  resetSecretForm() {
    const providerSelect = document.getElementById("secret-provider");
    if (providerSelect) {
      providerSelect.value = "github";
      providerSelect.dispatchEvent(new Event("change"));
    }
    const valInput = document.getElementById("secret-value");
    if (valInput) valInput.value = "";
    const descInput = document.getElementById("secret-description");
    if (descInput) descInput.value = "";
    const repoInput = document.getElementById("secret-repo");
    if (repoInput) repoInput.value = "";
    const instInput = document.getElementById("secret-instance-url");
    if (instInput) instInput.value = "";
  },

  async loadWorkspace() {
    const list = document.getElementById("menu-agent-list");
    try {
      const workspace = await api.workspaceConfig();
      const wsDir = document.getElementById("menu-workspace-dir");
      const roots = document.getElementById("menu-allowed-roots");
      const cfgPath = document.getElementById("menu-config-file-path");
      if (wsDir) wsDir.value = workspace.workspace_dir;
      if (roots) roots.value = workspace.allowed_roots.join("\n");
      if (cfgPath) cfgPath.textContent = workspace.config_file || "mini-o.config.json";

      const entries = await api.agents();
      if (list) {
        list.innerHTML = entries.length ? "" : "<p class='empty-state'>No AGENT.md files yet.</p>";
        entries.forEach(e => {
          const b = document.createElement("button");
          b.className = "file-entry";
          b.textContent = `${e.path} (${e.size} bytes)`;
          b.onclick = () => this.openAgent(e.path);
          list.appendChild(b);
        });
      }
    } catch (e) {
      if (list) list.textContent = e.message;
    }
  },

  async openAgent(path) {
    const r = await api.readAgent(path);
    const pathInput = document.getElementById("menu-agent-path");
    const textInput = document.getElementById("menu-agent-text");
    const preview = document.getElementById("menu-agent-preview");
    if (pathInput) pathInput.value = path;
    if (textInput) textInput.value = r.content;
    if (preview) preview.textContent = `Applies to: ${path.split("/").slice(0, -1).join("/") || "workspace root"}\n${r.content.slice(0, 300)}`;
  },

  async saveAgent() {
    const path = document.getElementById("menu-agent-path")?.value.trim();
    if (!path) return notify("warning", "Specify an AGENT.md path");
    const content = document.getElementById("menu-agent-text")?.value || "";
    const validation = await api.validateAgent(path, content);
    if (!validation.valid) return notify("error", validation.errors.join("; "));
    await api.writeAgent(path, content);
    notify("success", "Agent instructions saved");
    await this.loadWorkspace();
  },

  async showAgentTemplates() {
    try {
      const templates = await api.agentTemplates();
      showModal("AGENT.md Templates", templates.map(t => `<button class="template-choice" data-template="${t.id}">${t.name}</button>`).join(""));
      document.querySelectorAll(".template-choice").forEach(button => button.onclick = () => {
        const template = templates.find(t => t.id === button.dataset.template);
        if (template) {
          const pathInput = document.getElementById("menu-agent-path");
          const textInput = document.getElementById("menu-agent-text");
          if (pathInput) pathInput.value = pathInput.value || "AGENT.md";
          if (textInput) textInput.value = template.content;
        }
        closeModal();
      });
    } catch (e) {
      notify("error", e.message);
    }
  },

  async saveWorkspace() {
    const workspaceDir = document.getElementById("menu-workspace-dir")?.value.trim();
    const roots = (document.getElementById("menu-allowed-roots")?.value || "").split("\n").map(value => value.trim()).filter(Boolean);
    const statusEl = document.getElementById("menu-workspace-config-status");
    try {
      const result = await api.updateWorkspaceConfig({ workspace_dir: workspaceDir, allowed_roots: roots });
      if (statusEl) statusEl.textContent = "Saved and applied immediately.";
      notify("success", "Workspace policy saved");
      await files.load(".");
    } catch (err) {
      notify("error", err.message);
    }
  },

  async loadTools() {
    const list = document.getElementById("menu-tool-list");
    if (!list) return;
    try {
      const tools = await api.tools();
      list.innerHTML = "";
      if (!tools.length) list.innerHTML = "<li class='empty-state'>No tools are registered.</li>";
      const groups = new Map();
      tools.forEach(tool => {
        const group = groups.get(tool.category || "general") || [];
        group.push(tool);
        groups.set(tool.category || "general", group);
      });
      groups.forEach((entries, category) => {
        const heading = document.createElement("li");
        heading.className = "tool-group-heading";
        heading.textContent = category[0].toUpperCase() + category.slice(1);
        list.appendChild(heading);
        entries.forEach(tool => {
          const li = document.createElement("li");
          li.innerHTML = `
            <label class="tool-enabled"><input type="checkbox" checked data-tool="${tool.name}" /> Enabled</label>
            <code></code><span class="confirm"></span><span class="tool-risk"></span>
            <p></p>
            <p class="tool-effects"></p>
            <details><summary>Inputs and schema</summary><pre></pre></details>
            <div class="tool-policy">
              <select aria-label="Approval policy"><option value="confirm">Confirm</option><option value="allow">Always allow</option><option value="deny">Deny</option></select>
              <select aria-label="Approval scope"><option value="once">Once</option><option value="conversation">Conversation</option><option value="session">Session</option></select>
            </div>
          `;
          li.querySelector("code").textContent = tool.name;
          li.querySelector(".confirm").textContent = tool.requires_confirmation ? " ⚠ confirmation" : "";
          li.querySelector(".tool-risk").textContent = ` · risk: ${tool.risk || "low"}`;
          li.querySelector("p").textContent = tool.description;
          li.querySelector(".tool-effects").textContent = `Side effects: ${(tool.side_effects || []).join(", ") || "none"}`;
          li.querySelector("pre").textContent = JSON.stringify(tool.parameters, null, 2);
          const enabled = localStorage.getItem(`mini-o.tool.${tool.name}`) !== "false";
          li.querySelector("input").checked = enabled;
          li.querySelector("input").onchange = event => {
            localStorage.setItem(`mini-o.tool.${tool.name}`, String(event.target.checked));
            const current = JSON.parse(localStorage.getItem("mini-o.enabled-tools") || "null") || tools.map(item => item.name);
            const next = event.target.checked ? [...new Set([...current, tool.name])] : current.filter(name => name !== tool.name);
            localStorage.setItem("mini-o.enabled-tools", JSON.stringify(next));
          };
          const policy = tool.policy || {};
          li.querySelectorAll("select")[0].value = policy.mode || "confirm";
          li.querySelectorAll("select")[1].value = policy.scope || "conversation";
          li.querySelectorAll("select").forEach((select, index) => select.onchange = async () => {
            const body = index === 0 ? { mode: select.value } : { scope: select.value };
            try {
              await api.updateToolPolicy(tool.name, body);
              notify("success", `Updated ${tool.name} policy`);
            } catch (error) {
              select.value = index === 0 ? policy.mode || "confirm" : policy.scope || "conversation";
              notify("error", error.message);
            }
          });
          list.appendChild(li);
        });
      });
    } catch (error) {
      list.textContent = error.message;
    }
  },

  async loadIntegrations() {
    const pluginList = document.getElementById("menu-plugin-list");
    const integrationList = document.getElementById("menu-integration-list");
    if (!pluginList || !integrationList) return;
    try {
      const [plugins, catalog] = await Promise.all([api.plugins(), api.integrations()]);
      pluginList.replaceChildren(...(plugins.length ? plugins.map(item => this.integrationCard(item, true)) : [integrations.empty("No local plugins installed.")]));
      integrationList.replaceChildren(...(catalog.items?.length ? catalog.items.map(item => this.integrationCard(item, false)) : [integrations.empty("No integration targets published.")]));
    } catch (error) {
      pluginList.textContent = error.message;
      integrationList.textContent = error.message;
    }
  },

  integrationCard(item, plugin) {
    const article = document.createElement("article");
    article.className = "integration-card";
    const heading = document.createElement("div");
    heading.className = "integration-card-heading";
    const title = document.createElement("strong");
    title.textContent = item.name;
    const status = document.createElement("span");
    status.className = "badge";
    status.textContent = plugin ? `v${item.version}` : item.status;
    heading.append(title, status);
    const description = document.createElement("p");
    description.textContent = item.description || `${item.kind || "Integration"} via ${item.transport || "local plugin"}.`;
    const details = document.createElement("p");
    details.className = "field-help";
    details.textContent = `${(item.platforms || []).join(", ")} · ${(item.capabilities || []).join(", ") || "manifest only"}`;
    article.append(heading, description, details);
    return article;
  },

  loadSettings() {
    const theme = storage.get("theme", "dark");
    const density = storage.get("density", "comfortable");
    const fontSize = storage.get("font-size", "normal");
    const width = storage.get("message-width", "standard");
    const prefTheme = document.getElementById("menu-pref-theme");
    const prefDensity = document.getElementById("menu-pref-density");
    const prefFont = document.getElementById("menu-pref-font");
    const prefWidth = document.getElementById("menu-pref-width");
    if (prefTheme) prefTheme.value = theme;
    if (prefDensity) prefDensity.value = density;
    if (prefFont) prefFont.value = fontSize;
    if (prefWidth) prefWidth.value = width;
  },
};

const configure = {
  load() { return workspaceMenu.loadWorkspace(); },
  save() { return workspaceMenu.saveAgent(); },
  saveWorkspace() { return workspaceMenu.saveWorkspace(); },
};

async function loadModels() {
  state.modelRequest?.abort();
  state.modelRequest = new AbortController();
  const select = document.getElementById("model-select");
  setStatus("", "Checking connection…");
  try {
    const q = document.getElementById("model-search")?.value || "";
    const [models, meta] = await Promise.all([
      api.models({
        q,
        location: state.modelLocationFilter,
        tier: state.modelTierFilter
      }, state.modelRequest.signal),
      api.modelsMeta(state.modelRequest.signal).catch(() => null)
    ]);
    
    state.availableModels = models || [];
    if (meta) {
      state.modelMeta = meta;
      updateFilterButtons(meta);
    }
    
    select.innerHTML = "";
    if (!models || models.length === 0) {
      select.innerHTML = "<option value=''>No models match current filter</option>";
    } else {
      const cloudFree = [];
      const cloudPaid = [];
      const localModels = [];

      models.forEach(m => {
        const isCloud = m.location === "cloud" || m.name.includes(":cloud") || m.family === "cloud";
        const isPaid = m.tier === "paid" || m.pricing_tier === "paid";
        if (isCloud) {
          if (isPaid) cloudPaid.push(m);
          else cloudFree.push(m);
        } else {
          localModels.push(m);
        }
      });

      const appendGroup = (label, list) => {
        if (!list.length) return;
        const optgroup = document.createElement("optgroup");
        optgroup.label = label;
        list.forEach(model => {
          const option = document.createElement("option");
          option.value = model.name;
          const isFav = state.favoriteModels.includes(model.name);
          const icon = model.location === "cloud" ? (model.name.startsWith("gemini") ? "✨" : "☁️") : "💻";
          const tierTag = model.tier === "paid" ? "💳 Paid" : "🟢 Free";
          const metaPart = model.context_window ? ` · ${model.context_window}` : (model.size ? ` · ${formatBytes(model.size)}` : "");
          option.textContent = `${isFav ? "★ " : ""}${icon} ${model.display_name || model.name} (${tierTag}${metaPart})`;
          optgroup.appendChild(option);
        });
        select.appendChild(optgroup);
      };

      appendGroup("☁️ Cloud Models · Free Tier", cloudFree);
      appendGroup("☁️ Cloud Models · Paid API", cloudPaid);
      appendGroup("💻 Local Models · Free Open-Weights", localModels);
    }

    if (!state.model || !models.some(m => m.name === state.model)) {
      const preferred = models.find(m => m.name === "minimax-m3:cloud") ||
                        models.find(m => m.name.startsWith("gemini-2.5-flash")) ||
                        models[0];
      if (preferred) {
        state.model = preferred.name;
        storage.set("model", state.model);
      }
    }
    select.value = state.model || "";
    updateCurrentModelBadge();
    updateFavoriteButton();
    updateSendState();
    setStatus("online", `Ready · ${models.length} model${models.length === 1 ? "" : "s"}`);
  } catch (error) {
    if (error.name === "AbortError") return;
    if (select) select.innerHTML = "<option value=''>Model server offline</option>";
    const curModel = document.getElementById("current-model");
    if (curModel) curModel.textContent = "No model";
    updateSendState();
    setStatus("offline", "Server offline");
  }
}

function updateCurrentModelBadge() {
  const badgeEl = document.getElementById("current-model");
  if (!badgeEl) return;
  if (!state.model) {
    badgeEl.textContent = "No model";
    return;
  }
  const current = state.availableModels.find(m => m.name === state.model);
  if (current) {
    const locIcon = current.location === "cloud" ? "☁️" : "💻";
    const tierIcon = current.tier === "paid" ? "💳 Paid" : "🟢 Free";
    badgeEl.textContent = `${locIcon} ${current.display_name || current.name} (${tierIcon})`;
    badgeEl.title = `${current.name} · ${current.location || "cloud"} · ${current.tier || "free"} · ${current.description || ""}`;
  } else {
    badgeEl.textContent = state.model;
  }
}

function updateFilterButtons(meta = state.modelMeta) {
  document.querySelectorAll("[data-filter-group='location']").forEach(btn => {
    const val = btn.dataset.filterValue;
    btn.classList.toggle("active", val === state.modelLocationFilter);
    if (val === "cloud" && meta?.cloud != null) btn.title = `Cloud models (${meta.cloud})`;
    if (val === "local" && meta?.local != null) btn.title = `Local models (${meta.local})`;
  });

  document.querySelectorAll("[data-filter-group='tier']").forEach(btn => {
    const val = btn.dataset.filterValue;
    btn.classList.toggle("active", val === state.modelTierFilter);
    if (val === "free" && meta?.free != null) btn.title = `Free tier & open-weights (${meta.free})`;
    if (val === "paid" && meta?.paid != null) btn.title = `Paid API models (${meta.paid})`;
  });
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
  if (!list) return;
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
          const modelSel = document.getElementById("model-select");
          if (modelSel) modelSel.value = state.model;
          const curModel = document.getElementById("current-model");
          if (curModel) curModel.textContent = state.model;
          const msgEl = document.getElementById("messages");
          if (msgEl) msgEl.innerHTML = "";
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
  } catch (e) { if (list) list.textContent = e.message; }
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
  if (name === "configure") configure.load();
  if (name === "integrations") integrations.load();
}

const integrations = {
  async load() {
    const pluginList = document.getElementById("plugin-list") || document.getElementById("menu-plugin-list");
    const integrationList = document.getElementById("integration-list") || document.getElementById("menu-integration-list");
    if (!pluginList && !integrationList) return;
    try {
      const [plugins, catalog] = await Promise.all([api.plugins(), api.integrations()]);
      if (pluginList) pluginList.replaceChildren(...(plugins.length ? plugins.map(item => this.card(item, true)) : [this.empty("No local plugins installed.")]));
      if (integrationList) integrationList.replaceChildren(...(catalog.items?.length ? catalog.items.map(item => this.card(item, false)) : [this.empty("No integration targets published.")]));
    } catch (error) {
      if (pluginList) pluginList.textContent = error.message;
      if (integrationList) integrationList.textContent = error.message;
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
  state.model = event.target.value;
  storage.set("model", state.model);
  updateCurrentModelBadge();
  updateFavoriteButton();
  updateSendState();
};
document.getElementById("favorite-model").onclick = () => {
  if (!state.model) return;
  state.favoriteModels = state.favoriteModels.includes(state.model)
    ? state.favoriteModels.filter(name => name !== state.model)
    : [...state.favoriteModels, state.model];
  storage.set("favorite-models", JSON.stringify(state.favoriteModels));
  updateFavoriteButton(); loadModels();
};
function updateFavoriteButton() {
  const button = document.getElementById("favorite-model");
  const favorite = state.favoriteModels.includes(state.model);
  button.textContent = favorite ? "★ Favorited" : "☆ Favorite";
  button.setAttribute("aria-pressed", String(favorite));
}
document.getElementById("refresh-models").onclick = loadModels;
window.addEventListener("offline", () => setStatus("offline", "Browser offline"));
window.addEventListener("online", () => { setStatus("", "Rechecking connection…"); loadModels(); });
window.setInterval(() => { if (document.visibilityState !== "hidden" && !document.querySelector(".status-dot.busy")) loadModels(); }, 60000);

document.getElementById("model-details").onclick = async () => {
  if (!state.model) return;
  try {
    const m = await api.model(state.model);
    const isCloud = m.location === "cloud" || m.name.includes(":cloud") || m.family === "cloud";
    const locBadge = isCloud ? `<span class="badge-tag badge-cloud">☁️ Cloud</span>` : `<span class="badge-tag badge-local">💻 Local (Ollama)</span>`;
    const tierBadge = (m.tier === "paid" || m.pricing_tier === "paid") ? `<span class="badge-tag badge-paid">💳 Paid Tier</span>` : `<span class="badge-tag badge-free">🟢 Free Tier</span>`;

    showModal(
      `${m.display_name || m.name}`,
      `<div class="catalog-badges" style="margin-bottom: 12px;">${locBadge} ${tierBadge}</div>
       <p><strong>Model ID:</strong> <code>${m.name}</code></p>
       <p><strong>Description:</strong> ${m.description || "Versatile AI language model."}</p>
       <p><strong>Family:</strong> ${m.family || "general"}</p>
       <p><strong>Parameters:</strong> ${m.parameter_size || "Cloud-scale"}</p>
       <p><strong>Context Window:</strong> ${m.context_window || "128k tokens"}</p>
       <p><strong>Quantization / Size:</strong> ${m.quantization_level || (m.size ? formatBytes(m.size) : "Cloud API")}</p>
       <p><strong>Capabilities:</strong> ${(m.capabilities || []).join(", ") || "chat, streaming"}</p>
       <p><strong>Recommended Use:</strong> ${(m.use_cases || []).join(", ") || "general coding and conversation"}</p>`,
      `<div class="modal-actions">
         <button class="secondary" id="detail-toggle-fav">${state.favoriteModels.includes(m.name) ? "★ Unfavorite" : "☆ Add Favorite"}</button>
         <button class="primary modal-close">Close</button>
       </div>`
    );
    document.getElementById("detail-toggle-fav").onclick = () => {
      document.getElementById("favorite-model").click();
      closeModal();
    };
  } catch (e) { notify("error", e.message); }
};

// Filter chip event bindings for Location (All / Cloud / Local)
document.querySelectorAll("[data-filter-group='location']").forEach(btn => {
  btn.onclick = () => {
    state.modelLocationFilter = btn.dataset.filterValue;
    storage.set("model-location-filter", state.modelLocationFilter);
    updateFilterButtons();
    loadModels();
  };
});

// Filter chip event bindings for Tier (All / Free / Paid)
document.querySelectorAll("[data-filter-group='tier']").forEach(btn => {
  btn.onclick = () => {
    state.modelTierFilter = btn.dataset.filterValue;
    storage.set("model-tier-filter", state.modelTierFilter);
    updateFilterButtons();
    loadModels();
  };
});

// Rich Model Catalog Explorer Modal
async function openModelCatalogModal() {
  let catalogSearch = "";
  let catalogLoc = state.modelLocationFilter;
  let catalogTier = state.modelTierFilter;

  const renderCatalogView = async () => {
    try {
      const [models, meta] = await Promise.all([
        api.models({ q: catalogSearch, location: catalogLoc, tier: catalogTier }),
        api.modelsMeta().catch(() => ({ total: 0, cloud: 0, local: 0, free: 0, paid: 0 }))
      ]);

      const modalHtml = `
        <div class="modal-catalog-container">
          <div class="modal-catalog-header">
            <div>
              <h2 id="modal-title">AI Model Explorer & Catalog</h2>
              <p>Filter across Free/Paid tiers, Cloud/Local hosting, and explore model capabilities.</p>
            </div>
            <button class="icon-button modal-close" title="Close" aria-label="Close catalog">×</button>
          </div>

          <div class="modal-catalog-toolbar">
            <input id="catalog-search-input" class="modal-catalog-search" placeholder="Search by model name, family, task, coding…" value="${catalogSearch}" />
            
            <div class="catalog-filter-pills" role="group" aria-label="Location filter">
              <button type="button" class="catalog-pill ${catalogLoc === 'all' ? 'active' : ''}" data-cat-loc="all">All Hosts (${meta.total || models.length})</button>
              <button type="button" class="catalog-pill ${catalogLoc === 'cloud' ? 'active' : ''}" data-cat-loc="cloud">☁️ Cloud (${meta.cloud || 0})</button>
              <button type="button" class="catalog-pill ${catalogLoc === 'local' ? 'active' : ''}" data-cat-loc="local">💻 Local (${meta.local || 0})</button>
            </div>

            <div class="catalog-filter-pills" role="group" aria-label="Tier filter">
              <button type="button" class="catalog-pill ${catalogTier === 'all' ? 'active' : ''}" data-cat-tier="all">All Tiers</button>
              <button type="button" class="catalog-pill ${catalogTier === 'free' ? 'active' : ''}" data-cat-tier="free">🟢 Free (${meta.free || 0})</button>
              <button type="button" class="catalog-pill ${catalogTier === 'paid' ? 'active' : ''}" data-cat-tier="paid">💳 Paid (${meta.paid || 0})</button>
            </div>
          </div>

          <div class="modal-catalog-grid" id="catalog-cards-grid">
            ${models.length === 0 ? `<p class="empty-state" style="grid-column: 1/-1;">No models found matching your search and filter criteria.</p>` :
              models.map(m => {
                const isSelected = m.name === state.model;
                const isFav = state.favoriteModels.includes(m.name);
                const isCloud = m.location === "cloud" || m.name.includes(":cloud") || m.family === "cloud";
                const isPaid = m.tier === "paid" || m.pricing_tier === "paid";
                
                return `
                  <article class="catalog-card ${isSelected ? 'active-model' : ''}" data-model-id="${m.name}">
                    <div class="catalog-card-header">
                      <div>
                        <h4 class="catalog-card-title">${isFav ? '★ ' : ''}${m.display_name || m.name}</h4>
                        <div class="catalog-card-name">${m.name}</div>
                      </div>
                    </div>

                    <div class="catalog-badges">
                      ${isCloud ? '<span class="badge-tag badge-cloud">☁️ Cloud</span>' : '<span class="badge-tag badge-local">💻 Local</span>'}
                      ${isPaid ? '<span class="badge-tag badge-paid">💳 Paid Tier</span>' : '<span class="badge-tag badge-free">🟢 Free Tier</span>'}
                      ${m.family ? `<span class="badge-tag" style="background:var(--surface);border:1px solid var(--border);color:var(--text);">${m.family}</span>` : ''}
                    </div>

                    <div class="catalog-card-desc">${m.description || 'Versatile AI language model with fast inference.'}</div>

                    <div class="catalog-specs">
                      <div>Ctx: <span>${m.context_window || '128k'}</span></div>
                      <div>Params: <span>${m.parameter_size || 'Cloud'}</span></div>
                    </div>

                    <div class="catalog-card-actions">
                      <button class="secondary catalog-btn-fav" data-model="${m.name}" title="Favorite">${isFav ? '★' : '☆'}</button>
                      ${isSelected ?
                        `<button class="primary" disabled>✓ Active</button>` :
                        `<button class="primary catalog-btn-select" data-model="${m.name}">Select</button>`
                      }
                    </div>
                  </article>
                `;
              }).join("")
            }
          </div>

          <div class="modal-actions" style="justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 12px; margin-top: 0;">
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="pull-custom-input" placeholder="Pull custom Ollama model (e.g. qwen2.5:7b)" style="padding: 7px 10px; font-size: 12px; width: 280px;" />
              <button id="pull-custom-btn" class="secondary" style="width: auto; padding: 7px 12px; font-size: 12px;">⬇ Pull Model</button>
            </div>
            <button class="primary modal-close">Done</button>
          </div>
        </div>
      `;

      showCustomModal(modalHtml);
      bindCatalogEvents();
    } catch (err) {
      notify("error", `Failed to load catalog: ${err.message}`);
    }
  };

  const bindCatalogEvents = () => {
    const searchInput = document.getElementById("catalog-search-input");
    if (searchInput) {
      let timer;
      searchInput.oninput = (e) => {
        catalogSearch = e.target.value;
        clearTimeout(timer);
        timer = setTimeout(renderCatalogView, 220);
      };
      searchInput.focus();
      searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    }

    document.querySelectorAll("[data-cat-loc]").forEach(btn => {
      btn.onclick = () => {
        catalogLoc = btn.dataset.catLoc;
        state.modelLocationFilter = catalogLoc;
        storage.set("model-location-filter", catalogLoc);
        renderCatalogView();
        loadModels();
      };
    });

    document.querySelectorAll("[data-cat-tier]").forEach(btn => {
      btn.onclick = () => {
        catalogTier = btn.dataset.catTier;
        state.modelTierFilter = catalogTier;
        storage.set("model-tier-filter", catalogTier);
        renderCatalogView();
        loadModels();
      };
    });

    document.querySelectorAll(".catalog-btn-select").forEach(btn => {
      btn.onclick = () => {
        const modelName = btn.dataset.model;
        state.model = modelName;
        storage.set("model", state.model);
        document.getElementById("model-select").value = state.model;
        updateCurrentModelBadge();
        updateFavoriteButton();
        updateSendState();
        closeModal();
        notify("success", `Switched active model to ${modelName}`);
      };
    });

    document.querySelectorAll(".catalog-btn-fav").forEach(btn => {
      btn.onclick = () => {
        const name = btn.dataset.model;
        state.favoriteModels = state.favoriteModels.includes(name)
          ? state.favoriteModels.filter(n => n !== name)
          : [...state.favoriteModels, name];
        storage.set("favorite-models", JSON.stringify(state.favoriteModels));
        updateFavoriteButton();
        renderCatalogView();
        loadModels();
      };
    });

    const pullBtn = document.getElementById("pull-custom-btn");
    const pullInput = document.getElementById("pull-custom-input");
    if (pullBtn && pullInput) {
      pullBtn.onclick = async () => {
        const name = pullInput.value.trim();
        if (!name) return notify("warning", "Enter an Ollama model name (e.g., phi4, qwen2.5)");
        pullBtn.disabled = true;
        pullBtn.textContent = "Pulling…";
        try {
          const res = await api.pullModel(name);
          const reader = res.body.getReader(), decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            if (done) break;
          }
          notify("success", `Model ${name} pulled successfully!`);
          await loadModels();
          renderCatalogView();
        } catch (e) {
          notify("error", `Pull failed: ${e.message}`);
        } finally {
          pullBtn.disabled = false;
          pullBtn.textContent = "⬇ Pull Model";
        }
      };
    }
  };

  await renderCatalogView();
}

document.getElementById("open-model-catalog")?.addEventListener("click", openModelCatalogModal);

document.getElementById("pull-model").onclick = openModelCatalogModal;

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
  workspaceMenu.open("settings");
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

document.getElementById("open-menu")?.addEventListener("click", () => workspaceMenu.open("secrets"));
document.getElementById("open-menu-sidebar")?.addEventListener("click", () => workspaceMenu.open("secrets"));
document.getElementById("generation-settings")?.addEventListener("click", () => workspaceMenu.open("settings"));

const enableToolsEl = document.getElementById("enable-tools");
if (enableToolsEl) {
  enableToolsEl.checked = state.useTools;
  enableToolsEl.onchange = event => {
    state.useTools = event.target.checked;
    storage.set("tools", state.useTools);
  };
}
const confirmTools = document.getElementById("confirm-tools");
if (confirmTools) {
  confirmTools.checked = JSON.parse(storage.get("confirmedTools", "[]")).length > 0;
  confirmTools.onchange = event => storage.set("confirmedTools", JSON.stringify(event.target.checked ? ["write_file", "run_python", "run_shell", "web_fetch"] : []));
}

document.querySelectorAll(".tab").forEach(tab => tab.onclick = () => selectTab(tab.dataset.tab));
document.querySelectorAll(".tab").forEach((tab, index, tabs) => tab.onkeydown = event => {
  if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key.includes("Left") || event.key.includes("Up") ? -1 : 1) + tabs.length) % tabs.length;
  tabs[next].focus(); tabs[next].click();
});

document.getElementById("open-files")?.addEventListener("click", () => {
  setPanel(rightPanel, true);
  files.load();
});
document.getElementById("toggle-right-panel")?.addEventListener("click", () => setPanel(rightPanel, rightPanel.classList.contains("collapsed")));
document.getElementById("close-right-panel")?.addEventListener("click", () => setPanel(rightPanel, false));
document.getElementById("toggle-sidebar")?.addEventListener("click", () => setPanel(sidebar, sidebar.classList.contains("collapsed")));
document.getElementById("collapse-sidebar")?.addEventListener("click", () => setPanel(sidebar, false));
document.getElementById("toggle-fullscreen")?.addEventListener("click", toggleFullscreenTerminal);
if (scrim) scrim.onclick = () => { setPanel(sidebar, false); setPanel(rightPanel, false); };

document.getElementById("attach")?.addEventListener("click", async () => {
  setPanel(rightPanel, true);
  files.load();
  notify("success", "Choose a file from Workspace Explorer; double-click attaches it.");
});

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
  if (!activeFiles) return;
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

document.getElementById("agent-save")?.addEventListener("click", async () => {
  try {
    await configure.save();
    notify("success", "Agent instructions saved");
  } catch (e) {
    notify("error", e.message);
  }
});
document.getElementById("workspace-config-save")?.addEventListener("click", async () => {
  try {
    await configure.saveWorkspace();
    notify("success", "File access updated");
  } catch (e) {
    notify("error", e.message);
  }
});
document.getElementById("workspace-config-reload")?.addEventListener("click", () => configure.load().catch(error => notify("error", error.message)));
document.getElementById("refresh-integrations")?.addEventListener("click", () => integrations.load().catch(error => notify("error", error.message)));

document.getElementById("agent-new")?.addEventListener("click", () => {
  const p = document.getElementById("agent-path");
  const t = document.getElementById("agent-text");
  if (p) p.value = "AGENT.md";
  if (t) t.value = "# Agent instructions\n\n";
});

document.getElementById("agent-template")?.addEventListener("click", async () => {
  try {
    const templates = await api.agentTemplates();
    showModal("AGENT.md templates", templates.map(t => `<button class="template-choice" data-template="${t.id}">${t.name}</button>`).join(""));
    document.querySelectorAll(".template-choice").forEach(button => button.onclick = () => {
      const template = templates.find(t => t.id === button.dataset.template);
      const p = document.getElementById("agent-path");
      const t = document.getElementById("agent-text");
      if (p) p.value = p.value || "AGENT.md";
      if (t && template) t.value = template.content;
      closeModal();
    });
  } catch (e) {
    notify("error", e.message);
  }
});

bindWelcomeCards();
const input = document.getElementById("input");
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
});
input.addEventListener("input", saveDraft);

document.addEventListener("keydown", event => {
  // Shortcut: Alt+M or Ctrl+M to open Workspace Menu
  if ((event.altKey || event.ctrlKey || event.metaKey) && (event.key === "m" || event.key === "M" || event.key === "µ")) {
    event.preventDefault();
    workspaceMenu.open("secrets");
    return;
  }
  // Shortcut: Alt+F to toggle full-screen terminal
  if (event.altKey && (event.key === "f" || event.key === "F" || event.key === "ƒ")) {
    event.preventDefault();
    toggleFullscreenTerminal();
    return;
  }
  // Shortcut: Ctrl+B or Cmd+B to toggle sidebar
  if ((event.ctrlKey || event.metaKey) && (event.key === "b" || event.key === "B")) {
    event.preventDefault();
    setPanel(sidebar, sidebar.classList.contains("collapsed"));
    return;
  }
  // Shortcut: Ctrl+J or Cmd+J to toggle right workspace panel
  if ((event.ctrlKey || event.metaKey) && (event.key === "j" || event.key === "J")) {
    event.preventDefault();
    setPanel(rightPanel, rightPanel.classList.contains("collapsed"));
    return;
  }

  if (event.key === "Escape") {
    if (!document.getElementById("modal").classList.contains("hidden")) { closeModal(); return; }
    const editor = document.getElementById("file-editor");
    if (!editor.classList.contains("hidden")) { editor.classList.add("hidden"); return; }
    const isMobile = window.matchMedia("(max-width: 1100px)").matches;
    if (isMobile) {
      setPanel(sidebar, false);
      setPanel(rightPanel, false);
    }
  }
});

applyAppearance();
const shortcutHint = document.querySelector(".shortcut-hint");
if (shortcutHint) shortcutHint.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↵ send · ⇧↵ newline · ⌥M menu · ⌥F fullscreen" : "Enter to send · Shift+Enter newline · Alt+M menu · Alt+F fullscreen";
setPanel(sidebar, storage.get("sidebar-open", "true") !== "false");
setPanel(rightPanel, storage.get("workspace-open", "true") !== "false");
updateFullscreenButtonState();
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
         <li>Browse, view, and edit files in the right <strong>File Explorer</strong> panel.</li>
         <li>Click the <strong>☰ Menu</strong> button in the header (or press <kbd>Alt+M</kbd>) to configure <strong>API keys &amp; secrets</strong> (GitHub, GitLab, etc.), tool policies, file sandbox access, and IDE integrations.</li>
         <li>Inspect error traces in <strong>Settings &amp; Diagnostics</strong> anytime.</li>
       </ol>`,
      '<div class="modal-actions"><button class="primary modal-close" id="finish-onboarding">Get started</button></div>'
    );
  })();
}

document.addEventListener("click", event => {
  if (event.target.id === "finish-onboarding") storage.set("onboarding-seen", "true");
});

// ============================================================================
// Android Companion App Preview Simulator Launcher
// ============================================================================
let androidPreviewInstance = null;
const appContainer = document.getElementById("app");
const androidPreviewContainer = document.getElementById("android-preview-container");
const launchAndroidBtn = document.getElementById("launch-android-preview");
const sidebarAndroidBtn = document.getElementById("open-android-sidebar");

function launchAndroidCompanion() {
  if (!androidPreviewContainer) return;
  appContainer?.classList.add("hidden");
  androidPreviewContainer.classList.remove("hidden");

  if (!androidPreviewInstance) {
    androidPreviewInstance = new AndroidPreview(api);
  }
  androidPreviewInstance.mount(androidPreviewContainer);
  storage.set("active-preview-mode", "android");
  notify("info", "Launched Mini-O Android Companion in preview window");
}

function exitAndroidCompanion() {
  if (!androidPreviewContainer) return;
  androidPreviewContainer.classList.add("hidden");
  appContainer?.classList.remove("hidden");
  storage.set("active-preview-mode", "desktop");
}

if (launchAndroidBtn) {
  launchAndroidBtn.addEventListener("click", () => {
    launchAndroidCompanion();
  });
}

if (sidebarAndroidBtn) {
  sidebarAndroidBtn.addEventListener("click", () => {
    launchAndroidCompanion();
  });
}

window.addEventListener("minio-exit-android-preview", () => {
  exitAndroidCompanion();
});

// Global keyboard shortcut: Alt+A to toggle Android App Companion
document.addEventListener("keydown", event => {
  if (event.altKey && (event.key === "a" || event.key === "A")) {
    event.preventDefault();
    if (androidPreviewContainer?.classList.contains("hidden")) {
      launchAndroidCompanion();
    } else {
      exitAndroidCompanion();
    }
  }
});

// Check if launched with ?app=android or hash #android
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("app") === "android" || window.location.hash === "#android") {
  launchAndroidCompanion();
}

