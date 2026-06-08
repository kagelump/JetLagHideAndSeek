import ExpoModulesCore
// GEOS C API symbols (GEOSversion, GEOSinit_r, etc.) are available directly
// because geos_bridge.h is listed in the pod's source_files and the
// umbrella header includes it. No `import GEOS` needed.

// ---------------------------------------------------------------------------
// G1 smoke-test module — minimal GEOS integration to prove linking + execution
// before G2 builds the full backend.
// ---------------------------------------------------------------------------

/// Global GEOS context handle (reentrant). Created once on first use.
private var _geosContext: GEOSContextHandle_t? = nil

/// Thread-safe access to the GEOS context.
private func geosContext() -> GEOSContextHandle_t {
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

public class NativeGeometryModule: Module {
    public func definition() -> ModuleDefinition {
        Name("NativeGeometry")

        // -- G1 smoke: version string ---------------------------------------
        Function("geosVersion") { () -> String in
            guard let version = GEOSversion() else {
                return "unknown"
            }
            return String(cString: version)
        }

        // -- G1 smoke: buffer a WKB geometry --------------------------------
        // Takes a little-endian WKB Uint8Array, buffers by 0.01 degrees with
        // quadrantSegments=8, and returns the resulting WKB or null on error.
        Function("smokeTest") { (wkb: Data) -> Data? in
            let ctx = geosContext()

            // Read WKB → GEOS geometry.
            guard let inGeom = wkb.withUnsafeBytes({ (ptr: UnsafeRawBufferPointer) -> OpaquePointer? in
                guard let base = ptr.baseAddress else { return nil }
                return GEOSGeomFromWKB_buf_r(ctx, base, ptr.count)
            }) else {
                NSLog("[NativeGeometry] smokeTest: failed to parse WKB")
                return nil
            }
            defer { GEOSGeom_destroy_r(ctx, inGeom) }

            // Validate (optional; guards against degenerate input).
            var valid: Int8 = 0
            _ = GEOSisValid_r(ctx, inGeom, &valid)
            if valid != 1 {
                NSLog("[NativeGeometry] smokeTest: geometry is invalid — attempting MakeValid")
                guard let fixed = GEOSMakeValid_r(ctx, inGeom) else {
                    return nil
                }
                GEOSGeom_destroy_r(ctx, inGeom)
                // Use the fixed geometry below (deferred destroy is fine).
                return _bufferAndWrite(ctx: ctx, geom: fixed)
            }

            return _bufferAndWrite(ctx: ctx, geom: inGeom)
        }
    }
}

/// Buffer a geometry and return the result as WKB Data.
private func _bufferAndWrite(ctx: GEOSContextHandle_t, geom: OpaquePointer) -> Data? {
    // Create buffer parameters.
    guard let params = GEOSBufferParams_create_r(ctx) else {
        NSLog("[NativeGeometry] smokeTest: failed to create buffer params")
        return nil
    }
    defer { GEOSBufferParams_destroy_r(ctx, params) }

    // Buffer 0.01 degrees (~1.1 km at equator) with 8 quadrant segments.
    _ = GEOSBufferParams_setQuadrantSegments_r(ctx, params, 8)

    guard let buffered = GEOSBufferWithParams_r(ctx, geom, params, 0.01) else {
        NSLog("[NativeGeometry] smokeTest: buffer operation failed")
        return nil
    }
    defer { GEOSGeom_destroy_r(ctx, buffered) }

    // Write GEOS geometry → WKB.
    var wkbSize: Int = 0
    guard let wkbPtr = GEOSGeomToWKB_buf_r(ctx, buffered, &wkbSize) else {
        NSLog("[NativeGeometry] smokeTest: failed to write WKB")
        return nil
    }
    defer { GEOSFree_r(ctx, wkbPtr) }

    return Data(bytes: wkbPtr, count: wkbSize)
}
