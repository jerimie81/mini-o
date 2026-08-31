import { api } from "./api.js";
import { classifyError } from "./errors.js";

class FilePanel {
  constructor() {
    this.tree = document.getElementById("file-tree");
    this.editor = document.getElementById("file-editor");
    this.editorText = document.getElementById("editor-text");
    this.editorPath = document.getElementById("editor-path");
    document.getElementById("refresh-files").addEventListener("click", () => this.load());
    document.getElementById("file-back")?.addEventListener("click", () => this.goUp());
    document.getElementById("file-search")?.addEventListener("input", () => {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.renderCurrent(), 150);
    });
    document.getElementById("file-search-content")?.addEventListener("click", () => this.searchContent());
    document.getElementById("file-sort")?.addEventListener("change", () => this.load(this.currentPath, false));
    document.getElementById("file-hidden")?.addEventListener("click", event => {
      this.includeHidden = !this.includeHidden;
      event.currentTarget.setAttribute("aria-pressed", String(this.includeHidden));
      this.load(this.currentPath, false);
    });
    document.getElementById("new-file").addEventListener("click", () => this.newFile());
    document.getElementById("editor-save").addEventListener("click", () => this.save());
    document.getElementById("editor-close").addEventListener("click", () => this.closeEditor());
    this.currentPath = ".";
    this.items = [];
    this.history = ["."];
    this.historyIndex = 0;
    this.modified = null;
    this.undoStack = [];
    this.redoStack = [];
    this.editorText.addEventListener("input", () => {
      this.setDirty(true);
      this.undoStack.push(this.editorText.value);
      this.redoStack = [];
    });
    document.getElementById("editor-undo")?.addEventListener("click", () => this.undo());
    document.getElementById("editor-redo")?.addEventListener("click", () => this.redo());
    document.getElementById("editor-find")?.addEventListener("click", () => this.findReplace());
    document.getElementById("editor-goto")?.addEventListener("click", () => this.goToLine());
    this.includeHidden = false;
  }

  closeEditor() {
    this.editor.classList.add("hidden");
  }

  async load(path = ".", record = true) {
    this.currentPath = path;
    if (record && this.history[this.history.length - 1] !== path) {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(path);
      this.historyIndex++;
    }
    this.request?.abort();
    this.request = new AbortController();
    try {
      const items = await api.files(
        path,
        document.getElementById("file-search")?.value || "",
        document.getElementById("file-sort")?.value || "name",
        this.includeHidden,
        this.request.signal
      );
      this.items = items;
      this.renderCurrent();
    } catch (error) {
      if (error.name !== "AbortError") {
        const classified = classifyError(error);
        this.tree.innerHTML = `
          <div class="error-banner">
            <strong>Failed to load files (${classified.category}):</strong>
            <p>${classified.message}</p>
            <p class="field-help">${classified.action}</p>
            <button class="secondary" id="retry-load-files">Retry</button>
          </div>
        `;
        document.getElementById("retry-load-files")?.addEventListener("click", () => this.load(path));
      }
    }
  }

  async searchContent() {
    const query = document.getElementById("file-search")?.value.trim();
    if (!query) return this.renderCurrent();
    try {
      const results = await api.workspaceSearch(query, this.currentPath);
      this.tree.innerHTML = "";
      const heading = document.createElement("div");
      heading.className = "field-help";
      heading.textContent = `Content matches for “${query}”`;
      this.tree.appendChild(heading);

      if (!results.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No content matches found.";
        this.tree.appendChild(empty);
        return;
      }

      results.forEach(result => {
        const row = document.createElement("div");
        row.className = "search-result";
        const open = document.createElement("button");
        open.className = "file-entry";
        open.textContent = result.path;
        open.onclick = () => this.open(result.path);
        const insert = document.createElement("button");
        insert.className = "secondary";
        insert.textContent = "Insert context";
        insert.onclick = () => document.dispatchEvent(new CustomEvent("mini-o:insert-context", {
          detail: { path: result.path, preview: result.preview }
        }));
        const preview = document.createElement("pre");
        preview.textContent = result.preview;
        row.append(open, insert, preview);
        this.tree.appendChild(row);
      });
    } catch (error) {
      const classified = classifyError(error);
      this.tree.innerHTML = `<div class="error-banner"><p>${classified.message}</p></div>`;
    }
  }

  renderCurrent() {
    const path = this.currentPath;
    const pathSubtitle = document.getElementById("file-explorer-path");
    if (pathSubtitle) {
      pathSubtitle.textContent = path === "." ? "Workspace Root" : path;
      pathSubtitle.title = path === "." ? "Workspace Root" : path;
    }
    const filter = (document.getElementById("file-search")?.value || "").toLowerCase();
    try {
      this.tree.innerHTML = "";
      const toolbar = document.createElement("div");
      toolbar.className = "field-help";
      toolbar.textContent = `Workspace / ${path === "." ? "" : path}`;
      this.tree.appendChild(toolbar);
      const items = this.items.filter(item => item.name.toLowerCase().includes(filter));
      if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "This folder is empty.";
        this.tree.appendChild(empty);
      }
      items.forEach(item => {
        const row = document.createElement("button");
        row.className = "file-entry";
        row.tabIndex = 0;
        const when = item.modified ? new Date(item.modified * 1000).toLocaleDateString() : "";
        row.textContent = `${item.is_dir ? "📁" : "📄"} ${item.name}${item.is_dir ? "" : `  · ${item.size} B · ${when}`}`;
        row.onclick = () => item.is_dir ? this.load(item.path) : this.open(item.path);
        if (!item.is_dir) {
          row.ondblclick = () => document.dispatchEvent(new CustomEvent("mini-o:attach", { detail: { path: item.path } }));
        }
        this.tree.appendChild(row);
      });
      this.bindKeyboard();
      const back = document.getElementById("file-back");
      if (back) back.disabled = path === ".";
    } catch (error) {
      this.tree.textContent = error.message;
    }
  }

  goUp() {
    if (this.currentPath === ".") return;
    this.load(this.currentPath.split("/").slice(0, -1).join("/") || ".");
  }

  bindKeyboard() {
    const rows = [...this.tree.querySelectorAll("button.file-entry")];
    rows.forEach((row, index) => row.onkeydown = event => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + rows.length) % rows.length;
      rows[next]?.focus();
    });
  }

  async open(path) {
    try {
      const result = await api.read(path);
      const metadata = await api.fileMetadata(path).catch(() => ({}));
      if (this.editorPath) this.editorPath.textContent = path;
      if (this.editorText) this.editorText.value = result.content;
      this.modified = metadata.modified || result.modified || null;
      const langEl = document.getElementById("editor-language");
      if (langEl) langEl.textContent = metadata.language || "text";
      const encEl = document.getElementById("editor-encoding");
      if (encEl) encEl.textContent = `${metadata.encoding || "utf-8"} · ${metadata.line_ending || "lf"}`;
      const roEl = document.getElementById("editor-readonly");
      if (roEl) roEl.checked = Boolean(metadata.read_only);
      if (this.editorText) this.editorText.readOnly = Boolean(metadata.read_only);
      this.undoStack = [result.content];
      this.redoStack = [];
      this.setDirty(false);
      if (this.editor) this.editor.classList.remove("hidden");
    } catch (error) {
      const classified = classifyError(error);
      document.dispatchEvent(new CustomEvent("mini-o:notice", {
        detail: { kind: "error", message: `Cannot open ${path}: ${classified.message}` }
      }));
    }
  }

  async save(force = false) {
    const filePath = this.editorPath.textContent;
    try {
      const res = await api.write(filePath, this.editorText.value, force ? null : this.modified);
      this.modified = res.modified || (await api.fileMetadata(filePath).catch(() => ({}))).modified || null;
      this.setDirty(false);
      document.getElementById("announcer")?.replaceChildren(document.createTextNode(`Saved ${filePath}`));
      document.dispatchEvent(new CustomEvent("mini-o:notice", { detail: { kind: "success", message: `Saved ${filePath}` } }));
      this.editor.classList.add("hidden");
      await this.load(this.currentPath);
    } catch (error) {
      if (error.status === 409 || error.code === "CONCURRENCY_CONFLICT") {
        this.showConflictDialog(filePath);
      } else {
        const classified = classifyError(error);
        document.dispatchEvent(new CustomEvent("mini-o:notice", {
          detail: { kind: "error", message: `Failed to save ${filePath}: ${classified.message}` }
        }));
      }
    }
  }

  showConflictDialog(filePath) {
    const modal = document.getElementById("modal");
    if (!modal) return;
    const content = `
      <p><strong>Concurrent Modification Conflict:</strong></p>
      <p>The file <code>${filePath}</code> was modified by another tool or process since you opened it.</p>
      <p>Choose how you would like to proceed:</p>
      <div class="modal-actions" style="margin-top: 14px;">
        <button class="secondary" id="conflict-cancel">Cancel</button>
        <button class="secondary" id="conflict-reload">Reload Disk Version</button>
        <button class="danger" id="conflict-overwrite">Overwrite Disk Version</button>
      </div>
    `;
    const card = modal.querySelector(".modal-card");
    if (card) {
      card.innerHTML = `<h3>Save Conflict Detected</h3>${content}`;
      modal.classList.remove("hidden");

      document.getElementById("conflict-cancel").onclick = () => modal.classList.add("hidden");
      document.getElementById("conflict-reload").onclick = async () => {
        modal.classList.add("hidden");
        await this.open(filePath);
        document.dispatchEvent(new CustomEvent("mini-o:notice", { detail: { kind: "warning", message: `Reloaded ${filePath} from disk` } }));
      };
      document.getElementById("conflict-overwrite").onclick = async () => {
        modal.classList.add("hidden");
        await this.save(true);
      };
    }
  }

  newFile() {
    const name = prompt("New file path (e.g. notes.md):");
    if (name && name.trim()) {
      this.editorPath.textContent = name.trim();
      this.editorText.value = "";
      this.modified = null;
      this.undoStack = [""];
      this.redoStack = [];
      this.setDirty(true);
      this.editor.classList.remove("hidden");
    }
  }

  findReplace() {
    const find = prompt("Find text:");
    if (find === null) return;
    const replace = prompt("Replace with:", "");
    if (replace === null) return;
    this.editorText.value = this.editorText.value.split(find).join(replace);
    this.setDirty(true);
  }

  goToLine() {
    const line = Number(prompt("Go to line:", "1"));
    if (!Number.isInteger(line) || line < 1) return;
    const pos = this.editorText.value.split("\n").slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0);
    this.editorText.focus();
    this.editorText.setSelectionRange(pos, pos);
  }

  setDirty(dirty) {
    const status = document.getElementById("editor-status");
    if (status) {
      status.textContent = dirty ? "Unsaved changes" : "Saved";
      status.dataset.dirty = String(dirty);
    }
  }

  undo() {
    if (this.undoStack.length < 2) return;
    this.redoStack.push(this.undoStack.pop());
    this.editorText.value = this.undoStack.at(-1);
    this.setDirty(true);
  }

  redo() {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(next);
    this.editorText.value = next;
    this.setDirty(true);
  }
}

export { FilePanel };
