import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attachStationRecords } from "./conflate.mjs";

// ─── Helper to build a seed ────────────────────────────────────────────────

function seed(id, name, lat, lon, opts = {}) {
    return {
        id,
        name,
        lat,
        lon,
        nameVariants: opts.nameVariants ?? [name],
        wikidata: opts.wikidata ?? undefined,
        nameEn: opts.nameEn ?? undefined,
    };
}

function loose(id, name, lat, lon, opts = {}) {
    return {
        id,
        name,
        lat,
        lon,
        nameVariants: opts.nameVariants ?? [name],
        wikidata: opts.wikidata ?? undefined,
        nameEn: opts.nameEn ?? undefined,
        operator: opts.operator ?? undefined,
    };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("attachStationRecords", () => {
    it("attaches by wikidata across 120 m with different name spellings", () => {
        const seeds = [
            seed("gtfs:ns:stop:1", "Shimbashi", 35.666, 139.758, {
                wikidata: "Q123",
            }),
        ];
        const looseRecs = [
            loose("osm:node:1", "新橋", 35.666, 139.759, {
                wikidata: "Q123",
                nameVariants: ["新橋", "Shimbashi"],
            }),
        ];
        const { attachments, standaloneStations, nearMisses } =
            attachStationRecords({
                seeds,
                looseRecords: looseRecs,
                maxClusterMeters: 150,
            });
        assert.equal(attachments.length, 1);
        assert.equal(attachments[0].seedIds[0], "gtfs:ns:stop:1");
        assert.equal(standaloneStations.length, 0);
        assert.equal(nearMisses.length, 0);
    });

    it("attaches by normalized name match (大手町駅 → 大手町)", () => {
        const otemachiSeeds = [
            seed("gtfs:metro:stop:ot1", "大手町", 35.688, 139.764),
            seed("gtfs:metro:stop:ot2", "大手町", 35.688, 139.764),
            seed("gtfs:metro:stop:ot3", "大手町", 35.688, 139.764),
            seed("gtfs:metro:stop:ot4", "大手町", 35.688, 139.764),
            seed("gtfs:metro:stop:ot5", "大手町", 35.688, 139.764),
        ];
        const osmNode = loose(
            "osm:node:otemachi",
            "大手町駅",
            35.688,
            139.764,
            {
                nameVariants: ["大手町駅", "Otemachi"],
            },
        );
        const { attachments, standaloneStations, enrichedSeeds } =
            attachStationRecords({
                seeds: otemachiSeeds,
                looseRecords: [osmNode],
                maxClusterMeters: 150,
                suffixes: ["駅"],
            });
        // Should attach to all five per-line seeds.
        assert.equal(attachments.length, 1);
        assert.equal(attachments[0].seedIds.length, 5);
        // No standalone station emitted for the OSM node.
        assert.equal(standaloneStations.length, 0);
        // All seeds enriched.
        for (const es of enrichedSeeds) {
            assert.equal(es.nameEn, undefined); // OSM node has no name:en
        }
    });

    it("name gate: adjacent distinct stations do NOT attach → near-miss", () => {
        const seeds = [seed("gtfs:ns:stop:a", "Tokyo", 35.681, 139.767)];
        const looseRecs = [
            // ~60 m away — well within 150 m but different name.
            loose("osm:node:b", "Yurakucho", 35.6815, 139.7675, {
                nameVariants: ["Yurakucho", "有楽町"],
            }),
        ];
        const { attachments, nearMisses, standaloneStations } =
            attachStationRecords({
                seeds,
                looseRecords: looseRecs,
                maxClusterMeters: 150,
            });
        assert.equal(attachments.length, 0);
        assert.ok(nearMisses.length >= 1);
        assert.equal(standaloneStations.length, 1);
    });

    it("distance gate: identical names 5 km apart do NOT attach", () => {
        const seeds = [seed("gtfs:ns:stop:a", "Park", 35.0, 139.0)];
        const looseRecs = [
            loose("osm:node:b", "Park", 35.05, 139.0, {
                nameVariants: ["Park"],
            }),
        ];
        const { attachments } = attachStationRecords({
            seeds,
            looseRecords: looseRecs,
            maxClusterMeters: 150,
        });
        assert.equal(attachments.length, 0);
    });

    it("aliases: force-attach overrides missing signals", () => {
        const seeds = [seed("gtfs:ns:stop:x", "Unusual Name", 35.0, 139.0)];
        const looseRecs = [
            loose("osm:node:y", "Completely Different", 35.0, 139.0, {
                nameVariants: ["Completely Different"],
            }),
        ];
        const { attachments } = attachStationRecords({
            seeds,
            looseRecords: looseRecs,
            maxClusterMeters: 150,
            aliases: [{ attach: ["osm:node:y", "gtfs:ns:stop:x"] }],
        });
        assert.equal(attachments.length, 1);
        assert.equal(attachments[0].seedIds[0], "gtfs:ns:stop:x");
    });

    it("aliases: forbid-attach prevents name match", () => {
        const seeds = [seed("gtfs:ns:stop:x", "Same Name", 35.0, 139.0)];
        const looseRecs = [
            loose("osm:node:y", "Same Name", 35.0, 139.0, {
                nameVariants: ["Same Name"],
            }),
        ];
        const { attachments, standaloneStations } = attachStationRecords({
            seeds,
            looseRecords: looseRecs,
            maxClusterMeters: 150,
            aliases: [{ separate: ["osm:node:y", "gtfs:ns:stop:x"] }],
        });
        assert.equal(attachments.length, 0);
        assert.equal(standaloneStations.length, 1);
    });

    it("enriches seeds with nameEn from attached OSM record", () => {
        const seeds = [seed("gtfs:ns:stop:s", "Shinjuku", 35.689, 139.7)];
        const looseRecs = [
            loose("osm:node:s", "新宿駅", 35.689, 139.701, {
                nameEn: "Shinjuku",
                nameVariants: ["新宿駅", "Shinjuku"],
            }),
        ];
        const { enrichedSeeds } = attachStationRecords({
            seeds,
            looseRecords: looseRecs,
            maxClusterMeters: 150,
            suffixes: ["駅"],
        });
        assert.equal(enrichedSeeds[0].nameEn, "Shinjuku");
    });

    it("enriches seeds with osmOperators from attached OSM record", () => {
        const seeds = [
            seed("gtfs:ns:stop:1", "Shinjuku", 35.689, 139.7, {
                wikidata: "Q123",
            }),
        ];
        const looseRecs = [
            loose("osm:node:s", "新宿駅", 35.689, 139.701, {
                wikidata: "Q123",
                operator: "JR East",
                nameVariants: ["新宿駅", "Shinjuku"],
            }),
        ];
        const { enrichedSeeds } = attachStationRecords({
            seeds,
            looseRecords: looseRecs,
            maxClusterMeters: 150,
            suffixes: ["駅"],
        });
        assert.ok(Array.isArray(enrichedSeeds[0].osmOperators));
        assert.equal(enrichedSeeds[0].osmOperators.length, 1);
        assert.equal(enrichedSeeds[0].osmOperators[0], "JR East");
    });

    it("enriches seeds with osmSourceIds from attached OSM record", () => {
        const seeds = [
            seed("gtfs:ns:stop:1", "Shinjuku", 35.689, 139.7, {
                wikidata: "Q123",
            }),
        ];
        const looseRecs = [
            loose("osm:node:s", "新宿駅", 35.689, 139.701, {
                wikidata: "Q123",
                operator: "JR East",
                nameVariants: ["新宿駅", "Shinjuku"],
            }),
        ];
        const { enrichedSeeds } = attachStationRecords({
            seeds,
            looseRecords: looseRecs,
            maxClusterMeters: 150,
            suffixes: ["駅"],
        });
        assert.ok(Array.isArray(enrichedSeeds[0].osmSourceIds));
        assert.equal(enrichedSeeds[0].osmSourceIds.length, 1);
        assert.equal(enrichedSeeds[0].osmSourceIds[0], "osm:node:s");
    });

    it("accumulates osmOperators from multiple attached OSM records", () => {
        const seeds = [
            seed("gtfs:ns:stop:1", "Otemachi", 35.688, 139.764, {
                wikidata: "Q456",
            }),
        ];
        const looseRecs = [
            loose("osm:node:a", "大手町駅", 35.688, 139.764, {
                wikidata: "Q456",
                operator: "Tokyo Metro",
                nameVariants: ["大手町駅", "Otemachi"],
            }),
            loose("osm:node:b", "大手町", 35.688, 139.765, {
                wikidata: "Q456",
                operator: "Toei Subway",
                nameVariants: ["大手町", "Otemachi"],
            }),
        ];
        const { enrichedSeeds } = attachStationRecords({
            seeds,
            looseRecords: looseRecs,
            maxClusterMeters: 150,
            suffixes: ["駅"],
        });
        assert.ok(Array.isArray(enrichedSeeds[0].osmOperators));
        assert.equal(enrichedSeeds[0].osmOperators.length, 2);
        assert.ok(enrichedSeeds[0].osmOperators.includes("Tokyo Metro"));
        assert.ok(enrichedSeeds[0].osmOperators.includes("Toei Subway"));
        assert.ok(Array.isArray(enrichedSeeds[0].osmSourceIds));
        assert.equal(enrichedSeeds[0].osmSourceIds.length, 2);
        assert.ok(enrichedSeeds[0].osmSourceIds.includes("osm:node:a"));
        assert.ok(enrichedSeeds[0].osmSourceIds.includes("osm:node:b"));
    });
});
