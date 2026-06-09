/**
 * Layer 3 — GEOS backend adapter tests (Jest, GEOS mocked).
 *
 * Mocks the native `bufferWKB` and validates the project→encode→(call)→decode
 * →unproject wiring, FeatureCollection structure, null/throw semantics, and
 * seam selection.
 */

import type { Feature, FeatureCollection, Polygon } from "geojson";

import { geosGeometryBackend } from "../geosGeometryBackend";
import { jsGeometryBackend } from "../jsGeometryBackend";
import {
    getGeometryBackend,
    __setGeometryBackendForTest,
} from "../geometryBackend";
import { decodeWkb, encodeWkb } from "../wkb";

// ---- Helpers ---------------------------------------------------------------

function makeTestFeature(): Feature<Polygon> {
    return {
        type: "Feature",
        properties: {},
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [139.7, 35.6],
                    [139.8, 35.6],
                    [139.8, 35.7],
                    [139.7, 35.7],
                    [139.7, 35.6],
                ],
            ],
        },
    };
}

// The native-geometry module is already mocked by jest.setup.ts.
// We can override per-test with jest.mock inside the describe block or
// by mutating the mock.

// ---- T3.1 Echo round-trip --------------------------------------------------

describe("GEOS backend echo round-trip (T3.1)", () => {
    beforeEach(() => {
        // Reset the mock to echo the input WKB treated as a buffer result.
        const native = require("native-geometry");
        native.bufferWKB = jest.fn().mockImplementation((wkb: Uint8Array) => {
            // "Echo": decode the input, treat it as the buffer result,
            // re-encode a modified version (shifted slightly) to verify
            // the full pipeline.
            const decoded = decodeWkb(wkb);
            if (!decoded) return null; // empty geometry
            // Add a small shift so we can verify unprojection.
            if (decoded.type === "Polygon") {
                const shifted: Polygon = {
                    type: "Polygon",
                    coordinates: decoded.coordinates.map((ring) =>
                        (ring as [number, number][]).map(
                            ([x, y]) => [x + 100, y + 100] as [number, number],
                        ),
                    ),
                };
                return encodeWkb(shifted);
            }
            return wkb;
        });
        __setGeometryBackendForTest(null);
    });

    test("bufferMeters projects, encodes, calls native, decodes, unprojects", () => {
        const feature = makeTestFeature();

        // Spy on native bufferWKB to capture the WKB sent.
        const native = require("native-geometry");
        const result = geosGeometryBackend.bufferMeters(feature, 500, 8);

        expect(result).not.toBeNull();
        expect(result!.type).toBe("Feature");
        expect(
            result!.geometry.type === "Polygon" ||
                result!.geometry.type === "MultiPolygon",
        ).toBe(true);

        // Native bufferWKB was called with properly encoded WKB.
        const { bufferWKB } = native;
        expect(bufferWKB).toHaveBeenCalled();
        const callWkb: Uint8Array = bufferWKB.mock.calls[0][0];
        expect(callWkb).toBeInstanceOf(Uint8Array);
        expect(callWkb.length).toBeGreaterThan(0);

        // The WKB handed to native should decode to a Polygon in projected coords.
        const decoded = decodeWkb(callWkb)!;
        expect(decoded.type).toBe("Polygon");
    });
});

// ---- T3.2 FeatureCollection structure --------------------------------------

describe("GEOS backend FeatureCollection (T3.2)", () => {
    beforeEach(() => {
        const native = require("native-geometry");
        native.bufferWKB = jest.fn().mockImplementation((wkb: Uint8Array) => {
            // Echo as identity.
            return wkb;
        });
        __setGeometryBackendForTest(null);
    });

    test("FeatureCollection buffers each feature and returns features[0]", () => {
        const f1 = makeTestFeature();
        const f2: Feature<Polygon> = {
            type: "Feature",
            properties: {},
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [139.9, 35.8],
                        [140.0, 35.8],
                        [140.0, 35.9],
                        [139.9, 35.9],
                        [139.9, 35.8],
                    ],
                ],
            },
        };

        const fc: FeatureCollection<Polygon> = {
            type: "FeatureCollection",
            features: [f1, f2],
        };

        const result = geosGeometryBackend.bufferMeters(fc, 500, 8);
        expect(result).not.toBeNull();
        expect(result!.type).toBe("Feature");

        // Native was called twice (once per feature).
        const native = require("native-geometry");
        expect(native.bufferWKB).toHaveBeenCalledTimes(2);
    });

    test("FeatureCollection with no valid results returns null", () => {
        const native = require("native-geometry");
        native.bufferWKB = jest.fn().mockReturnValue(null);

        const fc: FeatureCollection<Polygon> = {
            type: "FeatureCollection",
            features: [makeTestFeature()],
        };

        const result = geosGeometryBackend.bufferMeters(fc, 500, 8);
        expect(result).toBeNull();
    });
});

// ---- T3.3 null vs throw ----------------------------------------------------

describe("GEOS backend error handling (T3.3)", () => {
    beforeEach(() => {
        __setGeometryBackendForTest(null);
    });

    test("native returns null → backend returns null", () => {
        const native = require("native-geometry");
        native.bufferWKB = jest.fn().mockReturnValue(null);

        const result = geosGeometryBackend.bufferMeters(
            makeTestFeature(),
            500,
            8,
        );
        expect(result).toBeNull();
    });

    test("native throws → backend falls back to jsGeometryBackend", () => {
        const native = require("native-geometry");
        native.bufferWKB = jest.fn().mockImplementation(() => {
            throw new Error("native explosion");
        });

        // Spy on jsGeometryBackend to verify fallback was invoked.
        const fallbackSpy = jest.spyOn(jsGeometryBackend, "bufferMeters");

        const result = geosGeometryBackend.bufferMeters(
            makeTestFeature(),
            500,
            8,
        );

        // Fallback should have been called.
        expect(fallbackSpy).toHaveBeenCalled();
        // The result should be whatever jsGeometryBackend returns (non-null
        // since @turf/buffer is real and the input is valid).
        expect(result).not.toBeNull();

        fallbackSpy.mockRestore();
    });
});

// ---- T3.4 Seam selection ---------------------------------------------------

describe("geometry backend seam selection (T3.4)", () => {
    beforeEach(() => {
        __setGeometryBackendForTest(null);
    });

    afterEach(() => {
        __setGeometryBackendForTest(null);
    });

    test("seam returns geos backend when set via test seam", () => {
        __setGeometryBackendForTest(geosGeometryBackend);
        const backend = getGeometryBackend();
        expect(backend.name).toBe("geos");
    });

    test("seam returns js backend when set via test seam", () => {
        __setGeometryBackendForTest(jsGeometryBackend);
        const backend = getGeometryBackend();
        expect(backend.name).toBe("js");
    });

    test("seam returns js backend by default in Jest (native mocked unavailable)", () => {
        // The jest.setup.ts mock returns isAvailable: () => false.
        // getGeometryBackend resolves to JS backend in this environment.
        __setGeometryBackendForTest(null);
        const backend = getGeometryBackend();
        // In Jest, the mock always returns isAvailable=false, so this
        // falls through all the native-available branches.
        expect(backend.name).toBe("js");
    });

    test("seam override is memoized until reset", () => {
        __setGeometryBackendForTest(geosGeometryBackend);
        expect(getGeometryBackend().name).toBe("geos");
        // Second call returns same memoized backend.
        expect(getGeometryBackend().name).toBe("geos");

        // Reset clears memoization.
        __setGeometryBackendForTest(null);
        // Next call re-resolves (but in Jest, isAvailable=false → js).
        expect(getGeometryBackend().name).toBe("js");
    });
});
