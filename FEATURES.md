# Mini-O Features & Capabilities

Mini-O is an open-source, local-first AI workspace and tool execution environment built for Ollama and optional cloud model passthroughs. Designed with security, transparency, and deterministic control as foundational tenets, Mini-O gives developers complete authority over what AI agents can read, execute, and modify on their machines.

This document provides a detailed breakdown of all core features, architectural modules, and security capabilities in Mini-O.

---

## Table of Contents

- [1. Core Architecture & Local-First Philosophy](#1-core-architecture--local-first-philosophy)
- [2. Hierarchical `AGENT.md` Directive Engine](#2-hierarchical-agentmd-directive-engine)
- [3. Workspace Boundary & Sandbox Enforcement](#3-workspace-boundary--sandbox-enforcement)
- [4. Tool Execution Framework & Policy Control](#4-tool-execution-framework--policy-control)
- [5. Workspace Menu & Repository Secrets Management](#5-workspace-menu--repository-secrets-management)
- [6. Workspace File Explorer & Code Editor](#6-workspace-file-explorer--code-editor)
- [7. Chat Interface & Conversation Lifecycle](#7-chat-interface--conversation-lifecycle)
- [8. Model Management & Generation Tuning](#8-model-management--generation-tuning)
- [9. Model Context Protocol (MCP) & IDE Adapters](#9-model-context-protocol-mcp--ide-adapters)
- [10. Cross-Platform Runtime & Packaging](#10-cross-platform-runtime--packaging)
- [11. Android Companion Client](#11-android-companion-client)
- [12. Accessibility, UX & Visual Polish](#12-accessibility-ux--visual-polish)

---

## 1. Core Architecture & Local-First Philosophy

Mini-O is built from the ground up to operate offline on your local machine without sending telemetry, conversation histories, or workspace files to third-party servers.

- **Zero Mandatory Cloud Dependency**: Native connection to local [Ollama](https://ollama.com/) instances via HTTP REST and streaming Server-Sent Events (SSE).
- **Fast Local Inference**: Ultra-low latency streaming responses with live token counts, elapsed generation timestamps, and stop reason diagnostics.
- **Degraded State Awareness**: Clear, non-blocking health diagnostics differentiating between backend server uptime and Ollama model engine connectivity (`/api/health`).
- **Atomic Local Persistence**: Complete chat histories and configuration metadata stored in human-readable JSON files with atomic file-write locking.

---

## 2. Hierarchical `AGENT.md` Directive Engine

Mini-O treats instruction files not as generic suggestions, but as authoritative contracts that govern model behavior.

- **Authoritative Orchestration**: Injected directives always take precedence over the default model persona and cannot be silently bypassed by chat prompts.
- **Directory-Scoped Cascading**: Rules defined in subfolder `AGENT.md` files dynamically inherit and augment parent workspace rules when interacting within those subtrees.
- **Supreme Agent Configuration**: Ability to designate a machine-level or project-level `SUPREME_AGENT_FILE` via environment configuration, injected as the supreme system prompt across all sessions.
- **Live Validation & Starter Templates**: Integrated instruction editor with syntax validation, rule linting, and built-in starter templates for Python engineering, frontend development, and systems programming.

---

## 3. Workspace Boundary & Sandbox Enforcement

Every filesystem operation and tool invocation is strictly bounded by deterministic sandbox rules.

- **Explicit Directory Whitelisting**: The agent is restricted to `WORKSPACE_DIR` and explicitly whitelisted `ALLOWED_ROOTS` declared in `mini-o.config.json`.
- **Path Traversal & Symlink Guards**: Hardened canonical path resolution rejects attempts to escape sandbox boundaries via directory traversal (`../`), malicious relative paths, or deceptive symbolic links.
- **Safe Network Isolation**: The `web_fetch` tool blocks egress requests targeting loopback addresses (`127.0.0.0/8`), RFC 1918 private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local IPs (`169.254.0.0/16`), and reserved multicast ranges.

---

## 4. Tool Execution Framework & Policy Control

Mini-O implements a transparent, human-in-the-loop tool execution model with granular permissioning.

### Built-in Tool Suite

| Tool | Category | Risk Tier | Description | Default Policy |
| :--- | :--- | :--- | :--- | :--- |
| `read_file` | Filesystem | Low | Reads file contents within the approved sandbox | Allow |
| `write_file` | Filesystem | High | Creates or modifies files within the approved sandbox | Confirm |
| `list_files` | Filesystem | Low | Lists directory contents and file metadata | Allow |
| `search_files` | Filesystem | Low | Finds files matching glob patterns or names | Allow |
| `run_shell` | System | Critical | Executes shell commands in the workspace root | Confirm |
| `run_python` | Execution | High | Executes isolated Python scripts in the workspace | Confirm |
| `web_fetch` | Network | Medium | Fetches and sanitizes public web content | Confirm |
| `research_fetch` | Research | Low | Retrieves bounded, provenance-bearing web summaries | Confirm |

### Granular Policy Modes

- **Three-Tier Permissioning**: Configure each tool individually as **Allow** (unrestricted within sandbox), **Confirm** (explicit user approval prompt), or **Deny** (hard execution block).
- **Flexible Approval Scopes**: Grant tool approvals **Once** (single tool call), **Conversation** (duration of current chat), or **Session** (until browser reload).
- **Execution Side-Effect Transparency**: Full disclosure of planned side-effects, arguments, and expected modifications before a tool executes.

---

## 5. Workspace Menu & Repository Secrets Management

The top-level **Workspace Menu** (accessible via header button or <kbd>Alt+M</kbd> / <kbd>Ctrl+M</kbd>) consolidates workspace administration and credential storage.

- **Repository Tokens & API Keys**: Secure local storage for personal access tokens and keys across multiple providers:
  - **GitHub**: `GITHUB_TOKEN` / Personal Access Tokens for repository cloning, pull requests, and workflow automation.
  - **GitLab**: `GITLAB_TOKEN` for public and self-hosted GitLab instances (with custom base URL configuration).
  - **Bitbucket**: `BITBUCKET_TOKEN` / App Passwords.
  - **Custom Git**: Generic Git repository access tokens with custom instance URLs.
  - **AI Model Providers**: Google Gemini (`GEMINI_API_KEY`), Anthropic Claude (`ANTHROPIC_API_KEY`), OpenAI (`OPENAI_API_KEY`), and Hugging Face (`HF_TOKEN`).
- **Live Connection Testing**: `⚡ Test Connection` harness validates token permissions, reachability, and authentication status in real time.
- **Repository-Scoped Secrets**: Bind tokens to specific target repositories (`https://github.com/org/repo`) or designate them as global fallback keys.
- **Secure Masking**: Value-hiding toggles, masked preview strings, and local browser-only credential encryption.

---

## 6. Workspace File Explorer & Code Editor

The right-hand workspace panel provides a dedicated, full-featured workspace explorer and code editing environment.

- **Interactive File Tree**: Real-time directory navigation with path breadcrumbs, folder hierarchy, and quick back navigation.
- **Deep Search Capabilities**: Fast search by filename as well as full-text content searching across all workspace documents.
- **Integrated Code Editor**:
  - Syntax-aware editing with automatic language and line-ending detection (LF/CRLF).
  - Multi-level Undo/Redo stack with keyboard shortcuts (<kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd>).
  - Find and Replace dialog with match highlighting.
  - Go to line navigation (<kbd>Ctrl+G</kbd>).
  - Unsaved change indicators and conflict-safe optimistic saves.
- **File Operations**: Create new files/folders, duplicate existing files, rename files safely, and soft-delete files with local recovery mechanisms.
- **Context Attachments**: Double-click any file to attach it as an ordered context chip in the composer, allowing the model to analyze relevant code without copy-pasting.

---

## 7. Chat Interface & Conversation Lifecycle

A distraction-free, responsive messaging workspace crafted for developer productivity.

- **Streaming Responses**: Live Server-Sent Events (SSE) streaming with cancellation controls (<kbd>Stop</kbd> button).
- **Message Lifecycle Actions**:
  - Edit submitted prompts and branch conversations at any point in time.
  - Regenerate assistant responses with a single click.
  - Copy formatted code blocks, raw markdown, or diagnostic metadata.
  - Inspect raw message payloads and prompt structure.
- **Markdown & Code Rendering**:
  - Syntax highlighting for 50+ programming languages.
  - Line numbers toggle and horizontal code scroll/wrap switches.
  - Rendered tables, task lists, nested quotes, and mathematical notations.
  - Unsafe URL filtering and sanitized HTML output.
- **Conversation Organization**:
  - Full-text search across all saved conversations.
  - Auto-generated or custom conversation titles.
  - Pin important chats to the top of the sidebar.
  - Archive inactive threads with bulk archiving and restoration safeguards.
  - Versioned portable JSON export and import for seamless backup and migration.
- **Voice Synthesis (TTS)**: Client-side audio generation allowing spoken playback of agent explanations and code breakdowns.

---

## 8. Model Management & Generation Tuning

Comprehensive control over local and cloud model execution parameters.

- **Model Catalog & Discovery**: Instant discovery of installed Ollama models with parameter sizes, quantization tags, and architecture metadata.
- **One-Click Model Pulls**: Streamed download and installation of new models from the Ollama library with live byte progress bars.
- **Per-Conversation Parameter Overrides**:
  - Temperature (creativity vs. determinism).
  - Top-P and Top-K sampling thresholds.
  - Context window size (`num_ctx`).
  - Max generation tokens and stop sequences.
- **Model Deletion & Cleanup**: Manage local disk footprint by removing unused models directly from the UI.

---

## 9. Model Context Protocol (MCP) & IDE Adapters

Mini-O supports the open **Model Context Protocol (MCP)** specification, allowing standard developer environments to leverage Mini-O tools and context.

- **Dual Transport Protocols**:
  - **HTTP JSON-RPC**: Endpoint `/api/mcp` for networked IDE integration and distributed agent workflows.
  - **stdio Transport**: Subprocess-based protocol communication via `python -m backend.mcp_stdio`.
- **Protocol Capabilities**: Full support for `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, and contextual envelope submission.
- **IDE Extensions & Clients** (under `clients/`):
  - **VS Code Extension**: Direct workspace binding and command execution.
  - **JetBrains & Android Studio Plugins**: Code assistance and file operations directly inside IntelliJ Platform IDEs.
  - **Standalone Python CLI**: Dependency-free command-line interface for terminal scripting and automated pipelines.

---

## 10. Cross-Platform Runtime & Packaging

Mini-O is distributed across multiple operating systems with native desktop integrations.

- **Windows Native Integration**:
  - Portable zero-install ZIP distribution (`mini-o-windows-x64.zip`).
  - Inno Setup GUI installer (`mini-o-setup.exe`) with automated Ollama detection, model pulling, and desktop shortcuts.
  - Dedicated PowerShell (`mini-o.ps1`) and Command Prompt (`mini-o.cmd`) CLI scripts (`open`, `start`, `stop`, `status`, `logs`, `install-service`).
  - Background Windows Service support via NSSM / PowerShell scripts.
- **Linux / Debian Packaging**:
  - Official `.deb` package (`mini-o_amd64.deb`) for Debian, Ubuntu, and WSL2.
  - Built-in `systemd` user and system unit integration (`systemctl enable --now mini-o`).
- **Node.js & Python Hybrid Architecture**:
  - High-performance TypeScript/Node.js web runtime.
  - Python 3.11+ FastAPI backend with asynchronous request routing and ASGI compatibility.

---

## 11. Android Companion Client

A native Android application located in `android/` designed for remote workspace inspection over local networks.

- **Native Jetpack Compose UI**: Fast, modern interface adhering to Material 3 design guidelines.
- **Encrypted Local Storage**: Server connection URLs and authentication tokens are securely encrypted using Android Keystore and EncryptedSharedPreferences.
- **Secure Read-Only Access**: Safely browse approved workspace directories and inspect code files on your phone without exposing write or shell capabilities over the network.
- **LAN Discovery & Authentication**: Connects over private Wi-Fi networks with bearer token verification.

---

## 12. Accessibility, UX & Visual Polish

Crafted with high typographic rigor and accessibility standards.

- **Theme Engine**: System, Light, Dark, and High-Contrast themes built with mathematically tuned contrast ratios (passing WCAG AA 4.5:1).
- **Display Density & Sizing**: Customizable UI density (Comfortable, Compact) and base font sizes (Normal, Small, Large).
- **Keyboard-First Navigation**: Complete keyboard navigation shortcuts for all core actions (<kbd>Alt+M</kbd> for menu, <kbd>Alt+F</kbd> for fullscreen terminal, <kbd>Ctrl+Enter</kbd> to send).
- **Screen Reader Support**: ARIA live regions, explicit element labeling, and high-visibility focus rings.
- **Reduced Motion**: Full support for `prefers-reduced-motion` media queries with disabled transitions.

---

For architectural design principles and product philosophy, refer to [PRODUCT_DESIGN.md](PRODUCT_DESIGN.md).  
For installation and quick start instructions, refer to the [README.md](README.md).
