import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectImplausibleJumps, repairStopOrder } from "./stopOrderRepair.mjs";

describe("detectImplausibleJumps", () => {
    it("flags an outlier appended at the end of a route", () => {
        const stops = [];
        for (let i = 0; i < 30; i++) {
            stops.push({ id: `s${i}`, lat: 35.0 + i * 0.009, lon: 139.0 });
        }
        // Outlier at same position as stop 0, appended at end.
        // Gap from stop 29 = 29 * 0.009° ≈ 29 km > 20 km threshold.
        stops.push({ id: "outlier", lat: 35.0, lon: 139.0 });

        const flagged = detectImplausibleJumps(stops);
        assert.deepEqual(flagged, [29], "Should flag the final gap");
    });

    it("does not flag a loop route with consistent spacing", () => {
        const stops = [];
        for (let i = 0; i < 30; i++) {
            const angle = (i / 30) * 2 * Math.PI;
            const r = 0.16;
            stops.push({
                id: `s${i}`,
                lat: 35.0 + r * Math.sin(angle),
                lon: 139.0 + r * Math.cos(angle),
            });
        }
        const flagged = detectImplausibleJumps(stops);
        assert.equal(
            flagged.length,
            0,
            "Loop route should have no flagged gaps",
        );
    });

    it("does not flag a limited-express variant with uniformly long gaps", () => {
        const stops = [];
        for (let i = 0; i < 10; i++) {
            stops.push({ id: `s${i}`, lat: 35.0 + i * 0.072, lon: 139.0 });
        }
        const flagged = detectImplausibleJumps(stops);
        assert.equal(
            flagged.length,
            0,
            "Uniform long gaps should not be flagged",
        );
    });

    it("flags a bad gap in a 3-stop variant (R8 — excludes largest from median)", () => {
        // 3 stops, gaps ~1 km and ~60 km.  Without the fix the 60 km gap
        // would escape because median = 30.5 and threshold = 122.
        const stops = [
            { id: "a", lat: 35.0, lon: 139.0 },
            { id: "b", lat: 35.0 + 0.009, lon: 139.0 }, // ~1 km from a
            { id: "c", lat: 35.0 + 0.54, lon: 139.0 }, // ~60 km from b
        ];
        const flagged = detectImplausibleJumps(stops);
        assert.deepEqual(
            flagged,
            [1],
            "Should flag the 60 km gap in a 3-stop variant",
        );
    });
});

describe("repairStopOrder", () => {
    it("repairs an outlier appended at the end (春日部-like case)", () => {
        const stops = [];
        for (let i = 0; i < 30; i++) {
            stops.push({ id: `s${i}`, lat: 35.0 + i * 0.009, lon: 139.0 });
        }
        // Outlier at same position as stop 0 — belongs at the start.
        const outlier = { id: "kasukabe", lat: 35.0, lon: 139.0 };
        stops.push(outlier);

        const {
            stops: repaired,
            repaired: wasRepaired,
            repairsDone,
        } = repairStopOrder(stops);
        assert.equal(wasRepaired, true);
        assert.equal(repairsDone, 1);
        assert.equal(repaired.length, stops.length);
        assert.notEqual(repaired[repaired.length - 1].id, "kasukabe");
        assert.equal(detectImplausibleJumps(repaired).length, 0);
    });

    it("rejects repair when no reinsertion improves total length", () => {
        // 5-stop sequence where the outlier is so far that any single move
        // either recreates the gap or does not reduce total length.
        const a = { id: "a", lat: 35.0, lon: 139.0 };
        const b = { id: "b", lat: 35.01, lon: 139.0 };
        const c = { id: "c", lat: 35.02, lon: 139.0 };
        const d = { id: "d", lat: 35.03, lon: 139.0 };
        const e = { id: "e", lat: 35.7, lon: 139.0 };
        const stops = [a, b, c, d, e];

        const {
            stops: result,
            repaired,
            repairsDone,
            warnings,
        } = repairStopOrder(stops);
        assert.equal(
            repaired,
            false,
            "Should reject repair when no improvement found",
        );
        assert.equal(repairsDone, 0);
        assert.deepEqual(
            result.map((s) => s.id),
            ["a", "b", "c", "d", "e"],
        );
        assert.ok(warnings.length > 0, "Should emit a warning");
    });

    it("leaves an already-correct route unchanged", () => {
        const stops = [];
        for (let i = 0; i < 15; i++) {
            stops.push({ id: `s${i}`, lat: 35.0 + i * 0.009, lon: 139.0 });
        }
        const {
            stops: result,
            repaired,
            repairsDone,
            warnings,
        } = repairStopOrder(stops);
        assert.equal(repaired, false);
        assert.equal(repairsDone, 0);
        assert.deepEqual(
            result.map((s) => s.id),
            stops.map((s) => s.id),
        );
        assert.equal(warnings.length, 0);
    });

    it("caps repairs at maxRepairs, reverts if gaps remain (R1)", () => {
        const stops = [];
        for (let i = 0; i < 30; i++) {
            stops.push({ id: `s${i}`, lat: 35.0 + i * 0.009, lon: 139.0 });
        }
        // Two outliers both at stop 0's position.
        stops.push({ id: "bad1", lat: 35.0, lon: 139.0 });
        stops.push({ id: "bad2", lat: 35.0, lon: 139.0 });

        const {
            stops: result,
            repaired,
            repairsDone,
            warnings,
        } = repairStopOrder(stops, {
            maxRepairs: 1,
        });
        // With atomic acceptance (R1), partial repair reverts to original.
        assert.equal(repaired, false, "Should revert when gaps remain");
        assert.equal(repairsDone, 0);
        assert.deepEqual(
            result.map((s) => s.id),
            stops.map((s) => s.id),
        );
        assert.ok(
            warnings.some((w) => w.includes("Unrepairable")),
            "Should warn about unrepairable remainder",
        );
    });

    it("declines repair for a reversed mid-route block (R5)", () => {
        // Correct order: A-B-C-D-E-F at positions 0,10,20,30,40,50.
        // Stored as: A-D-C-B-E-F (middle block reversed).
        const a = { id: "a", lat: 35.0, lon: 139.0 };
        const d = { id: "d", lat: 35.0 + 0.27, lon: 139.0 }; // ~30 km
        const c = { id: "c", lat: 35.0 + 0.18, lon: 139.0 }; // ~20 km
        const b = { id: "b", lat: 35.0 + 0.09, lon: 139.0 }; // ~10 km
        const e = { id: "e", lat: 35.0 + 0.36, lon: 139.0 }; // ~40 km
        const f = { id: "f", lat: 35.0 + 0.45, lon: 139.0 }; // ~50 km
        const stops = [a, d, c, b, e, f];

        const {
            stops: result,
            repaired,
            repairsDone,
            warnings,
        } = repairStopOrder(stops);
        assert.equal(
            repaired,
            false,
            "Should decline repair for reversed block",
        );
        assert.equal(repairsDone, 0);
        assert.deepEqual(
            result.map((s) => s.id),
            ["a", "d", "c", "b", "e", "f"],
            "Should revert to original order",
        );
        assert.ok(warnings.length > 0, "Should emit warnings");
    });

    it("force-fed correct route with flagged gap finds no improvement (R5)", () => {
        // B is far from A but close to C,D,E.  Any reinsertion of B or A
        // does not strictly improve total length, so repair declines.
        const a = { id: "a", lat: 35.0, lon: 139.0 };
        const b = { id: "b", lat: 35.0 + 0.45, lon: 139.0 }; // ~50 km from a
        const c = { id: "c", lat: 35.0 + 0.46, lon: 139.0 }; // ~1 km from b
        const d = { id: "d", lat: 35.0 + 0.47, lon: 139.0 };
        const e = { id: "e", lat: 35.0 + 0.48, lon: 139.0 };
        const stops = [a, b, c, d, e];

        // Detection should flag the 50 km gap.
        const flagged = detectImplausibleJumps(stops);
        assert.ok(flagged.length > 0, "Should flag the large gap");

        const {
            stops: result,
            repaired,
            repairsDone,
            warnings,
        } = repairStopOrder(stops);
        assert.equal(repaired, false, "Should find no valid reinsertion");
        assert.equal(repairsDone, 0);
        assert.deepEqual(
            result.map((s) => s.id),
            ["a", "b", "c", "d", "e"],
            "Should revert to original order",
        );
        assert.ok(warnings.length > 0, "Should emit a warning");
    });

    it("repairs duplicate consecutive ids without mis-identifying positions (R6)", () => {
        // A-B-B-C where the second B is a duplicate and C is an outlier.
        const a = { id: "a", lat: 35.0, lon: 139.0 };
        const b1 = { id: "b", lat: 35.0 + 0.009, lon: 139.0 };
        const b2 = { id: "b", lat: 35.0 + 0.009, lon: 139.0 }; // duplicate
        const c = { id: "c", lat: 35.0, lon: 139.0 }; // outlier back at A
        const stops = [a, b1, b2, c];

        const { stops: result, repaired, repairsDone } = repairStopOrder(stops);
        assert.equal(repaired, true);
        assert.equal(repairsDone, 1);
        // C should move next to A (position 0 or 1).
        const cIdx = result.findIndex((s) => s.id === "c");
        assert.ok(cIdx <= 1, "Outlier C should be near the start");
        assert.equal(detectImplausibleJumps(result).length, 0);
    });
});
