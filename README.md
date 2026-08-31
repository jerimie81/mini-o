# Mini-O

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20Web%20%7C%20Android-blueviolet)](FEATURES.md#10-cross-platform-runtime--packaging)
[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB.svg?logo=python&logoColor=white)](https://python.org)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933.svg?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Ollama](https://img.shields.io/badge/Ollama-Native%20Local-black.svg?logo=ollama&logoColor=white)](https://ollama.com)
[![Status](https://img.shields.io/badge/Release-v0.1.0%20Pre--Launch-orange.svg)](CHANGELOG.md)

**Your workspace, your rules — an AI agent that never touches a file without your say-so, and never ignores the ones you've written.**

Mini-O is an open-source, local-first AI workspace and agent execution framework for [Ollama](https://ollama.com/) (with optional cloud model passthrough). Designed for developers, systems engineers, and power users who require absolute control and transparency, Mini-O enforces strict workspace boundaries, requires explicit user confirmation before executing any side-effecting tools, and treats your workspace `AGENT.md` instructions as authoritative orchestration contracts.

---

## 🌟 Why Developers Choose Mini-O

- 📜 **`AGENT.md` is Law, Not a Suggestion**: Declare behavioral guidelines, coding conventions, and architectural constraints in your workspace. Mini-O cascades directives from root to subdirectories, enforcing them as highest-priority system prompts that cannot be silently overridden.
- 🛡️ **Deterministic Sandbox Boundaries**: Filesystem access, command executions, and code evaluations are strictly confined to approved workspace roots. Path traversal, symlink escapes, and private network requests are rejected at the kernel/backend layer.
- 👁️ **Total Tool Execution Visibility**: No hidden operations or silent file changes. Shell commands, script executions, and file edits are surfaced as structured approval prompts with clear side-effect disclosures.
- 🔒 **True Local Privacy**: 100% of your workspace files, conversation histories, and agent interactions stay on your machine. No accounts, telemetry, or mandatory cloud subscriptions.
- 🔑 **Built-in Repository Secrets & API Keys**: Unified menu (<kbd>Alt+M</kbd>) for managing scoped access tokens (GitHub, GitLab, Bitbucket, Custom Git) and AI providers (Gemini, Claude, OpenAI) with live connection testing.
- 📱 **Native Multi-Platform Ecosystem**: Ships with native Windows launchers/services, Debian `.deb` packages with `systemd` daemons, a standalone web IDE, and a read-only Android companion app for mobile inspection.

---

## 📖 Feature Matrix & Deep Dive

> 💡 **Looking for the complete architectural breakdown and feature list?**  
> Explore **[FEATURES.md](FEATURES.md)** for detailed specifications on our Sandbox Engine, Tool Permissioning, Code Editor, MCP Protocols, Voice Synthesis, and Accessibility features.

### Core Capabilities at a Glance

| Area | Highlights | Documentation |
| :--- | :--- | :--- |
| **Agent Orchestration** | Cascading `AGENT.md` directives, Supreme Agent overrides, starter templates | [FEATURES.md#2](FEATURES.md#2-hierarchical-agentmd-directive-engine) |
| **Security & Sandbox** | Whitelisted roots, symlink defense, SSRF/private-network egress filters | [FEATURES.md#3](FEATURES.md#3-workspace-boundary--sandbox-enforcement) |
| **Tool Policies** | Allow / Confirm / Deny modes with Once / Conversation / Session scopes | [FEATURES.md#4](FEATURES.md#4-tool-execution-framework--policy-control) |
| **Secrets Management** | GitHub, GitLab, Bitbucket, Git PATs & AI API keys with live connectivity tests | [FEATURES.md#5](FEATURES.md#5-workspace-menu--repository-secrets-management) |
| **Workspace File IDE** | Real-time file tree, full-text search, multi-level undo/redo, context chips | [FEATURES.md#6](FEATURES.md#6-workspace-file-explorer--code-editor) |
| **Chat & Streaming** | Live SSE streaming, message branching, markdown highlighting, TTS audio | [FEATURES.md#7](FEATURES.md#7-chat-interface--conversation-lifecycle) |
| **Model Operations** | Live Ollama pulls with progress bars, parameter tuning, multi-model support | [FEATURES.md#8](FEATURES.md#8-model-management--generation-tuning) |
| **MCP & IDE Adapters** | JSON-RPC & stdio transports, VS Code extension, JetBrains / Android Studio | [FEATURES.md#9](FEATURES.md#9-model-context-protocol-mcp--ide-adapters) |

---

## 💻 Supported Platforms & Distributions

| Platform | Distribution Format | Quick Launch Command / Entry | Documentation |
| :--- | :--- | :--- | :--- |
| **Windows 10 / 11 / Server** | Portable `.zip` & Inno Setup `.exe` | `start-mini-o.bat` or `.\mini-o.ps1 open` | [WINDOWS.md](WINDOWS.md) |
| **Debian / Ubuntu / WSL2** | Debian `.deb` package | `sudo dpkg -i mini-o_amd64.deb` (`mini-o open`) | [PACKAGING.md](PACKAGING.md) |
| **Web / Standalone Node.js** | Node.js + Python 3.11+ | `npm start` or `./start.sh` | [Quick Start](#quick-start) |
| **Android Companion** | Jetpack Compose APK | Android Studio / `android/` | [Android Guide](#android-companion-client) |

---

## 🚀 Quick Start

### Option A: Windows (Portable or Installer)

1. **Download & Launch**:
   - Download the portable release archive `mini-o-0.1.0-windows-x64.zip` or GUI installer `mini-o-setup-0.1.0.exe`.
   - Extract the archive to your preferred folder (e.g. `C:\Tools\mini-o`).
   - Double-click **`start-mini-o.bat`** or execute in PowerShell:
     ```powershell
     .\mini-o.ps1 open
     ```
2. **CLI Management**:
   ```powershell
   .\mini-o.ps1 status      # Check server health and diagnostics
   .\mini-o.ps1 logs        # Stream real-time operational logs
   .\mini-o.ps1 stop        # Stop background instances
   .\mini-o.ps1 install-service # Register as Windows background service (Admin)
   ```
3. Read the complete Windows guide in **[WINDOWS.md](WINDOWS.md)** for GPU acceleration (NVIDIA CUDA, AMD ROCm, Intel DirectML).

---

### Option B: Linux (Debian / Ubuntu / WSL2)

1. **Install Package**:
   ```bash
   # Install Debian package
   sudo dpkg -i dist/mini-o_0.1.0-1_amd64.deb
   sudo apt-get install -f

   # Launch Mini-O
   mini-o open
   ```
2. **Systemd Service** (Optional):
   ```bash
   sudo systemctl enable --now mini-o
   ```

---

### Option C: Source Installation (Cross-Platform)

#### 1. Prerequisites
- **Python 3.11+**
- **Node.js 18+ & npm**
- **[Ollama](https://ollama.com/)** installed and running (`ollama serve`)

#### 2. Clone & Setup
```bash
# Clone the repository
git clone https://github.com/your-org/mini-o.git
cd mini-o

# Create Python virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\Activate.ps1

# Install dependencies
python -m pip install -r requirements.txt
python -m pip install -r tests/requirements-test.txt

# Configure environment
cp .env.example .env
```

#### 3. Run Mini-O
```bash
# Start Ollama and Mini-O together
./start.sh

# Or start the server manually
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
```
Open your browser to <http://127.0.0.1:8000> (or port `3000` when running the web reverse-proxy).

---

## 🦙 Getting Started with Ollama

Install Ollama from [ollama.com](https://ollama.com), start the daemon, and pull a lightweight coding or chat model:

```bash
# Start the Ollama background daemon
ollama serve

# Pull your preferred model (e.g. Llama 3.1 8B, Qwen 2.5 Coder, Mistral)
ollama pull llama3.1
ollama pull qwen2.5-coder:7b
```

You can also pull, filter, and inspect models directly inside the Mini-O web UI using the top-header model selector!

---

## ⚙️ Configuration & Policy Settings

Configuration variables are managed in `.env` and `mini-o.config.json`:

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama server API endpoint |
| `WORKSPACE_DIR` | `./data` | Primary working directory for file operations |
| `ALLOWED_ROOTS` | Workspace root | Absolute paths permitted for agent file access |
| `CONFIG_FILE` | `./mini-o.config.json` | JSON file for runtime sandbox and tool policies |
| `SUPREME_AGENT_FILE` | Unset | Path to supreme highest-priority `AGENT.md` |
| `REQUIRE_TOOL_CONFIRMATION` | `true` | Enforces explicit human approval for side-effecting tools |
| `DEFAULT_MODEL` | `minimax-m3:cloud` | Initial selected model alias |
| `SHELL_TIMEOUT` | `30` | Execution timeout in seconds for shell / Python tools |
| `OLLAMA_TIMEOUT` | `15` | Ollama connection and streaming timeout |
| `LOG_LEVEL` | `INFO` | Application log verbosity (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |

---

## 🛠️ Built-in Tool Matrix

Mini-O provides safe, sandboxed tools designed specifically for software engineering:

```text
├── 📂 Filesystem:  read_file, write_file, list_files, search_files
├── 💻 Execution:   run_shell, run_python
├── 🌐 Network:     web_fetch (with private-network SSRF defense)
└── 🔬 Research:    research_fetch (provenance-bearing source summaries)
```

Every tool's execution mode (`allow`, `confirm`, or `deny`) and approval scope (`once`, `conversation`, `session`) can be customized on the fly in the **Workspace Menu → Tool Policies** tab.

---

## 🔌 Model Context Protocol (MCP) & IDE Integration

Mini-O implements the open [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) specification, allowing external editors to leverage Mini-O tools and workspace contexts.

- **HTTP JSON-RPC Endpoint**: `POST /api/mcp`
- **stdio Transport**: `python -m backend.mcp_stdio`
- **IDE Extensions** (in `clients/`):
  - **VS Code Extension**: `clients/vscode/`
  - **IntelliJ & Android Studio Plugins**: `clients/jetbrains/`
  - **Dependency-Free CLI**: `clients/cli/mini_o_mcp.py`

---

## 📱 Android Companion Client

Located in [`android/`](android/), the native Jetpack Compose Android client lets you securely connect to your workstation over local Wi-Fi:
- Browse approved workspace directories and inspect code on the go.
- Stored credentials are encrypted via Android Keystore.
- Strictly read-only to ensure zero accidental mobile mutations.

---

## 🧪 Testing & Verification

Mini-O includes a rigorous automated test suite spanning backend unit tests, sandbox security tests, API route verification, and frontend DOM / accessibility tests:

```bash
# Run backend Python test suite
.venv/bin/pytest -q -c tests/pytest.ini

# Run frontend tests
cd tests/frontend && npm test

# Run security and static compliance audits
bash scripts/security-check.sh
node tests/frontend/contrast-check.mjs
```

---

## 🤝 Contributing & Community

We welcome contributions from developers, researchers, and open-source enthusiasts!

- 🐛 **Found a bug or have a suggestion?** Open an [Issue](https://github.com/your-org/mini-o/issues).
- 💡 **Ready to submit code?** Read our **[CONTRIBUTING.md](CONTRIBUTING.md)** guidelines and **[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)** before submitting a Pull Request.
- 🛡️ **Found a security concern?** Please review our **[SECURITY.md](SECURITY.md)** and **[THREAT_MODEL.md](THREAT_MODEL.md)** for responsible disclosure procedures.
- 💬 **Join the Discussion**: Engage with fellow contributors in our community discussions and roadmap reviews.

---

## 📚 Complete Documentation Index

- **[FEATURES.md](FEATURES.md)** — In-depth architectural breakdown & capabilities guide.
- **[WINDOWS.md](WINDOWS.md)** — Windows native setup, services, launchers, and GPU acceleration.
- **[PACKAGING.md](PACKAGING.md)** — Cross-platform distribution packaging and release builds.
- **[PRODUCT_DESIGN.md](PRODUCT_DESIGN.md)** — Product philosophy, interaction design, and UX principles.
- **[SECURITY.md](SECURITY.md)** — Security policies, threat model, and vulnerability reporting.
- **[THREAT_MODEL.md](THREAT_MODEL.md)** — Detailed threat vectors, trust assumptions, and sandbox defenses.
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** — Common setup diagnostics, Ollama connectivity, and log inspection.
- **[CHANGELOG.md](CHANGELOG.md)** — Release history, migration notes, and version roadmap.

---

## 📄 License

Mini-O is released under the open-source [MIT License](LICENSE).
