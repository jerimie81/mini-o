# Mini-O / Redrum AI

Mini-O is a private, cross-platform, local-first AI workspace and companion application for [Ollama](https://ollama.com/) and remote models. It combines a standalone TypeScript/Node.js backend with an accessible web frontend, native **Windows** batch/PowerShell launchers and service daemons, a **Debian/Ubuntu Linux** `.deb` package, and an **Android companion** mobile app.

Current operational documentation is in [WINDOWS.md](WINDOWS.md), [PACKAGING.md](PACKAGING.md), [PROJECT_PROGRESS.md](PROJECT_PROGRESS.md), [THREAT_MODEL.md](THREAT_MODEL.md), [SECURITY.md](SECURITY.md), and [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

> **Status:** Mini-O v0.1.0 Cross-Platform Release (Windows, Linux, Web & Android Companion). Suitable for localhost, local area network (LAN), and dedicated developer environments.

---

## Supported Platforms & Distributions

| Platform | Distribution Format | Quick Launch Command / File | Status |
| :--- | :--- | :--- | :--- |
| **Windows 10 / 11 / Server** | Portable `.zip` & Inno Setup `.exe` | `start-mini-o.bat` or `.\mini-o.ps1 open` | **Full Native Support** |
| **Debian / Ubuntu / WSL2** | Debian `.deb` package | `sudo dpkg -i mini-o_0.1.0-1_amd64.deb` (`mini-o open`) | **Full Native Support** |
| **Web / Node.js Standalone** | `npm start` / Node.js runtime | `npm start` | **Production Ready** |
| **Android Companion** | Native Kotlin / Jetpack Compose APK | Android Studio / `android/` | **Companion (V1 Read-Only)** |

---

## Quick Start on Windows

### 1. Portable Windows Distribution (No Setup Required)
1. Download `mini-o-0.1.0-windows-x64.zip` (available from `/api/download/windows` or release build).
2. Extract the archive anywhere (e.g. `C:\Tools\mini-o` or `C:\Users\<User>\mini-o`).
3. Double-click **`start-mini-o.bat`** or run in PowerShell:
   ```powershell
   .\mini-o.ps1 open
   ```
4. Mini-O will automatically initialize the local server and launch your default web browser to `http://127.0.0.1:3000`.

### 2. Windows Command-Line Interface (`mini-o.cmd` & `mini-o.ps1`)
Mini-O provides dedicated CLI management scripts for Command Prompt (`mini-o.cmd`) and PowerShell (`mini-o.ps1`):

```powershell
# Open browser and launch server if not active
.\mini-o.ps1 open

# Start in background process
.\mini-o.ps1 start

# Check server health and diagnostics
.\mini-o.ps1 status

# Run in active console with live logs
.\mini-o.ps1 run

# Stream server logs in real time
.\mini-o.ps1 logs

# Terminate running background instances
.\mini-o.ps1 stop

# Register Mini-O as an automatic Windows Service (Admin required)
.\mini-o.ps1 install-service
```

Using standard Windows Command Prompt (`cmd.exe`):
```cmd
mini-o.cmd open
mini-o.cmd status
mini-o.cmd stop
mini-o.cmd logs
```

### 3. Background Windows Service & Auto-Start
To configure Mini-O to start automatically with Windows without requiring an open terminal window:
- **Inno Setup Installer (`mini-o-setup-0.1.0.exe`)**: Creates a complete installer that checks for Ollama, automatically downloads and installs Ollama for Windows if missing, guides the user through selecting a default local model (Llama 3.1 8B, Llama 3.2, Qwen 2.5 Coder, Mistral, Phi 3.5, DeepSeek R1), pulls the model, starts the Ollama daemon, and creates Start Menu icons, Desktop shortcuts, and uninstaller support.
- **Windows Service**: Run `PowerShell as Administrator` and execute `.\install-service.ps1`.
- **Silent User Startup**: Place a shortcut to `mini-o.vbs` in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`.
- **Interactive Model Chooser**: Run `mini-o setup-ollama` or `.\mini-o.ps1 setup-ollama` at any time to install Ollama or pull additional models.

### 4. GPU Acceleration on Windows
Mini-O connects to Ollama on Windows with hardware acceleration:
- **NVIDIA GPUs**: CUDA acceleration is automatically used by Ollama.
- **AMD GPUs**: ROCm support for compatible Radeon cards.
- **Intel Arc & Core Ultra**: DirectML / Vulkan support.

Install Ollama on Windows via `winget install Ollama.Ollama` or download from [ollama.com](https://ollama.com).

---

## Quick Start on Debian / Ubuntu Linux

```bash
# 1. Build or download the Debian package
npm run build:deb

# 2. Install package
sudo dpkg -i dist/mini-o_0.1.0-1_amd64.deb
sudo apt-get install -f

# 3. Launch Mini-O
mini-o open

# 4. Optional: Enable systemd background service
sudo systemctl enable --now mini-o
```

---

## Packaging & Build Commands

Mini-O includes cross-platform build scripts for all targets:

```bash
# Build standalone server bundle
npm run build

# Build Debian Linux package (.deb)
npm run build:deb

# Build Windows Portable Zip package (.zip)
npm run build:windows

# Build all cross-platform distributions and master SHA256 checksums
npm run build:all
```

---

## Features

- Stream responses from locally hosted Ollama models.
- Discover installed models and pull new models through the API.
- Filter models, inspect metadata, configure generation options, and delete installed models.
- Save, reopen, and manage conversations locally.
- Search, rename, pin, archive, duplicate, export, and import conversations.
- Browse, read, write, search, and attach workspace files.
- Filter and sort workspace files, inspect metadata, and safely rename, duplicate, or recoverably delete them.
- Create and edit `AGENT.md` files from the **Configure** tab.
- Persist model, theme, and tool preferences in browser `localStorage`.
- Optional tools for file access, shell commands, Python execution, and web fetching.
- Restrict filesystem operations to approved roots.
- Block web requests to loopback, private, link-local, and reserved networks.
- Serve the frontend directly from FastAPI.
- Safe Markdown rendering for headings, lists, blockquotes, tables, links,
  task lists, and fenced code, including unsafe-URL rejection.
- Message lifecycle controls: stop/retry, edit, regenerate, branch, raw view,
  timestamps, code wrapping, and optional line numbers.
- Structured expandable tool-call/result items, live-region announcements,
  keyboard navigation, visible focus, reduced-motion support, onboarding, and
  responsive drawers.
- Conversation management: search, generated/manual titles, pin/archive,
  duplicate/delete actions, pagination, bulk archive safeguards, recoverable
  streaming records, and versioned portable JSON export/import.
- Model operations: metadata, capability details, filtering, favorites,
  streamed pulls with progress, deletion, and validated per-conversation
  generation settings.
- Workspace improvements: discoverable file browsing with breadcrumbs,
  history, filtering, sorting, hidden-file rules, metadata, ordered attachment
  chips, optimistic editor saves, undo/redo, find/replace, go-to-line,
  read-only detection, and recoverable delete operations.
- Agent-instruction support: scoped `AGENT.md` discovery, validation, and
  general/Python/frontend starter templates.
- An optional configured `AGENT.md` is injected as the highest-priority system
  message for every chat.
- An Android companion client is included under [`android/`](android/).
- The Integrations panel exposes the reviewed plugin and IDE/platform adapter catalog. Local plugins are manifest-discovered under `.mini-o/plugins`.
- MCP is the interoperability layer for IDE and platform clients. Mini-O exposes `/api/mcp` JSON-RPC over HTTP plus `python -m backend.mcp_stdio` stdio transport with initialize, capability negotiation, tools/list, policy-gated tools/call, resources/list, resources/read, context submission, and ping. Authentication, signing, sandboxing, and production client hardening remain required.
- Client targets are included under [`clients/`](clients/): a dependency-free CLI, VS Code extension source, and IntelliJ Platform projects for JetBrains and Android Studio. They are testing-release clients, not signed marketplace distributions.
- Server access policy is declared in [`mini-o.config.example.json`](mini-o.config.example.json); copy it to `mini-o.config.json` or edit it from Configure. It controls the workspace directory, approved roots, and each tool's `allow`, `confirm`, or `deny` mode.

This repository documents a local testing release; it does not claim production remote-deployment hardening or marketplace publication.

## Requirements

- Python 3.11 or newer
- Ollama running locally or at a reachable URL
- Node.js and npm for frontend tests

## Installation

```bash
git clone <repository-url>
cd mini-o
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m pip install -r tests/requirements-test.txt
cp .env.example .env
```

Do not commit `.env`, credentials, model files, or local conversation data.

## Start Ollama

Install Ollama, then start it and download a model:

```bash
ollama serve
ollama pull llama3.1
```

The default model can be changed with `DEFAULT_MODEL`.

## Run Mini-O

For the usual local workflow, the project scripts start both Ollama and Mini-O
in the background:

```bash
./start.sh
```

The script uses project-relative paths, writes service output to `logs/`,
records owned process IDs in ignored PID files, and leaves an already-running
Ollama or Mini-O instance untouched. Stop only the processes started by the
script with:

```bash
./stop.sh
```

If you prefer to manage the services separately, start Ollama with
`ollama serve` and run Mini-O directly as shown below.

From the project root:

```bash
.venv/bin/uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000>.

- Web interface: `/`
- Health check: `/api/health`
- REST API: `/api`
- Interactive API documentation: `/docs`

The health endpoint distinguishes Mini-O availability from Ollama availability:
`{"status":"ok","ollama":"online"}` means both are reachable; a degraded
response means Mini-O is running while Ollama is unavailable.

## Android companion

The native Android client in [`android/`](android/) provides a focused mobile
workspace browser: connect to Mini-O, browse approved directories, search file
names, and read files. It stores the server URL and bearer token in Android's
encrypted preferences and does not upload files anywhere.

For a phone on the same Wi-Fi network, configure the host machine deliberately:

```dotenv
MINI_O_HOST=0.0.0.0
REMOTE_AUTH_TOKEN=generate-a-long-random-token
ALLOWED_HOSTS=["192.168.1.20","localhost"]
```

Then run `./start.sh`, find the host's LAN IP (for example `192.168.1.20`),
and enter `http://192.168.1.20:8000` plus the token in the app. Replace the
example address in `ALLOWED_HOSTS` with the host address shown by your network.
Allow TCP 8000
through the host firewall only on the trusted private network. Do not expose
Mini-O directly to the internet; the app can reach the API remotely, but the
server's existing host/origin/authentication checks and narrow
`ALLOWED_ROOTS` remain important.

Open `android/` in Android Studio, let it sync, select an emulator or Android
device, and run the `app` configuration. The project targets Android 8.0+
(API 26) and uses standard Jetpack Compose tooling.

The first Android version is intentionally read-only: it does not expose file
writes, shell/Python tools, model deletion, or unrestricted remote operations.
That keeps the mobile surface safer while the host remains the authority for
filesystem policy.

## Configuration

Settings are read from environment variables and `.env`:

Directory and tool policy are managed in `mini-o.config.json` (ignored by Git)
so the security boundary is visible in one file. The checked-in
`mini-o.config.example.json` is the complete reference configuration. The UI
edits this file atomically and applies it immediately; environment variables
remain useful for deployment-wide settings such as Ollama, hosts, and auth.
Tool policy modes apply to every registered tool, including read-only tools;
`deny` always blocks execution, `confirm` requires approval for side-effecting
tools, and `allow` permits the tool within the server's other boundaries.

| Variable | Default | Description |
| --- | --- | --- |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama server URL |
| `WORKSPACE_DIR` | `./data` | Primary local workspace |
| `ALLOWED_ROOTS` | workspace root | Filesystem roots permitted to Mini-O |
| `CONFIG_FILE` | `./mini-o.config.json` | JSON file for workspace roots and per-tool permissions |
| `SUPREME_AGENT_FILE` | unset | Optional highest-priority `AGENT.md` path |
| `MAX_FILE_SIZE` | `5242880` | Maximum file size in bytes |
| `SHELL_TIMEOUT` | `30` | Shell/Python timeout in seconds |
| `OLLAMA_TIMEOUT` | `15` | Total Ollama request timeout in seconds; connection attempts are capped at 2 seconds |
| `REQUIRE_TOOL_CONFIRMATION` | `true` | Block confirmation-required tools unless approved |
| `DEFAULT_MODEL` | `minimax-m3:cloud` | Initial model selection |
| `CORS_ORIGINS` | local origins | Allowed browser origins |
| `MAX_REQUEST_BODY` | `10485760` | Maximum accepted request body in bytes |
| `MAX_STREAM_SECONDS` | `600` | Maximum intended stream lifetime in seconds |
| `REMOTE_AUTH_TOKEN` | unset | Optional bearer token for intentional remote operation |
| `LOG_LEVEL` | `INFO` | Application log level |
| `METRICS_ENABLED` | `true` | Enable local operational metrics |

Relative paths are resolved from `WORKSPACE_DIR`. Path traversal and symlink escapes outside approved roots are rejected.

List-valued settings use JSON when provided through the environment, for example:

```bash
export ALLOWED_ROOTS='["/home/me/project","/home/me/notes"]'
export CORS_ORIGINS='["http://127.0.0.1:8000"]'
```

Restart Mini-O after changing `.env`. `WORKSPACE_DIR` is the default root for
relative file paths; `ALLOWED_ROOTS` adds the absolute directories permitted by
Mini-O's file/workspace path operations. For example:

```dotenv
WORKSPACE_DIR=/home/me/project
ALLOWED_ROOTS=["/home/me/project","/home/me/notes"]
```

File/workspace paths outside those resolved directories are rejected. Shell
and Python tools run with `WORKSPACE_DIR` as their working directory and are
more powerful, so keep `REQUIRE_TOOL_CONFIRMATION=true`, especially when
adding directories containing sensitive files.

Shell and Python tool output is retained in full. Long output remains part of
the normal page scrollback instead of being truncated to the previous 8,000
character tail.

## Configure `AGENT.md` files

The **Configure** tab provides a local editor for agent instructions:

1. Open **Configure** in the right panel.
2. Select an existing `AGENT.md`, or choose **New AGENT.md**.
3. Use `AGENT.md` for the workspace root or a relative path such as `project/AGENT.md`.
4. Edit the instructions and choose **Save**.

Only files named exactly `AGENT.md` can be created or edited, and all paths remain inside the configured workspace/allowed roots.

### Highest-priority configuration

Declare an `AGENT.md` path in `.env`:

```dotenv
SUPREME_AGENT_FILE=/home/me/project/AGENT.md
```

Relative paths are resolved from the Mini-O project root. When present, the
file is added by the backend as the first system message on every chat request.
It is ignored when unset, missing, unreadable, not named exactly `AGENT.md`, or
larger than `MAX_FILE_SIZE`. Keep it local and do not put secrets in it.

## Local storage and conversations

Mini-O uses three local storage layers:

- Browser `localStorage` stores the selected model, theme, tool preference, and confirmation preference for the current browser profile.
- The backend stores conversation JSON files locally under `<workspace-parent>/store` (the default is `<project>/store`). Writes are atomic.
- Workspace files and `AGENT.md` files remain ordinary files under `WORKSPACE_DIR`.

No cloud account or hosted persistence service is required.

Ollama receives prompts and attached file text when a chat is sent. The
`web_fetch` tool is the intentional outbound network boundary; loopback,
private, link-local, and reserved network targets are rejected by backend
checks.

## Tools

Available tools include:

| Tool | Capability | Confirmation |
| --- | --- | --- |
| `read_file` | Read a workspace file | No |
| `write_file` | Overwrite a workspace file | Yes |
| `list_files` | List workspace files | No |
| `search_files` | Find files by name | No |
| `run_python` | Execute Python code | Yes |
| `run_shell` | Execute a shell command | Yes |
| `web_fetch` | Fetch public HTTP(S) content | Yes |

The Configure tab includes an explicit toggle for confirmation-required tools. Leave it disabled unless the model and requested operation are trusted.

## API overview

| Endpoint | Purpose |
| --- | --- |
| `GET /api/models` | List Ollama models |
| `GET /api/models?q=...` | Search/filter installed models and return metadata |
| `GET /api/models/{name}` | Read model metadata and supported capabilities |
| `POST /api/models/{name}/pull` | Pull a model with streamed progress |
| `DELETE /api/models/{name}` | Delete an installed model through Ollama |
| `POST /api/chat/stream` | Stream chat and tool events |
| `GET /api/health` | Report Mini-O and Ollama availability |
| `GET /api/conversations` | List saved conversations |
| `GET /api/conversations?offset=0&limit=50` | Paginated conversation listing |
| `GET /api/conversations/recovery` | List records interrupted during streaming |
| `GET /api/conversations/{id}` | Read a conversation |
| `PATCH /api/conversations/{id}` | Rename, pin, archive, or update options |
| `POST /api/conversations/bulk` | Bulk archive or delete selected records |
| `POST /api/conversations/{id}/duplicate` | Duplicate a conversation |
| `GET /api/conversations/export` | Export conversations as versioned portable JSON |
| `POST /api/conversations/import` | Import version-1 portable conversation JSON |
| `DELETE /api/conversations/{id}` | Delete a conversation |
| `GET /api/files` | List workspace files with filtering and sorting |
| `GET /api/files/metadata` | Return file size, modification, encoding, line-ending, and language metadata |
| `GET /api/files/content` | Read a workspace file |
| `POST /api/files/content` | Write a workspace file with optional modification conflict checking |
| `POST /api/files/operation` | Safely rename, duplicate, or move a file to the local recovery area |
| `GET /api/files/search` | Search workspace files |
| `GET /api/agents` | List `AGENT.md` files |
| `GET /api/agents/templates` | List starter instruction templates |
| `POST /api/agents/validate` | Validate instruction content before saving |
| `GET /api/agents/content` | Read an `AGENT.md` |
| `POST /api/agents/content` | Create or update an `AGENT.md` |
| `GET /api/tools` | List registered tools |
| `GET /api/tools/policies` | List per-tool approval policies |
| `PATCH /api/tools/policies/{name}` | Change one tool’s allow/confirm/deny policy and scope |
| `GET /api/tools/activity` | View redacted local tool activity |
| `GET /api/workspace/search` | Search workspace names/content with previews |
| `POST /api/research/fetch` | Fetch a bounded, provenance-bearing research source |
| `POST /api/research/export` | Export research notes and source metadata to the workspace |
| `GET /api/capabilities` | Discover provider capabilities |
| `GET /api/fixtures` | Return versioned SSE and portable-data client fixtures |
| `GET /api/diagnostics` | Return safe local diagnostics without message content |
| `GET /api/diagnostics/export` | Download redacted diagnostics JSON |
| `GET /api/support-bundle` | Download a local redacted support bundle |
| `GET /api/metrics` | Return local request/tool counters |
| `POST /api/feedback` | Save user-written feedback locally without sending it remotely |
| `GET /api/workspace/config` | Read active workspace and server-side tool policy |
| `PUT /api/workspace/config` | Atomically update workspace roots and tool policy |
| `GET /api/plugins` | List valid local plugin manifests |
| `GET /api/integrations` | List available and planned IDE/platform adapters |
| `GET /api/mcp/manifest` | Read MCP protocol, capability, transport, and security metadata |
| `POST /api/mcp` | JSON-RPC MCP transport over HTTP |
| `POST /api/mcp/context` | Validate a Mini-O context envelope |

## Testing

### User diagnostic probe

When Mini-O repeatedly reports that Ollama is offline, start Ollama and Mini-O
as usual, then run this safe probe from the project root:

```bash
bash scripts/user-test.sh
```

Paste the complete output back for debugging. It checks Ollama, Mini-O, health,
and model-list reachability without printing `.env`, credentials, prompts,
conversation data, or workspace contents. To test non-default endpoints, set
`OLLAMA_HOST` or `MINI_O_URL` for that command.

Use the project virtual environment rather than relying on global Python tools.

Run the Python suite:

```bash
.venv/bin/pytest -q -c tests/pytest.ini
```

The full Python suite covers API, chat streaming, conversations, files,
sandboxing, tools, storage, and provider-client behavior. Run it locally with
the command above; GitHub Actions runs the same suite across supported Python
versions.

The V0.1 integration smoke checks also cover the MCP JSON-RPC lifecycle, policy
enforcement, context-size limits, the dependency-free CLI, and client source
syntax. The CLI can exercise either transport:

```bash
.venv/bin/python clients/cli/mini_o_mcp.py --stdio tools
.venv/bin/python clients/cli/mini_o_mcp.py --endpoint http://127.0.0.1:8000/api/mcp tools
node --check clients/vscode/extension.js
```

The JetBrains and Android Studio clients are source projects for this testing
release. Open each project in its matching IDE and run its Gradle plugin build;
signed marketplace publication is intentionally outside V0.1.

The bounded deterministic subset used for local validation is:

```bash
.venv/bin/pytest -q \
  tests/test_storage.py tests/test_sandbox.py tests/test_file_tools.py \
  tests/test_registry.py tests/test_ollama_client.py -c tests/pytest.ini
```

Run frontend tests:

```bash
cd tests/frontend
npm install
npm test
```

Basic source validation can be run without test dependencies:

```bash
.venv/bin/python -m compileall -q backend
for file in frontend/js/*.js; do node --check "$file"; done
node tests/frontend/contrast-check.mjs
```

Tests requiring Ollama need a running Ollama server and an available model.

The frontend package declares Vitest and jsdom locally, but `node_modules` is
not vendored. Install the test dependencies before reporting frontend tests as
passing. Ollama connection attempts are bounded so an unavailable local server
fails promptly instead of waiting for a long stream timeout. The latest API
validation command is:

```bash
.venv/bin/pytest -q tests/api -c tests/pytest.ini
```

`tests/frontend/visual-smoke.html` provides a manual desktop/mobile/theme
fixture. Automated Chrome screenshots are not currently claimed because the
installed browser exits with a managed sandbox/profile failure in this
environment.

Additional local release checks are:

```bash
.venv/bin/python -m compileall -q backend tests
for file in frontend/js/*.js; do node --check "$file"; done
node tests/frontend/contrast-check.mjs
bash scripts/security-check.sh
.venv/bin/python scripts/benchmark.py
bash scripts/release.sh v0.1.0
```

The CI workflow runs these checks where they do not require Ollama or a
browser. Browser-level tests, usability sessions, signed public release
artifacts, production identity integration, and production-scale performance
evidence remain open roadmap work. V0.1 is therefore a trusted small-group
testing package, not a public internet deployment: MCP HTTP sessions and
authentication still need production hardening, and client plugins are not yet
signed marketplace artifacts.

## Project layout

```text
backend/
  main.py              FastAPI app, lifespan, health, and static serving
  config.py            Pydantic Settings and environment defaults
  supreme_config.py    Optional .env-configured highest-priority AGENT.md
  routes/              Chat, model, file, conversation, tool, and agent APIs
  tools/               Tool implementations and workspace agent-file support
  sandbox.py           Allowed-root path validation
  storage.py           Local conversation persistence
  ollama_client.py     Ollama HTTP/streaming client
  mcp.py               MCP contracts and JSON-RPC dispatcher
  mcp_stdio.py         MCP stdio transport entry point
frontend/
  index.html           Application shell and Configure tab
  js/                  Chat, API, files, tools, and rendering logic
  css/                 Application styles
android/                Native Jetpack Compose mobile companion
clients/                CLI, VS Code, JetBrains, and Android Studio MCP clients
tests/
  api/                 FastAPI route and stream tests
  frontend/            Vitest/jsdom tests, contrast check, and visual fixture
  *.py                 Unit, sandbox, tool, and client tests
.github/workflows/     CI checks and tagged release artifact workflow
data/                  Default approved workspace (created at runtime)
store/                 Default local conversation store (created at runtime)
```

## Security

Mini-O is designed for trusted local development, not direct internet exposure. It can read/write approved workspace files and, when enabled, execute arbitrary shell/Python code. Before using it outside localhost, add authentication, authorization, audit logging, rate limiting, and a stronger execution sandbox.

Recommended defaults:

- Bind Uvicorn to `127.0.0.1`.
- Keep `WORKSPACE_DIR` narrow.
- Keep `REQUIRE_TOOL_CONFIRMATION=true`.
- Do not place secrets in workspace files or `AGENT.md` instructions.
- Review tool calls before enabling confirmation-required tools.

Before using Mini-O outside localhost, add authentication, authorization,
origin/host validation, CSRF protection where applicable, audit logging, rate
limits, request/stream limits, and a stronger execution sandbox. Treat model
output, tool arguments, fetched content, and `AGENT.md` text as untrusted input.

## Design

- Product decisions and interaction goals: [PRODUCT_DESIGN.md](PRODUCT_DESIGN.md)
