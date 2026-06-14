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
    ]
)
