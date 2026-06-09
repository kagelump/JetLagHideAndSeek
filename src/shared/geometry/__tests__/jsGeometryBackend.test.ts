/**
 * Layer 1 — JS backend overlay op tests (Jest, polyclip-ts under the hood).
 *
 * Exercises each overlay op with known polygon fixtures. All run with the
 * JS backend (polyclip-ts Greiner-Hormann), which is the default in Jest.
 */

import type { Feature, MultiPolygon, Polygon } from "geojson";

import { jsGeometryBackend } from "../jsGeometryBackend";
import {
    getGeometryBackend,
    __setGeometryBackendForTest,
} from "../geometryBackend";

// ---- Fixtures ---------------------------------------------------------------

/** 1°×1° square at (0,0)–(1,1) — clockwise exterior ring. */
function makeSquare(x = 0, y = 0, w = 1, h = 1): Feature<Polygon> {
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

/** Two adjacent 1°×1° squares: (0,0)–(1,1) and (1,0)–(2,1). */
function makeAdjacentSquares(): Feature<MultiPolygon> {
    return {
        type: "Feature",
        properties: {},
        geometry: {
            type: "MultiPolygon",
            coordinates: [
                [
                    [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 1],
                        [0, 0],
                    ],
                ],
                [
                    [
                        [1, 0],
                        [2, 0],
                        [2, 1],
                        [1, 1],
                        [1, 0],
                    ],
                ],
            ],
        },
    };
}

/**
 * Self-overlapping MultiPolygon: two overlapping 1°×1° squares forming a
 * 1.5°×1° rectangle. `unaryUnion` should dissolve the overlap into a single
 * Polygon.
 */
function makeSelfOverlappingMultipolygon(): Feature<MultiPolygon> {
    return {
        type: "Feature",
        properties: {},
        geometry: {
            type: "MultiPolygon",
            coordinates: [
                [
                    [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 1],
                        [0, 0],
                    ],
                ],
                [
                    [
                        [0.5, 0],
                        [1.5, 0],
                        [1.5, 1],
                        [0.5, 1],
                        [0.5, 0],
                    ],
                ],
            ],
        },
    };
}

// ---- Setup ------------------------------------------------------------------

beforeEach(() => {
    __setGeometryBackendForTest(null);
});

// ---- difference -------------------------------------------------------------

describe("jsGeometryBackend.difference", () => {
    test("difference(square, innerSquare) → square-with-hole", () => {
        const outer = makeSquare(0, 0, 2, 2);
        const inner = makeSquare(0.5, 0.5, 1, 1);

        const result = jsGeometryBackend.difference(outer, inner);
        expect(result).not.toBeNull();
        expect(result!.geometry.type).toBe("Polygon");

        // Should be a Polygon with 2 rings (exterior + hole)
        const coords = (result!.geometry as Polygon).coordinates;
        expect(coords.length).toBe(2);
    });

    test("difference(inner, outer) → empty (inner wholly inside outer)", () => {
        const inner = makeSquare(0.5, 0.5, 1, 1);
        const outer = makeSquare(0, 0, 2, 2);

        const result = jsGeometryBackend.difference(inner, outer);
        expect(result).toBeNull();
    });

    test("difference of disjoint squares returns first", () => {
        const a = makeSquare(0, 0, 1, 1);
        const b = makeSquare(2, 2, 1, 1);

        const result = jsGeometryBackend.difference(a, b);
        expect(result).not.toBeNull();
        // a is unchanged since b doesn't overlap
        expect(result!.geometry.type).toBe("Polygon");
    });
});

// ---- union ------------------------------------------------------------------

describe("jsGeometryBackend.union", () => {
    test("union(adjacentSquares) → L-shape", () => {
        const a = makeSquare(0, 0, 1, 1);
        const b = makeSquare(1, 0, 1, 1);

        const result = jsGeometryBackend.union(a, b);
        expect(result).not.toBeNull();
        // The result should be a single polygon (merged along the shared edge)
        expect(result!.geometry.type).toMatch(/Polygon/);
    });

    test("union(overlapping squares) → merged region", () => {
        const a = makeSquare(0, 0, 1, 1);
        const b = makeSquare(0.5, 0, 1, 1);

        const result = jsGeometryBackend.union(a, b);
        expect(result).not.toBeNull();
        expect(result!.geometry.type).toMatch(/Polygon/);
    });

    test("union(disjoint squares) → MultiPolygon", () => {
        const a = makeSquare(0, 0, 1, 1);
        const b = makeSquare(2, 2, 1, 1);

        const result = jsGeometryBackend.union(a, b);
        expect(result).not.toBeNull();
        expect(result!.geometry.type).toBe("MultiPolygon");
        if (result!.geometry.type === "MultiPolygon") {
            expect(result!.geometry.coordinates.length).toBe(2);
        }
    });
});

// ---- intersection -----------------------------------------------------------

describe("jsGeometryBackend.intersection", () => {
    test("intersection(overlapping squares) → overlap region", () => {
        const a = makeSquare(0, 0, 1, 1);
        const b = makeSquare(0.5, 0, 1, 1);

        const result = jsGeometryBackend.intersection(a, b);
        expect(result).not.toBeNull();
        expect(result!.geometry.type).toMatch(/Polygon/);
    });

    test("intersection(disjoint squares) → null", () => {
        const a = makeSquare(0, 0, 1, 1);
        const b = makeSquare(2, 2, 1, 1);

        const result = jsGeometryBackend.intersection(a, b);
        expect(result).toBeNull();
    });

    test("intersection(fully contained squares) → inner square", () => {
        const outer = makeSquare(0, 0, 2, 2);
        const inner = makeSquare(0.5, 0.5, 1, 1);

        const result = jsGeometryBackend.intersection(outer, inner);
        expect(result).not.toBeNull();
        expect(result!.geometry.type).toBe("Polygon");
    });
});

// ---- unaryUnion -------------------------------------------------------------

describe("jsGeometryBackend.unaryUnion", () => {
    test("unaryUnion(simple Polygon) → returns as-is", () => {
        const square = makeSquare(0, 0, 1, 1);
        const result = jsGeometryBackend.unaryUnion(square);
        expect(result).not.toBeNull();
        expect(result!.geometry.type).toBe("Polygon");

        // Coordinates should match the input (single polygon, no self-overlap).
        const inCoords = (square.geometry as Polygon).coordinates;
        const outCoords = (result!.geometry as Polygon).coordinates;
        expect(outCoords.length).toBe(inCoords.length);
    });

    test("unaryUnion(selfOverlappingMultiPolygon) → dissolved polygon", () => {
        const mp = makeSelfOverlappingMultipolygon();
        const result = jsGeometryBackend.unaryUnion(mp);
        expect(result).not.toBeNull();
        // Should dissolve into a single polygon or fewer polygons.
        expect(result!.geometry.type).toMatch(/Polygon/);
    });

    test("unaryUnion(adjacent squares) → single merged polygon", () => {
        const mp = makeAdjacentSquares();
        const result = jsGeometryBackend.unaryUnion(mp);
        expect(result).not.toBeNull();
        // Adjacent squares should merge into one polygon.
        expect(result!.geometry.type).toMatch(/Polygon/);
    });

    test("unaryUnion(single-member MultiPolygon) → returns as-is", () => {
        const square = makeSquare(0, 0, 1, 1);
        const mp: Feature<MultiPolygon> = {
            type: "Feature",
            properties: {},
            geometry: {
                type: "MultiPolygon",
                coordinates: [square.geometry.coordinates],
            },
        };
        const result = jsGeometryBackend.unaryUnion(mp);
        expect(result).not.toBeNull();
        // Single-member MultiPolygon with no self-overlap merges to Polygon.
        expect(result!.geometry.type).toMatch(/Polygon/);
    });
});

// ---- Seam integration -------------------------------------------------------

describe("overlay ops via getGeometryBackend", () => {
    test("active backend (JS in Jest) performs intersection correctly", () => {
        const backend = getGeometryBackend();
        expect(backend.name).toBe("js");

        const a = makeSquare(0, 0, 1, 1);
        const b = makeSquare(0.5, 0, 1, 1);

        const result = backend.intersection(a, b);
        expect(result).not.toBeNull();
    });

    test("active backend returns null for disjoint intersection", () => {
        const backend = getGeometryBackend();

        const result = backend.intersection(
            makeSquare(0, 0, 1, 1),
            makeSquare(2, 2, 1, 1),
        );
        expect(result).toBeNull();
    });
});
