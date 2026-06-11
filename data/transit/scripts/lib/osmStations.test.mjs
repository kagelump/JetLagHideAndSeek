import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeName } from "./names.mjs";
import {
    createOsmElementId,
    mapOsmNode,
    completenessScore,
    dedupeOsmStations,
} from "./osmStations.mjs";

// ─── names.mjs tests ───────────────────────────────────────────────────────

describe("normalizeName", () => {
    it("NFKC normalizes fullwidth characters", () => {
        // Fullwidth "A" (U+FF21) → ASCII "A"
        const result = normalizeName("Ａ");
        assert.equal(result, "a");
    });

    it("case-folds to lowercase", () => {
        assert.equal(normalizeName("SHINJUKU"), "shinjuku");
    });

    it("collapses whitespace", () => {
        assert.equal(normalizeName("  Tokyo   Station  "), "tokyo station");
    });

    it("strips Japanese station suffix", () => {
        assert.equal(normalizeName("新宿駅", ["駅"]), "新宿");
    });

    it("strips suffix even with leading space", () => {
        assert.equal(
            normalizeName("Shinjuku Station", ["Station"]),
            "shinjuku",
        );
    });

    it("handles empty input", () => {
        assert.equal(normalizeName(""), "");
        assert.equal(normalizeName(null), "");
    });
});

// ─── createOsmElementId tests ──────────────────────────────────────────────

describe("createOsmElementId", () => {
    it("formats node ids as osm:node:<id>", () => {
        assert.equal(createOsmElementId("node", 123), "osm:node:123");
        assert.equal(createOsmElementId("node", "456"), "osm:node:456");
    });

    it("rejects non-positive ids", () => {
        assert.throws(() => createOsmElementId("node", 0));
        assert.throws(() => createOsmElementId("node", -1));
    });
});

// ─── mapOsmNode tests ──────────────────────────────────────────────────────

describe("mapOsmNode", () => {
    const suffixes = ["駅"];
    const stats = () => ({
        skippedNoName: 0,
        skippedNoId: 0,
        skippedNonRailway: 0,
    });

    it("maps a complete station node", () => {
        const feature = {
            id: 12345,
            geometry: { type: "Point", coordinates: [139.7, 35.6] },
            properties: {
                tags: {
                    name: "渋谷",
                    "name:en": "Shibuya",
                    railway: "station",
                    operator: "JR東日本",
                    wikidata: "Q123",
                },
            },
        };
        const st = stats();
        const rec = mapOsmNode(feature, "japan-kanto", suffixes, st);
        assert.ok(rec);
        assert.equal(rec.id, "osm:node:12345");
        assert.equal(rec.lat, 35.6);
        assert.equal(rec.lon, 139.7);
        assert.equal(rec.name, "渋谷");
        assert.equal(rec.nameEn, "Shibuya");
        assert.equal(rec.wikidata, "Q123");
        assert.equal(rec.operator, "JR東日本");
        assert.equal(rec.normalizedName, "渋谷"); // "渋谷駅" → "渋谷"
        assert.equal(rec.tags.railway, "station");
        assert.equal(st.skippedNoName, 0);
    });

    it("skips nodes without a name", () => {
        const feature = {
            id: 1,
            geometry: { type: "Point", coordinates: [139, 35] },
            properties: { tags: { railway: "station" } },
        };
        const st = stats();
        assert.equal(mapOsmNode(feature, "jp", suffixes, st), null);
        assert.equal(st.skippedNoName, 1);
    });

    it("strips 駅 from normalized name", () => {
        const feature = {
            id: 2,
            geometry: { type: "Point", coordinates: [139, 35] },
            properties: { tags: { name: "新宿駅", railway: "station" } },
        };
        const st = stats();
        const rec = mapOsmNode(feature, "jp", suffixes, st);
        assert.equal(rec.normalizedName, "新宿");
    });

    it("handles missing name:en", () => {
        const feature = {
            id: 3,
            geometry: { type: "Point", coordinates: [139, 35] },
            properties: { tags: { name: "東京", railway: "station" } },
        };
        const st = stats();
        const rec = mapOsmNode(feature, "jp", suffixes, st);
        assert.equal(rec.nameEn, undefined);
    });

    it("rejects non-railway nodes (public_transport=station without railway tag)", () => {
        const feature = {
            id: 4536777489,
            geometry: { type: "Point", coordinates: [139.7680596, 35.6797924] },
            properties: {
                tags: {
                    name: "JR高速バスのりば",
                    "name:en": "Tokyo Station JR Express Bus Terminal",
                    public_transport: "station",
                },
            },
        };
        const st = stats();
        assert.equal(mapOsmNode(feature, "japan-kanto", suffixes, st), null);
        assert.equal(st.skippedNonRailway, 1);
        // Other counters should stay at 0 — it has a name and id.
        assert.equal(st.skippedNoName, 0);
        assert.equal(st.skippedNoId, 0);
    });
});

// ─── completenessScore tests ───────────────────────────────────────────────

describe("completenessScore", () => {
    it("scores name:en highest", () => {
        const a = completenessScore({ nameEn: "Shibuya" });
        const b = completenessScore({ operator: "JR" });
        assert.ok(a > b);
    });

    it("prefers railway=station over public_transport=station", () => {
        const a = completenessScore({ tags: { railway: "station" } });
        const b = completenessScore({ tags: { public_transport: "station" } });
        assert.ok(a > b);
    });
});

// ─── dedupeOsmStations tests ───────────────────────────────────────────────

describe("dedupeOsmStations", () => {
    it("deduplicates by id (region-boundary overlap)", () => {
        const records = [
            {
                id: "osm:node:1",
                name: "A",
                lat: 35,
                lon: 139,
                normalizedName: "a",
            },
            {
                id: "osm:node:1",
                name: "A",
                lat: 35,
                lon: 139,
                normalizedName: "a",
            },
        ];
        const { kept, stats } = dedupeOsmStations(records);
        assert.equal(kept.length, 1);
        assert.equal(stats.droppedById, 1);
    });

    it("deduplicates by wikidata, keeping most complete", () => {
        const records = [
            {
                id: "osm:node:1",
                name: "A",
                lat: 35,
                lon: 139,
                normalizedName: "a",
                wikidata: "Q1",
            },
            {
                id: "osm:node:2",
                name: "A+",
                lat: 35,
                lon: 139,
                normalizedName: "a",
                wikidata: "Q1",
                nameEn: "A",
            },
        ];
        const { kept } = dedupeOsmStations(records);
        assert.equal(kept.length, 1);
        assert.equal(kept[0].nameEn, "A");
    });

    it("merges same normalized name within 150 m", () => {
        const records = [
            {
                id: "osm:node:1",
                name: "Shinjuku",
                lat: 35.689,
                lon: 139.7,
                normalizedName: "shinjuku",
            },
            {
                id: "osm:node:2",
                name: "Shinjuku Station",
                lat: 35.69,
                lon: 139.701,
                normalizedName: "shinjuku",
            },
        ];
        const { kept, stats } = dedupeOsmStations(records);
        assert.equal(kept.length, 1);
        assert.ok(stats.droppedByNameDist >= 1);
    });

    it("keeps both when same name but far apart", () => {
        const records = [
            {
                id: "osm:node:1",
                name: "Park",
                lat: 35.0,
                lon: 139.0,
                normalizedName: "park",
            },
            {
                id: "osm:node:2",
                name: "Park",
                lat: 36.0,
                lon: 140.0,
                normalizedName: "park",
            },
        ];
        const { kept } = dedupeOsmStations(records);
        assert.equal(kept.length, 2);
    });
});
