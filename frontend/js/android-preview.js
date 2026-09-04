// Mini-O Android Companion Interactive Preview Simulator
// Matches the exact Jetpack Compose architecture and UI from /android/app/

export class AndroidPreview {
  constructor(apiClient) {
    this.api = apiClient;
    this.activeScreen = 'chat'; // 'connect' | 'chat' | 'workspace' | 'editor' | 'diagnostics' | 'settings'
    this.isConnected = true;
    this.serverUrl = window.location.origin;
    this.token = '';
    this.profileName = 'Primary Workspace';
    this.isTokenRevealed = false;
    this.biometricSimOpen = false;

    // Chat State
    this.messages = [
      {
        id: 'msg_init',
        role: 'assistant',
        content: 'Hello! I am your Mini-O Android companion. I am connected to your local workspace and ready to help you code, run diagnostics, and manage files.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        model: 'gemini-2.5-flash',
        tokensPerSec: 42.8,
      }
    ];
    this.models = [];
    this.selectedModel = 'gemini-2.5-flash';
    this.isStreaming = false;
    this.abortController = null;
    this.currentToolCall = null;
    this.isVoiceListening = false;
    this.isVoiceSpeaking = false;
    this.recognition = null;

    // Workspace & Editor State
    this.currentDirectory = '';
    this.files = [];
    this.searchQuery = '';
    this.isLoadingFiles = false;
    this.currentEditorFile = null;
    this.editorContent = '';
    this.originalEditorContent = '';
    this.isEditorDirty = false;

    // Diagnostics State
    this.diagnosticsData = null;
    this.isLoadingDiagnostics = false;

    // Settings & Profiles
    this.savedProfiles = [
      { name: 'Primary Workspace', url: window.location.origin, token: '' },
      { name: 'LAN Mini-O Server', url: 'http://192.168.1.150:3000', token: 'secret-token-key' }
    ];
    this.theme = 'dark';
    this.isOffline = false;

    // Device View Mode: 'fullscreen' | 'framed' | 'split'
    this.viewMode = 'framed';
    this.container = null;

    this.initVoice();
  }

  initVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        this.recognition.onresult = (e) => {
          const transcript = Array.from(e.results)
            .map(r => r[0].transcript)
            .join('');
          const inputEl = document.getElementById('droid-chat-input');
          if (inputEl) inputEl.value = transcript;
        };
        this.recognition.onend = () => {
          this.isVoiceListening = false;
          this.updateMicButtonUI();
        };
        this.recognition.onerror = () => {
          this.isVoiceListening = false;
          this.updateMicButtonUI();
        };
      } catch (err) {
        console.warn('Speech recognition not available', err);
      }
    }
  }

  mount(targetContainer) {
    this.container = targetContainer;
    this.render();
    this.loadInitialData();
  }

  async loadInitialData() {
    try {
      // Load models
      const res = await fetch('/api/models');
      if (res.ok) {
        const data = await res.json();
        this.models = data.models || data || [];
        if (this.models.length > 0) {
          const first = typeof this.models[0] === 'string' ? this.models[0] : (this.models[0].name || this.models[0].id);
          this.selectedModel = first || 'gemini-2.5-flash';
        }
      }
    } catch (e) {
      console.warn('Could not fetch models for android preview', e);
    }
    this.loadFiles();
    this.loadDiagnostics();
  }

  async loadFiles(dir = '') {
    this.isLoadingFiles = true;
    this.renderWorkspaceFileList();
    try {
      const q = dir ? `?dir=${encodeURIComponent(dir)}` : '';
      const res = await fetch(`/api/files${q}`);
      if (res.ok) {
        const data = await res.json();
        this.files = Array.isArray(data) ? data : (data.files || []);
        this.currentDirectory = dir;
      }
    } catch (err) {
      console.error('Error fetching files:', err);
    } finally {
      this.isLoadingFiles = false;
      this.renderWorkspaceFileList();
    }
  }

  async loadDiagnostics() {
    this.isLoadingDiagnostics = true;
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        this.diagnosticsData = {
          status: data.status || 'healthy',
          version: data.version || '0.1.0',
          uptime: data.uptime ? `${Math.floor(data.uptime / 60)}m ${Math.floor(data.uptime % 60)}s` : '1h 14m',
          platform: navigator.platform || 'Linux / Container',
          nodeVersion: 'v22.10.0',
          workspacePath: '/opt/mini-o/workspace',
          modelCount: this.models.length || 8,
          activeConnections: 1,
          errorCount: 0,
        };
      }
    } catch (e) {
      this.diagnosticsData = {
        status: 'online',
        version: '0.1.0',
        uptime: '45m 12s',
        platform: 'Android 14 (API 34) / Mini-O Server',
        nodeVersion: 'v22.10.0',
        workspacePath: '/workspace',
        modelCount: 8,
        activeConnections: 1,
        errorCount: 0,
      };
    } finally {
      this.isLoadingDiagnostics = false;
      if (this.activeScreen === 'diagnostics') {
        this.renderDiagnosticsContent();
      }
    }
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="droid-preview-root ${this.viewMode}">
        <!-- Top Toolbar for Preview Control -->
        <div class="droid-preview-header">
          <div class="droid-preview-header-brand">
            <svg class="droid-brand-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993s-.4483.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993s-.4482.9997-.9993.9997m11.4045-6.02l1.997-3.459a.416.416 0 0 0-.152-.568.416.416 0 0 0-.568.152l-2.022 3.503c-1.442-.656-3.059-1.025-4.812-1.025-1.753 0-3.37.369-4.812 1.025L5.481 5.446a.416.416 0 0 0-.568-.152.416.416 0 0 0-.152.568l1.997 3.459C3.125 11.236 1 15.006 1 19.341h22c0-4.335-2.125-8.105-5.877-10.02"/>
            </svg>
            <span class="droid-preview-title">Mini-O Android Companion</span>
            <span class="droid-badge-live">LIVE JETPACK COMPOSE</span>
          </div>
          <div class="droid-preview-controls">
            <button class="droid-ctrl-btn ${this.viewMode === 'framed' ? 'active' : ''}" id="btn-mode-framed" title="Phone Frame View">📱 Phone</button>
            <button class="droid-ctrl-btn ${this.viewMode === 'fullscreen' ? 'active' : ''}" id="btn-mode-fullscreen" title="Full Mobile View">🖥️ Fullscreen</button>
            <button class="droid-ctrl-btn" id="btn-toggle-offline" title="Simulate Offline/Online state">${this.isOffline ? '🔴 Go Online' : '🟢 Online'}</button>
            <button class="droid-ctrl-btn droid-ctrl-close" id="btn-exit-android" title="Switch back to Desktop Workspace">✕ Desktop</button>
          </div>
        </div>

        <!-- Phone Device Frame Container -->
        <div class="droid-device-viewport">
          <div class="droid-phone-shell">
            <!-- Camera Punchhole Notch & Earpiece -->
            <div class="droid-notch-wrap">
              <div class="droid-camera-hole"></div>
            </div>

            <!-- Android Status Bar -->
            <div class="droid-status-bar">
              <span class="droid-status-time" id="droid-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <div class="droid-status-icons">
                <span class="droid-icon-wifi">${this.isOffline ? '❌' : '📶'}</span>
                <span class="droid-icon-cell">5G</span>
                <span class="droid-icon-battery">🔋 98%</span>
              </div>
            </div>

            <!-- Global Offline Banner -->
            <div class="droid-offline-banner ${this.isOffline ? '' : 'hidden'}" id="droid-offline-banner">
              ⚠️ No network connection. Operating in offline cache mode.
            </div>

            <!-- Main App Body Screen Container -->
            <div class="droid-screen-body" id="droid-screen-body">
              <!-- Dynamically populated screen -->
            </div>

            <!-- Material 3 Bottom Navigation Bar -->
            <nav class="droid-bottom-nav">
              <button class="droid-nav-item ${this.activeScreen === 'chat' ? 'active' : ''}" data-screen="chat">
                <span class="droid-nav-icon">💬</span>
                <span class="droid-nav-label">Chat</span>
              </button>
              <button class="droid-nav-item ${this.activeScreen === 'workspace' || this.activeScreen === 'editor' ? 'active' : ''}" data-screen="workspace">
                <span class="droid-nav-icon">📁</span>
                <span class="droid-nav-label">Files</span>
              </button>
              <div class="droid-nav-fab-wrap">
                <button class="droid-fab-mic" id="droid-fab-mic" title="Voice Assistant">
                  <span class="droid-mic-icon">🎙️</span>
                </button>
              </div>
              <button class="droid-nav-item ${this.activeScreen === 'diagnostics' ? 'active' : ''}" data-screen="diagnostics">
                <span class="droid-nav-icon">⚡</span>
                <span class="droid-nav-label">System</span>
              </button>
              <button class="droid-nav-item ${this.activeScreen === 'settings' || this.activeScreen === 'connect' ? 'active' : ''}" data-screen="settings">
                <span class="droid-nav-icon">⚙️</span>
                <span class="droid-nav-label">Settings</span>
              </button>
            </nav>

            <!-- Android Gesture Navigation Bar Pill -->
            <div class="droid-nav-pill-bar">
              <div class="droid-nav-pill"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.attachHeaderListeners();
    this.renderCurrentScreen();
  }

  attachHeaderListeners() {
    const btnFramed = this.container.querySelector('#btn-mode-framed');
    const btnFullscreen = this.container.querySelector('#btn-mode-fullscreen');
    const btnOffline = this.container.querySelector('#btn-toggle-offline');
    const btnExit = this.container.querySelector('#btn-exit-android');
    const fabMic = this.container.querySelector('#droid-fab-mic');

    if (btnFramed) btnFramed.addEventListener('click', () => { this.viewMode = 'framed'; this.render(); });
    if (btnFullscreen) btnFullscreen.addEventListener('click', () => { this.viewMode = 'fullscreen'; this.render(); });
    if (btnOffline) btnOffline.addEventListener('click', () => {
      this.isOffline = !this.isOffline;
      this.render();
    });
    if (btnExit) btnExit.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('minio-exit-android-preview'));
    });

    if (fabMic) {
      fabMic.addEventListener('click', () => this.toggleVoiceMic());
    }

    const navItems = this.container.querySelectorAll('.droid-nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        const target = item.getAttribute('data-screen');
        if (target) {
          this.switchScreen(target);
        }
      });
    });
  }

  switchScreen(screenName) {
    this.activeScreen = screenName;
    const navItems = this.container.querySelectorAll('.droid-nav-item');
    navItems.forEach(item => {
      const match = (screenName === 'editor' && item.getAttribute('data-screen') === 'workspace') ||
                    (screenName === 'connect' && item.getAttribute('data-screen') === 'settings') ||
                    item.getAttribute('data-screen') === screenName;
      item.classList.toggle('active', match);
    });
    this.renderCurrentScreen();
  }

  renderCurrentScreen() {
    const screenBody = this.container.querySelector('#droid-screen-body');
    if (!screenBody) return;

    if (this.activeScreen === 'chat') {
      this.renderChatScreen(screenBody);
    } else if (this.activeScreen === 'workspace') {
      this.renderWorkspaceScreen(screenBody);
    } else if (this.activeScreen === 'editor') {
      this.renderEditorScreen(screenBody);
    } else if (this.activeScreen === 'diagnostics') {
      this.renderDiagnosticsScreen(screenBody);
    } else if (this.activeScreen === 'settings') {
      this.renderSettingsScreen(screenBody);
    } else if (this.activeScreen === 'connect') {
      this.renderConnectScreen(screenBody);
    }
  }

  // ===================== CHAT SCREEN =====================
  renderChatScreen(container) {
    const modelOptions = this.models.map(m => {
      const name = typeof m === 'string' ? m : (m.name || m.id);
      return `<option value="${name}" ${name === this.selectedModel ? 'selected' : ''}>${name}</option>`;
    }).join('');

    container.innerHTML = `
      <div class="droid-screen droid-screen-chat">
        <!-- Top App Bar -->
        <header class="droid-top-bar">
          <div class="droid-top-left">
            <span class="droid-status-dot ${this.isOffline ? 'offline' : 'online'}"></span>
            <div class="droid-title-wrap">
              <h2 class="droid-screen-title">Mini-O AI</h2>
              <span class="droid-screen-subtitle">${this.isStreaming ? 'Generating response…' : 'Connected to Workspace'}</span>
            </div>
          </div>
          <div class="droid-top-actions">
            <select class="droid-model-chip" id="droid-model-select" aria-label="Select AI Model">
              ${modelOptions || '<option value="gemini-2.5-flash">gemini-2.5-flash</option>'}
            </select>
            <button class="droid-icon-btn" id="droid-btn-new-chat" title="New Conversation">➕</button>
            <button class="droid-icon-btn" id="droid-btn-clear-chat" title="Clear Chat">🗑️</button>
          </div>
        </header>

        <!-- Tool execution banner if active -->
        <div class="droid-tool-banner ${this.currentToolCall ? '' : 'hidden'}" id="droid-tool-banner">
          <span class="droid-spin">⚙️</span> Running tool: <strong id="droid-tool-name">${this.currentToolCall || ''}</strong>
        </div>

        <!-- Messages Stream -->
        <div class="droid-messages-list" id="droid-messages-list">
          ${this.renderMessagesHtml()}
        </div>

        <!-- Voice Waves Active Bar -->
        <div class="droid-voice-wave-bar ${this.isVoiceListening || this.isVoiceSpeaking ? '' : 'hidden'}" id="droid-voice-bar">
          <div class="droid-wave-anim">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
          <span class="droid-voice-status-text">
            ${this.isVoiceListening ? 'Listening… speak now' : 'Voice Assistant speaking…'}
          </span>
        </div>

        <!-- Input Bottom Composer -->
        <div class="droid-chat-composer">
          <textarea class="droid-input" id="droid-chat-input" placeholder="Message Mini-O AI…" rows="1"></textarea>
          <div class="droid-composer-actions">
            ${this.isStreaming ? `
              <button class="droid-btn-stop" id="droid-btn-stop">■ Stop</button>
            ` : `
              <button class="droid-btn-send" id="droid-btn-send" title="Send Message">➤</button>
            `}
          </div>
        </div>
      </div>
    `;

    const modelSelect = container.querySelector('#droid-model-select');
    if (modelSelect) {
      modelSelect.addEventListener('change', (e) => {
        this.selectedModel = e.target.value;
      });
    }

    const btnNew = container.querySelector('#droid-btn-new-chat');
    if (btnNew) {
      btnNew.addEventListener('click', () => {
        this.messages = [{
          id: 'msg_' + Date.now(),
          role: 'assistant',
          content: 'Started new conversation thread. How can I help you today?',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          model: this.selectedModel,
        }];
        this.renderCurrentScreen();
      });
    }

    const btnClear = container.querySelector('#droid-btn-clear-chat');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        this.messages = [];
        this.renderCurrentScreen();
      });
    }

    const input = container.querySelector('#droid-chat-input');
    const btnSend = container.querySelector('#droid-btn-send');
    const btnStop = container.querySelector('#droid-btn-stop');

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendChatMessage(input.value.trim());
        }
      });
    }
    if (btnSend) {
      btnSend.addEventListener('click', () => {
        if (input) this.sendChatMessage(input.value.trim());
      });
    }
    if (btnStop) {
      btnStop.addEventListener('click', () => {
        if (this.abortController) {
          this.abortController.abort();
          this.isStreaming = false;
          this.renderCurrentScreen();
        }
      });
    }

    this.attachMessageActionListeners(container);
    this.scrollToBottom();
  }

  renderMessagesHtml() {
    if (!this.messages || this.messages.length === 0) {
      return `
        <div class="droid-empty-chat">
          <div class="droid-empty-icon">💬</div>
          <h3>No messages yet</h3>
          <p>Send a prompt or ask Mini-O to explore your workspace code.</p>
        </div>
      `;
    }

    return this.messages.map(m => {
      const isUser = m.role === 'user';
      return `
        <div class="droid-msg-row ${isUser ? 'user' : 'assistant'}" id="${m.id}">
          <div class="droid-msg-bubble">
            <div class="droid-msg-header">
              <span class="droid-msg-sender">${isUser ? 'You' : 'Mini-O'}</span>
              <span class="droid-msg-time">${m.timestamp || ''}</span>
            </div>
            <div class="droid-msg-content">${this.escapeAndFormatMarkdown(m.content)}</div>
            ${!isUser && m.tokensPerSec ? `
              <div class="droid-msg-footer">
                <span class="droid-tps-badge">⚡ ${m.tokensPerSec} t/s</span>
                <span class="droid-model-tag">${m.model || this.selectedModel}</span>
                <div class="droid-msg-tools">
                  <button class="droid-msg-tool-btn droid-btn-copy" data-msg-id="${m.id}" title="Copy">📋</button>
                  <button class="droid-msg-tool-btn droid-btn-speak" data-msg-id="${m.id}" title="Read aloud">🔊</button>
                  <button class="droid-msg-tool-btn droid-btn-retry" data-msg-id="${m.id}" title="Regenerate">🔄</button>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  attachMessageActionListeners(container) {
    container.querySelectorAll('.droid-btn-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const msgId = btn.getAttribute('data-msg-id');
        const msg = this.messages.find(m => m.id === msgId);
        if (msg) {
          navigator.clipboard.writeText(msg.content);
          btn.textContent = '✓';
          setTimeout(() => { btn.textContent = '📋'; }, 1500);
        }
      });
    });

    container.querySelectorAll('.droid-btn-speak').forEach(btn => {
      btn.addEventListener('click', () => {
        const msgId = btn.getAttribute('data-msg-id');
        const msg = this.messages.find(m => m.id === msgId);
        if (msg) {
          this.speakText(msg.content);
        }
      });
    });

    container.querySelectorAll('.droid-btn-retry').forEach(btn => {
      btn.addEventListener('click', () => {
        const lastUser = [...this.messages].reverse().find(m => m.role === 'user');
        if (lastUser) {
          this.sendChatMessage(lastUser.content);
        }
      });
    });
  }

  escapeAndFormatMarkdown(text) {
    if (!text) return '';
    let esc = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // Format Code blocks
    esc = esc.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="droid-code-block"><code>${code}</code></pre>`;
    });

    // Format Inline code
    esc = esc.replace(/`([^`]+)`/g, '<code class="droid-inline-code">$1</code>');

    // Format bold
    esc = esc.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Format newlines
    esc = esc.replace(/\n/g, '<br/>');
    return esc;
  }

  async sendChatMessage(content) {
    if (!content || this.isStreaming) return;

    const userMsg = {
      id: 'msg_' + Date.now(),
      role: 'user',
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    this.messages.push(userMsg);

    const assistantMsg = {
      id: 'msg_' + (Date.now() + 1),
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      model: this.selectedModel,
      tokensPerSec: 0,
    };
    this.messages.push(assistantMsg);

    this.isStreaming = true;
    this.abortController = new AbortController();
    this.renderCurrentScreen();

    const startTime = performance.now();
    let tokenCount = 0;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.selectedModel,
          messages: this.messages.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
          stream: true,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6).trim();
              if (dataStr === '[DONE]') continue;
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.content) {
                  assistantMsg.content += parsed.content;
                  tokenCount += parsed.content.split(/\s+/).length || 1;
                  const elapsedSec = (performance.now() - startTime) / 1000;
                  if (elapsedSec > 0) {
                    assistantMsg.tokensPerSec = Math.round((tokenCount / elapsedSec) * 10) / 10;
                  }
                  this.updateLiveMessageContent(assistantMsg);
                }
              } catch (e) {
                // Ignore parse errors on chunks
              }
            }
          }
        }
      } else {
        const json = await response.json();
        assistantMsg.content = json.response || json.content || 'Response received.';
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        assistantMsg.content += `\n\n[Error: ${err.message}]`;
      }
    } finally {
      this.isStreaming = false;
      this.renderCurrentScreen();
    }
  }

  updateLiveMessageContent(msg) {
    const el = document.getElementById(msg.id);
    if (el) {
      const contentEl = el.querySelector('.droid-msg-content');
      if (contentEl) {
        contentEl.innerHTML = this.escapeAndFormatMarkdown(msg.content);
      }
    }
    this.scrollToBottom();
  }

  scrollToBottom() {
    const list = this.container?.querySelector('#droid-messages-list');
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }

  // ===================== WORKSPACE FILES SCREEN =====================
  renderWorkspaceScreen(container) {
    container.innerHTML = `
      <div class="droid-screen droid-screen-workspace">
        <header class="droid-top-bar">
          <div class="droid-top-left">
            ${this.currentDirectory ? `
              <button class="droid-icon-btn" id="droid-btn-files-back" title="Go up a directory">⬅</button>
            ` : ''}
            <div class="droid-title-wrap">
              <h2 class="droid-screen-title">Workspace Files</h2>
              <span class="droid-screen-subtitle">${this.currentDirectory ? '/' + this.currentDirectory : 'Root directory'}</span>
            </div>
          </div>
          <div class="droid-top-actions">
            <button class="droid-icon-btn" id="droid-btn-refresh-files" title="Refresh files">🔄</button>
            <button class="droid-icon-btn" id="droid-btn-create-file" title="Create New File">➕</button>
          </div>
        </header>

        <div class="droid-search-bar">
          <span class="droid-search-icon">🔍</span>
          <input type="text" class="droid-search-input" id="droid-file-search" placeholder="Search workspace files…" value="${this.searchQuery}" />
          ${this.searchQuery ? `<button class="droid-search-clear" id="droid-clear-search">✕</button>` : ''}
        </div>

        <div class="droid-file-list" id="droid-file-list">
          ${this.isLoadingFiles ? '<div class="droid-loading-spinner"><span></span> Loading workspace…</div>' : ''}
        </div>
      </div>
    `;

    const backBtn = container.querySelector('#droid-btn-files-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        const parts = this.currentDirectory.split('/').filter(Boolean);
        parts.pop();
        this.loadFiles(parts.join('/'));
      });
    }

    const refreshBtn = container.querySelector('#droid-btn-refresh-files');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.loadFiles(this.currentDirectory));
    }

    const createBtn = container.querySelector('#droid-btn-create-file');
    if (createBtn) {
      createBtn.addEventListener('click', () => this.promptCreateFile());
    }

    const searchInput = container.querySelector('#droid-file-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        this.renderWorkspaceFileList();
      });
    }

    const clearSearch = container.querySelector('#droid-clear-search');
    if (clearSearch) {
      clearSearch.addEventListener('click', () => {
        this.searchQuery = '';
        this.renderCurrentScreen();
      });
    }

    this.renderWorkspaceFileList();
  }

  renderWorkspaceFileList() {
    const listEl = this.container?.querySelector('#droid-file-list');
    if (!listEl) return;

    if (this.isLoadingFiles) {
      listEl.innerHTML = `<div class="droid-loading-spinner"><span></span> Scanning directory…</div>`;
      return;
    }

    let displayFiles = this.files;
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      displayFiles = this.files.filter(f => (f.name || f).toLowerCase().includes(q));
    }

    if (!displayFiles || displayFiles.length === 0) {
      listEl.innerHTML = `
        <div class="droid-empty-files">
          <div class="droid-empty-icon">📁</div>
          <p>No files found in this directory</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = displayFiles.map(f => {
      const name = typeof f === 'string' ? f : f.name;
      const isDir = typeof f === 'object' && (f.isDirectory || f.type === 'directory');
      const sizeStr = f.size ? `${Math.round(f.size / 1024)} KB` : '';
      const icon = isDir ? '📁' : this.getFileTypeIcon(name);

      return `
        <div class="droid-file-item" data-name="${name}" data-is-dir="${isDir}">
          <div class="droid-file-main">
            <span class="droid-file-icon">${icon}</span>
            <div class="droid-file-info">
              <span class="droid-file-name">${name}</span>
              <span class="droid-file-meta">${isDir ? 'Folder' : (sizeStr || 'File')}</span>
            </div>
          </div>
          <div class="droid-file-actions">
            ${!isDir ? `<button class="droid-icon-btn-sm droid-btn-edit-file" data-name="${name}" title="Edit File">✏️</button>` : ''}
            <button class="droid-icon-btn-sm droid-btn-rename-file" data-name="${name}" title="Rename">🏷️</button>
            <button class="droid-icon-btn-sm droid-btn-delete-file" data-name="${name}" title="Delete">🗑️</button>
          </div>
        </div>
      `;
    }).join('');

    // Attach row click and buttons
    listEl.querySelectorAll('.droid-file-item').forEach(item => {
      const name = item.getAttribute('data-name');
      const isDir = item.getAttribute('data-is-dir') === 'true';

      item.querySelector('.droid-file-main')?.addEventListener('click', () => {
        if (isDir) {
          const nextDir = this.currentDirectory ? `${this.currentDirectory}/${name}` : name;
          this.loadFiles(nextDir);
        } else {
          this.openEditorForFile(name);
        }
      });
    });

    listEl.querySelectorAll('.droid-btn-edit-file').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openEditorForFile(btn.getAttribute('data-name'));
      });
    });

    listEl.querySelectorAll('.droid-btn-rename-file').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.promptRenameFile(btn.getAttribute('data-name'));
      });
    });

    listEl.querySelectorAll('.droid-btn-delete-file').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.promptDeleteFile(btn.getAttribute('data-name'));
      });
    });
  }

  getFileTypeIcon(filename) {
    if (filename.endsWith('.kt') || filename.endsWith('.java')) return '☕';
    if (filename.endsWith('.ts') || filename.endsWith('.js')) return '📜';
    if (filename.endsWith('.json')) return '🔧';
    if (filename.endsWith('.md')) return '📝';
    if (filename.endsWith('.png') || filename.endsWith('.svg') || filename.endsWith('.jpg')) return '🖼️';
    return '📄';
  }

  async openEditorForFile(filename) {
    const fullPath = this.currentDirectory ? `${this.currentDirectory}/${filename}` : filename;
    this.currentEditorFile = fullPath;
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(fullPath)}`);
      if (res.ok) {
        const text = await res.text();
        this.editorContent = text;
        this.originalEditorContent = text;
        this.isEditorDirty = false;
      } else {
        this.editorContent = '';
        this.originalEditorContent = '';
      }
    } catch (e) {
      this.editorContent = `// Unable to load ${fullPath}`;
    }
    this.switchScreen('editor');
  }

  // ===================== FILE EDITOR SCREEN =====================
  renderEditorScreen(container) {
    container.innerHTML = `
      <div class="droid-screen droid-screen-editor">
        <header class="droid-top-bar">
          <div class="droid-top-left">
            <button class="droid-icon-btn" id="droid-editor-back" title="Back to files">⬅</button>
            <div class="droid-title-wrap">
              <h2 class="droid-screen-title">${this.currentEditorFile ? this.currentEditorFile.split('/').pop() : 'Editor'}</h2>
              <span class="droid-screen-subtitle ${this.isEditorDirty ? 'dirty' : 'saved'}">
                ${this.isEditorDirty ? '● Unsaved changes' : 'Saved'}
              </span>
            </div>
          </div>
          <div class="droid-top-actions">
            <button class="droid-btn-secondary-sm" id="droid-editor-revert" ${this.isEditorDirty ? '' : 'disabled'}>Revert</button>
            <button class="droid-btn-primary-sm" id="droid-editor-save">💾 Save</button>
          </div>
        </header>

        <div class="droid-editor-body">
          <textarea class="droid-editor-textarea" id="droid-editor-text" spellcheck="false">${this.escapeHtml(this.editorContent)}</textarea>
        </div>
      </div>
    `;

    const backBtn = container.querySelector('#droid-editor-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (this.isEditorDirty) {
          if (confirm('You have unsaved changes. Discard them?')) {
            this.switchScreen('workspace');
          }
        } else {
          this.switchScreen('workspace');
        }
      });
    }

    const revertBtn = container.querySelector('#droid-editor-revert');
    if (revertBtn) {
      revertBtn.addEventListener('click', () => {
        this.editorContent = this.originalEditorContent;
        this.isEditorDirty = false;
        this.renderCurrentScreen();
      });
    }

    const saveBtn = container.querySelector('#droid-editor-save');
    const textarea = container.querySelector('#droid-editor-text');

    if (textarea) {
      textarea.addEventListener('input', (e) => {
        this.editorContent = e.target.value;
        this.isEditorDirty = this.editorContent !== this.originalEditorContent;
        const sub = container.querySelector('.droid-screen-subtitle');
        if (sub) {
          sub.className = `droid-screen-subtitle ${this.isEditorDirty ? 'dirty' : 'saved'}`;
          sub.textContent = this.isEditorDirty ? '● Unsaved changes' : 'Saved';
        }
        if (revertBtn) revertBtn.disabled = !this.isEditorDirty;
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        if (!this.currentEditorFile) return;
        saveBtn.textContent = 'Saving…';
        try {
          const res = await fetch('/api/file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              path: this.currentEditorFile,
              content: this.editorContent,
            }),
          });
          if (res.ok) {
            this.originalEditorContent = this.editorContent;
            this.isEditorDirty = false;
            saveBtn.textContent = '✓ Saved!';
            setTimeout(() => { saveBtn.textContent = '💾 Save'; }, 1500);
            this.renderCurrentScreen();
          } else {
            alert('Failed to save file.');
            saveBtn.textContent = '💾 Save';
          }
        } catch (e) {
          alert('Network error saving file: ' + e.message);
          saveBtn.textContent = '💾 Save';
        }
      });
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ===================== DIAGNOSTICS SCREEN =====================
  renderDiagnosticsScreen(container) {
    container.innerHTML = `
      <div class="droid-screen droid-screen-diagnostics">
        <header class="droid-top-bar">
          <div class="droid-top-left">
            <h2 class="droid-screen-title">System Diagnostics</h2>
          </div>
          <div class="droid-top-actions">
            <button class="droid-icon-btn" id="droid-btn-refresh-diag" title="Refresh Diagnostics">🔄</button>
          </div>
        </header>

        <div class="droid-diag-scroll" id="droid-diag-content">
          ${this.renderDiagnosticsContentHtml()}
        </div>
      </div>
    `;

    const refBtn = container.querySelector('#droid-btn-refresh-diag');
    if (refBtn) {
      refBtn.addEventListener('click', () => {
        this.loadDiagnostics();
      });
    }
  }

  renderDiagnosticsContentHtml() {
    const d = this.diagnosticsData || {
      status: 'healthy',
      version: '0.1.0',
      uptime: '1h 22m',
      platform: 'Linux x86_64 / Cloud Container',
      nodeVersion: 'v22.10.0',
      workspacePath: '/opt/mini-o/workspace',
      modelCount: 8,
      activeConnections: 1,
      errorCount: 0,
    };

    return `
      <!-- Server Runtime Card -->
      <div class="droid-card">
        <div class="droid-card-header">
          <span class="droid-card-icon">⚡</span>
          <h3>Server Runtime</h3>
          <span class="droid-badge-green">${d.status.toUpperCase()}</span>
        </div>
        <div class="droid-card-grid">
          <div class="droid-stat-box">
            <span class="droid-stat-label">Version</span>
            <span class="droid-stat-val">${d.version}</span>
          </div>
          <div class="droid-stat-box">
            <span class="droid-stat-label">Uptime</span>
            <span class="droid-stat-val">${d.uptime}</span>
          </div>
        </div>
      </div>

      <!-- Environment & Platform Card -->
      <div class="droid-card">
        <div class="droid-card-header">
          <span class="droid-card-icon">🖥️</span>
          <h3>Environment & Platform</h3>
        </div>
        <div class="droid-card-rows">
          <div class="droid-info-row">
            <span class="droid-info-label">Platform:</span>
            <span class="droid-info-val">${d.platform}</span>
          </div>
          <div class="droid-info-row">
            <span class="droid-info-label">Node Runtime:</span>
            <span class="droid-info-val">${d.nodeVersion}</span>
          </div>
          <div class="droid-info-row">
            <span class="droid-info-label">Workspace:</span>
            <span class="droid-info-val mono">${d.workspacePath}</span>
          </div>
        </div>
      </div>

      <!-- Activity & Connectivity Metrics -->
      <div class="droid-card">
        <div class="droid-card-header">
          <span class="droid-card-icon">📊</span>
          <h3>Live Activity Metrics</h3>
        </div>
        <div class="droid-card-grid">
          <div class="droid-stat-box">
            <span class="droid-stat-label">Available Models</span>
            <span class="droid-stat-val">${d.modelCount}</span>
          </div>
          <div class="droid-stat-box">
            <span class="droid-stat-label">Active Clients</span>
            <span class="droid-stat-val">${d.activeConnections}</span>
          </div>
          <div class="droid-stat-box">
            <span class="droid-stat-label">Error Logs</span>
            <span class="droid-stat-val ${d.errorCount > 0 ? 'warn' : 'good'}">${d.errorCount}</span>
          </div>
        </div>
      </div>
    `;
  }

  // ===================== SETTINGS & PROFILES SCREEN =====================
  renderSettingsScreen(container) {
    container.innerHTML = `
      <div class="droid-screen droid-screen-settings">
        <header class="droid-top-bar">
          <div class="droid-top-left">
            <h2 class="droid-screen-title">Companion Settings</h2>
          </div>
          <div class="droid-top-actions">
            <button class="droid-btn-secondary-sm" id="droid-btn-switch-server">Switch Server</button>
          </div>
        </header>

        <div class="droid-settings-scroll">
          <!-- Active Server Connection -->
          <div class="droid-card">
            <div class="droid-card-header">
              <span class="droid-card-icon">🌐</span>
              <h3>Active Server</h3>
            </div>
            <div class="droid-card-rows">
              <div class="droid-info-row">
                <span class="droid-info-label">Profile:</span>
                <span class="droid-info-val font-bold">${this.profileName}</span>
              </div>
              <div class="droid-info-row">
                <span class="droid-info-label">Endpoint:</span>
                <span class="droid-info-val mono">${this.serverUrl}</span>
              </div>
              <div class="droid-info-row">
                <span class="droid-info-label">Token:</span>
                <span class="droid-info-val mono">
                  ${this.isTokenRevealed ? (this.token || '(None / Open Access)') : '••••••••••••••••'}
                </span>
                <button class="droid-icon-btn-sm" id="droid-btn-biometric" title="Biometric authentication reveal">
                  ${this.isTokenRevealed ? '🔒' : '👁️'}
                </button>
              </div>
            </div>
            <div class="droid-card-actions">
              <button class="droid-btn-secondary" id="droid-btn-ping">📡 Test Ping Latency</button>
            </div>
          </div>

          <!-- Saved Profiles -->
          <div class="droid-card">
            <div class="droid-card-header">
              <span class="droid-card-icon">💾</span>
              <h3>Saved Profiles</h3>
            </div>
            <div class="droid-profile-list">
              ${this.savedProfiles.map((p, idx) => `
                <div class="droid-profile-item ${p.name === this.profileName ? 'active' : ''}">
                  <div class="droid-profile-details">
                    <strong>${p.name}</strong>
                    <span class="mono text-muted">${p.url}</span>
                  </div>
                  ${p.name !== this.profileName ? `
                    <button class="droid-btn-sm droid-btn-use-profile" data-idx="${idx}">Use</button>
                  ` : `<span class="droid-badge-active">ACTIVE</span>`}
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Preferences -->
          <div class="droid-card">
            <div class="droid-card-header">
              <span class="droid-card-icon">🎨</span>
              <h3>Preferences</h3>
            </div>
            <div class="droid-form-row">
              <label>Theme</label>
              <select class="droid-select" id="droid-pref-theme">
                <option value="dark" ${this.theme === 'dark' ? 'selected' : ''}>Dark Jetpack Theme</option>
                <option value="light" ${this.theme === 'light' ? 'selected' : ''}>Light Theme</option>
              </select>
            </div>
          </div>

          <!-- Data & Security -->
          <div class="droid-card danger-zone">
            <div class="droid-card-header">
              <span class="droid-card-icon">🛡️</span>
              <h3>Data & Storage</h3>
            </div>
            <p class="droid-help-text">Clear all cached threads and reset encrypted profiles on this Android device.</p>
            <button class="droid-btn-danger" id="droid-btn-wipe">🗑️ Wipe Local Companion Data</button>
          </div>
        </div>
      </div>
    `;

    const switchBtn = container.querySelector('#droid-btn-switch-server');
    if (switchBtn) {
      switchBtn.addEventListener('click', () => this.switchScreen('connect'));
    }

    const bioBtn = container.querySelector('#droid-btn-biometric');
    if (bioBtn) {
      bioBtn.addEventListener('click', () => this.triggerBiometricAuth());
    }

    const pingBtn = container.querySelector('#droid-btn-ping');
    if (pingBtn) {
      pingBtn.addEventListener('click', async () => {
        pingBtn.textContent = 'Pinging…';
        const start = performance.now();
        try {
          const res = await fetch('/api/health');
          const elapsed = Math.round(performance.now() - start);
          if (res.ok) {
            pingBtn.textContent = `✓ ${elapsed} ms (Healthy)`;
          } else {
            pingBtn.textContent = `❌ HTTP ${res.status}`;
          }
        } catch (e) {
          pingBtn.textContent = `❌ Failed: ${e.message}`;
        }
        setTimeout(() => { pingBtn.textContent = '📡 Test Ping Latency'; }, 2500);
      });
    }

    container.querySelectorAll('.droid-btn-use-profile').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const p = this.savedProfiles[idx];
        if (p) {
          this.profileName = p.name;
          this.serverUrl = p.url;
          this.token = p.token;
          this.renderCurrentScreen();
        }
      });
    });

    const wipeBtn = container.querySelector('#droid-btn-wipe');
    if (wipeBtn) {
      wipeBtn.addEventListener('click', () => {
        if (confirm('Reset Android companion state and wipe cached messages?')) {
          this.messages = [];
          this.isTokenRevealed = false;
          alert('Companion data cleared.');
          this.switchScreen('chat');
        }
      });
    }
  }

  // ===================== CONNECT SCREEN =====================
  renderConnectScreen(container) {
    container.innerHTML = `
      <div class="droid-screen droid-screen-connect">
        <header class="droid-top-bar">
          <div class="droid-top-left">
            <button class="droid-icon-btn" id="droid-connect-back">⬅</button>
            <h2 class="droid-screen-title">Connect to Server</h2>
          </div>
        </header>

        <div class="droid-connect-body">
          <div class="droid-connect-hero">
            <div class="droid-connect-icon">📡</div>
            <h3>Pair Android Device</h3>
            <p>Connect over Wi-Fi, LAN, or local port to access your Mini-O workspace.</p>
          </div>

          <div class="droid-card">
            <div class="droid-form-group">
              <label>Profile Name</label>
              <input type="text" class="droid-input" id="droid-conn-name" value="${this.profileName}" />
            </div>

            <div class="droid-form-group">
              <label>Server URL</label>
              <input type="text" class="droid-input" id="droid-conn-url" value="${this.serverUrl}" />
            </div>

            <div class="droid-form-group">
              <label>Bearer Token (Optional)</label>
              <input type="password" class="droid-input" id="droid-conn-token" value="${this.token}" placeholder="Leave blank if no auth" />
            </div>

            <div class="droid-presets-row">
              <button class="droid-chip-btn" data-url="http://localhost:3000">Localhost (3000)</button>
              <button class="droid-chip-btn" data-url="http://10.0.2.2:3000">AVD Emulator</button>
              <button class="droid-chip-btn" data-url="http://192.168.1.100:3000">LAN Host</button>
            </div>

            <div class="droid-connect-actions">
              <button class="droid-btn-primary" id="droid-btn-do-connect">Connect & Save</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const backBtn = container.querySelector('#droid-connect-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.switchScreen('settings'));
    }

    container.querySelectorAll('.droid-chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const urlInput = container.querySelector('#droid-conn-url');
        if (urlInput) urlInput.value = btn.getAttribute('data-url');
      });
    });

    const connBtn = container.querySelector('#droid-btn-do-connect');
    if (connBtn) {
      connBtn.addEventListener('click', () => {
        this.profileName = container.querySelector('#droid-conn-name')?.value || 'Workspace';
        this.serverUrl = container.querySelector('#droid-conn-url')?.value || window.location.origin;
        this.token = container.querySelector('#droid-conn-token')?.value || '';
        this.switchScreen('chat');
      });
    }
  }

  // ===================== VOICE MIC & BIOMETRIC HELPERS =====================
  toggleVoiceMic() {
    if (this.isVoiceSpeaking) {
      window.speechSynthesis?.cancel();
      this.isVoiceSpeaking = false;
      this.updateMicButtonUI();
      return;
    }

    if (!this.recognition) {
      alert('Speech recognition is not supported in this browser environment. You can type in the chat box.');
      return;
    }

    if (this.isVoiceListening) {
      this.recognition.stop();
      this.isVoiceListening = false;
    } else {
      try {
        this.recognition.start();
        this.isVoiceListening = true;
      } catch (e) {
        console.warn('Recognition start error', e);
        this.isVoiceListening = false;
      }
    }
    this.updateMicButtonUI();
  }

  updateMicButtonUI() {
    const fab = this.container?.querySelector('#droid-fab-mic');
    if (fab) {
      fab.classList.toggle('listening', this.isVoiceListening);
      fab.classList.toggle('speaking', this.isVoiceSpeaking);
    }
    const waveBar = this.container?.querySelector('#droid-voice-bar');
    if (waveBar) {
      waveBar.classList.toggle('hidden', !this.isVoiceListening && !this.isVoiceSpeaking);
      const text = waveBar.querySelector('.droid-voice-status-text');
      if (text) {
        text.textContent = this.isVoiceListening ? 'Listening… speak now' : 'Voice Assistant speaking…';
      }
    }
  }

  speakText(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const clean = text.replace(/```[\s\S]*?```/g, 'Code block omitted.').slice(0, 300);
    const u = new SpeechSynthesisUtterance(clean);
    this.isVoiceSpeaking = true;
    this.updateMicButtonUI();
    u.onend = () => {
      this.isVoiceSpeaking = false;
      this.updateMicButtonUI();
    };
    u.onerror = () => {
      this.isVoiceSpeaking = false;
      this.updateMicButtonUI();
    };
    window.speechSynthesis.speak(u);
  }

  triggerBiometricAuth() {
    if (this.isTokenRevealed) {
      this.isTokenRevealed = false;
      this.renderCurrentScreen();
      return;
    }

    // Show simulated biometric fingerprint prompt
    const modal = document.createElement('div');
    modal.className = 'droid-bio-modal-overlay';
    modal.innerHTML = `
      <div class="droid-bio-sheet">
        <div class="droid-bio-icon">👆</div>
        <h3>Verify Biometrics</h3>
        <p>Touch the fingerprint sensor to reveal encrypted API credentials.</p>
        <div class="droid-bio-btns">
          <button class="droid-btn-secondary" id="droid-bio-cancel">Cancel</button>
          <button class="droid-btn-primary" id="droid-bio-confirm">Authenticate</button>
        </div>
      </div>
    `;
    this.container.appendChild(modal);

    modal.querySelector('#droid-bio-cancel')?.addEventListener('click', () => modal.remove());
    modal.querySelector('#droid-bio-confirm')?.addEventListener('click', () => {
      modal.remove();
      this.isTokenRevealed = true;
      this.renderCurrentScreen();
    });
  }

  promptCreateFile() {
    const name = prompt('Enter new filename (e.g. notes.md or app.py):');
    if (name) {
      const fullPath = this.currentDirectory ? `${this.currentDirectory}/${name}` : name;
      fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fullPath, content: '' }),
      }).then(() => {
        this.loadFiles(this.currentDirectory);
      });
    }
  }

  promptRenameFile(oldName) {
    const newName = prompt(`Rename "${oldName}" to:`, oldName);
    if (newName && newName !== oldName) {
      const oldPath = this.currentDirectory ? `${this.currentDirectory}/${oldName}` : oldName;
      const newPath = this.currentDirectory ? `${this.currentDirectory}/${newName}` : newName;
      fetch('/api/file/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath }),
      }).then(() => {
        this.loadFiles(this.currentDirectory);
      }).catch(err => alert('Rename failed: ' + err.message));
    }
  }

  promptDeleteFile(filename) {
    if (confirm(`Are you sure you want to delete "${filename}"?`)) {
      const fullPath = this.currentDirectory ? `${this.currentDirectory}/${filename}` : filename;
      fetch(`/api/file?path=${encodeURIComponent(fullPath)}`, {
        method: 'DELETE',
      }).then(() => {
        this.loadFiles(this.currentDirectory);
      }).catch(err => alert('Delete failed: ' + err.message));
    }
  }
}
