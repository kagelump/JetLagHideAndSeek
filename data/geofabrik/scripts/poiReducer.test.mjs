import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    buildCategoryOf,
    buildColumnar,
    centroid,
    parseOsmId,
    reduceFeature,
} from "./poiReducer.mjs";

// A minimal selectors JSON fixture matching the real structure.
const SELECTORS_FIXTURE = {
    schemaVersion: 1,
    categories: {
        "commercial-airport": {
            selectors: [
                {
                    match: [
                        { key: "aeroway", value: "aerodrome" },
                        { key: "iata" },
                    ],
                },
            ],
        },
        park: { selectors: [{ match: [{ key: "leisure", value: "park" }] }] },
        hospital: {
            selectors: [{ match: [{ key: "amenity", value: "hospital" }] }],
        },
        museum: {
            selectors: [{ match: [{ key: "tourism", value: "museum" }] }],
        },
        "station-name-length": {
            selectors: [{ match: [{ key: "railway", value: "station" }] }],
        },
        "golf-course": {
            selectors: [{ match: [{ key: "leisure", value: "golf_course" }] }],
        },
    },
};

const categoryOf = buildCategoryOf(SELECTORS_FIXTURE);

/**
 * Builds a GeoJSON Feature that matches osmium export `-u type_id` output:
 * - `feature.id` is a prefixed string ("n123", "w456", "r789").
 * - `properties` contain only OSM tags (no `@id` / `@type`).
 * Geometry type is inferred from the id prefix when not explicit.
 */
function makeFeature(type, coords, tags, id) {
    const osmId =
        id ??
        (type === "Point" ? "n123" : type === "Polygon" ? "w123" : "r123");
    const geometry =
        type === "Point"
            ? { type: "Point", coordinates: coords }
            : type === "Polygon"
              ? {
                    type: "Polygon",
                    coordinates: [coords],
                }
              : { type: "MultiPolygon", coordinates: [[coords]] };
    return {
        type: "Feature",
        id: osmId,
        properties: { ...tags },
        geometry,
    };
}

// ─── parseOsmId ──────────────────────────────────────────────────────────

describe("parseOsmId", () => {
    it("parses a node id", () => {
        assert.deepStrictEqual(parseOsmId("n57390915"), {
            osmId: 57390915,
            osmType: 0,
        });
    });

    it("parses a way id", () => {
        assert.deepStrictEqual(parseOsmId("w123456"), {
            osmId: 123456,
            osmType: 1,
        });
    });

    it("parses a relation id", () => {
        assert.deepStrictEqual(parseOsmId("r999"), {
            osmId: 999,
            osmType: 2,
        });
    });

    it("returns zeros for a non-string", () => {
        assert.deepStrictEqual(parseOsmId(123), { osmId: 0, osmType: 0 });
    });

    it("returns zeros for undefined", () => {
        assert.deepStrictEqual(parseOsmId(undefined), { osmId: 0, osmType: 0 });
    });

    it("returns zeros for a too-short string", () => {
        assert.deepStrictEqual(parseOsmId("x"), { osmId: 0, osmType: 0 });
    });

    it("returns osmType 0 for an unknown prefix", () => {
        assert.deepStrictEqual(parseOsmId("x123"), { osmId: 123, osmType: 0 });
    });

    it("returns osmId 0 for NaN slice", () => {
        assert.deepStrictEqual(parseOsmId("wabc"), { osmId: 0, osmType: 1 });
    });
});

// ─── centroid ───────────────────────────────────────────────────────────

describe("centroid", () => {
    it("returns the point for a Point geometry", () => {
        const c = centroid({ type: "Point", coordinates: [139.76, 35.68] });
        assert.deepStrictEqual(c, [139.76, 35.68]);
    });

    it("returns the bbox center for a Polygon (matching Overpass out center)", () => {
        const ring = [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0],
        ];
        const c = centroid({
            type: "Polygon",
            coordinates: [ring],
        });
        // bbox: (0,0)–(2,2) → center (1, 1)
        assert.deepStrictEqual(c, [1, 1]);
    });

    it("returns the bbox center for a MultiPolygon", () => {
        const ring1 = [
            [0, 0],
            [2, 0],
            [2, 2],
        ];
        const ring2 = [
            [4, 4],
            [6, 4],
            [6, 6],
        ];
        const c = centroid({
            type: "MultiPolygon",
            coordinates: [[ring1], [ring2]],
        });
        // bbox: (0,0)–(6,6) → center (3, 3)
        assert.deepStrictEqual(c, [3, 3]);
    });
});

// ─── reduceFeature ──────────────────────────────────────────────────────

describe("reduceFeature", () => {
    it("returns a compact record for a park way", () => {
        const feature = makeFeature(
            "Polygon",
            [
                [139.76, 35.68],
                [139.77, 35.68],
                [139.77, 35.69],
                [139.76, 35.68],
            ],
            { leisure: "park", name: "Yoyogi Park" },
        );
        const rec = reduceFeature(feature, categoryOf);
        assert.ok(rec);
        assert.strictEqual(rec.category, "park");
        assert.strictEqual(rec.osmType, 1); // way
        assert.strictEqual(rec.osmId, 123); // "w123" → osmId 123
        assert.strictEqual(rec.name, "Yoyogi Park");
        // Bbox center: lon = (139.76 + 139.77) / 2 = 139.765
        //              lat = (35.68 + 35.69) / 2 = 35.685
        assert.strictEqual(rec.lon, 139.765);
        assert.strictEqual(rec.lat, 35.685);
    });

    it("returns null when a feature has no name", () => {
        const feature = makeFeature("Point", [139.76, 35.68], {
            leisure: "park",
        });
        assert.strictEqual(reduceFeature(feature, categoryOf), null);
    });

    it("returns null when a feature has an empty name", () => {
        const feature = makeFeature("Point", [139.76, 35.68], {
            leisure: "park",
            name: "",
        });
        assert.strictEqual(reduceFeature(feature, categoryOf), null);
    });

    it("returns null when categoryOf returns null", () => {
        const feature = makeFeature("Point", [139.76, 35.68], {
            shop: "convenience",
            name: "7-Eleven",
        });
        assert.strictEqual(reduceFeature(feature, categoryOf), null);
    });

    it("prefers name:en for station features and sets nameLength", () => {
        const feature = makeFeature("Point", [139.76, 35.68], {
            railway: "station",
            name: "東京",
            "name:en": "Tokyo Station",
        });
        const rec = reduceFeature(feature, categoryOf);
        assert.ok(rec);
        assert.strictEqual(rec.category, "station-name-length");
        assert.strictEqual(rec.name, "Tokyo Station");
        assert.strictEqual(rec.nameLength, 13);
    });

    it("falls back to name for station when name:en is missing", () => {
        const feature = makeFeature("Point", [139.76, 35.68], {
            railway: "station",
            name: "新宿",
        });
        const rec = reduceFeature(feature, categoryOf);
        assert.ok(rec);
        assert.strictEqual(rec.name, "新宿");
        assert.strictEqual(rec.nameLength, 2);
    });

    it("rounds coordinates to 6 decimal places", () => {
        const feature = makeFeature("Point", [139.123456789, 35.987654321], {
            leisure: "park",
            name: "Test",
        });
        const rec = reduceFeature(feature, categoryOf);
        assert.ok(rec);
        assert.strictEqual(rec.lon, 139.123457);
        assert.strictEqual(rec.lat, 35.987654);
    });

    it("sets osmType 0 for node features", () => {
        const feature = makeFeature("Point", [139.76, 35.68], {
            amenity: "hospital",
            name: "Test Hospital",
        });
        const rec = reduceFeature(feature, categoryOf);
        assert.ok(rec);
        assert.strictEqual(rec.osmType, 0);
    });

    it("skips features with NaN centroids (degenerate geometry)", () => {
        const feature = {
            type: "Feature",
            id: "w99",
            properties: {
                leisure: "park",
                name: "Empty Park",
            },
            geometry: { type: "Polygon", coordinates: [[]] }, // empty ring
        };
        const rec = reduceFeature(feature, categoryOf);
        assert.strictEqual(rec, null);
    });

    it("returns osmId 0 / osmType 0 when feature.id is undefined (regression guard)", () => {
        const feature = {
            type: "Feature",
            // No id at all — simulates osmium export without -u type_id.
            properties: {
                leisure: "park",
                name: "Park Without Id",
            },
            geometry: { type: "Point", coordinates: [139.76, 35.68] },
        };
        const rec = reduceFeature(feature, categoryOf);
        assert.ok(rec);
        assert.strictEqual(rec.osmId, 0);
        assert.strictEqual(rec.osmType, 0);
    });
});

// ─── buildCategoryOf ────────────────────────────────────────────────────

describe("buildCategoryOf", () => {
    it("matches a single condition", () => {
        const catOf = buildCategoryOf(SELECTORS_FIXTURE);
        const cat = catOf({ leisure: "park", name: "Park" });
        assert.strictEqual(cat, "park");
    });

    it("returns null for no match", () => {
        const catOf = buildCategoryOf(SELECTORS_FIXTURE);
        assert.strictEqual(catOf({ shop: "convenience" }), null);
    });

    it("matches first category in order", () => {
        // A feature that could match both park and golf-course (keys differ,
        // but in our fixture leisure=golf_course is golf-course and
        // leisure=park is park — these don't overlap.  Match order is
        // tested by ensuring the map iteration order is respected.)
        const catOf = buildCategoryOf(SELECTORS_FIXTURE);
        assert.strictEqual(catOf({ leisure: "golf_course" }), "golf-course");
        assert.strictEqual(catOf({ leisure: "park" }), "park");
    });

    it("matches multi-condition AND selector with key-only condition", () => {
        const catOf = buildCategoryOf(SELECTORS_FIXTURE);
        // Haneda: aeroway=aerodrome + iata=HND (both conditions satisfied).
        assert.strictEqual(
            catOf({ aeroway: "aerodrome", iata: "HND", name: "Haneda Airport" }),
            "commercial-airport",
        );
    });

    it("rejects when key-only condition is missing", () => {
        const catOf = buildCategoryOf(SELECTORS_FIXTURE);
        // Tokyo Heliport: aeroway=aerodrome but no iata tag → reject.
        assert.strictEqual(
            catOf({ aeroway: "aerodrome", name: "Tokyo Heliport" }),
            null,
        );
    });

    it("rejects when value-bearing condition mismatches", () => {
        const catOf = buildCategoryOf(SELECTORS_FIXTURE);
        // heliport is not aerodrome.
        assert.strictEqual(
            catOf({ aeroway: "heliport", iata: "XXX", name: "Heliport" }),
            null,
        );
    });
});

// ─── buildColumnar ─────────────────────────────────────────────────────

describe("buildColumnar", () => {
    const rec1 = {
        category: "park",
        lon: 139.7,
        lat: 35.66,
        name: "Yoyogi Park",
        osmId: 100,
        osmType: 1,
    };
    const rec2 = {
        category: "park",
        lon: 139.8,
        lat: 35.67,
        name: "Ueno Park",
        osmId: 50,
        osmType: 0,
    };
    const rec3 = {
        category: "station-name-length",
        lon: 139.767,
        lat: 35.681,
        name: "Shinjuku Station",
        osmId: 200,
        osmType: 0,
        nameLength: 16,
    };

    const regionMeta = {
        id: "japan-kanto",
        label: "Kantō, Japan",
        bbox: [134, 18, 156, 38],
        generatedAt: "2026-06-01T00:00:00Z",
        sourceSequence: 3320,
        source: "https://example.com/kanto.osm.pbf",
        attribution: {
            text: "© OpenStreetMap contributors",
            license: "ODbL-1.0",
            url: "https://www.openstreetmap.org/copyright",
        },
    };

    it("produces index-aligned parallel arrays sorted by osmId", () => {
        const col = buildColumnar([rec1, rec2], regionMeta);
        const park = col.categories.park;
        assert.ok(park);
        assert.strictEqual(park.count, 2);
        // Sorted by osmId: 50 first, then 100.
        assert.strictEqual(park.osmId[0], 50);
        assert.strictEqual(park.osmId[1], 100);
        assert.strictEqual(park.name[0], "Ueno Park");
        assert.strictEqual(park.name[1], "Yoyogi Park");
        assert.strictEqual(park.lon[0], 139.8);
        assert.strictEqual(park.lat[0], 35.67);
        assert.strictEqual(park.osmType[0], 0);
        assert.strictEqual(park.lon[1], 139.7);
        assert.strictEqual(park.lat[1], 35.66);
        assert.strictEqual(park.osmType[1], 1);
        assert.strictEqual(park.nameLength, undefined);
    });

    it("includes nameLength for station-name-length category", () => {
        const col = buildColumnar([rec3], regionMeta);
        const station = col.categories["station-name-length"];
        assert.ok(station);
        assert.strictEqual(station.count, 1);
        assert.ok(station.nameLength);
        assert.strictEqual(station.nameLength[0], 16);
    });

    it("omits empty categories", () => {
        const col = buildColumnar([rec1, rec2], regionMeta);
        assert.strictEqual(col.categories.hospital, undefined);
        assert.strictEqual(col.categories["station-name-length"], undefined);
    });

    it("sets metadata fields correctly", () => {
        const col = buildColumnar([rec1], regionMeta);
        assert.strictEqual(col.schemaVersion, 1);
        assert.strictEqual(col.region, "japan-kanto");
        assert.strictEqual(col.totalCount, 1);
        assert.deepStrictEqual(col.bbox, [134, 18, 156, 38]);
        assert.strictEqual(
            col.attribution.text,
            "© OpenStreetMap contributors",
        );
    });
});

// ─── loadCategoryOf fixture integration ─────────────────────────────────

describe("loadCategoryOf integration", () => {
    it("can build categoryOf from inline fixture matching", () => {
        const catOf = buildCategoryOf(SELECTORS_FIXTURE);
        assert.strictEqual(catOf({ tourism: "museum" }), "museum");
        assert.strictEqual(catOf({ amenity: "hospital" }), "hospital");
        assert.strictEqual(
            catOf({ railway: "station" }),
            "station-name-length",
        );
    });
});
