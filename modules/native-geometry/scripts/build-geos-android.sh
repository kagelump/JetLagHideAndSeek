#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# build-geos-android.sh — compile GEOS as static libraries for Android
#
# Builds libgeos.a + libgeos_c.a per ABI (arm64-v8a, x86_64) using the
# Android NDK CMake toolchain, combines them into a single .a, and places
# the results in modules/native-geometry/android/libs/<abi>/libgeos.a.
#
# Prerequisites:
#   - Android NDK (27.x) — set ANDROID_NDK, ANDROID_NDK_HOME, or use the
#     default $ANDROID_HOME/ndk/ path.
#   - CMake
#   - GEOS source extracted at vendor/geos/ (run fetch-geos.sh first)
#
# Usage:
#   bash modules/native-geometry/scripts/build-geos-android.sh
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/vendor/geos"
BUILD_DIR="$ROOT_DIR/android/build"
OUTPUT_DIR="$ROOT_DIR/android/libs"

# -- locate NDK -------------------------------------------------------------
_NDK=""
for _candidate in \
    "${ANDROID_NDK:-}" \
    "${ANDROID_NDK_HOME:-}" \
    "${ANDROID_HOME:-}/ndk/$(ls "${ANDROID_HOME:-}/ndk/" 2>/dev/null | sort -V | tail -1)" \
    "${ANDROID_SDK_ROOT:-}/ndk/$(ls "${ANDROID_SDK_ROOT:-}/ndk/" 2>/dev/null | sort -V | tail -1)" \
    "$HOME/Library/Android/sdk/ndk/$(ls "$HOME/Library/Android/sdk/ndk/" 2>/dev/null | sort -V | tail -1)"; do
    if [[ -n "$_candidate" && -f "$_candidate/build/cmake/android.toolchain.cmake" ]]; then
        _NDK="$_candidate"
        break
    fi
done

if [[ -z "$_NDK" ]]; then
    echo "ERROR: Android NDK not found." >&2
    echo "Set ANDROID_NDK, ANDROID_NDK_HOME, or ANDROID_HOME." >&2
    exit 1
fi

TOOLCHAIN="$_NDK/build/cmake/android.toolchain.cmake"
echo "NDK: $_NDK"
echo "Toolchain: $TOOLCHAIN"

# -- prerequisites ----------------------------------------------------------
if [[ ! -d "$VENDOR_DIR" ]]; then
    echo "ERROR: GEOS source not found at $VENDOR_DIR" >&2
    echo "Run fetch-geos.sh first." >&2
    exit 1
fi

if ! command -v cmake &>/dev/null; then
    echo "ERROR: cmake not found in PATH" >&2
    exit 1
fi

JOBS="$(sysctl -n hw.logicalcpu 2>/dev/null || nproc 2>/dev/null || echo 4)"
echo "Using $JOBS parallel jobs."

# -- common CMake args ------------------------------------------------------
CMAKE_COMMON=(
    -DCMAKE_BUILD_TYPE=Release
    -DBUILD_SHARED_LIBS=OFF
    -DCMAKE_CXX_VISIBILITY_PRESET=hidden
    -DCMAKE_VISIBILITY_INLINES_HIDDEN=ON
    -DBUILD_TESTING=OFF
    -DBUILD_DOCUMENTATION=OFF
    -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN"
    -DANDROID_PLATFORM=android-24
    -DANDROID_STL=c++_shared
)

# -- build per ABI ----------------------------------------------------------
ABIS=("arm64-v8a" "x86_64")

for ABI in "${ABIS[@]}"; do
    echo ""
    echo "=== Building GEOS for Android $ABI ==="
    ABI_BUILD_DIR="$BUILD_DIR/$ABI"
    rm -rf "$ABI_BUILD_DIR"

    cmake -S "$VENDOR_DIR" -B "$ABI_BUILD_DIR" \
        "${CMAKE_COMMON[@]}" \
        -DANDROID_ABI="$ABI"

    cmake --build "$ABI_BUILD_DIR" --target geos_c -j"$JOBS"

    GEO_LIB="$ABI_BUILD_DIR/lib/libgeos.a"
    GEOC_LIB="$ABI_BUILD_DIR/lib/libgeos_c.a"
    echo "libgeos.a:   $(du -h "$GEO_LIB" | cut -f1)"
    echo "libgeos_c.a: $(du -h "$GEOC_LIB" | cut -f1)"

    # Combine into a single static library.
    COMBINED="$ABI_BUILD_DIR/lib/libgeos-combined.a"
    echo "Combining into $COMBINED ..."

    # Use the NDK's toolchain utilities for merging.
    _AR="$_NDK/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ar"
    if [[ ! -f "$_AR" ]]; then
        # Fall back to macOS libtool if NDK host tools aren't available.
        libtool -static -o "$COMBINED" "$GEO_LIB" "$GEOC_LIB"
    else
        # Use a thin archive via MRI script for maximum compatibility.
        _MRI="/tmp/geos-merge-$ABI.mri"
        echo "CREATE $COMBINED" > "$_MRI"
        echo "ADDLIB $GEO_LIB" >> "$_MRI"
        echo "ADDLIB $GEOC_LIB" >> "$_MRI"
        echo "SAVE" >> "$_MRI"
        echo "END" >> "$_MRI"
        "$_AR" -M < "$_MRI"
        rm -f "$_MRI"
    fi

    echo "combined:     $(du -h "$COMBINED" | cut -f1)"

    # Strip debug symbols to reduce binary size.
    _STRIP="$_NDK/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-strip"
    if [[ -f "$_STRIP" ]]; then
        "$_STRIP" -S "$COMBINED" 2>/dev/null || true
    fi

    # Install into output directory.
    mkdir -p "$OUTPUT_DIR/$ABI"
    cp "$COMBINED" "$OUTPUT_DIR/$ABI/libgeos.a"
    echo "Installed: $OUTPUT_DIR/$ABI/libgeos.a ($(du -h "$OUTPUT_DIR/$ABI/libgeos.a" | cut -f1))"

    # Copy the generated C API header (needed by the Expo Module).
    HEADER_DIR="$OUTPUT_DIR/include"
    mkdir -p "$HEADER_DIR"
    cp "$ABI_BUILD_DIR/capi/geos_c.h" "$HEADER_DIR/"
    cp "$VENDOR_DIR/include/geos/export.h" "$HEADER_DIR/"
done

echo ""
echo "=== Done ==="
echo ""
for ABI in "${ABIS[@]}"; do
    LIB="$OUTPUT_DIR/$ABI/libgeos.a"
    if [[ -f "$LIB" ]]; then
        echo "  $ABI: $(du -h "$LIB" | cut -f1)"
    fi
done
echo "  headers: $OUTPUT_DIR/include/"

# -- symbol check -----------------------------------------------------------
echo ""
echo "=== C API symbol check (arm64-v8a) ==="
_LLVM_NM="$_NDK/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-nm"
SYM_COUNT=0
if [[ -f "$_LLVM_NM" ]]; then
    SYM_COUNT="$("$_LLVM_NM" -g "$OUTPUT_DIR/arm64-v8a/libgeos.a" 2>/dev/null | grep -c " T GEOS" || true)"
    echo "C API symbols exported: $SYM_COUNT"
    if [[ "$SYM_COUNT" -lt 5 ]]; then
        echo "WARNING: fewer than 5 GEOS C API symbols found — something may be wrong." >&2
    fi
else
    echo "Skipping (llvm-nm not found in NDK)."
fi
