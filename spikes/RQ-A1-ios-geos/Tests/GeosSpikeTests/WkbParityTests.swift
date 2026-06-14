import XCTest
@testable import GeosSpike

/// RQ-C1 — feed the *exact* WKB-hex bytes produced by the repo's JS `encodeWkb`
/// through GEOS on the simulator and assert the geometry survives byte-for-byte:
/// same type, same coordinate count, same envelope, and a clean WKB round-trip.
final class WkbParityTests: XCTestCase {
    // GEOS GEOSGeomTypeId enum values.
    private static let LINESTRING: Int32 = 1
    private static let POLYGON: Int32 = 3
    private static let MULTIPOINT: Int32 = 4
    private static let MULTIPOLYGON: Int32 = 6

    private struct Fixture: Decodable {
        let name: String
        let type: String
        let hex: String
        let numCoords: Int32
        let bbox: BBox
        struct BBox: Decodable {
            let xmin, ymin, xmax, ymax: Double
        }
    }

    private func loadFixtures() throws -> [Fixture] {
        // Read the JS-emitted fixtures directly from the spike dir. #filePath is
        // this source file; fixtures live two dirs up.
        let here = URL(fileURLWithPath: #filePath)
        let json = here
            .deletingLastPathComponent()  // GeosSpikeTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // package root
            .appendingPathComponent("wkb-fixtures.json")
        let data = try Data(contentsOf: json)
        return try JSONDecoder().decode([Fixture].self, from: data)
    }

    private func expectedTypeId(_ s: String) -> Int32 {
        switch s {
        case "LineString": return Self.LINESTRING
        case "Polygon": return Self.POLYGON
        case "MultiPoint": return Self.MULTIPOINT
        case "MultiPolygon": return Self.MULTIPOLYGON
        default: return -1
        }
    }

    func testWkbHexParsesIdenticallyInGeos() throws {
        let fixtures = try loadFixtures()
        XCTAssertEqual(fixtures.count, 4, "expected 4 fixtures")

        for f in fixtures {
            guard let probe = GeosSpike.probeWkbHex(f.hex) else {
                XCTFail("\(f.name): GEOS failed to parse WKB hex")
                continue
            }
            XCTAssertEqual(
                probe.typeId, expectedTypeId(f.type),
                "\(f.name): geometry type mismatch")
            XCTAssertEqual(
                probe.numCoords, f.numCoords,
                "\(f.name): coordinate count mismatch")
            XCTAssertEqual(
                probe.roundTripNumCoords, f.numCoords,
                "\(f.name): WKB round-trip changed coordinate count")
            let tol = 1e-9
            XCTAssertEqual(probe.xmin, f.bbox.xmin, accuracy: tol, "\(f.name) xmin")
            XCTAssertEqual(probe.ymin, f.bbox.ymin, accuracy: tol, "\(f.name) ymin")
            XCTAssertEqual(probe.xmax, f.bbox.xmax, accuracy: tol, "\(f.name) xmax")
            XCTAssertEqual(probe.ymax, f.bbox.ymax, accuracy: tol, "\(f.name) ymax")
            print(
                "\(f.name): type=\(probe.typeId) coords=\(probe.numCoords) "
                    + "bbox=[\(probe.xmin),\(probe.ymin),\(probe.xmax),\(probe.ymax)] OK")
        }
    }
}
