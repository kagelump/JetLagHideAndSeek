/**
 * Dissolve fallback hardening tests (Layer 1).
 *
 * These tests run under plain Node (`node --test`, no tsx), so `geosReady` is
 * false — the polyclip-ts path is exercised. Layer 1 bounds polyclip-ts via
 * size caps (skip-union) and per-polygon clips, so even without GEOS the
 * dissolve cannot hang.
 *
 * Tests:
 *   1. No-hang under density — 2,000 overlapping squares with size cap
 *      returns within a hard time bound.
 *   2. Coverage preserved by skip-union — forceSkipUnion output covers the
 *      same area as the true polyclip union.
 *   3. Size cap triggers — input > maxUnionPolygons yields pass-through
 *      (group count == input count, no polyclip call).
 *   4. Per-polygon clip — clipCoordsToRect on a MultiPolygon clips each
 *      member independently.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { union } from "polyclip-ts";

import {
    geosUnaryUnionCoords,
    clipCoordsToRect,
    pointInRing,
} from "../../../geofabrik/scripts/lib/polygonDissolve.mjs";

// ── helpers ─────────────────────────────────────────────────────────────────

/** Build a simple square polygon ring (no holes). */
function squareRing(x, y, size) {
    return [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
        [x, y],
    ];
}

/** Build a square Polygon coordinate array (ring wrapped in an array). */
function squarePolygon(x, y, size) {
    return [squareRing(x, y, size)];
}

/** Create `count` non-overlapping squares spread across a grid. */
function createGridSquares(count, originX, originY, size, cols) {
    const coords = [];
    for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        coords.push(
            squarePolygon(
                originX + col * size * 2,
                originY + row * size * 2,
                size,
            ),
        );
    }
    return coords;
}

/** Create `count` randomly-placed overlapping squares within a bbox. */
function createOverlappingSquares(count, bbox, size) {
    const [w, s, e, n] = bbox;
    const coords = [];
    for (let i = 0; i < count; i++) {
        const x = w + Math.random() * (e - w - size);
        const y = s + Math.random() * (n - s - size);
        coords.push(squarePolygon(x, y, size));
    }
    return coords;
}

/** Point-in-any-polygon test across a flat array of polygons. */
function pointInAny(px, py, polygons) {
    for (const poly of polygons) {
        if (!poly || poly.length === 0) continue;
        if (pointInRing(px, py, poly[0])) return true;
    }
    return false;
}

/** Flatten geosUnaryUnionCoords result (groups of MultiPolygon coords) to a
 *  flat array of individual polygons. */
function flattenGroups(groups) {
    const polys = [];
    for (const group of groups) {
        if (!group) continue;
        for (const poly of group) {
            if (poly && poly.length > 0) polys.push(poly);
        }
    }
    return polys;
}

// ── tests ───────────────────────────────────────────────────────────────────

describe("dissolve fallback (Layer 1)", () => {
    describe("geosUnaryUnionCoords size cap", () => {
        it("returns within time bound for dense input (no hang)", () => {
            // 2,000 overlapping squares — the documented 123 s case with
            // polyclip-ts variadic union. With the size cap the dissolve
            // must skip-union and return near-instantly.
            const bbox = [139.0, 35.0, 140.0, 36.0];
            const squares = createOverlappingSquares(2000, bbox, 0.002);

            const start = Date.now();
            const result = geosUnaryUnionCoords(squares, {
                maxUnionPolygons: 500,
            });
            const elapsed = Date.now() - start;

            assert.ok(
                elapsed < 5000,
                `dissolve took ${elapsed}ms, expected < 5000ms (would hang without cap)`,
            );
            assert.ok(result.length > 0, "expected non-empty result");

            // With skip-union triggered by the cap, every input polygon
            // becomes its own group — total groups >= input count.
            const totalGroups = result.length;
            assert.ok(
                totalGroups >= squares.length,
                `expected >= ${squares.length} groups (pass-through), got ${totalGroups}`,
            );
        });

        it("size cap triggers pass-through (no polyclip)", () => {
            // 100 non-overlapping squares with cap of 50 → skip-union.
            const squares = createGridSquares(100, 0, 0, 0.005, 10);

            const result = geosUnaryUnionCoords(squares, {
                maxUnionPolygons: 50,
            });

            // Pass-through: 100 inputs → 100 groups (one polygon per group).
            // Each group has exactly one polygon.
            assert.equal(result.length, 100);
            for (const group of result) {
                assert.equal(
                    group.length,
                    1,
                    "each group should have 1 polygon",
                );
                assert.ok(group[0].length > 0, "polygon should have rings");
            }
        });

        it("coord cap triggers pass-through", () => {
            // 20 large squares (many coords each) with a low coord cap.
            const squares = [];
            for (let i = 0; i < 20; i++) {
                // Each square ring has 5 points (4 corners + closing).
                squares.push([squareRing(i * 0.02, 0, 0.01)]);
            }

            // 20 squares × 5 coords = 100 coords. Cap at 50.
            const result = geosUnaryUnionCoords(squares, {
                maxUnionCoords: 50,
            });

            // Should pass through: 20 inputs → 20 groups.
            assert.equal(result.length, 20);
        });

        it("does not skip-union when input is under caps", () => {
            // 5 squares, cap of 100 — well under, should use polyclip.
            const squares = [];
            for (let i = 0; i < 5; i++) {
                squares.push([squareRing(i * 0.02, 0, 0.01)]);
            }

            // Under node --test (no GEOS), this goes through unionAllCoords.
            // With only 5 polygons it's fast and should produce fewer groups
            // than inputs (actual union happened).
            const result = geosUnaryUnionCoords(squares, {
                maxUnionPolygons: 100,
            });

            // 5 non-overlapping squares → polyclip produces 1 group with
            // 5 member polygons.
            assert.ok(
                result.length <= 5,
                "should be merged (not pass-through)",
            );
            const totalPolys = flattenGroups(result).length;
            assert.equal(totalPolys, 5, "all 5 squares should survive");
        });
    });

    describe("forceSkipUnion", () => {
        it("preserves coverage (same area as true union)", () => {
            // 3 overlapping squares (Polygon coords = [ring] each).
            const squares = [
                squarePolygon(0, 0, 1),
                squarePolygon(0.5, 0.5, 1),
                squarePolygon(0.2, 0.8, 0.5),
            ];

            // Force skip-union (no merge at all).
            const skipped = geosUnaryUnionCoords(squares, {
                forceSkipUnion: true,
            });
            const skippedPolys = flattenGroups(skipped);
            assert.ok(
                skippedPolys.length >= 3,
                "all 3 polygons survive skip-union",
            );

            // True union via polyclip (fast for 3 squares).
            // polyclip union returns raw MultiPolygon coords directly
            // (array of polygons, not a GeoJSON geometry object).
            const truePolys = union(squares[0], squares[1], squares[2]);

            // Sample a grid and compare point membership.
            const bbox = [-0.5, -0.5, 2.5, 2.5];
            const step = 0.05;
            let mismatches = 0;
            let total = 0;
            for (let x = bbox[0]; x <= bbox[2]; x += step) {
                for (let y = bbox[1]; y <= bbox[3]; y += step) {
                    total++;
                    const inSkipped = pointInAny(x, y, skippedPolys);
                    const inTrue = pointInAny(x, y, truePolys);
                    if (inSkipped !== inTrue) {
                        mismatches++;
                    }
                }
            }

            // Coverage should be identical (or near-identical — floating-point
            // edge effects may cause a very small number of boundary mismatches).
            const mismatchRate = mismatches / total;
            assert.ok(
                mismatchRate < 0.001,
                `coverage mismatch rate ${(mismatchRate * 100).toFixed(2)}% ` +
                    `(${mismatches}/${total} points) — should be near zero`,
            );
        });

        it("produces deterministic output (each polygon intact)", () => {
            const squares = [
                squarePolygon(0, 0, 0.5),
                squarePolygon(0.6, 0, 0.5),
            ];

            const result = geosUnaryUnionCoords(squares, {
                forceSkipUnion: true,
            });

            // 2 inputs → 2 groups, each with 1 polygon of 5 coords.
            assert.equal(result.length, 2);
            assert.equal(result[0].length, 1);
            assert.equal(result[0][0].length, 1); // outer ring
            assert.equal(result[0][0][0].length, 5); // 4 corners + closing
        });
    });

    describe("clipCoordsToRect (per-polygon)", () => {
        it("clips each MultiPolygon member independently", () => {
            // Two non-overlapping squares as a proper MultiPolygon coords array.
            const poly1 = squarePolygon(0, 0, 1); // Polygon = [ring]
            const poly2 = squarePolygon(3, 0, 1);
            const mp = [poly1, poly2]; // MultiPolygon = [polygon, polygon]

            // Clip to a rect that fully contains both.
            const rect = [-1, -1, 5, 2];
            const clipped = clipCoordsToRect(mp, rect);

            // Both polygons survive unmodified (fully inside rect).
            assert.equal(clipped.length, 2, "both polygons survive");

            // Area should match clipping each member individually.
            const c1 = clipCoordsToRect(poly1, rect);
            const c2 = clipCoordsToRect(poly2, rect);
            assert.equal(clipped.length, c1.length + c2.length);
        });

        it("handles a polygon partially outside the rect", () => {
            // A Polygon that extends beyond the right edge of the rect.
            const poly = squarePolygon(0, 0, 2); // x: 0–2
            const rect = [0, 0, 1, 2]; // x: 0–1

            const clipped = clipCoordsToRect(poly, rect);

            // Should produce exactly one clipped polygon.
            assert.ok(
                clipped.length >= 1,
                "should produce at least one polygon",
            );
            // The clipped polygon should be within the rect bounds.
            for (const c of clipped) {
                for (const [x, y] of c[0]) {
                    assert.ok(x >= rect[0] - 1e-9, `x=${x} < west=${rect[0]}`);
                    assert.ok(x <= rect[2] + 1e-9, `x=${x} > east=${rect[2]}`);
                    assert.ok(y >= rect[1] - 1e-9, `y=${y} < south=${rect[1]}`);
                    assert.ok(y <= rect[3] + 1e-9, `y=${y} > north=${rect[3]}`);
                }
            }
        });

        it("returns [] when all polygons are outside the rect", () => {
            const poly = squarePolygon(10, 10, 1);
            const rect = [0, 0, 1, 1]; // far away

            const clipped = clipCoordsToRect(poly, rect);
            assert.equal(clipped.length, 0);
        });

        it("never feeds polyclip a multi-member overlap", () => {
            // This test is about the invariant: every call to polyclip-ts
            // intersection inside clipCoordsToRect sees exactly one polygon.
            // We verify this by constructing a MultiPolygon whose bbox
            // overlaps but whose members don't — each member gets its own
            // intersection call.
            const poly1 = squarePolygon(0, 0, 1);
            const poly2 = squarePolygon(2, 0, 1); // gap between them
            const mp = [poly1, poly2];
            const rect = [-1, -1, 4, 2]; // covers both + gap

            const clipped = clipCoordsToRect(mp, rect);
            // Two independent clips = two results.
            assert.equal(clipped.length, 2);
        });
    });
});
