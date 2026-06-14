import XCTest
@testable import GeosSpike

/// RQ-C2 — do the existing parity tolerances hold across the geos-wasm 3.13 →
/// device 3.14.1 jump? Buffers the same projected WKB input with device GEOS
/// 3.14.1 and compares area ratio + bbox delta against the 3.13 oracle, using
/// the repo's own gates (parityMetrics.ts):
///   - area ratio ∈ [0.99, 1.01]
///   - bbox edge delta ≤ radius * 0.02 + 5 meters
final class BufferParityTests: XCTestCase {
    // Mirrors src/shared/geometry/parityMetrics.ts.
    private static let AREA_RATIO_MIN = 0.99
    private static let AREA_RATIO_MAX = 1.01
    private static func bboxToleranceM(_ radius: Double) -> Double {
        radius * 0.02 + 5
    }

    private struct Suite: Decodable {
        let wasmVersion: String
        let cases: [Case]
    }
    private struct Case: Decodable {
        let name: String
        let radius: Double
        let qs: Int32
        let inputHex: String
        let wasmArea: Double
        let wasmBbox: [Double]  // [w, s, e, n] projected meters
    }

    private func loadSuite() throws -> Suite {
        let here = URL(fileURLWithPath: #filePath)
        let json = here
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("buffer-fixtures.json")
        return try JSONDecoder().decode(Suite.self, from: Data(contentsOf: json))
    }

    func testBufferTolerancesHoldAcrossVersionJump() throws {
        let suite = try loadSuite()
        print("oracle geos-wasm: \(suite.wasmVersion)  device: \(GeosSpike.version())")
        XCTAssertEqual(suite.cases.count, 9, "expected 3 fixtures × 3 radii")

        for c in suite.cases {
            guard
                let p = GeosSpike.bufferWkbHex(
                    c.inputHex, distance: c.radius, quadrantSegments: c.qs)
            else {
                XCTFail("\(c.name)@\(c.radius): device buffer returned nil")
                continue
            }
            let ratio = p.area / c.wasmArea
            // bbox edge delta in projected meters (coords already meters).
            let edgeDelta = max(
                abs(p.xmin - c.wasmBbox[0]),
                abs(p.ymin - c.wasmBbox[1]),
                abs(p.xmax - c.wasmBbox[2]),
                abs(p.ymax - c.wasmBbox[3])
            )
            let tol = Self.bboxToleranceM(c.radius)
            print(
                "\(c.name)@\(Int(c.radius))m  ratio=\(String(format: "%.5f", ratio))  "
                    + "bboxΔ=\(String(format: "%.3f", edgeDelta))m (tol \(String(format: "%.1f", tol)))")
            XCTAssertGreaterThanOrEqual(
                ratio, Self.AREA_RATIO_MIN, "\(c.name)@\(c.radius) area ratio low")
            XCTAssertLessThanOrEqual(
                ratio, Self.AREA_RATIO_MAX, "\(c.name)@\(c.radius) area ratio high")
            XCTAssertLessThanOrEqual(
                edgeDelta, tol, "\(c.name)@\(c.radius) bbox delta over tol")
        }
    }
}
