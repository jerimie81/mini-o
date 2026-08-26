#!/usr/bin/env bash
# ==============================================================================
# Mini-O / Redrum AI - Windows Portable & Installer Packaging Script
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PKG_NAME="mini-o"
PKG_VERSION="0.1.0"
PKG_ARCH="windows-x64"
OUTPUT_ZIP="${ROOT_DIR}/dist/${PKG_NAME}-${PKG_VERSION}-${PKG_ARCH}.zip"
LATEST_ZIP="${ROOT_DIR}/dist/${PKG_NAME}-windows-portable.zip"
PUBLIC_ZIP="${ROOT_DIR}/frontend/${PKG_NAME}-windows.zip"
STAGING_DIR="${ROOT_DIR}/dist/win-staging"

echo "=== Building Mini-O Windows Distribution (${PKG_NAME}-${PKG_VERSION}-${PKG_ARCH}.zip) ==="

# 1. Clean & prepare output directories
mkdir -p "${ROOT_DIR}/dist"
rm -rf "${STAGING_DIR}"
mkdir -p "${STAGING_DIR}/dist"
mkdir -p "${STAGING_DIR}/frontend"
mkdir -p "${STAGING_DIR}/data"
mkdir -p "${STAGING_DIR}/logs"
mkdir -p "${STAGING_DIR}/windows"

# 2. Compile standalone backend server bundle
echo "--> 1. Compiling standalone server bundle for Windows runtime..."
cd "${ROOT_DIR}"
npx esbuild server.ts --bundle --platform=node --format=cjs --sourcemap --outfile="${STAGING_DIR}/dist/server.cjs"
cp "${STAGING_DIR}/dist/server.cjs"* "${ROOT_DIR}/dist/" 2>/dev/null || true

# 3. Copy Application & Frontend Files
echo "--> 2. Staging frontend and workspace assets..."
cp -r "${ROOT_DIR}/frontend/css" "${STAGING_DIR}/frontend/"
cp -r "${ROOT_DIR}/frontend/js" "${STAGING_DIR}/frontend/"
cp "${ROOT_DIR}/frontend/index.html" "${STAGING_DIR}/frontend/"

if [ -d "${ROOT_DIR}/data" ]; then
    cp -r "${ROOT_DIR}/data/"* "${STAGING_DIR}/data/" 2>/dev/null || true
fi

# 4. Copy Windows Launchers, Scripts & Configs
echo "--> 3. Staging Windows launchers, scripts and service definitions..."
cp "${ROOT_DIR}/windows/mini-o.cmd" "${STAGING_DIR}/mini-o.cmd"
cp "${ROOT_DIR}/windows/mini-o.ps1" "${STAGING_DIR}/mini-o.ps1"
cp "${ROOT_DIR}/windows/start-mini-o.bat" "${STAGING_DIR}/start-mini-o.bat"
cp "${ROOT_DIR}/windows/setup-ollama.ps1" "${STAGING_DIR}/setup-ollama.ps1"
cp "${ROOT_DIR}/windows/mini-o.vbs" "${STAGING_DIR}/mini-o.vbs"
cp "${ROOT_DIR}/windows/config.windows.json" "${STAGING_DIR}/config.json"
cp "${ROOT_DIR}/windows/mini-o-service.xml" "${STAGING_DIR}/mini-o-service.xml"
cp "${ROOT_DIR}/windows/install-service.ps1" "${STAGING_DIR}/install-service.ps1"
cp "${ROOT_DIR}/windows/uninstall.cmd" "${STAGING_DIR}/uninstall.cmd"
cp "${ROOT_DIR}/windows/installer.iss" "${STAGING_DIR}/installer.iss"
if [ -f "${ROOT_DIR}/windows/mini-o.ico" ]; then
    cp "${ROOT_DIR}/windows/mini-o.ico" "${STAGING_DIR}/mini-o.ico"
fi
if [ -f "${ROOT_DIR}/windows/mini-o.svg" ]; then
    cp "${ROOT_DIR}/windows/mini-o.svg" "${STAGING_DIR}/mini-o.svg"
fi

cp "${ROOT_DIR}/package.json" "${STAGING_DIR}/package.json"
cp "${ROOT_DIR}/README.md" "${STAGING_DIR}/README.md"
if [ -f "${ROOT_DIR}/WINDOWS.md" ]; then
    cp "${ROOT_DIR}/WINDOWS.md" "${STAGING_DIR}/WINDOWS.md"
fi

# 5. Build the ZIP archive using Python
echo "--> 4. Compressing Windows distribution archive..."
python3 -c "
import zipfile, os

staging = '${STAGING_DIR}'
output = '${OUTPUT_ZIP}'

with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(staging):
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, staging)
            # Prepend root folder inside zip for clean extraction
            arcname = os.path.join('mini-o-windows', rel_path)
            z.write(full_path, arcname)

print('Zip created successfully at', output)
"

# Create convenience copies
cp "${OUTPUT_ZIP}" "${LATEST_ZIP}"
cp "${OUTPUT_ZIP}" "${PUBLIC_ZIP}" 2>/dev/null || true

# Compute checksums
cd "${ROOT_DIR}/dist"
sha256sum "$(basename "${OUTPUT_ZIP}")" >> "${ROOT_DIR}/dist/SHA256SUMS.tmp"
sort -u "${ROOT_DIR}/dist/SHA256SUMS.tmp" > "${ROOT_DIR}/dist/SHA256SUMS" 2>/dev/null || sha256sum "$(basename "${OUTPUT_ZIP}")" > "${ROOT_DIR}/dist/SHA256SUMS"
rm -f "${ROOT_DIR}/dist/SHA256SUMS.tmp"

echo ""
echo "================================================================"
echo " Mini-O Windows Package Successfully Built!"
echo "================================================================"
echo " Package Path:  ${OUTPUT_ZIP}"
echo " Portable Alias:${LATEST_ZIP}"
echo " Package Size:  $(du -h "${OUTPUT_ZIP}" | cut -f1)"
echo " SHA256 Hash:   $(sha256sum "${OUTPUT_ZIP}" | cut -d' ' -f1)"
echo ""
echo " Contents:"
python3 -c "
import zipfile
with zipfile.ZipFile('${OUTPUT_ZIP}', 'r') as z:
    for info in z.infolist()[:20]:
        print(f'  {info.filename:45} {info.file_size:>10} bytes')
"
echo "================================================================"
