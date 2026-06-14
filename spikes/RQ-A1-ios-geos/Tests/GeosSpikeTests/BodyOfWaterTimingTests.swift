import XCTest
@testable import GeosSpike

/// RQ-C3 — the marquee case. The body-of-water measuring pipeline dissolves a
/// large self-overlapping MultiPolygon (`unaryUnion`) and then differences it
/// against the play area. polyclip-JS hard-locks on this (~5.6 s measured for the
/// dissolve alone; ~25 s for the full render historically). This test runs the
/// SAME captured WKB through device GEOS 3.14.1 and asserts it is fast + non-null.
final class BodyOfWaterTimingTests: XCTestCase {
    private struct Op: Decodable {
        let numCoords: Int32
        let hex: String
    }
    private struct Fixture: Decodable {
        let distanceMeters: Double
        let windowFeatures: Int
        let jsPolyclipUnaryUnionMs: Double
        let unaryUnion: Op
        let differenceA: Op
        let differenceB: Op
    }

    // Generous ceiling — the RQ target is < 3 s; failing this means GEOS is
    // also slow on the pathological input (a critical finding, escalate).
    private static let MAX_MS = 3000.0

    private func loadFixture() throws -> Fixture {
        let here = URL(fileURLWithPath: #filePath)
        let json = here
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("bow-fixtures.json")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: json))
    }

    func testUnaryUnionIsFastOnDevice() throws {
        let f = try loadFixture()
        guard let p = GeosSpike.unaryUnionWkbHex(f.unaryUnion.hex) else {
            return XCTFail("unaryUnion returned nil probe")
        }
        print(
            "[C3] unaryUnion: \(f.unaryUnion.numCoords) coords in → "
                + "\(p.numCoords) coords out in \(String(format: "%.1f", p.ms)) ms "
                + "(polyclip-JS: \(Int(f.jsPolyclipUnaryUnionMs)) ms)")
        XCTAssertFalse(p.isNull, "unaryUnion result is null")
        XCTAssertGreaterThan(p.numCoords, 0, "unaryUnion produced empty geometry")
        XCTAssertLessThan(p.ms, Self.MAX_MS, "GEOS unaryUnion too slow (\(p.ms) ms)")
    }

    func testDifferenceIsFastOnDevice() throws {
        let f = try loadFixture()
        guard let p = GeosSpike.differenceWkbHex(f.differenceA.hex, f.differenceB.hex)
        else {
            return XCTFail("difference returned nil probe")
        }
        print(
            "[C3] difference: A=\(f.differenceA.numCoords) B=\(f.differenceB.numCoords) → "
                + "\(p.numCoords) coords in \(String(format: "%.1f", p.ms)) ms")
        XCTAssertFalse(p.isNull, "difference result is null")
        XCTAssertGreaterThan(p.numCoords, 0, "difference produced empty geometry")
        XCTAssertLessThan(p.ms, Self.MAX_MS, "GEOS difference too slow (\(p.ms) ms)")
    }
}
