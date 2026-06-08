#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# build-geos-ios.sh — compile GEOS as a static xcframework for iOS
#
# Builds two thin static libraries (arm64 device + arm64 simulator) and
# packages them into modules/native-geometry/ios/libgeos.xcframework.
#
# Prerequisites:
#   - Xcode CLI tools (xcodebuild, cmake, libtool)
#   - GEOS source extracted at vendor/geos/ (run fetch-geos.sh first)
#
# Usage:
#   bash modules/native-geometry/scripts/build-geos-ios.sh
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/vendor/geos"
BUILD_DIR="$ROOT_DIR/ios/build"
XCFRAMEWORK_DIR="$ROOT_DIR/ios/libgeos.xcframework"
DEPLOYMENT_TARGET="18.0"

# -- prerequisites ----------------------------------------------------------
if [[ ! -d "$VENDOR_DIR" ]]; then
    echo "ERROR: GEOS source not found at $VENDOR_DIR" >&2
    echo "Run fetch-geos.sh first." >&2
    exit 1
fi

for tool in cmake xcodebuild libtool; do
    if ! command -v "$tool" &>/dev/null; then
        echo "ERROR: $tool not found in PATH" >&2
        exit 1
    fi
done

JOBS="$(sysctl -n hw.logicalcpu)"
echo "Using $JOBS parallel jobs."

# -- common CMake args (minus arch/sysroot) ----------------------------------
CMAKE_COMMON=(
    -DCMAKE_BUILD_TYPE=Release
    -DBUILD_SHARED_LIBS=OFF
    -DCMAKE_CXX_VISIBILITY_PRESET=hidden
    -DCMAKE_VISIBILITY_INLINES_HIDDEN=ON
    -DBUILD_TESTING=OFF
    -DBUILD_DOCUMENTATION=OFF
)

# -- device slice (arm64, iphoneos) ------------------------------------------
echo ""
echo "=== Building GEOS for iOS device (arm64) ==="
rm -rf "$BUILD_DIR/device"
cmake -S "$VENDOR_DIR" -B "$BUILD_DIR/device" \
    "${CMAKE_COMMON[@]}" \
    -DCMAKE_OSX_ARCHITECTURES=arm64 \
    -DCMAKE_OSX_SYSROOT=iphoneos \
    -DCMAKE_OSX_DEPLOYMENT_TARGET="$DEPLOYMENT_TARGET"

# Build both the C++ library and the C API wrapper.
cmake --build "$BUILD_DIR/device" --target geos_c -j"$JOBS"

DEVICE_LIB="$BUILD_DIR/device/lib/libgeos.a"
DEVICE_C_LIB="$BUILD_DIR/device/lib/libgeos_c.a"
echo "libgeos.a:    $(du -h "$DEVICE_LIB" | cut -f1)"
echo "libgeos_c.a:  $(du -h "$DEVICE_C_LIB" | cut -f1)"

# -- simulator slice (arm64, iphonesimulator) --------------------------------
echo ""
echo "=== Building GEOS for iOS simulator (arm64) ==="
rm -rf "$BUILD_DIR/simulator"
cmake -S "$VENDOR_DIR" -B "$BUILD_DIR/simulator" \
    "${CMAKE_COMMON[@]}" \
    -DCMAKE_OSX_ARCHITECTURES=arm64 \
    -DCMAKE_OSX_SYSROOT=iphonesimulator \
    -DCMAKE_OSX_DEPLOYMENT_TARGET="$DEPLOYMENT_TARGET"

cmake --build "$BUILD_DIR/simulator" --target geos_c -j"$JOBS"

SIM_LIB="$BUILD_DIR/simulator/lib/libgeos.a"
SIM_C_LIB="$BUILD_DIR/simulator/lib/libgeos_c.a"
echo "libgeos.a:    $(du -h "$SIM_LIB" | cut -f1)"
echo "libgeos_c.a:  $(du -h "$SIM_C_LIB" | cut -f1)"

# -- combine libgeos + libgeos_c into a single fat .a ------------------------
# libtool (macOS) merges static libraries; xcframework expects one .a per slice.
echo ""
echo "=== Combining libgeos + libgeos_c into single static library ==="
DEVICE_FAT="$BUILD_DIR/device/lib/libgeos-combined.a"
SIM_FAT="$BUILD_DIR/simulator/lib/libgeos-combined.a"
libtool -static -o "$DEVICE_FAT" "$DEVICE_LIB" "$DEVICE_C_LIB"
libtool -static -o "$SIM_FAT" "$SIM_LIB" "$SIM_C_LIB"
echo "device combined:    $(du -h "$DEVICE_FAT" | cut -f1)"
echo "simulator combined: $(du -h "$SIM_FAT" | cut -f1)"

# -- xcframework -------------------------------------------------------------
echo ""
echo "=== Creating xcframework ==="
TMP_XCFRAMEWORK="$BUILD_DIR/libgeos.xcframework"
rm -rf "$TMP_XCFRAMEWORK"
xcodebuild -create-xcframework \
    -library "$DEVICE_FAT" \
    -library "$SIM_FAT" \
    -output "$TMP_XCFRAMEWORK"

# Copy GEOS C headers into the xcframework so the module can import them.
# geos_c.h is generated from geos_c.h.in during the CMake configure step.
for SLICE_PATH in "$BUILD_DIR/device" "$BUILD_DIR/simulator"; do
    if [[ "$SLICE_PATH" == *"device"* ]]; then
        SLICE="ios-arm64"
    else
        SLICE="ios-arm64-simulator"
    fi
    HEADERS="$TMP_XCFRAMEWORK/$SLICE/Headers"
    mkdir -p "$HEADERS"
    cp "$SLICE_PATH/capi/geos_c.h" "$HEADERS/"
    cp "$VENDOR_DIR/include/geos/export.h" "$HEADERS/"
done

# Plist content
PLIST="$TMP_XCFRAMEWORK/Info.plist"
cat > "$PLIST" <<'PLISTEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundlePackageType</key>
    <string>XFWK</string>
    <key>CFBundleIdentifier</key>
    <string>org.geos.libgeos</string>
    <key>AvailableLibraries</key>
    <array>
        <dict>
            <key>LibraryIdentifier</key>
            <string>ios-arm64</string>
            <key>LibraryPath</key>
            <string>libgeos-combined.a</string>
            <key>SupportedArchitectures</key>
            <array><string>arm64</string></array>
            <key>SupportedPlatform</key>
            <string>ios</string>
        </dict>
        <dict>
            <key>LibraryIdentifier</key>
            <string>ios-arm64-simulator</string>
            <key>LibraryPath</key>
            <string>libgeos-combined.a</string>
            <key>SupportedArchitectures</key>
            <array><string>arm64</string></array>
            <key>SupportedPlatform</key>
            <string>ios</string>
            <key>SupportedPlatformVariant</key>
            <string>simulator</string>
        </dict>
    </array>
</dict>
</plist>
PLISTEOF

# Atomic replace
rm -rf "$XCFRAMEWORK_DIR"
mkdir -p "$(dirname "$XCFRAMEWORK_DIR")"
mv "$TMP_XCFRAMEWORK" "$XCFRAMEWORK_DIR"

echo ""
echo "=== Done ==="
echo "xcframework: $XCFRAMEWORK_DIR"
du -sh "$XCFRAMEWORK_DIR"
echo ""
echo "Slices:"
for SLICE in ios-arm64 ios-arm64-simulator; do
    LIB="$XCFRAMEWORK_DIR/$SLICE/libgeos-combined.a"
    if [[ -f "$LIB" ]]; then
        echo "  $SLICE: $(du -h "$LIB" | cut -f1)"
    fi
done

# -- symbol check -----------------------------------------------------------
echo ""
echo "=== C API symbol check ==="
C_API_COUNT="$(nm -g "$XCFRAMEWORK_DIR/ios-arm64/libgeos-combined.a" 2>/dev/null | grep -c " T _GEOS" || true)"
echo "C API symbols exported: $C_API_COUNT"
if [[ "$C_API_COUNT" -lt 5 ]]; then
    echo "WARNING: fewer than 5 GEOS C API symbols found — something may be wrong." >&2
fi
