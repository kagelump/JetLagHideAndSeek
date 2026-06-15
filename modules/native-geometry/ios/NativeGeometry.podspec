Pod::Spec.new do |s|
  s.name           = "NativeGeometry"
  s.version        = "0.1.0"
  s.summary        = "GEOS-backed geometry operations (G1 smoke test)"
  s.homepage       = "https://github.com/raycatdev/jet-lag-hide-and-seek"
  s.license        = "MIT"
  s.author         = ""
  s.source         = { git: "" }
  s.platform       = :ios, "15.1"
  s.swift_version  = "5.9"

  # IMPORTANT: do NOT set a custom module_map here.
  # CocoaPods does not support custom module maps with Swift static libraries.
  # Instead, we import GEOS by including the bridge header as a source file
  # and relying on the auto-generated module map. Swift sees GEOS symbols
  # because geos_bridge.h is listed among the source files.

  # geos_ops.{h,cpp} is the shared GEOS op core compiled into the pod; Swift
  # reaches its C functions through geos_bridge.h (which includes geos_ops.h).
  s.source_files = "*.swift", "geos_bridge.h", "geos_ops.h", "geos_ops.cpp"
  s.public_header_files = "geos_bridge.h"

  # Vendored GEOS xcframework (committed artifact).
  s.vendored_frameworks = "libgeos.xcframework"

  s.dependency "ExpoModulesCore"

  # Link C++ standard library (GEOS is C++ under the hood). Pin the C++
  # standard so the shared core (geos_ops.cpp — lambdas, brace-init,
  # std::call_once) builds the same here as in the SPM target + Android NDK.
  s.pod_target_xcconfig = {
    "OTHER_LDFLAGS" => "-lc++",
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17"
  }
end
