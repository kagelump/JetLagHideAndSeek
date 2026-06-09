/**
 * Layer 3 — GEOS backend adapter tests (Jest, GEOS mocked).
 *
 * Mocks the native `bufferWKB` and overlay WKB functions, validates the
 * project→encode→(call)→decode wiring, null/throw semantics, seam selection,
 * and overlay op (encode → call → decode) pipeline (G5 — no projection).
 */

import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Polygon,
} from "geojson";

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

// ---- G5 Overlay ops: encode → call → decode (no projection) -----------------

function makeSquareFeature(x = 0, y = 0, w = 1, h = 1): Feature<Polygon> {
    return {
        type: "Feature",
        properties: {},
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [x, y],
                    [x + w, y],
                    [x + w, y + h],
                    [x, y + h],
                    [x, y],
                ],
            ],
        },
    };
}

// ---- G5.1 Echo round-trip (binary ops) --------------------------------------

describe("GEOS backend overlay echo round-trip (G5.1)", () => {
    beforeEach(() => {
        const native = require("native-geometry");
        // Echo the first operand's WKB as the result — decodes back to the
        // original geometry. This validates the encode→call→decode wiring
        // without needing a real GEOS op.
        native.differenceWKB = jest
            .fn()
            .mockImplementation((wkbA: Uint8Array) => wkbA);
        native.unionWKB = jest
            .fn()
            .mockImplementation((wkbA: Uint8Array) => wkbA);
        native.intersectionWKB = jest
            .fn()
            .mockImplementation((wkbA: Uint8Array) => wkbA);
        native.unaryUnionWKB = jest
            .fn()
            .mockImplementation((wkb: Uint8Array) => wkb);
        __setGeometryBackendForTest(null);
    });

    test("difference encodes both operands, calls native, decodes result", () => {
        const a = makeSquareFeature(0, 0, 1, 1);
        const b = makeSquareFeature(0.5, 0.5, 1, 1);

        const result = geosGeometryBackend.difference(a, b);
        expect(result).not.toBeNull();
        expect(result!.geometry.type).toMatch(/Polygon/);

        const native = require("native-geometry");
        expect(native.differenceWKB).toHaveBeenCalledTimes(1);
        const [wkbA, wkbB]: Uint8Array[] = native.differenceWKB.mock.calls[0];
        expect(wkbA).toBeInstanceOf(Uint8Array);
        expect(wkbA.length).toBeGreaterThan(0);
        expect(wkbB).toBeInstanceOf(Uint8Array);
        expect(wkbB.length).toBeGreaterThan(0);

        // Verify the WKB sent to native carries raw WGS84 coords (no projection).
        const decoded = decodeWkb(wkbA)!;
        expect(decoded.type).toBe("Polygon");
        // Should be in original lon/lat space (~0–1°, not projected meters).
        if (decoded.type === "Polygon") {
            const [lng] = decoded.coordinates[0][0];
            expect(lng).toBeLessThan(10); // lon ~0°, not projected 0 m
        }
    });

    test("union encode → call → decode pipeline works", () => {
        const a = makeSquareFeature(0, 0, 1, 1);
        const b = makeSquareFeature(1, 0, 1, 1);

        const result = geosGeometryBackend.union(a, b);
        expect(result).not.toBeNull();
        expect(result!.geometry.type).toMatch(/Polygon/);

        const native = require("native-geometry");
        expect(native.unionWKB).toHaveBeenCalledTimes(1);
    });

    test("intersection encode → call → decode pipeline works", () => {
        const a = makeSquareFeature(0, 0, 1, 1);
        const b = makeSquareFeature(0.5, 0, 1, 1);

        const result = geosGeometryBackend.intersection(a, b);
        expect(result).not.toBeNull();
        expect(result!.geometry.type).toMatch(/Polygon/);

        const native = require("native-geometry");
        expect(native.intersectionWKB).toHaveBeenCalledTimes(1);
    });

    test("unaryUnion encode → call → decode pipeline works", () => {
        const mp: Feature<MultiPolygon> = {
            type: "Feature",
            properties: {},
            geometry: {
                type: "MultiPolygon",
                coordinates: [
                    makeSquareFeature(0, 0, 1, 1).geometry.coordinates,
                    makeSquareFeature(0.5, 0, 1, 1).geometry.coordinates,
                ],
            },
        };

        const result = geosGeometryBackend.unaryUnion(mp);
        expect(result).not.toBeNull();
        expect(result!.geometry.type).toMatch(/Polygon/);

        const native = require("native-geometry");
        expect(native.unaryUnionWKB).toHaveBeenCalledTimes(1);
    });

    test("binary ops feed raw WGS84 coords (no AEQD projection)", () => {
        const a = makeSquareFeature(139.7, 35.6, 0.1, 0.1); // Tokyo area
        const b = makeSquareFeature(139.75, 35.65, 0.1, 0.1);

        geosGeometryBackend.difference(a, b);

        const native = require("native-geometry");
        const [wkbA]: Uint8Array[] = native.differenceWKB.mock.calls[0];
        const decoded = decodeWkb(wkbA)!;
        expect(decoded.type).toBe("Polygon");

        // Coordinates should be in lon/lat degree range (~139–140, ~35–36),
        // NOT in projected meter range (which would be 0 or millions).
        if (decoded.type === "Polygon") {
            const [lng, lat] = decoded.coordinates[0][0];
            expect(lng).toBeGreaterThan(100); // ~139.7°, not projected meters
            expect(lng).toBeLessThan(200);
            expect(lat).toBeGreaterThan(0); // ~35.6°
            expect(lat).toBeLessThan(90);
        }
    });
});

// ---- G5.2 null result → backend returns null ---------------------------------

describe("GEOS backend overlay null handling (G5.2)", () => {
    beforeEach(() => {
        const native = require("native-geometry");
        native.differenceWKB = jest.fn().mockReturnValue(null);
        native.unionWKB = jest.fn().mockReturnValue(null);
        native.intersectionWKB = jest.fn().mockReturnValue(null);
        native.unaryUnionWKB = jest.fn().mockReturnValue(null);
        __setGeometryBackendForTest(null);
    });

    test("native returns null → diff / union / intersection fall back to JS", () => {
        const a = makeSquareFeature(0, 0, 1, 1);
        const b = makeSquareFeature(0.5, 0.5, 1, 1);

        // JS backend is the oracle — these ops return real results.
        const diff = geosGeometryBackend.difference(a, b);
        expect(diff).not.toBeNull();

        const un = geosGeometryBackend.union(a, b);
        expect(un).not.toBeNull();

        const int = geosGeometryBackend.intersection(a, b);
        expect(int).not.toBeNull();
    });

    test("native returns null for unaryUnion → falls back to JS", () => {
        const square = makeSquareFeature(0, 0, 1, 1);
        const result = geosGeometryBackend.unaryUnion(square);
        // JS fallback returns the square as-is.
        expect(result).not.toBeNull();
    });
});

// ---- G5.3 exception → JS fallback -------------------------------------------

describe("GEOS backend overlay exception fallback (G5.3)", () => {
    beforeEach(() => {
        __setGeometryBackendForTest(null);
    });

    test("native differenceWKB throws → falls back to JS", () => {
        const native = require("native-geometry");
        native.differenceWKB = jest.fn().mockImplementation(() => {
            throw new Error("native explosion");
        });

        const fallbackSpy = jest.spyOn(jsGeometryBackend, "difference");

        const result = geosGeometryBackend.difference(
            makeSquareFeature(0, 0, 1, 1),
            makeSquareFeature(0.5, 0.5, 1, 1),
        );
        expect(fallbackSpy).toHaveBeenCalled();
        expect(result).not.toBeNull();

        fallbackSpy.mockRestore();
    });

    test("native unionWKB throws → falls back to JS", () => {
        const native = require("native-geometry");
        native.unionWKB = jest.fn().mockImplementation(() => {
            throw new Error("native explosion");
        });

        const fallbackSpy = jest.spyOn(jsGeometryBackend, "union");
        const result = geosGeometryBackend.union(
            makeSquareFeature(0, 0, 1, 1),
            makeSquareFeature(1, 0, 1, 1),
        );
        expect(fallbackSpy).toHaveBeenCalled();
        expect(result).not.toBeNull();
        fallbackSpy.mockRestore();
    });

    test("native intersectionWKB throws → falls back to JS", () => {
        const native = require("native-geometry");
        native.intersectionWKB = jest.fn().mockImplementation(() => {
            throw new Error("native explosion");
        });

        const fallbackSpy = jest.spyOn(jsGeometryBackend, "intersection");
        const result = geosGeometryBackend.intersection(
            makeSquareFeature(0, 0, 1, 1),
            makeSquareFeature(0.5, 0, 1, 1),
        );
        expect(fallbackSpy).toHaveBeenCalled();
        expect(result).not.toBeNull();
        fallbackSpy.mockRestore();
    });

    test("native unaryUnionWKB throws → falls back to JS", () => {
        const native = require("native-geometry");
        native.unaryUnionWKB = jest.fn().mockImplementation(() => {
            throw new Error("native explosion");
        });

        const fallbackSpy = jest.spyOn(jsGeometryBackend, "unaryUnion");
        const result = geosGeometryBackend.unaryUnion(
            makeSquareFeature(0, 0, 1, 1),
        );
        expect(fallbackSpy).toHaveBeenCalled();
        expect(result).not.toBeNull();
        fallbackSpy.mockRestore();
    });
});

// ---- G5.4 Missing native op → JS fallback -----------------------------------

describe("GEOS backend overlay missing native op (G5.4)", () => {
    beforeEach(() => {
        // Simulate a partial ABI: bufferWKB exists but overlay ops are missing.
        const native = require("native-geometry");
        native.bufferWKB = jest.fn().mockReturnValue(new Uint8Array());
        native.differenceWKB = undefined;
        native.unionWKB = undefined;
        native.intersectionWKB = undefined;
        native.unaryUnionWKB = undefined;
        __setGeometryBackendForTest(null);
    });

    test("missing differenceWKB → falls back to JS", () => {
        const fallbackSpy = jest.spyOn(jsGeometryBackend, "difference");
        const result = geosGeometryBackend.difference(
            makeSquareFeature(0, 0, 1, 1),
            makeSquareFeature(0.5, 0.5, 1, 1),
        );
        expect(fallbackSpy).toHaveBeenCalled();
        expect(result).not.toBeNull();
        fallbackSpy.mockRestore();
    });

    test("missing unionWKB → falls back to JS", () => {
        const fallbackSpy = jest.spyOn(jsGeometryBackend, "union");
        const result = geosGeometryBackend.union(
            makeSquareFeature(0, 0, 1, 1),
            makeSquareFeature(1, 0, 1, 1),
        );
        expect(fallbackSpy).toHaveBeenCalled();
        expect(result).not.toBeNull();
        fallbackSpy.mockRestore();
    });

    test("missing intersectionWKB → falls back to JS", () => {
        const fallbackSpy = jest.spyOn(jsGeometryBackend, "intersection");
        const result = geosGeometryBackend.intersection(
            makeSquareFeature(0, 0, 1, 1),
            makeSquareFeature(0.5, 0, 1, 1),
        );
        expect(fallbackSpy).toHaveBeenCalled();
        expect(result).not.toBeNull();
        fallbackSpy.mockRestore();
    });

    test("missing unaryUnionWKB → falls back to JS", () => {
        const fallbackSpy = jest.spyOn(jsGeometryBackend, "unaryUnion");
        const result = geosGeometryBackend.unaryUnion(
            makeSquareFeature(0, 0, 1, 1),
        );
        expect(fallbackSpy).toHaveBeenCalled();
        expect(result).not.toBeNull();
        fallbackSpy.mockRestore();
    });
});
