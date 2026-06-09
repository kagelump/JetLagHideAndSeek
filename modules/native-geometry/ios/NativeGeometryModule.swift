import ExpoModulesCore

// GEOS C API symbols (GEOSversion, GEOSinit_r, etc.) are available directly
// because geos_bridge.h is listed in the pod's source_files and the
// umbrella header includes it. No `import GEOS` needed.

// ---------------------------------------------------------------------------
// G2 production module — GEOS-backed bufferWKB replacing the G1 smoke test.
// ---------------------------------------------------------------------------

/// Global GEOS context handle (reentrant). Created once on first use.
private var _geosContext: GEOSContextHandle_t? = nil
private let _geosContextLock = NSLock()

/// Thread-safe access to the GEOS context.
private func geosContext() -> GEOSContextHandle_t {
    // Fast path: context already created.
    if let ctx = _geosContext { return ctx }

    _geosContextLock.lock()
    defer { _geosContextLock.unlock() }

    // Double-check after acquiring the lock.
    if let ctx = _geosContext { return ctx }

    guard let ctx = GEOS_init_r() else {
        // GEOS_init_r returns nil on allocation failure.
        fatalError("[NativeGeometry] GEOS_init_r returned nil")
    }
    // Install notice + error handlers that log instead of printing to stderr.
    let noticeCb: GEOSMessageHandler_r = { (msg, _) in
        if let msg = msg {
            NSLog("[GEOS notice] %s", msg)
        }
    }
    let errorCb: GEOSMessageHandler_r = { (msg, _) in
        if let msg = msg {
            NSLog("[GEOS error] %s", msg)
        }
    }
    GEOSContext_setNoticeMessageHandler_r(ctx, noticeCb, nil)
    GEOSContext_setErrorMessageHandler_r(ctx, errorCb, nil)
    _geosContext = ctx
    return ctx
}

/// Buffer a single GEOS geometry and write the result as WKB Data.
///
/// Does **not** take ownership of `geom` — the caller (or its `defer`) owns
/// the geometry and must destroy it exactly once. This function treats `geom`
/// as read-only for the GEOS buffer operation and does not free it.
private func _bufferAndWrite(
    ctx: GEOSContextHandle_t,
    geom: OpaquePointer,
    distance: Double,
    quadrantSegments: Int32
) -> Data? {
    // Create buffer parameters with JSTS-matching defaults.
    guard let params = GEOSBufferParams_create_r(ctx) else {
        NSLog("[NativeGeometry] buffer: failed to create buffer params")
        return nil
    }
    defer { GEOSBufferParams_destroy_r(ctx, params) }

    _ = GEOSBufferParams_setQuadrantSegments_r(ctx, params, quadrantSegments)
    _ = GEOSBufferParams_setEndCapStyle_r(ctx, params, Int32(GEOSBUF_CAP_ROUND.rawValue))
    _ = GEOSBufferParams_setJoinStyle_r(ctx, params, Int32(GEOSBUF_JOIN_ROUND.rawValue))
    // Leave mitre limit at GEOS default (matches JSTS default).

    guard let buffered = GEOSBufferWithParams_r(ctx, geom, params, distance) else {
        NSLog("[NativeGeometry] buffer: GEOSBufferWithParams_r failed")
        return nil
    }
    defer { GEOSGeom_destroy_r(ctx, buffered) }

    // Write GEOS geometry → WKB.
    var wkbSize: Int = 0
    guard let wkbPtr = GEOSGeomToWKB_buf_r(ctx, buffered, &wkbSize) else {
        NSLog("[NativeGeometry] buffer: failed to write WKB")
        return nil
    }
    defer { GEOSFree_r(ctx, wkbPtr) }

    return Data(bytes: wkbPtr, count: wkbSize)
}

/// Binary overlay op helper: parse → validate → op → write → free.
///
/// Memory ownership is the riskiest part of native overlay code — two input
/// geometries, each possibly reassigned on MakeValid, plus the result. Every
/// pointer is destroyed exactly once via defer (LIFO cleanup).
///
/// - Parameters:
///   - wkbA, wkbB: Input WKB data.
///   - op: GEOS binary operation (e.g. `GEOSDifference_r`).
///   - opName: Human-readable name for debug logging.
private func _binaryOpAndWrite(
    ctx: GEOSContextHandle_t,
    wkbA: Data,
    wkbB: Data,
    op: (OpaquePointer, OpaquePointer) -> OpaquePointer?,
    opName: String
) -> Data? {
    #if DEBUG
    let tTotal0 = CFAbsoluteTimeGetCurrent()
    #endif

    // ── Parse A ──────────────────────────────────────────────────────────
    #if DEBUG
    let tParseA0 = CFAbsoluteTimeGetCurrent()
    #endif
    guard let rawGeomA = wkbA.withUnsafeBytes({ (ptr: UnsafeRawBufferPointer) -> OpaquePointer? in
        guard let base = ptr.baseAddress else { return nil }
        return GEOSGeomFromWKB_buf_r(ctx, base, ptr.count)
    }) else {
        NSLog("[NativeGeometry] %@: failed to parse WKB A", opName)
        return nil
    }
    #if DEBUG
    let tParseAMs = (CFAbsoluteTimeGetCurrent() - tParseA0) * 1000
    #endif
    var geomA: OpaquePointer? = rawGeomA
    defer {
        if let g = geomA { GEOSGeom_destroy_r(ctx, g) }
    }

    // ── Parse B ──────────────────────────────────────────────────────────
    #if DEBUG
    let tParseB0 = CFAbsoluteTimeGetCurrent()
    #endif
    guard let rawGeomB = wkbB.withUnsafeBytes({ (ptr: UnsafeRawBufferPointer) -> OpaquePointer? in
        guard let base = ptr.baseAddress else { return nil }
        return GEOSGeomFromWKB_buf_r(ctx, base, ptr.count)
    }) else {
        NSLog("[NativeGeometry] %@: failed to parse WKB B", opName)
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

    // ── Validate A ───────────────────────────────────────────────────────
    #if DEBUG
    let tValid0 = CFAbsoluteTimeGetCurrent()
    var tMakeValidMs: Double = 0
    #endif
    let validA = GEOSisValid_r(ctx, geomA!)
    if validA != 1 {
        NSLog("[NativeGeometry] %@: input A invalid — attempting MakeValid", opName)
        guard let fixed = GEOSMakeValid_r(ctx, geomA!) else {
            return nil
        }
        GEOSGeom_destroy_r(ctx, geomA!)
        geomA = fixed
    }

    // ── Validate B ───────────────────────────────────────────────────────
    let validB = GEOSisValid_r(ctx, geomB!)
    if validB != 1 {
        NSLog("[NativeGeometry] %@: input B invalid — attempting MakeValid", opName)
        guard let fixed = GEOSMakeValid_r(ctx, geomB!) else {
            return nil
        }
        GEOSGeom_destroy_r(ctx, geomB!)
        geomB = fixed
    }
    #if DEBUG
    let tValidMs = (CFAbsoluteTimeGetCurrent() - tValid0) * 1000
    #endif

    // ── GEOS binary op ───────────────────────────────────────────────────
    #if DEBUG
    let tOp0 = CFAbsoluteTimeGetCurrent()
    #endif
    guard let resultGeom = op(geomA!, geomB!) else {
        NSLog("[NativeGeometry] %@: GEOS op returned null (empty result)", opName)
        return nil
    }
    defer { GEOSGeom_destroy_r(ctx, resultGeom) }
    #if DEBUG
    let tOpMs = (CFAbsoluteTimeGetCurrent() - tOp0) * 1000
    #endif

    // ── Write WKB ────────────────────────────────────────────────────────
    var wkbSize: Int = 0
    guard let wkbPtr = GEOSGeomToWKB_buf_r(ctx, resultGeom, &wkbSize) else {
        NSLog("[NativeGeometry] %@: failed to write output WKB", opName)
        return nil
    }
    defer { GEOSFree_r(ctx, wkbPtr) }

    #if DEBUG
    let tTotalMs = (CFAbsoluteTimeGetCurrent() - tTotal0) * 1000
    NSLog("[NativeGeometry] %@ parse=%.2fms valid=%.2fms makeValid=%.2fms op=%.2fms total=%.2fms (wkbA=%ld bytes, wkbB=%ld bytes)",
          opName, tParseMs, tValidMs, tMakeValidMs, tOpMs, tTotalMs,
          wkbA.count, wkbB.count)
    #endif

    return Data(bytes: wkbPtr, count: wkbSize)
}

/// Unary overlay op helper: parse → validate → op → write → free.
///
/// Same pattern as `_bufferAndWrite` but for GEOS unary operations
/// (e.g. `GEOSUnaryUnion_r`).
private func _unaryOpAndWrite(
    ctx: GEOSContextHandle_t,
    wkb: Data,
    op: (OpaquePointer) -> OpaquePointer?,
    opName: String
) -> Data? {
    #if DEBUG
    let tTotal0 = CFAbsoluteTimeGetCurrent()
    #endif

    // ── Parse ────────────────────────────────────────────────────────────
    guard let rawGeom = wkb.withUnsafeBytes({ (ptr: UnsafeRawBufferPointer) -> OpaquePointer? in
        guard let base = ptr.baseAddress else { return nil }
        return GEOSGeomFromWKB_buf_r(ctx, base, ptr.count)
    }) else {
        NSLog("[NativeGeometry] %@: failed to parse WKB", opName)
        return nil
    }
    var geom: OpaquePointer? = rawGeom
    defer {
        if let g = geom { GEOSGeom_destroy_r(ctx, g) }
    }

    // ── Validate ─────────────────────────────────────────────────────────
    let valid = GEOSisValid_r(ctx, geom!)
    if valid != 1 {
        NSLog("[NativeGeometry] %@: geometry invalid — attempting MakeValid", opName)
        guard let fixed = GEOSMakeValid_r(ctx, geom!) else {
            return nil
        }
        GEOSGeom_destroy_r(ctx, geom!)
        geom = fixed
    }

    // ── GEOS unary op ────────────────────────────────────────────────────
    guard let resultGeom = op(geom!) else {
        NSLog("[NativeGeometry] %@: GEOS op returned null (empty result)", opName)
        return nil
    }
    defer { GEOSGeom_destroy_r(ctx, resultGeom) }

    // ── Write WKB ────────────────────────────────────────────────────────
    var wkbSize: Int = 0
    guard let wkbPtr = GEOSGeomToWKB_buf_r(ctx, resultGeom, &wkbSize) else {
        NSLog("[NativeGeometry] %@: failed to write output WKB", opName)
        return nil
    }
    defer { GEOSFree_r(ctx, wkbPtr) }

    #if DEBUG
    let tTotalMs = (CFAbsoluteTimeGetCurrent() - tTotal0) * 1000
    NSLog("[NativeGeometry] %@ total=%.2fms (wkb=%ld bytes)",
          opName, tTotalMs, wkb.count)
    #endif

    return Data(bytes: wkbPtr, count: wkbSize)
}

public class NativeGeometryModule: Module {
    public func definition() -> ModuleDefinition {
        Name("NativeGeometry")

        // -- Diagnostics: GEOS library version --------------------------------
        Function("geosVersion") { () -> String in
            guard let version = GEOSversion() else {
                return "unknown"
            }
            return String(cString: version)
        }

        // -- ABI version handshake (G5 follow-up) ------------------------------
        // Bump whenever the WKB function surface changes (e.g. new overlay ops).
        // JS side has EXPECTED_NATIVE_ABI; mismatch → loud rebuild warning.
        Function("nativeAbiVersion") { () -> Int in
            return 2 // G5 overlay ops
        }

        // -- Production: buffer WKB geometry ----------------------------------
        // Buffers a little-endian WKB geometry by `distance` (in input units)
        // with `quadrantSegments` arc fidelity. Returns the buffered WKB or
        // null on failure.
        //
        // Uses a single owning pointer, reassigned on MakeValid, destroyed once
        // at the end — no double-free (the G1 smokeTest bug is not carried forward).
        Function("bufferWKB") {
            (wkb: Data, distance: Double, quadrantSegments: Int) -> Data? in
            #if DEBUG
            let tTotal0 = CFAbsoluteTimeGetCurrent()
            #endif
            let ctx = geosContext()

            // Read WKB → GEOS geometry.
            #if DEBUG
            let tParse0 = CFAbsoluteTimeGetCurrent()
            #endif
            guard let rawGeom = wkb.withUnsafeBytes({ (ptr: UnsafeRawBufferPointer) -> OpaquePointer? in
                guard let base = ptr.baseAddress else { return nil }
                return GEOSGeomFromWKB_buf_r(ctx, base, ptr.count)
            }) else {
                NSLog("[NativeGeometry] bufferWKB: failed to parse WKB")
                return nil
            }
            #if DEBUG
            let tParseMs = (CFAbsoluteTimeGetCurrent() - tParse0) * 1000
            #endif

            // Own the geometry pointer — mutating so we can reassign on MakeValid.
            var geom: OpaquePointer? = rawGeom
            defer {
                if let g = geom {
                    GEOSGeom_destroy_r(ctx, g)
                }
            }

            // Validate; attempt MakeValid if invalid.
            // GEOSisValid_r returns 1 (valid), 0 (invalid), or 2 (exception).
            #if DEBUG
            let tValid0 = CFAbsoluteTimeGetCurrent()
            #endif
            let valid = GEOSisValid_r(ctx, geom!)
            #if DEBUG
            let tValidMs = (CFAbsoluteTimeGetCurrent() - tValid0) * 1000
            var tMakeValidMs: Double = 0
            #endif
            if valid != 1 {
                NSLog("[NativeGeometry] bufferWKB: geometry invalid — attempting MakeValid")
                #if DEBUG
                let tMake0 = CFAbsoluteTimeGetCurrent()
                #endif
                guard let fixed = GEOSMakeValid_r(ctx, geom!) else {
                    return nil
                }
                #if DEBUG
                tMakeValidMs = (CFAbsoluteTimeGetCurrent() - tMake0) * 1000
                #endif
                // Destroy the original invalid geometry; take ownership of the fixed one.
                GEOSGeom_destroy_r(ctx, geom!)
                geom = fixed
            }

            #if DEBUG
            let tBuffer0 = CFAbsoluteTimeGetCurrent()
            #endif
            let result = _bufferAndWrite(
                ctx: ctx,
                geom: geom!,
                distance: distance,
                quadrantSegments: Int32(quadrantSegments)
            )
            #if DEBUG
            let tBufferMs = (CFAbsoluteTimeGetCurrent() - tBuffer0) * 1000
            let tTotalMs = (CFAbsoluteTimeGetCurrent() - tTotal0) * 1000

            NSLog("[NativeGeometry] bufferWKB parse=%.2fms valid=%.2fms makeValid=%.2fms buffer+write=%.2fms total=%.2fms (wkb=%ld bytes, qs=%d)",
                  tParseMs, tValidMs, tMakeValidMs, tBufferMs, tTotalMs,
                  wkb.count, quadrantSegments)
            #endif

            return result
        }

        // -- Overlay ops: binary (difference, union, intersection) -----------
        Function("differenceWKB") {
            (wkbA: Data, wkbB: Data) -> Data? in
            let ctx = geosContext()
            return _binaryOpAndWrite(
                ctx: ctx,
                wkbA: wkbA,
                wkbB: wkbB,
                op: { GEOSDifference_r(ctx, $0, $1) },
                opName: "differenceWKB"
            )
        }

        Function("unionWKB") {
            (wkbA: Data, wkbB: Data) -> Data? in
            let ctx = geosContext()
            return _binaryOpAndWrite(
                ctx: ctx,
                wkbA: wkbA,
                wkbB: wkbB,
                op: { GEOSUnion_r(ctx, $0, $1) },
                opName: "unionWKB"
            )
        }

        Function("intersectionWKB") {
            (wkbA: Data, wkbB: Data) -> Data? in
            let ctx = geosContext()
            return _binaryOpAndWrite(
                ctx: ctx,
                wkbA: wkbA,
                wkbB: wkbB,
                op: { GEOSIntersection_r(ctx, $0, $1) },
                opName: "intersectionWKB"
            )
        }

        // -- Overlay op: unary union -----------------------------------------
        Function("unaryUnionWKB") {
            (wkb: Data) -> Data? in
            let ctx = geosContext()
            return _unaryOpAndWrite(
                ctx: ctx,
                wkb: wkb,
                op: { GEOSUnaryUnion_r(ctx, $0) },
                opName: "unaryUnionWKB"
            )
        }
    }
}
