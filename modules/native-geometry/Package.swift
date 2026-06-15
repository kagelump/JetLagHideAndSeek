// swift-tools-version: 6.0
import PackageDescription
import Foundation

// Resolve the xcframework path relative to this Package.swift.
let packageDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path
let geosLibDir = "\(packageDir)/ios/libgeos.xcframework/ios-arm64-simulator"

let package = Package(
    name: "NativeGeometryTests",
    platforms: [.iOS(.v18)],
    targets: [
        // C bridge module + the shared GEOS op core. geos_ops.cpp (symlinked
        // from ios/geos_ops.cpp) is the single source of the parse/validate/
        // op/write/free pipeline; SwiftPM auto-discovers it under the target
        // path. geos_bridge.h includes geos_ops.h so `import GEOS` exposes the
        // geos_ops_* C functions to GeosCore.swift. GEOS symbols it calls are
        // linked via -lgeos-combined at the test target below.
        .target(
            name: "CGEOS",
            path: "Sources/CGEOS",
            publicHeadersPath: "include"
        ),
        .target(
            name: "GeosCore",
            dependencies: ["CGEOS"],
            path: "Sources/GeosCore",
            swiftSettings: [
                .swiftLanguageMode(.v5),
            ]
        ),
        .testTarget(
            name: "GeosCoreTests",
            dependencies: ["GeosCore"],
            path: "Tests/GeosCoreTests",
            swiftSettings: [
                .swiftLanguageMode(.v5),
            ],
            linkerSettings: [
                .unsafeFlags([
                    "-L\(geosLibDir)",
                    "-lgeos-combined",
                    "-lc++",
                ]),
            ]
        ),
    ],
    // geos_ops.cpp uses C++11+ (lambdas, brace-init, std::call_once). Without
    // this, Xcode compiles the CGEOS target's C++ as gnu++98 and fails. Pinned
    // to match the Android NDK + pod (see CMakeLists.txt / the podspec) so the
    // one shared core builds identically on every native target.
    cxxLanguageStandard: .cxx17
)
