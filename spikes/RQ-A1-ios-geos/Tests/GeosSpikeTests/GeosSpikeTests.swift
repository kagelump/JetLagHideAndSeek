import XCTest
@testable import GeosSpike

final class GeosSpikeTests: XCTestCase {
    func testGeosVersionIs314() throws {
        let v = GeosSpike.version()
        print("GEOS version: \(v)")
        XCTAssertTrue(v.hasPrefix("3.14"), "expected GEOS 3.14.x, got \(v)")
    }

    func testIntersectionArea() throws {
        let area = GeosSpike.intersectionAreaOfOverlappingUnitSquares()
        print("intersection area: \(area)")
        XCTAssertEqual(area, 1.0, accuracy: 1e-9)
    }
}
