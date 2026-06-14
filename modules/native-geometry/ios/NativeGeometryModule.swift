import ExpoModulesCore

public class NativeGeometryModule: Module {
    public func definition() -> ModuleDefinition {
        Name("NativeGeometry")

        Function("geosVersion") { () -> String in
            return GeosCore.version()
        }

        // Bump whenever the WKB function surface changes (e.g. new overlay ops).
        // JS side has EXPECTED_NATIVE_ABI; mismatch → loud rebuild warning.
        Function("nativeAbiVersion") { () -> Int in
            return 2 // G5 overlay ops
        }

        Function("bufferWKB") {
            (wkb: Data, distance: Double, quadrantSegments: Int) -> Data? in
            return GeosCore.buffer(
                wkb: wkb, distance: distance, quadrantSegments: quadrantSegments)
        }

        Function("differenceWKB") {
            (wkbA: Data, wkbB: Data) -> Data? in
            return GeosCore.difference(wkbA: wkbA, wkbB: wkbB)
        }

        Function("unionWKB") {
            (wkbA: Data, wkbB: Data) -> Data? in
            return GeosCore.union(wkbA: wkbA, wkbB: wkbB)
        }

        Function("intersectionWKB") {
            (wkbA: Data, wkbB: Data) -> Data? in
            return GeosCore.intersection(wkbA: wkbA, wkbB: wkbB)
        }

        Function("unaryUnionWKB") {
            (wkb: Data) -> Data? in
            return GeosCore.unaryUnion(wkb: wkb)
        }
    }
}
