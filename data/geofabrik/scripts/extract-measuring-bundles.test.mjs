import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
