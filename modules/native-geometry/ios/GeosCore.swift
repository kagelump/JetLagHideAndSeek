import Foundation
// In the standalone SPM test package the GEOS C API is its own module (named
// `GEOS` via Sources/CGEOS/include/module.modulemap), so it must be imported.
// In the CocoaPods app build there is no `GEOS` module — `geos_bridge.h` is a
// pod source/public header, so the C symbols are already part of this pod's
// umbrella module and no import is needed (and `import GEOS` would fail to
// resolve). Guard the import so the file compiles in both builds.
#if canImport(GEOS)
    import GEOS
#endif

/// Stateless namespace for GEOS-backed geometry operations.
///
/// The parse → validate → MakeValid → op → write → free pipeline lives **once**
/// in the shared C core (`geos_ops.cpp`, exposed via `geos_ops.h`). This type
/// is now a thin marshalling shim: `Data` ⇄ `GeosWkbBuffer`. The same core
/// backs the Android `.so`, so behavioral changes happen in one place.
///
/// Depends only on Foundation + the GEOS C bridge — no ExpoModulesCore —
/// so XCTest targets can compile and link GeosCore standalone.
public enum GeosCore {

    // MARK: - Log handler

    /// Route GEOS notice/error diagnostics from the C core to NSLog. Evaluated
    /// once on first use of any op (the lazy static initializer runs at most
    /// once and is thread-safe).
    private static let installLog: Void = {
        geos_ops_set_log { msg in
            if let msg = msg { NSLog("[geos_ops] %s", msg) }
        }
    }()

    // MARK: - Context (verification only)

    private static var _geosContext: GEOSContextHandle_t?
    private static let _geosContextLock = NSLock()

    /// A GEOS context for callers that need to decode/inspect WKB directly
    /// (the XCTest verification path). The op functions use the core's own
    /// context — GEOS contexts are independent, so the two coexist safely.
    public static func geosContext() -> GEOSContextHandle_t {
        if let ctx = _geosContext { return ctx }

        _geosContextLock.lock()
        defer { _geosContextLock.unlock() }

        if let ctx = _geosContext { return ctx }

        guard let ctx = GEOS_init_r() else {
            fatalError("[GeosCore] GEOS_init_r returned nil")
        }
        _geosContext = ctx
        return ctx
    }

    // MARK: - Version

    public static func version() -> String {
        _ = installLog
        guard let v = geos_ops_version() else { return "unknown" }
        return String(cString: v)
    }

    // MARK: - Ops (thin shims over the C core)

    public static func buffer(
        wkb: Data,
        distance: Double,
        quadrantSegments: Int
    ) -> Data? {
        _ = installLog
        return wkb.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> Data? in
            let base = ptr.bindMemory(to: UInt8.self).baseAddress
            let result = geos_ops_buffer(base, ptr.count, distance, Int32(quadrantSegments))
            return takeData(result)
        }
    }

    public static func difference(wkbA: Data, wkbB: Data) -> Data? {
        binary(wkbA, wkbB) { a, la, b, lb in geos_ops_difference(a, la, b, lb) }
    }

    public static func union(wkbA: Data, wkbB: Data) -> Data? {
        binary(wkbA, wkbB) { a, la, b, lb in geos_ops_union(a, la, b, lb) }
    }

    public static func intersection(wkbA: Data, wkbB: Data) -> Data? {
        binary(wkbA, wkbB) { a, la, b, lb in geos_ops_intersection(a, la, b, lb) }
    }

    public static func unaryUnion(wkb: Data) -> Data? {
        _ = installLog
        return wkb.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> Data? in
            let base = ptr.bindMemory(to: UInt8.self).baseAddress
            let result = geos_ops_unary_union(base, ptr.count)
            return takeData(result)
        }
    }

    // MARK: - Internal helpers

    /// Run a binary overlay op, marshalling both inputs and the result.
    private static func binary(
        _ wkbA: Data,
        _ wkbB: Data,
        _ op: (UnsafePointer<UInt8>?, Int, UnsafePointer<UInt8>?, Int) -> GeosWkbBuffer
    ) -> Data? {
        _ = installLog
        return wkbA.withUnsafeBytes { (a: UnsafeRawBufferPointer) -> Data? in
            wkbB.withUnsafeBytes { (b: UnsafeRawBufferPointer) -> Data? in
                let result = op(
                    a.bindMemory(to: UInt8.self).baseAddress, a.count,
                    b.bindMemory(to: UInt8.self).baseAddress, b.count)
                return takeData(result)
            }
        }
    }

    /// Copy a `GeosWkbBuffer` into `Data` and free the C buffer. `nil` data
    /// (failure or empty/null result) maps to `nil`, matching the prior
    /// per-op return contract.
    private static func takeData(_ buffer: GeosWkbBuffer) -> Data? {
        guard let ptr = buffer.data, buffer.size > 0 else {
            geos_ops_free(buffer)
            return nil
        }
        let data = Data(bytes: ptr, count: buffer.size)
        geos_ops_free(buffer)
        return data
    }
}
