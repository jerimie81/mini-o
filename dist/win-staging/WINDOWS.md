# Mini-O / Redrum AI — Windows Application Guide

Mini-O is a private, local-first AI workspace and companion application built for Windows 10, Windows 11, and Windows Server (x64 and ARM64).

---

## 1. Quick Start on Windows

### Option A: Portable Archive (.zip) — No Installation Required
1. Download `mini-o-0.1.0-windows-x64.zip` (or `mini-o-windows-portable.zip`).
2. Extract the folder anywhere (e.g., `C:\Tools\mini-o` or `C:\Users\<You>\mini-o`).
3. Double-click **`start-mini-o.bat`** or run **`.\mini-o.ps1 open`** in PowerShell.
4. Your default browser will launch immediately to `http://localhost:3000`.

### Option B: Windows Installer (.exe) — Recommended
Compile or run the Inno Setup installer (`installer.iss` or `mini-o-setup-0.1.0.exe`):
- **Automated Ollama Integration**: Automatically checks for Ollama, downloads and installs it silently if missing.
- **Model Chooser Wizard**: Lets you choose and pull your preferred local companion model (Llama 3.1 8B, Llama 3.2 3B/1B, Qwen 2.5 Coder 7B, Mistral 7B, Phi 3.5 Mini, DeepSeek R1 8B) during setup and sets it as default in `config.json`.
- **Automatic Daemon Launch**: Configures and launches the Ollama server on `http://127.0.0.1:11434`.
- **Path & Shortcuts**: Adds Start Menu shortcuts, a Desktop launcher, and adds `mini-o` to your system `PATH`.
- **Uninstaller**: Provides a clean uninstaller in Windows *Add or Remove Programs*.

---

## 2. Prerequisites

| Requirement | Recommended | Installation Command |
|-------------|-------------|----------------------|
| **Node.js** | v18.0.0 or higher (LTS) | `winget install OpenJS.NodeJS.LTS` |
| **Ollama (Optional)** | For local offline LLMs | `winget install Ollama.Ollama` |
| **PowerShell** | 5.1 (Built-in) or 7+ | `winget install Microsoft.PowerShell` |

---

## 3. Command-Line Interface (`mini-o.cmd` & `mini-o.ps1`)

Mini-O provides both Command Prompt (`mini-o.cmd`) and PowerShell (`mini-o.ps1`) tools.

```powershell
# Open browser & start server if not already running
.\mini-o.ps1 open

# Start in background
.\mini-o.ps1 start

# Check status and health
.\mini-o.ps1 status

# Run in active console with live logs (Foreground)
.\mini-o.ps1 run

# Stream server logs in real-time
.\mini-o.ps1 logs

# Interactive local Ollama setup and model selector
.\mini-o.ps1 setup-ollama
# Or pull a specific model directly:
.\mini-o.ps1 setup-ollama -Model "llama3.1:8b"

# Stop all Mini-O processes
.\mini-o.ps1 stop

# Register as automatic Windows Service (requires Admin)
.\mini-o.ps1 install-service
```

Using standard Command Prompt / CMD:
```cmd
mini-o.cmd open
mini-o.cmd setup-ollama
mini-o.cmd models
mini-o.cmd status
mini-o.cmd stop
mini-o.cmd logs
```

---

## 4. Running as a Background Windows Service

To have Mini-O run continuously in the background and start automatically on Windows boot without requiring manual login:

1. Open **PowerShell as Administrator**.
2. Run:
   ```powershell
   .\install-service.ps1
   ```
3. Mini-O will be registered and started as a Windows Service (`Mini-O AI Workspace`).
4. To remove the service later:
   ```powershell
   .\install-service.ps1 -Uninstall
   ```

---

## 5. Local LLM Acceleration with Ollama on Windows

Mini-O connects seamlessly to Ollama running locally on Windows with hardware acceleration:
- **Automated Setup**: The Windows installer (`mini-o-setup.exe`) and `setup-ollama.ps1` handle Ollama installation and model downloads automatically.
- **NVIDIA GPUs**: CUDA acceleration is automatically enabled by Ollama.
- **AMD GPUs**: ROCm support on supported Radeon GPUs.
- **Intel Arc & Core Ultra**: DirectML / Vulkan support.

### Supported Local Models & Hardware Guide:
| Model Name | Parameters | Download Size | Recommended RAM / VRAM | Best For |
|------------|------------|---------------|------------------------|----------|
| `llama3.1:8b` | 8 Billion | ~4.7 GB | 8 GB+ | Balanced default companion, reasoning, general chat |
| `llama3.2:3b` | 3 Billion | ~2.0 GB | 6 GB | Laptops, ultra-fast responses, light resource usage |
| `llama3.2:1b` | 1 Billion | ~1.3 GB | 4 GB | Minimal resource footprint, low-power devices |
| `qwen2.5-coder:7b` | 7 Billion | ~4.7 GB | 8 GB+ | Code generation, refactoring, bash/PowerShell automation |
| `mistral:7b` | 7 Billion | ~4.1 GB | 8 GB+ | Complex instructions, structured outputs, summarization |
| `phi3.5:3.8b` | 3.8 Billion | ~2.2 GB | 6 GB | High reasoning-to-size performance |
| `deepseek-r1:8b` | 8 Billion | ~4.9 GB | 8 GB+ | Step-by-step chain-of-thought math and logic |

To pull or switch models at any time:
```cmd
mini-o.cmd setup-ollama
# Or directly via Ollama:
ollama run llama3.1:8b
```
Mini-O detects local models at `http://127.0.0.1:11434` automatically.

---

## 6. Windows File Paths & Workspace Integration

- **Workspace Data Directory**: Located in `./data` relative to the application, or `%LOCALAPPDATA%\Mini-O\data`.
- **System Agent Directives**: Edit `./data/AGENT.md` to customize how the agent handles your Windows codebases, documents, and workflows.
- **Backups & Safety**: File modifications are protected with concurrency checking (`mtime`) and atomic writes.

---

## 7. Troubleshooting on Windows

| Issue | Cause | Solution |
|-------|-------|----------|
| `node is not recognized` | Node.js not in PATH | Install Node.js LTS via `winget install OpenJS.NodeJS.LTS` and restart terminal. |
| `Port 3000 in use` | Another program is listening on port 3000 | Run `set PORT=3050` before starting, or stop the conflicting app. |
| Execution Policy Error in PowerShell | Restricted execution policy | Run `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` or use `mini-o.cmd`. |
| Cannot reach Ollama | Ollama service not started | Start Ollama from the Windows system tray or run `ollama serve`. |
