import { api } from "./api.js";
import { renderMarkdown, attachCopyHandlers } from "./render.js";
import { classifyError, diagnostics } from "./errors.js";

function messageTime(date = new Date()) {
  const format = localStorage.getItem("mini-o.time-format") || "relative";
  if (format === "absolute") return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  return minutes < 1 ? "just now" : minutes === 1 ? "1 min ago" : `${minutes} min ago`;
}

let currentAudioSource = null;

function playPcmBase64(base64Data, sampleRate = 24000) {
  if (currentAudioSource) {
    try {
      currentAudioSource.source.stop();
      currentAudioSource.audioCtx.close();
    } catch {}
    currentAudioSource = null;
  }

  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const int16Array = new Int16Array(bytes.buffer);
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
  const audioBuffer = audioCtx.createBuffer(1, float32Array.length, sampleRate);
  audioBuffer.getChannelData(0).set(float32Array);
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);
  source.start();
  currentAudioSource = { audioCtx, source };
  return currentAudioSource;
}

class Chat {
  constructor(state) {
    this.state = state;
    this.messagesEl = document.getElementById("messages");
    this.input = document.getElementById("input");
    this.sendBtn = document.getElementById("send");
    this.stopBtn = document.getElementById("stop");
    this.statusEl = document.getElementById("status");

    attachCopyHandlers(this.messagesEl);
    this.sendBtn.onclick = () => this.send();
    this.stopBtn.onclick = () => this.controller?.abort();
    this.input.onkeydown = e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    };
  }

  setStatus(status) {
    this.statusEl.className = `status-dot ${status}`;
    const labels = { busy: "Generating response", online: "Ready", offline: "Connection error" };
    const label = labels[status] || "Checking connection";
    this.statusEl.setAttribute("aria-label", label);
    const statusText = document.getElementById("status-text");
    if (statusText) statusText.textContent = label;
  }

  addMessage(role, content = "") {
    const wrap = document.createElement("div");
    wrap.className = `msg ${role}`;
    const created = new Date();
    wrap.innerHTML = `
      <div class="avatar" aria-hidden="true">${role === "user" ? "🧑" : "🤖"}</div>
      <div class="bubble">
        <div class="content" tabindex="-1"></div>
        <div class="grounding-blocks"></div>
        <div class="tool-blocks"></div>
        <div class="message-actions">
          <button type="button" class="listen-message ${role === "user" ? "hidden" : ""}" title="Listen with Gemini neural voice">🔊 Listen</button>
          <button type="button" class="copy-message">Copy</button>
          <button type="button" class="select-message">Select</button>
          <button type="button" class="share-message">Share</button>
          <button type="button" class="raw-message">Raw</button>
          <button type="button" class="edit-message">Edit</button>
          <button type="button" class="regenerate-message">Regenerate</button>
          <button type="button" class="branch-message">Branch</button>
          <button type="button" class="retry-message hidden">Retry</button>
        </div>
        <div class="message-meta" title="${created.toISOString()}">${messageTime(created)}</div>
      </div>
    `;

    const contentEl = wrap.querySelector(".content");
    contentEl.innerHTML = renderMarkdown(content);
    contentEl.dataset.raw = content;

    const listenBtn = wrap.querySelector(".listen-message");
    if (listenBtn) {
      listenBtn.onclick = async () => {
        if (listenBtn.dataset.playing === "true") {
          if (currentAudioSource) {
            try { currentAudioSource.source.stop(); } catch {}
            currentAudioSource = null;
          }
          listenBtn.textContent = "🔊 Listen";
          delete listenBtn.dataset.playing;
          return;
        }

        const raw = contentEl.dataset.raw || contentEl.textContent || "";
        if (!raw.trim()) return;

        listenBtn.textContent = "⏳ Generating speech…";
        try {
          const res = await api.geminiSpeech({
            text: raw.slice(0, 2000),
            voice: this.state.options?.ttsVoice || "Kore",
          });
          if (res.audio_data) {
            listenBtn.textContent = "⏹ Stop audio";
            listenBtn.dataset.playing = "true";
            const playback = playPcmBase64(res.audio_data, res.sample_rate || 24000);
            playback.source.onended = () => {
              listenBtn.textContent = "🔊 Listen";
              delete listenBtn.dataset.playing;
            };
          }
        } catch (err) {
          listenBtn.textContent = "🔊 Listen";
          delete listenBtn.dataset.playing;
          document.dispatchEvent(new CustomEvent("mini-o:notice", { detail: { kind: "warning", message: `Gemini Voice: ${err.message}` } }));
        }
      };
    }

    wrap.querySelector(".copy-message").onclick = async () => {
      await navigator.clipboard.writeText(contentEl.dataset.raw || "");
      wrap.querySelector(".copy-message").textContent = "Copied";
      setTimeout(() => { wrap.querySelector(".copy-message").textContent = "Copy"; }, 1200);
    };

    wrap.querySelector(".select-message").onclick = () => {
      const range = document.createRange();
      range.selectNodeContents(contentEl);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };

    wrap.querySelector(".share-message").onclick = async () => {
      const text = contentEl.dataset.raw || "";
      if (navigator.share) await navigator.share({ title: "Mini-O message", text });
      else await navigator.clipboard.writeText(text);
    };

    wrap.querySelector(".retry-message").onclick = () => {
      this.input.value = this.retryText || "";
      this.input.dispatchEvent(new Event("input"));
      this.input.focus();
      this.send();
    };

    wrap.querySelector(".edit-message").onclick = () => {
      this.input.value = contentEl.dataset.raw || "";
      this.input.dispatchEvent(new Event("input"));
      this.input.focus();
    };

    wrap.querySelector(".regenerate-message").onclick = () => {
      this.input.value = this.retryText || "";
      this.input.dispatchEvent(new Event("input"));
      this.send();
    };

    wrap.querySelector(".branch-message").onclick = () => {
      const raw = contentEl.dataset.raw || "";
      const index = [...this.messagesEl.querySelectorAll(".msg")].indexOf(wrap);
      this.state.conversationId = null;
      this.state.messages = this.state.messages.slice(0, Math.max(0, index + 1));
      this.input.value = role === "user" ? raw : (this.state.messages.filter(m => m.role === "user").at(-1)?.content || raw);
      this.input.dispatchEvent(new Event("input"));
      this.input.focus();
      this.announce("Started a new branch");
    };

    wrap.querySelector(".raw-message").onclick = () => {
      let raw = wrap.querySelector(".raw-response");
      if (!raw) {
        raw = document.createElement("pre");
        raw.className = "raw-response";
        raw.textContent = contentEl.dataset.raw || "";
        wrap.querySelector(".bubble").appendChild(raw);
      } else {
        raw.classList.toggle("hidden");
      }
    };

    document.getElementById("welcome")?.remove();
    this.messagesEl.appendChild(wrap);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    return wrap;
  }

  appendToken(bubble, text) {
    const content = bubble.querySelector(".content");
    content.dataset.raw = (content.dataset.raw || "") + text;
    if (!content.dataset.renderScheduled) {
      content.dataset.renderScheduled = "true";
      requestAnimationFrame(() => {
        content.innerHTML = renderMarkdown(content.dataset.raw);
        delete content.dataset.renderScheduled;
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      });
    }
  }

  addGroundingBlock(bubble, grounding) {
    let wrap = bubble.querySelector(".grounding-blocks");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "grounding-blocks";
      bubble.querySelector(".content").after(wrap);
    }
    const chunks = grounding.groundingChunks || [];
    const webChunks = chunks.filter(c => c.web?.uri);
    if (!webChunks.length) return;

    wrap.innerHTML = `
      <div class="grounding-card">
        <span class="grounding-title">🔍 Grounded with Google Search:</span>
        <ul class="grounding-list">
          ${webChunks.map(c => `
            <li>
              <a href="${c.web.uri}" target="_blank" rel="noopener noreferrer">
                ${c.web.title || c.web.uri}
              </a>
            </li>
          `).join("")}
        </ul>
      </div>
    `;
  }

  addToolBlock(bubble, name, args) {
    const block = document.createElement("details");
    block.className = "tool-block";
    block.open = false;
    block.innerHTML = `<summary>⚙️ Tool execution: <code>${name}</code></summary><pre>${JSON.stringify(args, null, 2)}</pre>`;
    bubble.querySelector(".tool-blocks").appendChild(block);
    return block;
  }

  addApprovalBlock(bubble, data) {
    const block = document.createElement("div");
    block.className = "approval-card";
    block.innerHTML = `
      <strong>⚠️ Tool Confirmation Required: <code>${data.name}</code></strong>
      <p>Risk level: <strong>${data.risk || "high"}</strong>. ${(data.side_effects || []).join(", ")}</p>
      <pre></pre>
      <div class="modal-actions" style="margin-top: 6px;">
        <button type="button" class="secondary" id="open-tool-policies">Review Tool Policies</button>
      </div>
    `;
    block.querySelector("pre").textContent = JSON.stringify(data.args, null, 2);
    block.querySelector("#open-tool-policies").onclick = () => {
      document.getElementById("toggle-right-panel")?.click();
      document.querySelector('[data-tab="tools"]')?.click();
    };
    bubble.querySelector(".tool-blocks").appendChild(block);
  }

  updateToolResult(block, result) {
    const pre = block.querySelector("pre");
    pre.textContent += `\n\n[Result: ${result.ok ? "SUCCESS" : "FAILED"}]\n${result.ok ? result.output : result.error}`;
    block.open = true;
    if (!result.ok) {
      block.classList.add("tool-error");
    }
  }

  renderErrorCard(assistant, error) {
    const classification = classifyError(error);
    const bubble = assistant.querySelector(".bubble");
    const content = assistant.querySelector(".content");
    const hadPartialContent = Boolean(content.dataset.raw && content.dataset.raw.trim().length > 0);

    const errorCard = document.createElement("div");
    errorCard.className = `error-card error-card-${classification.category}`;
    errorCard.innerHTML = `
      <div class="error-card-header">
        <span class="badge badge-error">${classification.category.toUpperCase()} ERROR</span>
        <span class="diagnostic-tag" title="Diagnostic ID">${classification.diagnosticId}</span>
      </div>
      <div class="error-card-body">
        <p class="error-message"><strong>${classification.message}</strong></p>
        <p class="error-action">💡 <em>Suggested action:</em> ${classification.action}</p>
      </div>
      <div class="error-card-actions">
        <button type="button" class="secondary btn-copy-diag">Copy Diagnostic ID</button>
        <button type="button" class="secondary btn-view-diag">View Error Log</button>
        <button type="button" class="secondary btn-toggle-details">Show Details</button>
        <button type="button" class="primary btn-retry-action">Retry Generation</button>
      </div>
      <details class="error-details hidden" style="margin-top: 8px;">
        <summary>Technical Details & Stack</summary>
        <pre class="error-stack">${classification.details?.stack || error.stack || JSON.stringify(classification, null, 2)}</pre>
      </details>
    `;

    errorCard.querySelector(".btn-copy-diag").onclick = async (e) => {
      await navigator.clipboard.writeText(classification.diagnosticId);
      e.target.textContent = "Copied!";
      setTimeout(() => { e.target.textContent = "Copy Diagnostic ID"; }, 1500);
    };

    errorCard.querySelector(".btn-view-diag").onclick = () => {
      document.dispatchEvent(new CustomEvent("mini-o:open-diagnostics", { detail: { id: classification.diagnosticId } }));
    };

    errorCard.querySelector(".btn-toggle-details").onclick = (e) => {
      const detailsEl = errorCard.querySelector(".error-details");
      detailsEl.classList.toggle("hidden");
      e.target.textContent = detailsEl.classList.contains("hidden") ? "Show Details" : "Hide Details";
    };

    errorCard.querySelector(".btn-retry-action").onclick = () => {
      this.input.value = this.retryText || "";
      this.input.dispatchEvent(new Event("input"));
      this.send();
    };

    if (hadPartialContent) {
      const notice = document.createElement("div");
      notice.className = "field-help";
      notice.style.marginTop = "8px";
      notice.textContent = "Stream disconnected before completion. Partial response displayed above.";
      bubble.appendChild(notice);
    } else {
      content.innerHTML = "";
    }

    bubble.appendChild(errorCard);
    assistant.querySelector(".retry-message").classList.remove("hidden");
  }

  async send() {
    const text = this.input.value.trim();
    if (!text) return;
    if (!this.state.model) {
      this.setStatus("offline");
      this.input.setCustomValidity("Choose an available model before sending.");
      this.input.reportValidity();
      return;
    }
    this.input.setCustomValidity("");
    this.input.value = "";
    this.setStatus("busy");
    this.messagesEl.setAttribute("aria-busy", "true");
    this.sendBtn.classList.add("hidden");
    this.stopBtn.classList.remove("hidden");

    let assistant;
    this.controller = new AbortController();

    try {
      let content = text;
      if (this.state.attachedFiles.length) {
        const attachments = await Promise.all(
          this.state.attachedFiles.map(async path => {
            try {
              const res = await api.read(path);
              return `${path}\n${res.content}`;
            } catch (err) {
              return `${path}\n[Error reading attached file: ${err.message}]`;
            }
          })
        );
        content += `\n\nAttached workspace files:\n${attachments.join("\n\n")}`;
      }

      const user = { role: "user", content };
      this.state.messages.push(user);
      this.addMessage("user", text);
      assistant = this.addMessage("assistant", "");
      this.retryText = text;

      const confirmed = JSON.parse(localStorage.getItem("mini-o.confirmedTools") || "[]");
      const enabledTools = JSON.parse(localStorage.getItem("mini-o.enabled-tools") || "null");

      for await (const event of api.streamChat(
        {
          model: this.state.model,
          messages: this.state.messages,
          conversation_id: this.state.conversationId,
          options: this.state.options,
          use_tools: this.state.useTools,
          enabled_tools: enabledTools,
          confirmed_tools: confirmed,
        },
        this.controller.signal
      )) {
        if (event.event === "token") this.appendToken(assistant, event.data.content || "");
        if (event.event === "grounding") this.addGroundingBlock(assistant, event.data);
        if (event.event === "tool_call") this.addToolBlock(assistant, event.data.name, event.data.args);
        if (event.event === "approval_required") this.addApprovalBlock(assistant, event.data);
        if (event.event === "tool_result") {
          const blocks = assistant.querySelectorAll(".tool-block");
          if (blocks.length > 0) this.updateToolResult(blocks[blocks.length - 1], event.data);
        }
        if (event.event === "done" && event.data.stats) this.addStats(assistant, event.data.stats, event.data.stop_reason);
        if (event.event === "end" && event.data.id) {
          this.state.conversationId = event.data.id;
          this.state.messages.push({
            role: "assistant",
            content: assistant.querySelector(".content").dataset.raw || "",
          });
        }
      }
    } catch (error) {
      if (assistant && error.name === "AbortError") {
        const content = assistant.querySelector(".content");
        if (!content.dataset.raw || content.dataset.raw.trim() === "") {
          content.textContent = "Generation stopped by user.";
        }
        assistant.querySelector(".retry-message").classList.remove("hidden");
        this.announce("Generation interrupted; retry is available");
      } else if (assistant) {
        this.renderErrorCard(assistant, error);
        this.setStatus("offline");
        this.announce(`Response failed: ${error.message}`);
      }
    } finally {
      this.sendBtn.classList.remove("hidden");
      this.stopBtn.classList.add("hidden");
      this.messagesEl.setAttribute("aria-busy", "false");
      this.setStatus("online");
    }
  }

  announce(message) {
    document.getElementById("announcer")?.replaceChildren(document.createTextNode(message));
  }

  addStats(wrap, stats, stopReason = "stop") {
    const meta = wrap.querySelector(".message-meta");
    const tokens = stats.eval_count ? `${stats.eval_count} tokens` : "";
    const ms = stats.total_duration ? `${Math.round(stats.total_duration / 1e6)} ms` : "";
    meta.textContent = [meta.textContent, tokens, ms, stopReason].filter(Boolean).join(" · ");
  }
}

export { Chat };
