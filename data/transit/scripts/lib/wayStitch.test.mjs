/**
 * Tests for wayStitch.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    stitchWays,
    pointToSegmentDistM,
    attachStationsAlongLine,
} from "./wayStitch.mjs";

describe("stitchWays", () => {
    it("chains two ways sharing an endpoint into one LineString", () => {
        const ways = new Map([
            [1, [101, 102]],
            [2, [102, 103]],
        ]);
        const nodeCoords = new Map([
            [101, { lat: 35.0, lon: 139.0 }],
            [102, { lat: 35.1, lon: 139.1 }],
            [103, { lat: 35.2, lon: 139.2 }],
        ]);
        const members = [
            { type: "way", ref: 1 },
            { type: "way", ref: 2 },
        ];

        const result = stitchWays(members, ways, nodeCoords);
        assert.equal(result.type, "MultiLineString");
        assert.equal(result.coordinates.length, 1);
        assert.equal(result.coordinates[0].length, 3);
        assert.deepEqual(result.coordinates[0][0], [139.0, 35.0]);
        assert.deepEqual(result.coordinates[0][2], [139.2, 35.2]);
    });

    it("chains reversed ways by matching endpoints", () => {
        const ways = new Map([
            [1, [101, 102]],
            [2, [103, 102]], // reversed: ends at 102
        ]);
        const nodeCoords = new Map([
            [101, { lat: 35.0, lon: 139.0 }],
            [102, { lat: 35.1, lon: 139.1 }],
            [103, { lat: 35.2, lon: 139.2 }],
        ]);
        const members = [
            { type: "way", ref: 1 },
            { type: "way", ref: 2 },
        ];

        const result = stitchWays(members, ways, nodeCoords);
        assert.equal(result.coordinates.length, 1);
        assert.equal(result.coordinates[0].length, 3);
        // Should chain: 101→102, then 103→102 reversed = 102→103.
        assert.deepEqual(result.coordinates[0][0], [139.0, 35.0]);
        assert.deepEqual(result.coordinates[0][2], [139.2, 35.2]);
    });

    it("produces two segments for ways with a gap", () => {
        const ways = new Map([
            [1, [101, 102]],
            [2, [103, 104]], // no shared endpoint with way 1
        ]);
        const nodeCoords = new Map([
            [101, { lat: 35.0, lon: 139.0 }],
            [102, { lat: 35.1, lon: 139.1 }],
            [103, { lat: 36.0, lon: 140.0 }],
            [104, { lat: 36.1, lon: 140.1 }],
        ]);
        const members = [
            { type: "way", ref: 1 },
            { type: "way", ref: 2 },
        ];

        const result = stitchWays(members, ways, nodeCoords);
        assert.equal(result.coordinates.length, 2);
        assert.equal(result.coordinates[0].length, 2);
        assert.equal(result.coordinates[1].length, 2);
    });

    it("never throws on degenerate input", () => {
        // Empty members.
        const empty = stitchWays([], new Map(), new Map());
        assert.deepEqual(empty, { type: "MultiLineString", coordinates: [] });

        // Way with < 2 nodes.
        const ways = new Map([[1, [101]]]);
        const nodeCoords = new Map([[101, { lat: 35.0, lon: 139.0 }]]);
        const single = stitchWays([{ type: "way", ref: 1 }], ways, nodeCoords);
        assert.deepEqual(single, { type: "MultiLineString", coordinates: [] });

        // Missing way id.
        const missing = stitchWays(
            [{ type: "way", ref: 999 }],
            ways,
            nodeCoords,
        );
        assert.deepEqual(missing, { type: "MultiLineString", coordinates: [] });

        // Null inputs.
        assert.deepEqual(stitchWays(null, null, null), {
            type: "MultiLineString",
            coordinates: [],
        });
    });

    it("handles a single way", () => {
        const ways = new Map([[1, [101, 102, 103]]]);
        const nodeCoords = new Map([
            [101, { lat: 35.0, lon: 139.0 }],
            [102, { lat: 35.1, lon: 139.1 }],
            [103, { lat: 35.2, lon: 139.2 }],
        ]);
        const result = stitchWays([{ type: "way", ref: 1 }], ways, nodeCoords);
        assert.equal(result.coordinates.length, 1);
        assert.equal(result.coordinates[0].length, 3);
    });
});

describe("pointToSegmentDistM", () => {
    it("returns 0 when point is on the segment", () => {
        const dist = pointToSegmentDistM(35.1, 139.1, 35.0, 139.0, 35.2, 139.2);
        assert.ok(dist < 1, `expected <1m, got ${dist}m`);
    });

    it("returns positive distance when point is off the segment", () => {
        const dist = pointToSegmentDistM(35.5, 139.5, 35.0, 139.0, 35.1, 139.1);
        assert.ok(dist > 1000, `expected >1km, got ${dist}m`);
    });

    it("handles degenerate segment (zero length)", () => {
        const dist = pointToSegmentDistM(35.1, 139.1, 35.0, 139.0, 35.0, 139.0);
        assert.ok(dist > 0, "degenerate segment should give positive distance");
    });
});

describe("attachStationsAlongLine", () => {
    it("finds stations within range of a line segment", () => {
        const geometry = {
            type: "MultiLineString",
            coordinates: [
                [
                    [139.0, 35.0],
                    [139.2, 35.2],
                ],
            ],
        };
        const stationById = new Map([
            ["osm:node:1", { lat: 35.1, lon: 139.1 }], // on the line
            ["osm:node:2", { lat: 36.0, lon: 140.0 }], // far away
        ]);

        const result = attachStationsAlongLine(
            geometry,
            stationById,
            500,
            new Set(),
        );
        assert.deepEqual(result, ["osm:node:1"]);
    });

    it("skips existing member ids", () => {
        const geometry = {
            type: "MultiLineString",
            coordinates: [
                [
                    [139.0, 35.0],
                    [139.2, 35.2],
                ],
            ],
        };
        const stationById = new Map([
            ["osm:node:1", { lat: 35.1, lon: 139.1 }],
        ]);

        const result = attachStationsAlongLine(
            geometry,
            stationById,
            500,
            new Set(["osm:node:1"]), // already a member
        );
        assert.equal(result.length, 0);
    });

    it("returns empty for empty geometry", () => {
        const result = attachStationsAlongLine(
            { type: "MultiLineString", coordinates: [] },
            new Map(),
            500,
            new Set(),
        );
        assert.deepEqual(result, []);
    });

    it("orders spatial members by projection along the line", () => {
        const geometry = {
            type: "MultiLineString",
            coordinates: [
                [
                    [139.0, 35.0],
                    [139.4, 35.0],
                ],
            ], // east-west line
        };
        const stationById = new Map([
            ["osm:node:far", { lat: 35.0, lon: 139.3 }], // further along
            ["osm:node:near", { lat: 35.0, lon: 139.1 }], // closer to start
        ]);

        const result = attachStationsAlongLine(
            geometry,
            stationById,
            500,
            new Set(),
        );
        assert.deepEqual(result, ["osm:node:near", "osm:node:far"]);
    });
});
