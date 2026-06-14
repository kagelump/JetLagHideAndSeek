// swift-tools-version:6.0
import PackageDescription

// RQ-A1 spike: prove a standalone XCTest bundle can link the vendored GEOS
// static lib + the C bridge and call GEOS directly on the iOS simulator,
// without expo prebuild, the app, Pods, or code signing.
//
// NOTE: we intentionally do NOT use a `.binaryTarget` for libgeos.xcframework.
// Its Info.plist lacks `XCFrameworkFormatVersion`, which CocoaPods tolerates
// but Xcode's native xcframework decoder rejects ("Failed to decode XCFramework
// Info.plist ... missing"). Instead we link the simulator slice's static lib
// directly. This pins the spike to the simulator, which is exactly the target.
let simSliceDir =
    "/Users/ryantseng/projects/JetLagHideAndSeek/modules/native-geometry/ios/libgeos.xcframework/ios-arm64-simulator"

let package = Package(
    name: "GeosSpike",
    platforms: [.iOS(.v18)],
    targets: [
        // C module that exposes geos_c.h to Swift via geos_bridge.h.
        .target(name: "CGEOS"),
        // Swift surface that imports CGEOS and links the static GEOS slice.
        .target(
            name: "GeosSpike",
            dependencies: ["CGEOS"],
            linkerSettings: [
                .unsafeFlags(["-L\(simSliceDir)", "-lgeos-combined"]),
                .linkedLibrary("c++"),
            ]
        ),
        .testTarget(
            name: "GeosSpikeTests",
            dependencies: ["GeosSpike"]
        ),
    ]
)
