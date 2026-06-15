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
/// Depends only on Foundation + the GEOS C bridge — no ExpoModulesCore —
/// so XCTest targets can compile and link GeosCore standalone.
public enum GeosCore {

    // MARK: - Context

    private static var _geosContext: GEOSContextHandle_t?
    private static let _geosContextLock = NSLock()

    /// Thread-safe access to the GEOS context (created once on first use).
    public static func geosContext() -> GEOSContextHandle_t {
        if let ctx = _geosContext { return ctx }

        _geosContextLock.lock()
        defer { _geosContextLock.unlock() }

        if let ctx = _geosContext { return ctx }

        guard let ctx = GEOS_init_r() else {
            fatalError("[GeosCore] GEOS_init_r returned nil")
        }
        let noticeCb: GEOSMessageHandler_r = { (msg, _) in
            if let msg = msg { NSLog("[GEOS notice] %s", msg) }
        }
        let errorCb: GEOSMessageHandler_r = { (msg, _) in
            if let msg = msg { NSLog("[GEOS error] %s", msg) }
        }
        GEOSContext_setNoticeMessageHandler_r(ctx, noticeCb, nil)
        GEOSContext_setErrorMessageHandler_r(ctx, errorCb, nil)
        _geosContext = ctx
        return ctx
    }

    // MARK: - Version

    public static func version() -> String {
        guard let v = GEOSversion() else { return "unknown" }
        return String(cString: v)
    }

    // MARK: - Buffer

    /// Buffer a WKB geometry by `distance` with `quadrantSegments` arc fidelity.
    /// Returns the buffered WKB or nil on failure.
    public static func buffer(
        wkb: Data,
        distance: Double,
        quadrantSegments: Int
    ) -> Data? {
        let ctx = geosContext()

        #if DEBUG
        let tTotal0 = CFAbsoluteTimeGetCurrent()
        let tParse0 = CFAbsoluteTimeGetCurrent()
        #endif
        guard let rawGeom = wkb.withUnsafeBytes({ (ptr: UnsafeRawBufferPointer) -> OpaquePointer? in
            guard let base = ptr.baseAddress else { return nil }
            return GEOSGeomFromWKB_buf_r(ctx, base, ptr.count)
        }) else {
            NSLog("[GeosCore] buffer: failed to parse WKB")
            return nil
        }
        #if DEBUG
        let tParseMs = (CFAbsoluteTimeGetCurrent() - tParse0) * 1000
        #endif

        var geom: OpaquePointer? = rawGeom
        defer {
            if let g = geom { GEOSGeom_destroy_r(ctx, g) }
        }

        #if DEBUG
        let tValid0 = CFAbsoluteTimeGetCurrent()
        var tMakeValidMs: Double = 0
        #endif
        let valid = GEOSisValid_r(ctx, geom!)
        #if DEBUG
        let tValidMs = (CFAbsoluteTimeGetCurrent() - tValid0) * 1000
        #endif
        if valid != 1 {
            NSLog("[GeosCore] buffer: geometry invalid — attempting MakeValid")
            #if DEBUG
            let tMake0 = CFAbsoluteTimeGetCurrent()
            #endif
            guard let fixed = GEOSMakeValid_r(ctx, geom!) else { return nil }
            #if DEBUG
            tMakeValidMs = (CFAbsoluteTimeGetCurrent() - tMake0) * 1000
            #endif
            GEOSGeom_destroy_r(ctx, geom!)
            geom = fixed
        }

        #if DEBUG
        let tBuffer0 = CFAbsoluteTimeGetCurrent()
        #endif
        let result = bufferAndWrite(
            ctx: ctx, geom: geom!, distance: distance,
            quadrantSegments: Int32(quadrantSegments))
        #if DEBUG
        let tBufferMs = (CFAbsoluteTimeGetCurrent() - tBuffer0) * 1000
        let tTotalMs = (CFAbsoluteTimeGetCurrent() - tTotal0) * 1000
        NSLog("[GeosCore] buffer parse=%.2fms valid=%.2fms makeValid=%.2fms buffer+write=%.2fms total=%.2fms (wkb=%ld bytes, qs=%ld)",
              tParseMs, tValidMs, tMakeValidMs, tBufferMs, tTotalMs,
              wkb.count, quadrantSegments)
        #endif

        return result
    }

    // MARK: - Binary overlay ops

    public static func difference(wkbA: Data, wkbB: Data) -> Data? {
        let ctx = geosContext()
        return binaryOpAndWrite(
            ctx: ctx, wkbA: wkbA, wkbB: wkbB,
            op: { GEOSDifference_r(ctx, $0, $1) },
            opName: "difference")
    }

    public static func union(wkbA: Data, wkbB: Data) -> Data? {
        let ctx = geosContext()
        return binaryOpAndWrite(
            ctx: ctx, wkbA: wkbA, wkbB: wkbB,
            op: { GEOSUnion_r(ctx, $0, $1) },
            opName: "union")
    }

    public static func intersection(wkbA: Data, wkbB: Data) -> Data? {
        let ctx = geosContext()
        return binaryOpAndWrite(
            ctx: ctx, wkbA: wkbA, wkbB: wkbB,
            op: { GEOSIntersection_r(ctx, $0, $1) },
            opName: "intersection")
    }

    // MARK: - Unary overlay ops

    public static func unaryUnion(wkb: Data) -> Data? {
        let ctx = geosContext()
        return unaryOpAndWrite(
            ctx: ctx, wkb: wkb,
            op: { GEOSUnaryUnion_r(ctx, $0) },
            opName: "unaryUnion")
    }

    // MARK: - Internal helpers

    /// Buffer a single GEOS geometry and write the result as WKB Data.
    ///
    /// Does **not** take ownership of `geom` — the caller owns it.
    static func bufferAndWrite(
        ctx: GEOSContextHandle_t,
        geom: OpaquePointer,
        distance: Double,
        quadrantSegments: Int32
    ) -> Data? {
        guard let params = GEOSBufferParams_create_r(ctx) else {
            NSLog("[GeosCore] buffer: failed to create buffer params")
            return nil
        }
        defer { GEOSBufferParams_destroy_r(ctx, params) }

        _ = GEOSBufferParams_setQuadrantSegments_r(ctx, params, quadrantSegments)
        _ = GEOSBufferParams_setEndCapStyle_r(ctx, params, Int32(GEOSBUF_CAP_ROUND.rawValue))
        _ = GEOSBufferParams_setJoinStyle_r(ctx, params, Int32(GEOSBUF_JOIN_ROUND.rawValue))

        guard let buffered = GEOSBufferWithParams_r(ctx, geom, params, distance) else {
            NSLog("[GeosCore] buffer: GEOSBufferWithParams_r failed")
            return nil
        }
        defer { GEOSGeom_destroy_r(ctx, buffered) }

        var wkbSize: Int = 0
        guard let wkbPtr = GEOSGeomToWKB_buf_r(ctx, buffered, &wkbSize) else {
            NSLog("[GeosCore] buffer: failed to write WKB")
            return nil
        }
        defer { GEOSFree_r(ctx, wkbPtr) }

        return Data(bytes: wkbPtr, count: wkbSize)
    }

    /// Binary overlay op: parse → validate → op → write → free.
    static func binaryOpAndWrite(
        ctx: GEOSContextHandle_t,
        wkbA: Data,
        wkbB: Data,
        op: (OpaquePointer, OpaquePointer) -> OpaquePointer?,
        opName: String
    ) -> Data? {
        #if DEBUG
        let tTotal0 = CFAbsoluteTimeGetCurrent()
        let tParseA0 = CFAbsoluteTimeGetCurrent()
        #endif

        guard let rawGeomA = wkbA.withUnsafeBytes({ (ptr: UnsafeRawBufferPointer) -> OpaquePointer? in
            guard let base = ptr.baseAddress else { return nil }
            return GEOSGeomFromWKB_buf_r(ctx, base, ptr.count)
        }) else {
            NSLog("[GeosCore] %@: failed to parse WKB A", opName)
            return nil
        }
        #if DEBUG
        let tParseAMs = (CFAbsoluteTimeGetCurrent() - tParseA0) * 1000
        #endif
        var geomA: OpaquePointer? = rawGeomA
        defer {
            if let g = geomA { GEOSGeom_destroy_r(ctx, g) }
        }

        #if DEBUG
        let tParseB0 = CFAbsoluteTimeGetCurrent()
        #endif
        guard let rawGeomB = wkbB.withUnsafeBytes({ (ptr: UnsafeRawBufferPointer) -> OpaquePointer? in
            guard let base = ptr.baseAddress else { return nil }
            return GEOSGeomFromWKB_buf_r(ctx, base, ptr.count)
        }) else {
            NSLog("[GeosCore] %@: failed to parse WKB B", opName)
            return nil
        }
        #if DEBUG
        let tParseBMs = (CFAbsoluteTimeGetCurrent() - tParseB0) * 1000
        let tParseMs = tParseAMs + tParseBMs
        #endif
        var geomB: OpaquePointer? = rawGeomB
        defer {
            if let g = geomB { GEOSGeom_destroy_r(ctx, g) }
        }

        #if DEBUG
        let tValid0 = CFAbsoluteTimeGetCurrent()
        #endif
        let validA = GEOSisValid_r(ctx, geomA!)
        if validA != 1 {
            NSLog("[GeosCore] %@: input A invalid — attempting MakeValid", opName)
            guard let fixed = GEOSMakeValid_r(ctx, geomA!) else { return nil }
            GEOSGeom_destroy_r(ctx, geomA!)
            geomA = fixed
        }

        let validB = GEOSisValid_r(ctx, geomB!)
        if validB != 1 {
            NSLog("[GeosCore] %@: input B invalid — attempting MakeValid", opName)
            guard let fixed = GEOSMakeValid_r(ctx, geomB!) else { return nil }
            GEOSGeom_destroy_r(ctx, geomB!)
            geomB = fixed
        }
        #if DEBUG
        let tValidMs = (CFAbsoluteTimeGetCurrent() - tValid0) * 1000
        #endif

        #if DEBUG
        let tOp0 = CFAbsoluteTimeGetCurrent()
        #endif
        guard let resultGeom = op(geomA!, geomB!) else {
            NSLog("[GeosCore] %@: GEOS op returned null (empty result)", opName)
            return nil
        }
        defer { GEOSGeom_destroy_r(ctx, resultGeom) }
        #if DEBUG
        let tOpMs = (CFAbsoluteTimeGetCurrent() - tOp0) * 1000
        #endif

        var wkbSize: Int = 0
        guard let wkbPtr = GEOSGeomToWKB_buf_r(ctx, resultGeom, &wkbSize) else {
            NSLog("[GeosCore] %@: failed to write output WKB", opName)
            return nil
        }
        defer { GEOSFree_r(ctx, wkbPtr) }

        #if DEBUG
        let tTotalMs = (CFAbsoluteTimeGetCurrent() - tTotal0) * 1000
        NSLog("[GeosCore] %@ parse=%.2fms valid=%.2fms op=%.2fms total=%.2fms (wkbA=%ld bytes, wkbB=%ld bytes)",
              opName, tParseMs, tValidMs, tOpMs, tTotalMs,
              wkbA.count, wkbB.count)
        #endif

        return Data(bytes: wkbPtr, count: wkbSize)
    }

    /// Unary overlay op: parse → validate → op → write → free.
    static func unaryOpAndWrite(
        ctx: GEOSContextHandle_t,
        wkb: Data,
        op: (OpaquePointer) -> OpaquePointer?,
        opName: String
    ) -> Data? {
        #if DEBUG
        let tTotal0 = CFAbsoluteTimeGetCurrent()
        #endif

        guard let rawGeom = wkb.withUnsafeBytes({ (ptr: UnsafeRawBufferPointer) -> OpaquePointer? in
            guard let base = ptr.baseAddress else { return nil }
            return GEOSGeomFromWKB_buf_r(ctx, base, ptr.count)
        }) else {
            NSLog("[GeosCore] %@: failed to parse WKB", opName)
            return nil
        }
        var geom: OpaquePointer? = rawGeom
        defer {
            if let g = geom { GEOSGeom_destroy_r(ctx, g) }
        }

        let valid = GEOSisValid_r(ctx, geom!)
        if valid != 1 {
            NSLog("[GeosCore] %@: geometry invalid — attempting MakeValid", opName)
            guard let fixed = GEOSMakeValid_r(ctx, geom!) else { return nil }
            GEOSGeom_destroy_r(ctx, geom!)
            geom = fixed
        }

        guard let resultGeom = op(geom!) else {
            NSLog("[GeosCore] %@: GEOS op returned null (empty result)", opName)
            return nil
        }
        defer { GEOSGeom_destroy_r(ctx, resultGeom) }

        var wkbSize: Int = 0
        guard let wkbPtr = GEOSGeomToWKB_buf_r(ctx, resultGeom, &wkbSize) else {
            NSLog("[GeosCore] %@: failed to write output WKB", opName)
            return nil
        }
        defer { GEOSFree_r(ctx, wkbPtr) }

        #if DEBUG
        let tTotalMs = (CFAbsoluteTimeGetCurrent() - tTotal0) * 1000
        NSLog("[GeosCore] %@ total=%.2fms (wkb=%ld bytes)",
              opName, tTotalMs, wkb.count)
        #endif

        return Data(bytes: wkbPtr, count: wkbSize)
    }
}
