#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# fetch-geos.sh — download + verify + extract GEOS source tarball
#
# Reads the GEOS version from geos-version.txt (sibling of this script),
# downloads the corresponding release tarball from GitHub, verifies its
# SHA-256 hash, and extracts it into vendor/geos/.
#
# Idempotent: if vendor/geos/ already contains the expected version (checked
# via Version.txt shipped in the GEOS tarball), the download is skipped.
#
# Usage:
#   bash modules/native-geometry/scripts/fetch-geos.sh
#
# Requires: curl, shasum, tar
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/vendor/geos"
VERSION_FILE="$SCRIPT_DIR/geos-version.txt"
BUILD_DIR="$ROOT_DIR/ios/build"

# -- version ----------------------------------------------------------------
VERSION="$(cat "$VERSION_FILE" | tr -d '[:space:]')"
if [[ -z "$VERSION" ]]; then
    echo "ERROR: geos-version.txt is empty or missing" >&2
    exit 1
fi

# -- known SHA-256 hashes ---------------------------------------------------
# Update this table when bumping the version in geos-version.txt.
# Format: version|hash (pipe-delimited because dots break bash assoc arrays).
_KNOWN="
3.14.1|512118b3be3ccefbca66b36b0f3e895576d08d6ff330ba1511a31a306abbb477
"

EXPECTED_HASH=""
while IFS='|' read -r _ver _hash; do
    [[ -z "$_ver" ]] && continue
    if [[ "$_ver" == "$VERSION" ]]; then
        EXPECTED_HASH="$_hash"
        break
    fi
done <<< "$_KNOWN"

if [[ -z "$EXPECTED_HASH" ]]; then
    echo "ERROR: no SHA-256 hash registered for GEOS $VERSION" >&2
    echo "Add it to the KNOWN_HASHES table in $(basename "$0")" >&2
    exit 1
fi

# -- idempotency check ------------------------------------------------------
VERSION_TXT="$VENDOR_DIR/Version.txt"
if [[ -f "$VERSION_TXT" ]]; then
    # GEOS Version.txt uses KEY=VALUE lines; reconstruct "MAJOR.MINOR.PATCH".
    _v_major="$(sed -n 's/^GEOS_VERSION_MAJOR=//p' "$VERSION_TXT" | tr -d '[:space:]')"
    _v_minor="$(sed -n 's/^GEOS_VERSION_MINOR=//p' "$VERSION_TXT" | tr -d '[:space:]')"
    _v_patch="$(sed -n 's/^GEOS_VERSION_PATCH=//p' "$VERSION_TXT" | tr -d '[:space:]')"
    EXISTING_VERSION="${_v_major}.${_v_minor}.${_v_patch}"
    if [[ "$EXISTING_VERSION" == "$VERSION" ]]; then
        echo "GEOS $VERSION already extracted at $VENDOR_DIR — skipping fetch."
        exit 0
    fi
    echo "GEOS version mismatch (existing=$EXISTING_VERSION, wanted=$VERSION) — re-fetching."
    rm -rf "$VENDOR_DIR"
fi

# -- download ---------------------------------------------------------------
TARBALL_URL="https://github.com/libgeos/geos/archive/refs/tags/${VERSION}.tar.gz"
TARBALL="/tmp/geos-${VERSION}.tar.gz"

echo "Downloading GEOS $VERSION from $TARBALL_URL ..."
curl -sL -o "$TARBALL" "$TARBALL_URL"

# -- verify -----------------------------------------------------------------
echo "Verifying SHA-256 ..."
ACTUAL_HASH="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
if [[ "$ACTUAL_HASH" != "$EXPECTED_HASH" ]]; then
    echo "ERROR: SHA-256 mismatch!" >&2
    echo "  expected: $EXPECTED_HASH" >&2
    echo "  actual:   $ACTUAL_HASH" >&2
    rm -f "$TARBALL"
    exit 1
fi
echo "SHA-256 OK."

# -- extract ----------------------------------------------------------------
echo "Extracting GEOS $VERSION to $VENDOR_DIR ..."
mkdir -p "$VENDOR_DIR"
# The tarball contains a top-level geos-<version>/ directory; strip it.
tar -xzf "$TARBALL" -C "$VENDOR_DIR" --strip-components=1
rm -f "$TARBALL"

# -- confirm ----------------------------------------------------------------
if [[ -f "$VERSION_TXT" ]]; then
    _v_major="$(sed -n 's/^GEOS_VERSION_MAJOR=//p' "$VERSION_TXT" | tr -d '[:space:]')"
    _v_minor="$(sed -n 's/^GEOS_VERSION_MINOR=//p' "$VERSION_TXT" | tr -d '[:space:]')"
    _v_patch="$(sed -n 's/^GEOS_VERSION_PATCH=//p' "$VERSION_TXT" | tr -d '[:space:]')"
    echo "GEOS ${_v_major}.${_v_minor}.${_v_patch} extracted successfully."
else
    echo "ERROR: extraction failed — Version.txt not found in $VENDOR_DIR" >&2
    exit 1
fi
