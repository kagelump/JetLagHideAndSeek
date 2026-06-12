/**
 * Tests for delta encoding: round-trip, normalization, and correctness.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    encodeDeltaPolygon,
    decodeDeltaPolygon,
    encodeDeltaRing,
    decodeDeltaRing,
    quantize,
    unquantize,
    SCALE,
} from "./deltaEncode.mjs";

describe("quantize / unquantize round-trip", () => {
    it("round-trips a coordinate pair", () => {
        const [x, y] = quantize(139.75849, 35.68291);
        const [lon, lat] = unquantize(x, y);
        assert.ok(Math.abs(lon - 139.75849) < 1 / SCALE);
        assert.ok(Math.abs(lat - 35.68291) < 1 / SCALE);
    });

    it("handles negative coordinates", () => {
        const [x, y] = quantize(-73.9856, 40.7484);
        const [lon, lat] = unquantize(x, y);
        assert.ok(Math.abs(lon - -73.9856) < 1 / SCALE);
        assert.ok(Math.abs(lat - 40.7484) < 1 / SCALE);
    });
});

describe("encodeDeltaRing / decodeDeltaRing round-trip", () => {
    it("round-trips a simple triangle", () => {
        const ring = [
            [139.0, 35.0],
            [139.1, 35.1],
            [139.05, 35.05],
            [139.0, 35.0], // closed ring
        ];
        const encoded = encodeDeltaRing(ring);
        const decoded = decodeDeltaRing(encoded);

        assert.equal(decoded.length, ring.length);
        for (let i = 0; i < ring.length; i++) {
            assert.ok(Math.abs(decoded[i][0] - ring[i][0]) < 1 / SCALE);
            assert.ok(Math.abs(decoded[i][1] - ring[i][1]) < 1 / SCALE);
        }
    });

    it("round-trips a ring with many vertices", () => {
        const ring = [];
        for (let i = 0; i < 100; i++) {
            const angle = (2 * Math.PI * i) / 99;
            ring.push([
                139.5 + Math.cos(angle) * 0.1,
                35.5 + Math.sin(angle) * 0.1,
            ]);
        }
        // Close it
        ring.push(ring[0]);

        const encoded = encodeDeltaRing(ring);
        const decoded = decodeDeltaRing(encoded);

        assert.equal(decoded.length, ring.length);
        for (let i = 0; i < ring.length; i++) {
            assert.ok(Math.abs(decoded[i][0] - ring[i][0]) < 1 / SCALE);
            assert.ok(Math.abs(decoded[i][1] - ring[i][1]) < 1 / SCALE);
        }
    });

    it("first value in encoded array is the ring length (not including itself)", () => {
        const ring = [
            [139.0, 35.0],
            [139.1, 35.1],
            [139.05, 35.05],
            [139.0, 35.0],
        ];
        const encoded = encodeDeltaRing(ring);
        // ringLen should be 8 (4 points × 2 coords), encoded[0] = 8
        assert.equal(encoded[0], 8);
    });

    it("rejects a degenerate ring", () => {
        assert.throws(() =>
            encodeDeltaRing([
                [139.0, 35.0],
                [139.1, 35.1],
            ]),
        );
    });
});

describe("encodeDeltaPolygon / decodeDeltaPolygon round-trip", () => {
    it("round-trips a simple Polygon", () => {
        const geometry = {
            type: "Polygon",
            coordinates: [
                [
                    [139.0, 35.0],
                    [139.1, 35.0],
                    [139.1, 35.1],
                    [139.0, 35.1],
                    [139.0, 35.0],
                ],
            ],
        };

        const encoded = encodeDeltaPolygon(geometry);
        const decoded = decodeDeltaPolygon(encoded);

        assert.equal(decoded.length, 1); // 1 polygon
        assert.equal(decoded[0].length, 1); // 1 ring (outer)
        assert.equal(decoded[0][0].length, 5);
    });

    it("round-trips a MultiPolygon with two polygons", () => {
        const geometry = {
            type: "MultiPolygon",
            coordinates: [
                [
                    [
                        [139.0, 35.0],
                        [139.1, 35.0],
                        [139.1, 35.1],
                        [139.0, 35.1],
                        [139.0, 35.0],
                    ],
                ],
                [
                    [
                        [139.2, 35.2],
                        [139.3, 35.2],
                        [139.3, 35.3],
                        [139.2, 35.3],
                        [139.2, 35.2],
                    ],
                ],
            ],
        };

        const encoded = encodeDeltaPolygon(geometry);
        const decoded = decodeDeltaPolygon(encoded);

        assert.equal(decoded.length, 2);
        assert.equal(decoded[0][0].length, 5);
        assert.equal(decoded[1][0].length, 5);
    });

    it("round-trips a Polygon with a hole", () => {
        const geometry = {
            type: "Polygon",
            coordinates: [
                [
                    [139.0, 35.0],
                    [139.2, 35.0],
                    [139.2, 35.2],
                    [139.0, 35.2],
                    [139.0, 35.0],
                ],
                [
                    [139.05, 35.05],
                    [139.15, 35.05],
                    [139.15, 35.15],
                    [139.05, 35.15],
                    [139.05, 35.05],
                ],
            ],
        };

        const encoded = encodeDeltaPolygon(geometry);
        const decoded = decodeDeltaPolygon(encoded);

        assert.equal(decoded.length, 1);
        assert.equal(decoded[0].length, 2); // outer + hole
        // Outer ring
        assert.equal(decoded[0][0].length, 5);
        // Hole
        assert.equal(decoded[0][1].length, 5);
    });

    it("round-trip preserves coordinates within grid tolerance", () => {
        const geometry = {
            type: "MultiPolygon",
            coordinates: [
                [
                    [
                        [139.0, 35.0],
                        [139.1, 35.0],
                        [139.1, 35.1],
                        [139.0, 35.1],
                        [139.0, 35.0],
                    ],
                ],
            ],
        };

        const original = geometry.coordinates;
        const encoded = encodeDeltaPolygon(geometry);
        const decoded = decodeDeltaPolygon(encoded);

        for (let p = 0; p < original.length; p++) {
            for (let r = 0; r < original[p].length; r++) {
                for (let v = 0; v < original[p][r].length; v++) {
                    assert.ok(
                        Math.abs(decoded[p][r][v][0] - original[p][r][v][0]) <
                            1 / SCALE,
                    );
                    assert.ok(
                        Math.abs(decoded[p][r][v][1] - original[p][r][v][1]) <
                            1 / SCALE,
                    );
                }
            }
        }
    });
});

describe("encoding is always a pure number[]", () => {
    it("encodeDeltaPolygon returns a flat number array", () => {
        const geometry = {
            type: "Polygon",
            coordinates: [
                [
                    [139.0, 35.0],
                    [139.1, 35.0],
                    [139.1, 35.1],
                    [139.0, 35.1],
                    [139.0, 35.0],
                ],
            ],
        };

        const encoded = encodeDeltaPolygon(geometry);
        assert.ok(Array.isArray(encoded));
        assert.ok(encoded.every((v) => typeof v === "number"));
    });

    it("encoded format has polyCount, then ringCount, then length-prefixed rings", () => {
        const geometry = {
            type: "MultiPolygon",
            coordinates: [
                [
                    [
                        [139.0, 35.0],
                        [139.1, 35.0],
                        [139.1, 35.1],
                        [139.0, 35.1],
                        [139.0, 35.0],
                    ],
                ],
            ],
        };

        const encoded = encodeDeltaPolygon(geometry);
        assert.equal(encoded[0], 1); // polyCount
        assert.equal(encoded[1], 1); // ringCount for poly 0
        assert.equal(encoded[2], 10); // ringLen (5 points × 2 coords = 10, ringLen itself not counted)
    });
});
