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

    let ctx = GEOS_init_r()
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
    _ = GEOSBufferParams_setEndCapStyle_r(ctx, params, GEOSBUF_CAP_ROUND)
    _ = GEOSBufferParams_setJoinStyle_r(ctx, params, GEOSBUF_JOIN_ROUND)
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

        // -- Production: buffer WKB geometry ----------------------------------
        // Buffers a little-endian WKB geometry by `distance` (in input units)
        // with `quadrantSegments` arc fidelity. Returns the buffered WKB or
        // null on failure.
        //
        // Uses a single owning pointer, reassigned on MakeValid, destroyed once
        // at the end — no double-free (the G1 smokeTest bug is not carried forward).
        Function("bufferWKB") {
            (wkb: Data, distance: Double, quadrantSegments: Int) -> Data? in
            let ctx = geosContext()

            // Read WKB → GEOS geometry.
            guard let rawGeom = wkb.withUnsafeBytes({ (ptr: UnsafeRawBufferPointer) -> OpaquePointer? in
                guard let base = ptr.baseAddress else { return nil }
                return GEOSGeomFromWKB_buf_r(ctx, base, ptr.count)
            }) else {
                NSLog("[NativeGeometry] bufferWKB: failed to parse WKB")
                return nil
            }

            // Own the geometry pointer — mutating so we can reassign on MakeValid.
            var geom: OpaquePointer? = rawGeom
            defer {
                if let g = geom {
                    GEOSGeom_destroy_r(ctx, g)
                }
            }

            // Validate; attempt MakeValid if invalid.
            var valid: Int8 = 0
            _ = GEOSisValid_r(ctx, geom!, &valid)
            if valid != 1 {
                NSLog("[NativeGeometry] bufferWKB: geometry invalid — attempting MakeValid")
                guard let fixed = GEOSMakeValid_r(ctx, geom!) else {
                    return nil
                }
                // Destroy the original invalid geometry; take ownership of the fixed one.
                GEOSGeom_destroy_r(ctx, geom!)
                geom = fixed
            }

            return _bufferAndWrite(
                ctx: ctx,
                geom: geom!,
                distance: distance,
                quadrantSegments: Int32(quadrantSegments)
            )
        }
    }
}
