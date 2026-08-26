#!/usr/bin/env bash
# ==============================================================================
# Mini-O / Redrum AI - Debian Package (.deb) Build Script
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PKG_NAME="mini-o"
PKG_VERSION="0.1.0-1"
PKG_ARCH="amd64"
OUTPUT_DEB="${ROOT_DIR}/dist/${PKG_NAME}_${PKG_VERSION}_${PKG_ARCH}.deb"
LATEST_DEB="${ROOT_DIR}/dist/${PKG_NAME}_latest_${PKG_ARCH}.deb"
STANDALONE_DEB="${ROOT_DIR}/dist/${PKG_NAME}.deb"
PUBLIC_DEB="${ROOT_DIR}/frontend/${PKG_NAME}.deb"
STAGING_DIR="${ROOT_DIR}/dist/deb-staging"

echo "=== Building Mini-O Debian Package (${PKG_NAME}_${PKG_VERSION}_${PKG_ARCH}.deb) ==="

# Clean any existing deb binaries in frontend to avoid recursion
rm -f "${ROOT_DIR}/frontend/"*.deb 2>/dev/null || true

# 1. Clean & prepare output directories
mkdir -p "${ROOT_DIR}/dist"
rm -rf "${STAGING_DIR}"
mkdir -p "${STAGING_DIR}/DEBIAN"
mkdir -p "${STAGING_DIR}/opt/mini-o/dist"
mkdir -p "${STAGING_DIR}/opt/mini-o/frontend"
mkdir -p "${STAGING_DIR}/opt/mini-o/data"
mkdir -p "${STAGING_DIR}/usr/bin"
mkdir -p "${STAGING_DIR}/lib/systemd/system"
mkdir -p "${STAGING_DIR}/usr/lib/systemd/user"
mkdir -p "${STAGING_DIR}/usr/share/applications"
mkdir -p "${STAGING_DIR}/usr/share/icons/hicolor/scalable/apps"
mkdir -p "${STAGING_DIR}/usr/share/doc/mini-o"
mkdir -p "${STAGING_DIR}/etc/mini-o"
mkdir -p "${STAGING_DIR}/var/log/mini-o"
mkdir -p "${STAGING_DIR}/var/lib/mini-o"

# 2. Compile standalone backend server bundle
echo "--> 1. Compiling standalone server bundle with esbuild..."
cd "${ROOT_DIR}"
npx esbuild server.ts --bundle --platform=node --format=cjs --sourcemap --outfile="${STAGING_DIR}/opt/mini-o/dist/server.cjs"
cp "${STAGING_DIR}/opt/mini-o/dist/server.cjs"* "${ROOT_DIR}/dist/" 2>/dev/null || true

# 3. Copy Application & Frontend Files (excluding .deb files)
echo "--> 2. Staging application files to /opt/mini-o..."
cp -r "${ROOT_DIR}/frontend/css" "${STAGING_DIR}/opt/mini-o/frontend/"
cp -r "${ROOT_DIR}/frontend/js" "${STAGING_DIR}/opt/mini-o/frontend/"
cp "${ROOT_DIR}/frontend/index.html" "${STAGING_DIR}/opt/mini-o/frontend/"

cp "${ROOT_DIR}/package.json" "${STAGING_DIR}/opt/mini-o/package.json"
cp "${ROOT_DIR}/mini-o.config.example.json" "${STAGING_DIR}/opt/mini-o/mini-o.config.example.json"
cp "${ROOT_DIR}/mini-o.config.example.json" "${STAGING_DIR}/etc/mini-o/config.json"

if [ -f "${ROOT_DIR}/README.md" ]; then
    cp "${ROOT_DIR}/README.md" "${STAGING_DIR}/opt/mini-o/README.md"
    cp "${ROOT_DIR}/README.md" "${STAGING_DIR}/usr/share/doc/mini-o/README.md"
fi
if [ -f "${ROOT_DIR}/CHANGELOG.md" ]; then
    cp "${ROOT_DIR}/CHANGELOG.md" "${STAGING_DIR}/usr/share/doc/mini-o/changelog.md"
fi

# 4. Copy Debian packaging files
echo "--> 3. Copying control scripts, systemd service, desktop launcher, and icon..."
cp "${ROOT_DIR}/debian/control" "${STAGING_DIR}/DEBIAN/control"
cp "${ROOT_DIR}/debian/postinst" "${STAGING_DIR}/DEBIAN/postinst"
cp "${ROOT_DIR}/debian/prerm" "${STAGING_DIR}/DEBIAN/prerm"
cp "${ROOT_DIR}/debian/postrm" "${STAGING_DIR}/DEBIAN/postrm"
cp "${ROOT_DIR}/debian/conffiles" "${STAGING_DIR}/DEBIAN/conffiles"

# CLI wrapper
cp "${ROOT_DIR}/debian/mini-o" "${STAGING_DIR}/usr/bin/mini-o"
# Systemd services (system & user)
cp "${ROOT_DIR}/debian/mini-o.service" "${STAGING_DIR}/lib/systemd/system/mini-o.service"
cp "${ROOT_DIR}/debian/mini-o.service" "${STAGING_DIR}/usr/lib/systemd/user/mini-o.service"
# Desktop entry & icon
cp "${ROOT_DIR}/debian/mini-o.desktop" "${STAGING_DIR}/usr/share/applications/mini-o.desktop"
cp "${ROOT_DIR}/debian/mini-o.svg" "${STAGING_DIR}/usr/share/icons/hicolor/scalable/apps/mini-o.svg"

# 5. Set appropriate Unix permissions
echo "--> 4. Setting file permissions..."
chmod 755 "${STAGING_DIR}/DEBIAN/postinst"
chmod 755 "${STAGING_DIR}/DEBIAN/prerm"
chmod 755 "${STAGING_DIR}/DEBIAN/postrm"
chmod 644 "${STAGING_DIR}/DEBIAN/control"
chmod 644 "${STAGING_DIR}/DEBIAN/conffiles"

chmod 755 "${STAGING_DIR}/usr/bin/mini-o"
chmod 644 "${STAGING_DIR}/lib/systemd/system/mini-o.service"
chmod 644 "${STAGING_DIR}/usr/lib/systemd/user/mini-o.service"
chmod 644 "${STAGING_DIR}/usr/share/applications/mini-o.desktop"
chmod 644 "${STAGING_DIR}/usr/share/icons/hicolor/scalable/apps/mini-o.svg"

find "${STAGING_DIR}/opt/mini-o" -type d -exec chmod 755 {} +
find "${STAGING_DIR}/opt/mini-o" -type f -exec chmod 644 {} +
chmod 755 "${STAGING_DIR}/opt/mini-o/dist/server.cjs"

# 6. Build the .deb archive
echo "--> 5. Building Debian archive with dpkg-deb..."
dpkg-deb --build --root-owner-group "${STAGING_DIR}" "${OUTPUT_DEB}"

# Create convenience copies and web distribution files
cp "${OUTPUT_DEB}" "${LATEST_DEB}"
cp "${OUTPUT_DEB}" "${STANDALONE_DEB}"
cp "${OUTPUT_DEB}" "${PUBLIC_DEB}"

# Compute checksums
cd "${ROOT_DIR}/dist"
sha256sum "$(basename "${OUTPUT_DEB}")" > "${ROOT_DIR}/dist/SHA256SUMS"

echo ""
echo "================================================================"
echo " Mini-O Debian Package Successfully Built!"
echo "================================================================"
echo " Package Path:  ${OUTPUT_DEB}"
echo " Latest Alias:  ${LATEST_DEB}"
echo " Public Asset:  ${PUBLIC_DEB}"
echo " Package Size:  $(du -h "${OUTPUT_DEB}" | cut -f1)"
echo " SHA256 Hash:   $(cat "${ROOT_DIR}/dist/SHA256SUMS" | cut -d' ' -f1)"
echo ""
echo "--- Package Control Metadata ---"
dpkg-deb -I "${OUTPUT_DEB}"
echo ""
echo "================================================================"
