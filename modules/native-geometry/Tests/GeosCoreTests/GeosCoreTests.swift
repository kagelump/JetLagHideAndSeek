import XCTest
import GEOS
import GeosCore

final class GeosCoreTests: XCTestCase {

    struct GoldenCase: Decodable {
        let name: String
        let op: String
        let inputWkbHex: [String]?
        let params: Params?
        let expect: Expect

        struct Params: Codable {
            let distance: Double
            let quadrantSegments: Int?
        }
        struct Expect: Decodable {
            let isNull: Bool
            let resultType: String?
            let areaM2: AreaM2?
            let bbox: [Double]?
            let bboxTolM: Double?
            let minRingVertices: Int?
            let numCoords: Int?
            struct AreaM2: Decodable {
                let value: Double
                let ratioTol: Double
            }
        }
    }

    struct GoldenFile: Decodable {
        let version: Int
        let cases: [GoldenCase]
    }

    static var goldenCases: [GoldenCase] = {
        let testFile = URL(fileURLWithPath: #filePath)
        let packageRoot = testFile
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let fixtureURL = packageRoot
            .appendingPathComponent("__fixtures__")
            .appendingPathComponent("geos-golden.json")
        let data = try! Data(contentsOf: fixtureURL)
        let file = try! JSONDecoder().decode(GoldenFile.self, from: data)
        return file.cases
    }()

    private static let squareHex = "01030000000100000005000000000000000000000000000000000000000000000000408f4000000000000000000000000000408f400000000000408f4000000000000000000000000000408f4000000000000000000000000000000000"

    // MARK: - Diagnostics

    func testVersionStartsWith3_14() {
        let v = GeosCore.version()
        XCTAssertTrue(v.hasPrefix("3.14"), "Expected GEOS 3.14.x, got \(v)")
    }

    // MARK: - Regenerate golden fixtures against GEOS 3.14.1
    //
    // Run: xcodebuild test -scheme NativeGeometryTests-Package \
    //        -destination 'platform=iOS Simulator,...' \
    //        -only-testing:GeosCoreTests/GeosCoreTests/testRegenerateGoldenFixtures
    // This overwrites __fixtures__/geos-golden.json with 3.14.1 invariants.

    func testRegenerateGoldenFixtures() {
        let ctx = GeosCore.geosContext()
        let version = GeosCore.version()

        struct OutputCase: Encodable {
            let name: String
            let op: String
            let inputWkbHex: [String]?
            let params: GoldenCase.Params?
            let expect: OutputExpect
        }
        struct OutputExpect: Encodable {
            let isNull: Bool
            let resultType: String?
            let areaM2: AreaM2Out?
            let bbox: [Double]?
            let bboxTolM: Double?
            let minRingVertices: Int?
            let numCoords: Int?
        }
        struct AreaM2Out: Encodable {
            let value: Double
            let ratioTol: Double
        }
        struct OutputFile: Encodable {
            let version: Int
            let oracle: String
            let generatedBy: String
            let cases: [OutputCase]
        }

        var outputCases: [OutputCase] = []

        for c in Self.goldenCases {
            let inputs = (c.inputWkbHex ?? []).map { hexToData($0)! }
            let result: Data?
            let bboxTolM: Double

            switch c.op {
            case "buffer":
                result = GeosCore.buffer(
                    wkb: inputs[0],
                    distance: c.params!.distance,
                    quadrantSegments: c.params!.quadrantSegments ?? 8)
                bboxTolM = c.params!.distance * 0.02 + 5
            case "difference":
                result = GeosCore.difference(wkbA: inputs[0], wkbB: inputs[1])
                bboxTolM = 1
            case "intersection":
                result = GeosCore.intersection(wkbA: inputs[0], wkbB: inputs[1])
                bboxTolM = 1
            case "union":
                result = GeosCore.union(wkbA: inputs[0], wkbB: inputs[1])
                bboxTolM = 1
            case "unaryUnion":
                result = GeosCore.unaryUnion(wkb: inputs[0])
                bboxTolM = 1
            case "parse":
                result = GeosCore.unaryUnion(wkb: inputs[0])
                bboxTolM = 0
            default:
                XCTFail("Unknown op: \(c.op)")
                continue
            }

            // Build the expect from actual GEOS 3.14.1 results.
            let expect: OutputExpect
            if let result = result, result.count > 0 {
                let geom = result.withUnsafeBytes { ptr -> OpaquePointer? in
                    guard let base = ptr.baseAddress else { return nil }
                    return GEOSGeomFromWKB_buf_r(ctx, base, ptr.count)
                }

                if let geom = geom {
                    let empty = GEOSisEmpty_r(ctx, geom)
                    if empty == 1 {
                        GEOSGeom_destroy_r(ctx, geom)
                        expect = OutputExpect(isNull: true, resultType: nil, areaM2: nil, bbox: nil, bboxTolM: nil, minRingVertices: nil, numCoords: nil)
                    } else {
                        let typeId = GEOSGeomTypeId_r(ctx, geom)
                        let typeName = wkbTypeName(geom, ctx: ctx)

                        var area: Double = 0
                        GEOSArea_r(ctx, geom, &area)

                        var xmin: Double = 0, ymin: Double = 0, xmax: Double = 0, ymax: Double = 0
                        GEOSGeom_getExtent_r(ctx, geom, &xmin, &ymin, &xmax, &ymax)

                        var minRing: Int? = nil
                        if c.expect.minRingVertices != nil {
                            minRing = computeMinRingVertices(geom, ctx: ctx)
                        }

                        var numCoords: Int? = nil
                        if c.expect.numCoords != nil {
                            numCoords = Int(GEOSGetNumCoordinates_r(ctx, geom))
                        }

                        let areaM2: AreaM2Out?
                        if c.expect.areaM2 != nil {
                            areaM2 = AreaM2Out(value: round6(area), ratioTol: 0.01)
                        } else {
                            areaM2 = nil
                        }

                        let bboxArr: [Double]? = c.expect.bbox != nil
                            ? [round4(xmin), round4(ymin), round4(xmax), round4(ymax)]
                            : nil

                        expect = OutputExpect(
                            isNull: false,
                            resultType: typeName,
                            areaM2: areaM2,
                            bbox: bboxArr,
                            bboxTolM: bboxTolM,
                            minRingVertices: minRing,
                            numCoords: numCoords
                        )
                        GEOSGeom_destroy_r(ctx, geom)
                    }
                } else {
                    expect = OutputExpect(isNull: true, resultType: nil, areaM2: nil, bbox: nil, bboxTolM: nil, minRingVertices: nil, numCoords: nil)
                }
            } else {
                expect = OutputExpect(isNull: true, resultType: nil, areaM2: nil, bbox: nil, bboxTolM: nil, minRingVertices: nil, numCoords: nil)
            }

            outputCases.append(OutputCase(
                name: c.name,
                op: c.op,
                inputWkbHex: c.inputWkbHex,
                params: c.params,
                expect: expect
            ))
        }

        let outputFile = OutputFile(
            version: 1,
            oracle: version,
            generatedBy: "GeosCoreTests/testRegenerateGoldenFixtures (GEOS \(version))",
            cases: outputCases
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let jsonData = try! encoder.encode(outputFile)

        // Write to the fixtures directory (resolved from #filePath).
        let testFile = URL(fileURLWithPath: #filePath)
        let packageRoot = testFile
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let outPath = packageRoot
            .appendingPathComponent("__fixtures__")
            .appendingPathComponent("geos-golden.json")

        try! jsonData.write(to: outPath)
        print("[regen] Wrote \(outputCases.count) cases to \(outPath.path)")
        print("[regen] Oracle: \(version)")
    }

    // MARK: - Helpers

    private func round6(_ v: Double) -> Double { Double(String(format: "%.6f", v))! }
    private func round4(_ v: Double) -> Double { Double(String(format: "%.4f", v))! }

    private func computeMinRingVertices(_ geom: OpaquePointer, ctx: GEOSContextHandle_t) -> Int {
        let numGeoms = GEOSGetNumGeometries_r(ctx, geom)
        var minVerts = Int.max
        for i in 0..<numGeoms {
            guard let sub = GEOSGetGeometryN_r(ctx, geom, Int32(i)) else { continue }
            let typeId = GEOSGeomTypeId_r(ctx, sub)
            guard typeId == 3 || typeId == 6 else { continue }
            if let extRing = GEOSGetExteriorRing_r(ctx, sub) {
                let n = Int(GEOSGetNumCoordinates_r(ctx, extRing))
                if n < minVerts { minVerts = n }
            }
            let numInterior = GEOSGetNumInteriorRings_r(ctx, sub)
            for j in 0..<numInterior {
                if let ring = GEOSGetInteriorRingN_r(ctx, sub, Int32(j)) {
                    let n = Int(GEOSGetNumCoordinates_r(ctx, ring))
                    if n < minVerts { minVerts = n }
                }
            }
        }
        return minVerts == Int.max ? 0 : minVerts
    }

    // MARK: - Golden fixture parity

    func testBufferCases() {
        let cases = Self.goldenCases.filter { $0.op == "buffer" }
        XCTAssertFalse(cases.isEmpty, "No buffer cases in golden fixture")
        for c in cases {
            runGoldenCase(c)
        }
    }

    func testDifferenceCases() {
        let cases = Self.goldenCases.filter { $0.op == "difference" }
        XCTAssertFalse(cases.isEmpty, "No difference cases in golden fixture")
        for c in cases {
            runGoldenCase(c)
        }
    }

    func testIntersectionCases() {
        let cases = Self.goldenCases.filter { $0.op == "intersection" }
        XCTAssertFalse(cases.isEmpty, "No intersection cases in golden fixture")
        for c in cases {
            runGoldenCase(c)
        }
    }

    func testUnionCases() {
        let cases = Self.goldenCases.filter { $0.op == "union" }
        XCTAssertFalse(cases.isEmpty, "No union cases in golden fixture")
        for c in cases {
            runGoldenCase(c)
        }
    }

    func testUnaryUnionCases() {
        let cases = Self.goldenCases.filter { $0.op == "unaryUnion" }
        XCTAssertFalse(cases.isEmpty, "No unaryUnion cases in golden fixture")
        for c in cases {
            runGoldenCase(c)
        }
    }

    func testParseCases() {
        let cases = Self.goldenCases.filter { $0.op == "parse" }
        XCTAssertFalse(cases.isEmpty, "No parse cases in golden fixture")
        for c in cases {
            runGoldenCase(c)
        }
    }

    // MARK: - All ops present on fresh binary

    func testAllOpsPresent() {
        // Use the first buffer case's input from the golden fixture (known-good WKB).
        let golden = Self.goldenCases.first { $0.op == "buffer" }!
        let square = hexToData(golden.inputWkbHex![0])!

        XCTAssertNotNil(GeosCore.buffer(wkb: square, distance: 1, quadrantSegments: 8),
                        "buffer returned nil")
        XCTAssertNotNil(GeosCore.difference(wkbA: square, wkbB: square),
                        "difference returned nil")
        XCTAssertNotNil(GeosCore.union(wkbA: square, wkbB: square),
                        "union returned nil")
        XCTAssertNotNil(GeosCore.intersection(wkbA: square, wkbB: square),
                        "intersection returned nil")
        XCTAssertNotNil(GeosCore.unaryUnion(wkb: square),
                        "unaryUnion returned nil")
    }

    // MARK: - Empty-result semantics (GEOS 3.14 returns empty geometry, not null)

    func testDisjointIntersectionIsEmpty() {
        let golden = Self.goldenCases.first { $0.name == "intersection/disjoint-empty" }!
        let wkbs = golden.inputWkbHex!.map { hexToData($0)! }
        let result = GeosCore.intersection(wkbA: wkbs[0], wkbB: wkbs[1])
        assertEmptyOrNull(result, name: "disjoint intersection")
    }

    func testDifferenceAInsideBIsEmpty() {
        let golden = Self.goldenCases.first { $0.name == "difference/a-inside-b-empty" }!
        let wkbs = golden.inputWkbHex!.map { hexToData($0)! }
        let result = GeosCore.difference(wkbA: wkbs[0], wkbB: wkbs[1])
        assertEmptyOrNull(result, name: "A-inside-B difference")
    }

    // MARK: - MakeValid recovery

    func testMakeValidRecovery() {
        // Self-intersecting bowtie polygon: (0,0)->(2,2)->(2,0)->(0,2)->(0,0)
        let bowtieHex = "010300000001000000050000000000000000000000000000000000000000000000000000400000000000000040000000000000004000000000000000000000000000000000000000000000004000000000000000000000000000000000"
        let wkb = hexToData(bowtieHex)!
        let result = GeosCore.unaryUnion(wkb: wkb)
        XCTAssertNotNil(result, "MakeValid + unaryUnion on bowtie should not crash or return nil")
    }

    // MARK: - Memory stress (1000 iterations)

    func testMemoryStressBuffer() {
        let golden = Self.goldenCases.first { $0.op == "buffer" }!
        let square = hexToData(golden.inputWkbHex![0])!
        for i in 0..<1000 {
            let result = GeosCore.buffer(wkb: square, distance: 100, quadrantSegments: 8)
            XCTAssertNotNil(result, "Buffer failed at iteration \(i)")
        }
    }

    func testMemoryStressOverlay() {
        let diffCase = Self.goldenCases.first { $0.name == "difference/square-with-hole" }!
        let a = hexToData(diffCase.inputWkbHex![0])!
        let b = hexToData(diffCase.inputWkbHex![1])!
        for i in 0..<1000 {
            let d = GeosCore.difference(wkbA: a, wkbB: b)
            XCTAssertNotNil(d, "Difference failed at iteration \(i)")
            let u = GeosCore.union(wkbA: a, wkbB: b)
            XCTAssertNotNil(u, "Union failed at iteration \(i)")
            let inter = GeosCore.intersection(wkbA: a, wkbB: b)
            XCTAssertNotNil(inter, "Intersection failed at iteration \(i)")
        }
    }

    // MARK: - Helpers

    /// Asserts that a result is either nil (GEOS 3.13 style) or an empty geometry (GEOS 3.14 style).
    private func assertEmptyOrNull(_ result: Data?, name: String) {
        if result == nil { return }
        let ctx = GeosCore.geosContext()
        let geom = result!.withUnsafeBytes { ptr -> OpaquePointer? in
            guard let base = ptr.baseAddress else { return nil }
            return GEOSGeomFromWKB_buf_r(ctx, base, ptr.count)
        }
        if let geom = geom {
            let empty = GEOSisEmpty_r(ctx, geom)
            GEOSGeom_destroy_r(ctx, geom)
            XCTAssertEqual(empty, 1, "\(name): expected empty or null result, got non-empty geometry")
        }
    }

    private func runGoldenCase(_ c: GoldenCase) {
        XCTContext.runActivity(named: c.name) { _ in
            let inputs = (c.inputWkbHex ?? []).map { hexToData($0)! }
            let result: Data?
            switch c.op {
            case "buffer":
                result = GeosCore.buffer(
                    wkb: inputs[0],
                    distance: c.params!.distance,
                    quadrantSegments: c.params!.quadrantSegments ?? 8)
            case "difference":
                result = GeosCore.difference(wkbA: inputs[0], wkbB: inputs[1])
            case "intersection":
                result = GeosCore.intersection(wkbA: inputs[0], wkbB: inputs[1])
            case "union":
                result = GeosCore.union(wkbA: inputs[0], wkbB: inputs[1])
            case "unaryUnion":
                result = GeosCore.unaryUnion(wkb: inputs[0])
            case "parse":
                result = GeosCore.unaryUnion(wkb: inputs[0])
            default:
                XCTFail("Unknown op: \(c.op)")
                return
            }

            if c.expect.isNull {
                assertEmptyOrNull(result, name: c.name)
                return
            }

            XCTAssertNotNil(result, "\(c.name): expected non-null result")
            guard let result else { return }

            let ctx = GeosCore.geosContext()
            let geom = result.withUnsafeBytes { ptr -> OpaquePointer? in
                guard let base = ptr.baseAddress else { return nil }
                return GEOSGeomFromWKB_buf_r(ctx, base, ptr.count)
            }
            defer { if let g = geom { GEOSGeom_destroy_r(ctx, g) } }
            XCTAssertNotNil(geom, "\(c.name): failed to decode result WKB")
            guard let geom else { return }

            if let expectedType = c.expect.resultType {
                let actualType = wkbTypeName(geom, ctx: ctx)
                XCTAssertEqual(actualType, expectedType,
                               "\(c.name): type mismatch — expected \(expectedType), got \(actualType)")
            }

            if let areaExpect = c.expect.areaM2 {
                var area: Double = 0
                let rc = GEOSArea_r(ctx, geom, &area)
                XCTAssertEqual(rc, 1, "\(c.name): GEOSArea_r failed")
                XCTAssertGreaterThanOrEqual(area, 0, "\(c.name): negative area")
                let ratio = area / areaExpect.value
                XCTAssertEqual(ratio, 1.0, accuracy: areaExpect.ratioTol,
                               "\(c.name): area ratio \(ratio) outside tolerance \(areaExpect.ratioTol)")
            }

            if let expectedBbox = c.expect.bbox, let tol = c.expect.bboxTolM {
                var xmin: Double = 0, ymin: Double = 0, xmax: Double = 0, ymax: Double = 0
                let rc = GEOSGeom_getExtent_r(ctx, geom, &xmin, &ymin, &xmax, &ymax)
                XCTAssertEqual(rc, 1, "\(c.name): GEOSGeom_getExtent_r failed")
                XCTAssertEqual(xmin, expectedBbox[0], accuracy: tol,
                               "\(c.name): bbox xmin mismatch")
                XCTAssertEqual(ymin, expectedBbox[1], accuracy: tol,
                               "\(c.name): bbox ymin mismatch")
                XCTAssertEqual(xmax, expectedBbox[2], accuracy: tol,
                               "\(c.name): bbox xmax mismatch")
                XCTAssertEqual(ymax, expectedBbox[3], accuracy: tol,
                               "\(c.name): bbox ymax mismatch")
            }

            if let minRing = c.expect.minRingVertices {
                let minRingI32 = Int32(minRing)
                let numGeoms = GEOSGetNumGeometries_r(ctx, geom)
                XCTAssertGreaterThanOrEqual(numGeoms, Int32(1), "\(c.name): no geometries")
                for i in 0..<numGeoms {
                    guard let sub = GEOSGetGeometryN_r(ctx, geom, Int32(i)) else { continue }
                    let typeId = GEOSGeomTypeId_r(ctx, sub)
                    guard typeId == 3 || typeId == 6 else { continue } // Polygon or MultiPolygon
                    let numInteriorRings = Int(GEOSGetNumInteriorRings_r(ctx, sub))
                    if let extRing = GEOSGetExteriorRing_r(ctx, sub) {
                        let nCoords = GEOSGetNumCoordinates_r(ctx, extRing)
                        XCTAssertGreaterThanOrEqual(nCoords, minRingI32,
                            "\(c.name): exterior ring of geom \(i) has \(nCoords) coords, want >= \(minRing)")
                    }
                    for j in 0..<numInteriorRings {
                        if let ring = GEOSGetInteriorRingN_r(ctx, sub, Int32(j)) {
                            let nCoords = GEOSGetNumCoordinates_r(ctx, ring)
                            XCTAssertGreaterThanOrEqual(nCoords, minRingI32,
                                "\(c.name): interior ring \(j) of geom \(i) has \(nCoords) coords, want >= \(minRing)")
                        }
                    }
                }
            }

            if let numCoords = c.expect.numCoords {
                let n = GEOSGetNumCoordinates_r(ctx, geom)
                XCTAssertEqual(n, Int32(numCoords),
                               "\(c.name): expected \(numCoords) coords, got \(n)")
            }
        }
    }

    private func wkbTypeName(_ geom: OpaquePointer, ctx: GEOSContextHandle_t) -> String {
        let typeId = GEOSGeomTypeId_r(ctx, geom)
        switch typeId {
        case 0: return "Point"
        case 1: return "LineString"
        case 2: return "LinearRing"
        case 3: return "Polygon"
        case 4: return "MultiPoint"
        case 5: return "MultiLineString"
        case 6: return "MultiPolygon"
        case 7: return "GeometryCollection"
        default: return "Unknown(\(typeId))"
        }
    }

    private func hexToData(_ hex: String) -> Data? {
        let hex = hex.dropFirst(hex.hasPrefix("0x") ? 2 : 0)
        guard hex.count % 2 == 0 else { return nil }
        var data = Data(capacity: hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            data.append(byte)
            index = next
        }
        return data
    }
}
