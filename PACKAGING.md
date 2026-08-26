# Mini-O / Redrum AI — Debian (.deb) Packaging & Distribution Guide

This document explains the structure, build process, installation, testing procedures, and maintenance of the Debian package (`.deb`) for **Mini-O / Redrum AI**.

---

## 1. Package Overview

- **Package Name:** `mini-o`
- **Version:** `0.1.0-1`
- **Target Architecture:** `amd64` (or `all` with Node.js runtime)
- **Target Distributions:** Debian 11/12, Ubuntu 20.04/22.04/24.04, Linux Mint, Pop!_OS, WSL2
- **Runtime Dependencies:**
  - `nodejs (>= 18.0.0)` or `node (>= 18.0.0)`
  - `curl`
  - `systemd` (recommended for background daemon management)
  - `ollama` (recommended for local model execution)

---

## 2. Directory Layout on Installed Target Systems

When installed via `dpkg -i`, the files are laid out according to standard Linux FHS (Filesystem Hierarchy Standard):

| Path | Purpose | Permissions |
|------|---------|-------------|
| `/opt/mini-o/dist/server.cjs` | Standalone bundled server runtime | `0755` |
| `/opt/mini-o/frontend/` | Complete web frontend (HTML, CSS, JS) | `0644` / `0755` |
| `/usr/bin/mini-o` | Unified CLI wrapper and service manager | `0755` |
| `/lib/systemd/system/mini-o.service` | System-level systemd service unit | `0644` |
| `/usr/lib/systemd/user/mini-o.service` | User-level systemd service unit | `0644` |
| `/usr/share/applications/mini-o.desktop` | Desktop launcher menu entry | `0644` |
| `/usr/share/icons/hicolor/scalable/apps/mini-o.svg` | Application icon | `0644` |
| `/etc/mini-o/config.json` | System default configuration file | `0644` (conffile) |
| `/var/log/mini-o/` | Default server log directory | `0755` |
| `/var/lib/mini-o/` | Persistent workspace storage | `0755` |

---

## 3. Building the Debian Package

The build script compiles the standalone Node.js server bundle using `esbuild`, stages the Debian control hierarchy, and packages everything using `dpkg-deb`:

```bash
# Run the automated build script
npm run build:deb

# Or invoke directly
bash scripts/build-deb.sh
```

### Build Artifacts:
- `dist/mini-o_0.1.0-1_amd64.deb` — Primary versioned Debian package
- `dist/mini-o_latest_amd64.deb` — Latest symbolic alias
- `dist/SHA256SUMS` — Verification hashes

---

## 4. Testing & Installation on Debian/Ubuntu

### Step 1: Install the Package
```bash
sudo dpkg -i dist/mini-o_0.1.0-1_amd64.deb

# If any dependencies (e.g. nodejs, curl) need resolution:
sudo apt-get install -f
```

### Step 2: Verification Commands
```bash
# Verify installation
which mini-o
mini-o version

# Inspect Debian package metadata
dpkg -s mini-o

# List all files installed by the package
dpkg -L mini-o
```

### Step 3: Running Mini-O

#### Option A: Interactive CLI & Browser Launcher
```bash
# Start server daemon and launch default browser to http://127.0.0.1:3000
mini-o open

# Check status and health API
mini-o status

# View live log stream
mini-o logs

# Stop the server
mini-o stop
```

#### Option B: Systemd Background Service
```bash
# Enable and start the system service
sudo systemctl enable --now mini-o

# Check service status
systemctl status mini-o

# View service logs via journalctl
journalctl -u mini-o -f
```

#### Option C: Desktop Launcher
Launch **"Mini-O AI Workspace"** directly from your application launcher (GNOME, KDE, XFCE).

---

## 5. Web Download Endpoint

The running server includes built-in endpoints for testers:
- **Download URL:** `http://localhost:3000/api/download/deb` (or `/download/deb`)
- **Package Metadata:** `http://localhost:3000/api/package/info`

---

## 6. Upgrading and Uninstallation

### Upgrading:
```bash
sudo dpkg -i mini-o_0.1.0-2_amd64.deb
```
Configuration files in `/etc/mini-o/config.json` are preserved across upgrades.

### Uninstallation:
```bash
# Remove package (keeps logs and configuration)
sudo dpkg -r mini-o

# Complete purge (removes configuration and logs)
sudo dpkg -P mini-o
```
