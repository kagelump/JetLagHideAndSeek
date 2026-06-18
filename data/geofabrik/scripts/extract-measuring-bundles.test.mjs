// NOTE: This file used to validate the committed bundled measuring assets in
// `assets/measuring/*.json` (structural validator, high-speed-rail shape +
// continuity, body-of-water centerlines). Those bundled assets were removed —
// all measuring data now ships in downloadable offline packs and is validated by
// the packs pipeline (`pnpm data:pack:lint`). Only the pure-logic unit tests for
// the extraction helpers remain here; they read no files from disk.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
    stitchSegments,
    cleanPolygonFeature,
    simplifyPolygonFeature,
    polygonPerimeterMeters,
    polygonDissolve,
    unionAllCoords,
} from "./extract-measuring-bundles.mjs";

// ─── Stitcher unit tests (shared-node assembly) ─────────────────────────────

const line = (coords) => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: {},
});

describe("stitchSegments shared-node assembly", () => {
    // The original bug only merged ways digitized head-on; head-to-tail ways
    // (way A's end === way B's start, same travel direction — the common OSM
    // case) were dropped, shattering the line. Lock that case down.
    const a = [
        [139.7, 35.6],
        [139.71, 35.6],
    ];
    const b = [
        [139.71, 35.6],
        [139.72, 35.6],
    ];
    const c = [
        [139.72, 35.6],
        [139.73, 35.6],
    ];

    it("merges three head-to-tail collinear ways into one feature", () => {
        const out = stitchSegments([line(a), line(b), line(c)]);
        assert.strictEqual(out.length, 1);
        assert.strictEqual(out[0].geometry.coordinates.length, 4);
    });

    it("merges regardless of individual way digitization direction", () => {
        const out = stitchSegments([line(a), line([...b].reverse()), line(c)]);
        assert.strictEqual(out.length, 1);
    });

    it("never increases the connected-component count", () => {
        // A straight line split into ways must collapse, not fragment.
        const out = stitchSegments([line(a), line(b), line(c)]);
        assert.ok(out.length <= 3);
        assert.strictEqual(out.length, 1);
    });

    it("does not connect ways that meet at a right angle", () => {
        const branch = [
            [139.71, 35.6],
            [139.71, 35.61],
        ];
        // a + b continue straight; branch turns 90° at the shared node.
        const out = stitchSegments([line(a), line(b), line(branch)]);
        // The straight run merges; the perpendicular branch stays separate.
        assert.strictEqual(out.length, 2);
    });
});

// ─── Polygon-dissolve unit tests ────────────────────────────────────────────

function makePolygon(coords) {
    return {
        type: "Feature",
        bbox: [
            Math.min(...coords[0].map((c) => c[0])),
            Math.min(...coords[0].map((c) => c[1])),
            Math.max(...coords[0].map((c) => c[0])),
            Math.max(...coords[0].map((c) => c[1])),
        ],
        geometry: {
            type: "Polygon",
            coordinates: coords,
        },
        properties: {},
    };
}

describe("polygonDissolve", () => {
    const EXTRACT_BBOX = [139.0, 35.0, 140.0, 36.0];

    /** Simple point-in-polygon (even-odd rule). */
    function pointInPolygon(point, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0],
                yi = ring[i][1];
            const xj = ring[j][0],
                yj = ring[j][1];
            if (
                yi > point[1] !== yj > point[1] &&
                point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
            ) {
                inside = !inside;
            }
        }
        return inside;
    }

    /** Check if a point falls inside any ring of any polygon feature. */
    function pointInAnyPolygon(point, features) {
        for (const f of features) {
            const rings =
                f.geometry.type === "Polygon"
                    ? f.geometry.coordinates
                    : f.geometry.coordinates.flat();
            for (const ring of rings) {
                if (pointInPolygon(point, ring)) return true;
            }
        }
        return false;
    }

    it("dissolve merges overlapping polygons into a single polygon", () => {
        // Two overlapping squares that fit entirely within the tile at
        // [139.0, 35.0] (tile bbox ≈ [138.99, 34.99, 139.26, 35.26]).
        const a = makePolygon([
            [
                [139.0, 35.0],
                [139.12, 35.0],
                [139.12, 35.12],
                [139.0, 35.12],
                [139.0, 35.0],
            ],
        ]);
        const b = makePolygon([
            [
                [139.08, 35.08],
                [139.2, 35.08],
                [139.2, 35.2],
                [139.08, 35.2],
                [139.08, 35.08],
            ],
        ]);
        const result = polygonDissolve([a, b], EXTRACT_BBOX, 0.0001);

        // Two overlapping squares in the same tile MUST merge into one feature.
        assert.strictEqual(
            result.length,
            1,
            `expected 1 merged feature, got ${result.length}`,
        );

        const f = result[0];
        assert.ok(
            f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon",
            `unexpected geometry type: ${f.geometry.type}`,
        );
        assert.ok(Array.isArray(f.bbox) && f.bbox.length === 4);

        // All rings must be closed and have ≥ 4 coords.
        const rings =
            f.geometry.type === "Polygon"
                ? f.geometry.coordinates
                : f.geometry.coordinates.flat();
        for (const ring of rings) {
            assert.ok(
                ring.length >= 4,
                `degenerate ring: ${ring.length} coords`,
            );
            const first = ring[0];
            const last = ring[ring.length - 1];
            assert.strictEqual(first[0], last[0], "ring does not close (lon)");
            assert.strictEqual(first[1], last[1], "ring does not close (lat)");
        }

        // Shoelace area of the merged feature should approximate the union
        // area (≈ 0.0272 sq deg), NOT the sum (≈ 0.0288 sq deg).  The two
        // 0.12°×0.12° squares overlap by 0.04°×0.04°.
        function shoelaceAreaSqDeg(ring) {
            let area = 0;
            for (let i = 0; i < ring.length - 1; i++) {
                area += ring[i][0] * ring[i + 1][1];
                area -= ring[i + 1][0] * ring[i][1];
            }
            return Math.abs(area) / 2;
        }
        const totalArea = rings.reduce(
            (sum, r) => sum + shoelaceAreaSqDeg(r),
            0,
        );
        const sumArea = 0.0288; // 2 × 0.0144
        assert.ok(
            totalArea < sumArea - 0.0005,
            `area ${totalArea.toFixed(4)} ≈ sum ${sumArea} — polygons did not merge`,
        );
    });

    it("tiling produces no gaps at tile boundaries", () => {
        // A single polygon that straddles the 0.25° tile boundary at lon=139.25.
        // It should appear (possibly split) in both tiles with no lost area.
        const straddle = makePolygon([
            [
                [139.2, 35.1],
                [139.3, 35.1],
                [139.3, 35.2],
                [139.2, 35.2],
                [139.2, 35.1],
            ],
        ]);
        const result = polygonDissolve([straddle], EXTRACT_BBOX, 0.001);
        // With a single polygon, we should get at least 1 feature.
        assert.ok(result.length >= 1, "straddling polygon was lost");
        // The union of all result features should cover the original area.
        // Quick check: at least one feature contains the center of the straddle.
        const center = [139.25, 35.15];
        let insideCenter = false;
        for (const f of result) {
            const rings =
                f.geometry.type === "Polygon"
                    ? f.geometry.coordinates
                    : f.geometry.coordinates.flat();
            for (const ring of rings) {
                // Simple point-in-polygon (even-odd rule).
                let inside = false;
                for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                    const xi = ring[i][0],
                        yi = ring[i][1];
                    const xj = ring[j][0],
                        yj = ring[j][1];
                    if (
                        yi > center[1] !== yj > center[1] &&
                        center[0] <
                            ((xj - xi) * (center[1] - yi)) / (yj - yi) + xi
                    ) {
                        inside = !inside;
                    }
                }
                if (inside) {
                    insideCenter = true;
                    break;
                }
            }
            if (insideCenter) break;
        }
        assert.ok(
            insideCenter,
            "straddling polygon center [139.25, 35.15] not inside any output feature",
        );
    });

    it("output features are valid polygons with bbox", () => {
        const square = makePolygon([
            [
                [139.1, 35.1],
                [139.2, 35.1],
                [139.2, 35.2],
                [139.1, 35.2],
                [139.1, 35.1],
            ],
        ]);
        const result = polygonDissolve([square], EXTRACT_BBOX, 0.001);
        assert.ok(result.length >= 1);
        for (const f of result) {
            assert.ok(
                f.geometry.type === "Polygon" ||
                    f.geometry.type === "MultiPolygon",
            );
            assert.ok(Array.isArray(f.bbox) && f.bbox.length === 4);
            for (const v of f.bbox) {
                assert.ok(Number.isFinite(v));
            }
        }
    });

    it("returns empty array for empty input", () => {
        const result = polygonDissolve([], EXTRACT_BBOX, 0.001);
        assert.strictEqual(result.length, 0);
    });

    it("handles a MultiPolygon input feature", () => {
        const mp = {
            type: "Feature",
            bbox: [139.0, 35.0, 139.4, 35.4],
            geometry: {
                type: "MultiPolygon",
                coordinates: [
                    [
                        [
                            [139.0, 35.0],
                            [139.2, 35.0],
                            [139.2, 35.2],
                            [139.0, 35.2],
                            [139.0, 35.0],
                        ],
                    ],
                    [
                        [
                            [139.2, 35.2],
                            [139.4, 35.2],
                            [139.4, 35.4],
                            [139.2, 35.4],
                            [139.2, 35.2],
                        ],
                    ],
                ],
            },
            properties: {},
        };
        const result = polygonDissolve([mp], EXTRACT_BBOX, 0.001);
        assert.ok(result.length >= 1);
        // The two disjoint parts of the MultiPolygon should be preserved
        // (each in its own tile).
        for (const f of result) {
            assert.ok(
                f.geometry.type === "Polygon" ||
                    f.geometry.type === "MultiPolygon",
            );
        }
    });

    it("cross-tile dissolve does not produce overlapping polygons", () => {
        // Two narrow river-like polygons straddling the tile boundary at
        // lat 35.25 (tile 0: [34.99, 35.26], tile 1: [35.24, 35.51]).
        // Each polygon is a narrow strip crossing the boundary. Adjacent
        // tiles dissolve them independently, producing overlapping output
        // with different outlines in the overlap zone [35.24, 35.26].
        //
        // This is a regression test for the cross-tile overlap bug that
        // caused weird merge visuals at bridge areas (e.g. OSM ways
        // 624304778 + 624304779).
        const riverA = makePolygon([
            [
                [139.1, 35.23],
                [139.12, 35.23],
                [139.12, 35.27],
                [139.1, 35.27],
                [139.1, 35.23],
            ],
        ]);
        const riverB = makePolygon([
            [
                [139.12, 35.23],
                [139.14, 35.23],
                [139.14, 35.27],
                [139.12, 35.27],
                [139.12, 35.23],
            ],
        ]);

        const dissolved = polygonDissolve(
            [riverA, riverB],
            EXTRACT_BBOX,
            0.0001,
        );

        // Per-tile dissolve produces ≥2 features when the polygons
        // straddle a tile boundary (overlap artifacts).
        assert.ok(
            dissolved.length >= 2,
            `expected ≥2 per-tile features, got ${dissolved.length}`,
        );

        // Cross-tile merge should produce a single clean polygon.
        const mergedCoords = unionAllCoords(
            dissolved.map((f) => f.geometry.coordinates),
        );
        assert.strictEqual(
            mergedCoords.length,
            1,
            `expected 1 merged polygon, got ${mergedCoords.length}`,
        );

        const merged = [
            {
                type: "Feature",
                geometry: {
                    type: "MultiPolygon",
                    coordinates: mergedCoords[0],
                },
            },
        ];

        // Both input polygon centers must be inside the merged result.
        const centerA = [139.11, 35.25];
        const centerB = [139.13, 35.25];
        assert.ok(
            pointInAnyPolygon(centerA, merged),
            "center of riverA not inside merged polygon",
        );
        assert.ok(
            pointInAnyPolygon(centerB, merged),
            "center of riverB not inside merged polygon",
        );

        // The merged polygon must not have overlapping rings — check that
        // no two outer rings have >50% area overlap. This is the core
        // regression assertion: before the fix, the per-tile features
        // overlapped in the tile boundary zone.
        function shoelaceAreaSqDeg(ring) {
            let area = 0;
            for (let i = 0; i < ring.length - 1; i++) {
                area += ring[i][0] * ring[i + 1][1];
                area -= ring[i + 1][0] * ring[i][1];
            }
            return Math.abs(area / 2);
        }

        function bboxOverlapArea(a, b) {
            const west = Math.max(a[0], b[0]);
            const east = Math.min(a[2], b[2]);
            const south = Math.max(a[1], b[1]);
            const north = Math.min(a[3], b[3]);
            if (west >= east || south >= north) return 0;
            return (east - west) * (north - south);
        }

        function ringBbox(ring) {
            let minLon = Infinity,
                maxLon = -Infinity,
                minLat = Infinity,
                maxLat = -Infinity;
            for (const [lon, lat] of ring) {
                if (lon < minLon) minLon = lon;
                if (lon > maxLon) maxLon = lon;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            }
            return [minLon, minLat, maxLon, maxLat];
        }

        // Collect all outer rings from the merged polygon.
        const outerRings = [];
        for (const poly of mergedCoords[0]) {
            outerRings.push(poly[0]);
        }
        for (let i = 0; i < outerRings.length; i++) {
            for (let j = i + 1; j < outerRings.length; j++) {
                const areaI = shoelaceAreaSqDeg(outerRings[i]);
                const areaJ = shoelaceAreaSqDeg(outerRings[j]);
                const overlap = bboxOverlapArea(
                    ringBbox(outerRings[i]),
                    ringBbox(outerRings[j]),
                );
                const minArea = Math.min(areaI, areaJ);
                if (minArea > 0) {
                    assert.ok(
                        overlap / minArea < 0.5,
                        `outer rings ${i} and ${j} overlap ${((overlap / minArea) * 100).toFixed(1)}% (bbox estimate)`,
                    );
                }
            }
        }
    });
});

describe("cleanPolygonFeature", () => {
    it("strips consecutive duplicate coords from all rings", () => {
        const feat = {
            type: "Feature",
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [139.0, 35.0],
                        [139.0, 35.0], // duplicate
                        [139.1, 35.0],
                        [139.1, 35.1],
                        [139.0, 35.1],
                        [139.0, 35.0],
                    ],
                ],
            },
            properties: {},
        };
        const cleaned = cleanPolygonFeature(feat);
        assert.ok(cleaned);
        const ring = cleaned.geometry.coordinates[0];
        assert.strictEqual(ring.length, 5); // 5 unique vertices (including closing)
    });

    it("drops rings that collapse to fewer than 3 coords", () => {
        const feat = {
            type: "Feature",
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [139.0, 35.0],
                        [139.0, 35.0],
                        [139.0, 35.0],
                        [139.0, 35.0],
                    ],
                ],
            },
            properties: {},
        };
        const cleaned = cleanPolygonFeature(feat);
        // All coords are identical → ring collapses → feature is dropped.
        assert.strictEqual(cleaned, null);
    });
});

describe("polygonPerimeterMeters", () => {
    it("computes perimeter of a square polygon", () => {
        // ~0.01° square at latitude 35° → approximately 4 * 0.01 * 111320 ≈ 4453 m.
        const geom = {
            type: "Polygon",
            coordinates: [
                [
                    [139.0, 35.0],
                    [139.01, 35.0],
                    [139.01, 35.01],
                    [139.0, 35.01],
                    [139.0, 35.0],
                ],
            ],
        };
        const perim = polygonPerimeterMeters(geom);
        assert.ok(perim > 3000 && perim < 6000, `got perimeter=${perim}`);
    });
});

// ─── simplifyPolygonFeature collapse-fallback (P7-B) ─────────────────────

describe("simplifyPolygonFeature collapse-fallback", () => {
    it("retains a thin (~20 m wide) polygon that would collapse at default tolerance", () => {
        // A ~20 m wide riverbank rectangle. At 0.0002° (~22 m) tolerance,
        // the narrow axis collapses to just the two endpoints — pre-fix
        // this was dropped. Post-fix the collapse-fallback keeps it.
        const cx = 139.7,
            cy = 35.6;
        const hw = 0.00009; // half-width ≈ 10 m at mid-latitudes
        const hh = 0.0009; // half-height ≈ 100 m
        const feat = {
            type: "Feature",
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [cx - hw, cy - hh],
                        [cx + hw, cy - hh],
                        [cx + hw, cy + hh],
                        [cx - hw, cy + hh],
                        [cx - hw, cy - hh],
                    ],
                ],
            },
            properties: {},
        };
        const result = simplifyPolygonFeature(feat, 0.0002);
        assert.ok(
            result,
            "thin polygon should be retained by collapse-fallback",
        );
        assert.strictEqual(result.geometry.type, "Polygon");
        // The ring should still have at least 4 coords.
        assert.ok(
            result.geometry.coordinates[0].length >= 4,
            `ring collapsed to ${result.geometry.coordinates[0].length} coords`,
        );
    });

    it("drops a polygon whose source ring genuinely has < 4 unique coords", () => {
        // A degenerate ring: all coords identical.
        const feat = {
            type: "Feature",
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [139.0, 35.0],
                        [139.0, 35.0],
                        [139.0, 35.0],
                        [139.0, 35.0],
                    ],
                ],
            },
            properties: {},
        };
        const result = simplifyPolygonFeature(feat, 0.0002);
        assert.strictEqual(
            result,
            null,
            "genuinely degenerate ring should still be dropped",
        );
    });
});
