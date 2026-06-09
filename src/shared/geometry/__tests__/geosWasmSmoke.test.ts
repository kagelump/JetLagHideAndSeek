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
        expect(geosWasmVersion()).toMatch(/^3\./);
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
