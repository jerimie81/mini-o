#!/usr/bin/env bash
# ==============================================================================
# Mini-O / Redrum AI - Unified Cross-Platform Release Packager
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "================================================================"
echo " Building Mini-O Cross-Platform Distribution Packages"
echo "================================================================"

cd "${ROOT_DIR}"

# 1. Build Debian Package
echo "==> [1/2] Building Debian (.deb) Linux package..."
bash "${SCRIPT_DIR}/build-deb.sh"

# 2. Build Windows Portable (.zip + scripts) package
echo ""
echo "==> [2/2] Building Windows (.zip + launchers) package..."
bash "${SCRIPT_DIR}/build-windows.sh"

# 3. Generate master SHA256 checksums
echo ""
echo "==> Generating master SHA256SUMS for all release artifacts..."
cd "${ROOT_DIR}/dist"
sha256sum *.deb *.zip > "${ROOT_DIR}/dist/SHA256SUMS" 2>/dev/null || true

echo ""
echo "================================================================"
echo " All Cross-Platform Packages Built Successfully!"
echo "================================================================"
ls -lh "${ROOT_DIR}/dist"/*.deb "${ROOT_DIR}/dist"/*.zip
echo "================================================================"
