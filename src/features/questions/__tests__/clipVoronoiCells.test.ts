import { featureCollection } from "@turf/helpers";
import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Polygon,
} from "geojson";

import {
    clearClipCellsCache,
    clipCellsToPlayArea,
} from "@/features/questions/clipVoronoiCells";

/**
 * Compute the approximate area of a Polygon or MultiPolygon feature using the
 * shoelace formula. Only uses the outer ring(s) — sufficient for convex-ish
 * test geometries.
 */
function approxArea(feature: Feature<Polygon | MultiPolygon>): number {
    const { geometry } = feature;
    const sumRing = (ring: number[][]) => {
        let area = 0;
        for (let i = 0; i < ring.length - 1; i++) {
            const [x1, y1] = ring[i];
            const [x2, y2] = ring[i + 1];
            area += x1 * y2 - x2 * y1;
        }
        return Math.abs(area) / 2;
    };

    if (geometry.type === "Polygon") {
        return sumRing(geometry.coordinates[0]);
    }
    // MultiPolygon — sum the outer rings
    return geometry.coordinates.reduce(
        (sum, polygon) => sum + sumRing(polygon[0]),
        0,
    );
}

/**
 * Build a simple rectangular boundary: [-1, -1] to [3, 3].
 * This is a 4×4 square centered roughly at [1, 1].
 */
function makeRectBoundary(): FeatureCollection<Polygon | MultiPolygon> {
    const coords = [
        [
            [-1, -1],
            [3, -1],
            [3, 3],
            [-1, 3],
            [-1, -1],
        ],
    ];
    return featureCollection([
        {
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: coords },
        },
    ]) as FeatureCollection<Polygon | MultiPolygon>;
}

/**
 * Build a single square cell from (minX, minY) to (maxX, maxY).
 */
function makeCell(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    props: Record<string, unknown> = {},
): Feature<Polygon> {
    return {
        type: "Feature",
        properties: { osmKey: "test", ...props },
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [minX, minY],
                    [maxX, minY],
                    [maxX, maxY],
                    [minX, maxY],
                    [minX, minY],
                ],
            ],
        },
    };
}

function makeCells(
    ...cellFeatures: Feature<Polygon>[]
): FeatureCollection<Polygon, { osmKey: string; nameLength?: number }> {
    return featureCollection(cellFeatures) as FeatureCollection<
        Polygon,
        { osmKey: string; nameLength?: number }
    >;
}

const boundary = makeRectBoundary();

describe("clipCellsToPlayArea", () => {
    it("returns empty output for empty cells", () => {
        const result = clipCellsToPlayArea(
            featureCollection([]) as FeatureCollection<Polygon>,
            boundary,
        );
        expect(result.features).toHaveLength(0);
        expect(result.type).toBe("FeatureCollection");
    });

    it("returns empty output for an empty boundary", () => {
        const cells = makeCells(makeCell(0, 0, 1, 1));
        const result = clipCellsToPlayArea(cells, {
            features: [],
            type: "FeatureCollection",
        });
        expect(result.features).toHaveLength(0);
    });

    it("returns empty output for a boundary with zero-polygon features", () => {
        const cells = makeCells(makeCell(0, 0, 1, 1));
        // A boundary with an empty MultiPolygon
        const emptyBoundary: FeatureCollection<MultiPolygon> = {
            features: [
                {
                    type: "Feature",
                    properties: {},
                    geometry: { type: "MultiPolygon", coordinates: [] },
                },
            ],
            type: "FeatureCollection",
        };
        const result = clipCellsToPlayArea(
            cells,
            emptyBoundary as FeatureCollection<Polygon | MultiPolygon>,
        );
        expect(result.features).toHaveLength(0);
    });

    it("preserves a cell fully inside the boundary", () => {
        const cell = makeCell(0, 0, 1, 1, { osmKey: "node/42" });
        const cells = makeCells(cell);
        const originalArea = approxArea(
            cell as Feature<Polygon | MultiPolygon>,
        );

        const result = clipCellsToPlayArea(cells, boundary);

        expect(result.features).toHaveLength(1);
        const clippedArea = approxArea(result.features[0]);
        // Area should be approximately equal (allow 1% tolerance for re-noding)
        expect(clippedArea).toBeGreaterThan(originalArea * 0.99);
        expect(clippedArea).toBeLessThan(originalArea * 1.01);
        // Property preservation
        expect(result.features[0].properties?.osmKey).toBe("node/42");
    });

    it("clips a cell partially outside the boundary", () => {
        // Cell that sticks out past the right edge of boundary (which goes to x=3)
        const cell = makeCell(2, 0, 5, 2);
        const cells = makeCells(cell);
        const originalArea = approxArea(
            cell as Feature<Polygon | MultiPolygon>,
        );

        const result = clipCellsToPlayArea(cells, boundary);

        expect(result.features).toHaveLength(1);
        const clippedArea = approxArea(result.features[0]);
        expect(clippedArea).toBeGreaterThan(0);
        expect(clippedArea).toBeLessThan(originalArea);
    });

    it("drops a cell whose site is fully outside the boundary", () => {
        // Cell completely outside the boundary
        const cell = makeCell(10, 10, 11, 11);
        const cells = makeCells(cell);

        const result = clipCellsToPlayArea(cells, boundary);

        expect(result.features).toHaveLength(0);
    });

    it("preserves arbitrary cell properties through clipping", () => {
        const cell = makeCell(0, 0, 1, 1, {
            osmKey: "way/7",
            nameLength: 5,
            custom: "value",
        });
        const cells = makeCells(cell);

        const result = clipCellsToPlayArea(cells, boundary);

        expect(result.features).toHaveLength(1);
        expect(result.features[0].properties).toEqual({
            osmKey: "way/7",
            nameLength: 5,
            custom: "value",
        });
    });

    describe("cache", () => {
        it("returns the same object ref for the same (cells, boundary) input refs", () => {
            const cells = makeCells(makeCell(0, 0, 1, 1));

            const result1 = clipCellsToPlayArea(cells, boundary);
            const result2 = clipCellsToPlayArea(cells, boundary);

            expect(result1).toBe(result2);
        });

        it("does not share cache across different boundaries", () => {
            const cells = makeCells(makeCell(0, 0, 1, 1));
            const boundary2 = makeRectBoundary(); // same shape, different object

            const result1 = clipCellsToPlayArea(cells, boundary);
            const result2 = clipCellsToPlayArea(cells, boundary2);

            // Different boundary objects → different cache keys → different results
            // But they should have the same content since boundary shapes are identical
            expect(result1).not.toBe(result2);
            expect(result1.features).toHaveLength(1);
            expect(result2.features).toHaveLength(1);
        });

        it("clearClipCellsCache causes a fresh recompute on next call", () => {
            const cells = makeCells(makeCell(0, 0, 1, 1));

            const result1 = clipCellsToPlayArea(cells, boundary);
            clearClipCellsCache();
            const result2 = clipCellsToPlayArea(cells, boundary);

            // After clearing, the result is a new object (recomputed)
            expect(result1).not.toBe(result2);
            // But functionally equivalent
            expect(result2.features).toHaveLength(result1.features.length);
        });
    });

    describe("robustness", () => {
        it("drops a degenerate/throwing cell and returns the rest", () => {
            // A cell with a degenerate geometry (self-intersecting / zero-area
            // point) that polyclip-ts cannot clip without throwing, alongside a
            // valid cell that should survive.
            const degenerateCell: Feature<Polygon> = {
                type: "Feature",
                properties: { osmKey: "degenerate/0" },
                geometry: {
                    type: "Polygon",
                    // A self-intersecting "bowtie" ring (collapses to a line)
                    coordinates: [
                        [
                            [0, 0],
                            [1, 1],
                            [0, 1],
                            [1, 0],
                            [0, 0],
                        ],
                    ],
                },
            };
            const goodCell = makeCell(0, 0, 1, 1, { osmKey: "node/99" });

            // Build a fresh cells collection (not previously cached)
            const cells = featureCollection([
                degenerateCell,
                goodCell,
            ]) as FeatureCollection<Polygon, { osmKey: string }>;

            const freshBoundary = makeRectBoundary();

            // Should not throw, and the good cell should be present in the output
            let result: ReturnType<typeof clipCellsToPlayArea>;
            expect(() => {
                result = clipCellsToPlayArea(cells, freshBoundary);
            }).not.toThrow();
            // The good cell must be present (degenerate may be dropped or kept)
            const keys = result!.features.map((f) => f.properties?.osmKey);
            expect(keys).toContain("node/99");
        });

        it("skips undefined features without crashing (regression: turf/voronoi)", () => {
            // @turf/voronoi produces undefined entries in features[] for
            // input points whose Voronoi cell lies entirely outside the
            // bbox. clipCellsToPlayArea must tolerate these.
            const goodCell = makeCell(0, 0, 1, 1, { osmKey: "good" });
            const features: (Feature<Polygon> | undefined)[] = [
                goodCell,
                undefined,
                goodCell,
                undefined,
            ];
            const cells = {
                type: "FeatureCollection" as const,
                features: features as FeatureCollection<
                    Polygon,
                    { osmKey: string }
                >["features"],
            } as FeatureCollection<Polygon, { osmKey: string }>;

            const result = clipCellsToPlayArea(cells, boundary);
            expect(result.features).toHaveLength(2);
            expect(
                result.features.every((f) => f.properties?.osmKey === "good"),
            ).toBe(true);
        });
    });
});
