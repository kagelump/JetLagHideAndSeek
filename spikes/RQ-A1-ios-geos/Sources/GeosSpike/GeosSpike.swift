import CGEOS

/// Thin Swift surface over the GEOS C API, just enough for the RQ-A1 spike.
/// Proves Swift can call into the vendored simulator GEOS slice.
public enum GeosSpike {
    /// Returns the GEOS version string, e.g. "3.14.1-CAPI-1.20.1".
    public static func version() -> String {
        return String(cString: GEOSversion())
    }

    /// Builds two unit squares, computes their intersection area via the
    /// thread-safe reentrant API, and returns it. Exercises real geometry ops,
    /// not just the version symbol.
    public static func intersectionAreaOfOverlappingUnitSquares() -> Double {
        let handle = GEOS_init_r()
        defer { GEOS_finish_r(handle) }

        let reader = GEOSWKTReader_create_r(handle)
        defer { GEOSWKTReader_destroy_r(handle, reader) }

        // Square A: (0,0)-(2,2). Square B: (1,1)-(3,3). Overlap is 1x1 = 1.0.
        let a = "POLYGON((0 0, 2 0, 2 2, 0 2, 0 0))"
        let b = "POLYGON((1 1, 3 1, 3 3, 1 3, 1 1))"
        let ga = a.withCString { GEOSWKTReader_read_r(handle, reader, $0) }
        let gb = b.withCString { GEOSWKTReader_read_r(handle, reader, $0) }
        defer {
            GEOSGeom_destroy_r(handle, ga)
            GEOSGeom_destroy_r(handle, gb)
        }

        let inter = GEOSIntersection_r(handle, ga, gb)
        defer { GEOSGeom_destroy_r(handle, inter) }

        var area: Double = 0
        GEOSArea_r(handle, inter, &area)
        return area
    }

    /// Result of parsing a WKB-hex fixture through GEOS (RQ-C1).
    public struct WkbProbe: Equatable {
        public let typeId: Int32
        public let numCoords: Int32
        public let xmin: Double
        public let ymin: Double
        public let xmax: Double
        public let ymax: Double
        /// Coord count after a WKB write→read round-trip through GEOS.
        public let roundTripNumCoords: Int32
    }

    /// Decodes a lowercase hex string into bytes.
    static func bytes(fromHex hex: String) -> [UInt8] {
        var out: [UInt8] = []
        out.reserveCapacity(hex.count / 2)
        var idx = hex.startIndex
        while idx < hex.endIndex {
            let next = hex.index(idx, offsetBy: 2)
            out.append(UInt8(hex[idx..<next], radix: 16)!)
            idx = next
        }
        return out
    }

    /// Parses WKB-hex (as produced by the repo's `encodeWkb`) through GEOS and
    /// reports type, coordinate count, and envelope — the cross-engine
    /// invariants RQ-C1 compares against the JS ground truth.
    public static func probeWkbHex(_ hex: String) -> WkbProbe? {
        let handle = GEOS_init_r()
        defer { GEOS_finish_r(handle) }

        let reader = GEOSWKBReader_create_r(handle)
        defer { GEOSWKBReader_destroy_r(handle, reader) }

        let raw = bytes(fromHex: hex)
        guard
            let geom = raw.withUnsafeBufferPointer({ buf in
                GEOSWKBReader_read_r(handle, reader, buf.baseAddress, raw.count)
            })
        else { return nil }
        defer { GEOSGeom_destroy_r(handle, geom) }

        let typeId = GEOSGeomTypeId_r(handle, geom)
        let numCoords = GEOSGetNumCoordinates_r(handle, geom)
        var xmin = 0.0, ymin = 0.0, xmax = 0.0, ymax = 0.0
        GEOSGeom_getXMin_r(handle, geom, &xmin)
        GEOSGeom_getYMin_r(handle, geom, &ymin)
        GEOSGeom_getXMax_r(handle, geom, &xmax)
        GEOSGeom_getYMax_r(handle, geom, &ymax)

        // Round-trip: serialize back to WKB and re-parse.
        let writer = GEOSWKBWriter_create_r(handle)
        defer { GEOSWKBWriter_destroy_r(handle, writer) }
        var size: Int = 0
        var rtCoords: Int32 = -1
        if let wkb = GEOSWKBWriter_write_r(handle, writer, geom, &size) {
            defer { GEOSFree_r(handle, wkb) }
            if let geom2 = GEOSWKBReader_read_r(handle, reader, wkb, size) {
                defer { GEOSGeom_destroy_r(handle, geom2) }
                rtCoords = GEOSGetNumCoordinates_r(handle, geom2)
            }
        }

        return WkbProbe(
            typeId: typeId,
            numCoords: numCoords,
            xmin: xmin, ymin: ymin, xmax: xmax, ymax: ymax,
            roundTripNumCoords: rtCoords
        )
    }

    /// Area + envelope of a buffered geometry (RQ-C2). Coords are projected
    /// meters, so `GEOSArea_r` yields planar m² directly.
    public struct BufferProbe: Equatable {
        public let area: Double
        public let xmin: Double
        public let ymin: Double
        public let xmax: Double
        public let ymax: Double
    }

    /// Buffers a (projected) WKB-hex geometry with the SAME params as the
    /// production native module (QS, CAP_ROUND, JOIN_ROUND via
    /// GEOSBufferWithParams) and returns the result's planar area + bbox.
    public static func bufferWkbHex(
        _ hex: String, distance: Double, quadrantSegments: Int32
    ) -> BufferProbe? {
        let handle = GEOS_init_r()
        defer { GEOS_finish_r(handle) }

        let reader = GEOSWKBReader_create_r(handle)
        defer { GEOSWKBReader_destroy_r(handle, reader) }
        let raw = bytes(fromHex: hex)
        guard
            let geom = raw.withUnsafeBufferPointer({ buf in
                GEOSWKBReader_read_r(handle, reader, buf.baseAddress, raw.count)
            })
        else { return nil }
        defer { GEOSGeom_destroy_r(handle, geom) }

        guard let params = GEOSBufferParams_create_r(handle) else { return nil }
        defer { GEOSBufferParams_destroy_r(handle, params) }
        _ = GEOSBufferParams_setQuadrantSegments_r(handle, params, quadrantSegments)
        _ = GEOSBufferParams_setEndCapStyle_r(
            handle, params, Int32(GEOSBUF_CAP_ROUND.rawValue))
        _ = GEOSBufferParams_setJoinStyle_r(
            handle, params, Int32(GEOSBUF_JOIN_ROUND.rawValue))

        guard let buffered = GEOSBufferWithParams_r(handle, geom, params, distance)
        else { return nil }
        defer { GEOSGeom_destroy_r(handle, buffered) }

        var area = 0.0, xmin = 0.0, ymin = 0.0, xmax = 0.0, ymax = 0.0
        GEOSArea_r(handle, buffered, &area)
        GEOSGeom_getXMin_r(handle, buffered, &xmin)
        GEOSGeom_getYMin_r(handle, buffered, &ymin)
        GEOSGeom_getXMax_r(handle, buffered, &xmax)
        GEOSGeom_getYMax_r(handle, buffered, &ymax)
        return BufferProbe(area: area, xmin: xmin, ymin: ymin, xmax: xmax, ymax: ymax)
    }
}
