/**
 * Tests for simplifyGeometry.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simplifyGeometry } from "./simplifyGeometry.mjs";

function pointToSegmentDistanceM([lon, lat], [lon1, lat1], [lon2, lat2]) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371000;
    const cosLat = Math.cos(toRad((lat1 + lat2 + lat) / 3));

    const px = lon * cosLat;
    const py = lat;
    const ax = lon1 * cosLat;
    const ay = lat1;
    const bx = lon2 * cosLat;
    const by = lat2;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    let t;
    if (lenSq === 0) {
        t = 0;
    } else {
        t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
    }

    const projLon = ax + t * dx;
    const projLat = ay + t * dy;

    const projLonGeo = projLon / cosLat;
    const dLat = toRad(projLat - lat);
    const dLon = toRad(projLonGeo - lon);
    const rlat1 = toRad(lat);
    const rlat2 = toRad(projLat);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

describe("simplifyGeometry", () => {
    it("reduces a dense straight polyline while keeping endpoints", () => {
        const coords = [];
        for (let i = 0; i <= 100; i++) {
            coords.push([139.0 + i * 0.0001, 35.0 + i * 0.0001]);
        }
        const geometry = {
            type: "MultiLineString",
            coordinates: [coords],
        };

        const simplified = simplifyGeometry(geometry, 11);
        assert.equal(simplified.type, "MultiLineString");
        assert.equal(simplified.coordinates.length, 1);
        assert.ok(
            simplified.coordinates[0].length < coords.length / 2,
            "expected significant reduction",
        );
        assert.deepEqual(simplified.coordinates[0][0], coords[0]);
        assert.deepEqual(
            simplified.coordinates[0][simplified.coordinates[0].length - 1],
            coords[coords.length - 1],
        );
    });

    it("drops segments that collapse to fewer than two points", () => {
        const geometry = {
            type: "MultiLineString",
            coordinates: [
                [[139.0, 35.0]], // single point — dropped
                [
                    [139.1, 35.1],
                    [139.2, 35.2],
                ], // stays
            ],
        };
        const simplified = simplifyGeometry(geometry, 100);
        assert.equal(simplified.coordinates.length, 1);
        assert.deepEqual(simplified.coordinates[0], [
            [139.1, 35.1],
            [139.2, 35.2],
        ]);
    });

    it("preserves max deviation within tolerance for a curved line", () => {
        const coords = [];
        for (let i = 0; i <= 50; i++) {
            const t = i / 50;
            coords.push([
                139.0 + t * 0.01,
                35.0 + Math.sin(t * Math.PI) * 0.001,
            ]);
        }
        const geometry = {
            type: "MultiLineString",
            coordinates: [coords],
        };
        const tolerance = 25;
        const simplified = simplifyGeometry(geometry, tolerance);

        for (const originalPoint of coords) {
            let bestDist = Infinity;
            const segment = simplified.coordinates[0];
            for (let i = 0; i < segment.length - 1; i++) {
                const d = pointToSegmentDistanceM(
                    originalPoint,
                    segment[i],
                    segment[i + 1],
                );
                if (d < bestDist) bestDist = d;
            }
            assert.ok(
                bestDist <= tolerance,
                `point deviated ${bestDist.toFixed(1)}m > ${tolerance}m`,
            );
        }
    });
});
