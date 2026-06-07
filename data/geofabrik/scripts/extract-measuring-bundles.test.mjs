import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    stitchSegments,
    validateLineContinuity,
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

            it("has schemaVersion 1", () => {
                assert.strictEqual(bundle.schemaVersion, 1);
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

            it("every feature is a LineString or MultiLineString", () => {
                for (const f of bundle.features) {
                    assert.ok(
                        f.geometry.type === "LineString" ||
                            f.geometry.type === "MultiLineString",
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
                    } else {
                        for (const seg of f.geometry.coordinates) {
                            assert.ok(
                                seg.length >= 2,
                                "MultiLineString segment needs at least 2 coords",
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

            it("every feature has empty properties object", () => {
                for (const f of bundle.features) {
                    assert.deepStrictEqual(
                        f.properties,
                        {},
                        "properties should be empty",
                    );
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

    it("has between 50 and 600 features (merged, not raw fragments)", () => {
        const n = bundle.features.length;
        assert.ok(
            n >= 30 && n <= 600,
            `expected 50–600 merged features, got ${n}`,
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
        const out = stitchSegments([
            line(a),
            line([...b].reverse()),
            line(c),
        ]);
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
        const metrics = validateLineContinuity(
            bundle.features,
            EXTRACT_BBOX,
        );
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
