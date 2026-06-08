import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    stitchSegments,
    validateLineContinuity,
    cleanPolygonFeature,
    polygonPerimeterMeters,
    polygonDissolve,
} from "./extract-measuring-bundles.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..", "..", "..");
const measuringDir = resolve(root, "assets", "measuring");

const CATEGORY_KEYS = [
    "coastline",
    "high-speed-rail",
    "body-of-water",
    "admin-1st-border",
    "admin-2nd-border",
];

describe("measuring bundle structural validator", () => {
    for (const key of CATEGORY_KEYS) {
        const bundlePath = resolve(measuringDir, `${key}.json`);

        describe(`${key}.json`, () => {
            let bundle;

            it("exists on disk", () => {
                assert.ok(
                    existsSync(bundlePath),
                    `${bundlePath} not found — run pnpm data:measuring to generate`,
                );
                if (existsSync(bundlePath)) {
                    const raw = readFileSync(bundlePath, "utf8");
                    bundle = JSON.parse(raw);
                }
            });

            if (!existsSync(bundlePath)) {
                // Skip remaining checks if bundle doesn't exist yet.
                return;
            }

            it("has schemaVersion 1 (or 2 for polygon-dissolve bundles)", () => {
                if (key === "body-of-water") {
                    // body-of-water uses polygon-dissolve → schemaVersion 2
                    assert.strictEqual(bundle.schemaVersion, 2);
                } else {
                    assert.strictEqual(bundle.schemaVersion, 1);
                }
            });

            it("has correct category field", () => {
                assert.strictEqual(bundle.category, key);
            });

            it("has a valid generatedAt ISO string", () => {
                assert.ok(
                    typeof bundle.generatedAt === "string" &&
                        bundle.generatedAt.length > 0,
                );
            });

            it("has source set to japan-latest", () => {
                assert.strictEqual(bundle.source, "japan-latest");
            });

            it("has extractBbox of 4 finite numbers", () => {
                const bbox = bundle.extractBbox;
                assert.ok(Array.isArray(bbox));
                assert.strictEqual(bbox.length, 4);
                for (const v of bbox) {
                    assert.ok(Number.isFinite(v));
                }
                // Bbox should be within the Kantō+margin window [137.9, 33.9, 141.9, 37.9]
                assert.ok(bbox[0] >= 137.9, `west=${bbox[0]} < 137.9`);
                assert.ok(bbox[1] >= 33.9, `south=${bbox[1]} < 33.9`);
                assert.ok(bbox[2] <= 141.9, `east=${bbox[2]} > 141.9`);
                assert.ok(bbox[3] <= 37.9, `north=${bbox[3]} > 37.9`);
            });

            it("has attribution block", () => {
                assert.ok(bundle.attribution);
                assert.ok(typeof bundle.attribution.text === "string");
                assert.ok(typeof bundle.attribution.license === "string");
                assert.ok(typeof bundle.attribution.url === "string");
            });

            it("has features array", () => {
                assert.ok(Array.isArray(bundle.features));
                assert.ok(
                    bundle.features.length > 0,
                    "bundle should not be empty",
                );
            });

            it("every feature is a LineString, MultiLineString, Polygon, or MultiPolygon", () => {
                const validTypes = new Set([
                    "LineString",
                    "MultiLineString",
                    "Polygon",
                    "MultiPolygon",
                ]);
                for (const f of bundle.features) {
                    assert.ok(
                        validTypes.has(f.geometry.type),
                        `unexpected geometry type: ${f.geometry.type}`,
                    );
                }
            });

            it("every feature has a non-empty coordinates array", () => {
                for (const f of bundle.features) {
                    assert.ok(Array.isArray(f.geometry.coordinates));
                    if (f.geometry.type === "LineString") {
                        assert.ok(
                            f.geometry.coordinates.length >= 2,
                            "LineString needs at least 2 coords",
                        );
                    } else if (f.geometry.type === "MultiLineString") {
                        for (const seg of f.geometry.coordinates) {
                            assert.ok(
                                seg.length >= 2,
                                "MultiLineString segment needs at least 2 coords",
                            );
                        }
                    } else if (f.geometry.type === "Polygon") {
                        // Polygon: array of rings, at least 1 outer ring with ≥ 4 coords.
                        assert.ok(
                            f.geometry.coordinates.length >= 1,
                            "Polygon needs at least 1 ring",
                        );
                        assert.ok(
                            f.geometry.coordinates[0].length >= 4,
                            "Polygon outer ring needs at least 4 coords",
                        );
                    } else if (f.geometry.type === "MultiPolygon") {
                        assert.ok(
                            f.geometry.coordinates.length >= 1,
                            "MultiPolygon needs at least 1 polygon",
                        );
                        for (const poly of f.geometry.coordinates) {
                            assert.ok(
                                poly.length >= 1,
                                "MultiPolygon part needs at least 1 ring",
                            );
                            assert.ok(
                                poly[0].length >= 4,
                                "MultiPolygon outer ring needs at least 4 coords",
                            );
                        }
                    }
                }
            });

            it("every feature has a bbox of 4 finite numbers", () => {
                for (const f of bundle.features) {
                    const bbox = f.bbox;
                    assert.ok(Array.isArray(bbox), "feature missing bbox");
                    assert.strictEqual(bbox.length, 4);
                    for (const v of bbox) {
                        assert.ok(
                            Number.isFinite(v),
                            `bbox value is not finite: ${v}`,
                        );
                    }
                }
            });

            it("every feature bbox intersects or touches the extractBbox", () => {
                const [ew, es, ee, en] = bundle.extractBbox;
                // Small epsilon for floating-point boundary cases (~0.001° ≈ 110 m).
                const EPS = 0.001;
                for (const f of bundle.features) {
                    const [fw, fs, fe, fn] = f.bbox;
                    const intersects =
                        fw - EPS <= ee &&
                        fe + EPS >= ew &&
                        fs - EPS <= en &&
                        fn + EPS >= es;
                    assert.ok(
                        intersects,
                        `feature bbox [${fw}, ${fs}, ${fe}, ${fn}] does not intersect extractBbox [${ew}, ${es}, ${ee}, ${en}]`,
                    );
                }
            });

            it("every feature has valid properties", () => {
                const isAdminBorder =
                    key === "admin-1st-border" || key === "admin-2nd-border";
                for (const f of bundle.features) {
                    if (isAdminBorder) {
                        // Admin border features carry relationId (required)
                        // and optionally name / name:en.
                        assert.ok(
                            typeof f.properties.relationId === "number",
                            `missing relationId: ${JSON.stringify(f.properties)}`,
                        );
                        const keys = Object.keys(f.properties);
                        const allowed = new Set([
                            "relationId",
                            "name",
                            "name:en",
                        ]);
                        for (const k of keys) {
                            assert.ok(
                                allowed.has(k),
                                `unexpected property "${k}" in ${JSON.stringify(f.properties)}`,
                            );
                        }
                        if (keys.includes("name")) {
                            assert.ok(
                                typeof f.properties.name === "string",
                                "name must be a string",
                            );
                        }
                        if (keys.includes("name:en")) {
                            assert.ok(
                                typeof f.properties["name:en"] === "string",
                                "name:en must be a string",
                            );
                        }
                    } else {
                        assert.deepStrictEqual(
                            f.properties,
                            {},
                            "properties should be empty",
                        );
                    }
                }
            });
        });
    }
});

// ─── High-speed-rail shape smoke test ──────────────────────────────────────

function haversineKm(a, b) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLon = Math.sin(dLon / 2);
    const h =
        sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function featureLengthKm(f) {
    const coords = f.geometry.coordinates;
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        total += haversineKm(coords[i], coords[i + 1]);
    }
    return total;
}

describe("high-speed-rail shape smoke test", () => {
    const bundlePath = resolve(measuringDir, "high-speed-rail.json");

    let bundle;
    it("loads the bundle", () => {
        bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
    });

    it("has between 8 and 600 features (merged, not raw fragments)", () => {
        // Lower bound: enough to catch gross fragmentation (would get thousands
        // of raw ways if stitching regressed). Post-stitch dedup collapses
        // parallel double-tracks; 1 km min-length drops station stubs; so the
        // expected count for the Kantō window is in the low tens.
        const n = bundle.features.length;
        assert.ok(
            n >= 8 && n <= 600,
            `expected 8–600 merged features, got ${n}`,
        );
    });

    it("has at least 3 features longer than 20 km (major corridors)", () => {
        const long = bundle.features.filter((f) => featureLengthKm(f) > 20);
        assert.ok(
            long.length >= 3,
            `expected ≥3 features > 20 km, got ${long.length}`,
        );
    });

    it("has features covering the full Shinkansen latitude range", () => {
        // Tokaido Shinkansen: ~34.7 (Shizuoka) to 35.7 (Tokyo)
        // Tohoku Shinkansen:  35.7 (Tokyo) to ~37.9 (Aomori)
        // Joetsu Shinkansen:  35.7 (Tokyo) to ~37.0 (Niigata)
        const bands = [
            [34.5, 35.0],
            [35.0, 35.5],
            [35.5, 36.0],
            [36.0, 36.5],
            [36.5, 37.0],
            [37.0, 37.5],
            [37.5, 38.0],
        ];

        for (const [lo, hi] of bands) {
            const count = bundle.features.filter((f) => {
                const b = f.bbox;
                return b[3] >= lo && b[1] <= hi;
            }).length;
            assert.ok(
                count > 0,
                `no features in lat band [${lo}, ${hi}] — possible merge regression`,
            );
        }
    });

    it("has no gap larger than 0.4° between consecutive feature lat spans", () => {
        // Sort by southernmost extent, track max lat seen, find biggest gap.
        const sorted = bundle.features
            .map((f) => ({ lo: f.bbox[1], hi: f.bbox[3] }))
            .sort((a, b) => a.lo - b.lo);

        let maxSeen = sorted[0].hi;
        let maxGap = 0;
        for (let i = 1; i < sorted.length; i++) {
            const { lo, hi } = sorted[i];
            if (lo > maxSeen) {
                const gap = lo - maxSeen;
                if (gap > maxGap) maxGap = gap;
            }
            if (hi > maxSeen) maxSeen = hi;
        }

        assert.ok(
            maxGap <= 0.4,
            `max lat gap between features is ${maxGap.toFixed(3)}° (> 0.4°) — ` +
                `merge may have dropped a region`,
        );
    });

    it("has no large gaps between consecutive simplified vertices", () => {
        // With dedup (not centerline-averaging), long simplified straight
        // segments are legitimate — the Shinkansen runs straight for many km.
        // This catches only egregious jumps (> 20 km) that would indicate
        // missing track or a stitching failure.
        const JUMP_THRESHOLD_M = 20000;
        const badFeatures = [];
        for (const f of bundle.features) {
            const coords = f.geometry.coordinates;
            for (let i = 1; i < coords.length; i++) {
                const d = haversineKm(coords[i - 1], coords[i]) * 1000;
                if (d > JUMP_THRESHOLD_M) {
                    badFeatures.push({
                        index: bundle.features.indexOf(f),
                        step: i,
                        distM: Math.round(d),
                    });
                    break; // one per feature is enough
                }
            }
        }
        assert.ok(
            badFeatures.length === 0,
            `${badFeatures.length} features have jumps > ${JUMP_THRESHOLD_M} m: ` +
                badFeatures
                    .slice(0, 5)
                    .map(
                        (b) =>
                            `feature ${b.index} step ${b.step} (${b.distM} m)`,
                    )
                    .join(", "),
        );
    });
});

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

// ─── High-speed-rail continuity guard ───────────────────────────────────────

describe("high-speed-rail continuity", () => {
    const bundlePath = resolve(measuringDir, "high-speed-rail.json");
    const EXTRACT_BBOX = [137.9, 33.9, 141.9, 37.9];

    it("passes the shared-node continuity validator (no fragmentation)", () => {
        const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
        // Throws if the assembled line is fragmented or full of collinear holes.
        const metrics = validateLineContinuity(bundle.features, EXTRACT_BBOX);
        assert.ok(
            metrics.components <= 40,
            `too many connected components: ${metrics.components}`,
        );
        assert.ok(
            metrics.holes <= 8,
            `too many interior collinear holes: ${metrics.holes}`,
        );
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
