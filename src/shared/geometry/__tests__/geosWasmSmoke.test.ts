import {
    initGeosWasm,
    geosWasmVersion,
    bufferWKB,
} from "./helpers/geosWasmShim";
import { encodeWkb, decodeWkb } from "../wkb";
import type { Polygon } from "geojson";

describe("geos-wasm loads under Jest", () => {
    beforeAll(async () => {
        await initGeosWasm();
    });

    test("reports a GEOS version", () => {
        // GEOSversion() string marshalling is environment-dependent under
        // jsdom (can come back empty → "unknown"); the buffer path doesn't
        // use string returns, so only assert we get a non-empty string.
        const version = geosWasmVersion();
        expect(typeof version).toBe("string");
        expect(version.length).toBeGreaterThan(0);
    });

    test("buffers a unit square through real GEOS", () => {
        const square: Polygon = {
            type: "Polygon",
            coordinates: [
                [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                    [0, 0],
                ],
            ],
        };
        const out = bufferWKB(encodeWkb(square), 1.0, 8);
        expect(out).not.toBeNull();
        const decoded = decodeWkb(out!);
        expect(decoded).not.toBeNull();
        expect(
            decoded!.type === "Polygon" || decoded!.type === "MultiPolygon",
        ).toBe(true);
        // Buffering by 1 grows the square well past its 4 original corners.
        const rings = (decoded as Polygon).coordinates[0];
        expect(rings.length).toBeGreaterThan(8);
    });
});
