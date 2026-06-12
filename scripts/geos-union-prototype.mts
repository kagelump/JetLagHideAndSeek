/**
 * Prototype: prove GEOS (geos-wasm) can replace polyclip-ts for the
 * body-of-water dissolve — both for *correctness* (overlapping polygons union
 * to a valid, hole-free result) and *cost* (time + peak RSS) on a synthetic
 * worst-case water set.
 *
 * Run: node --import tsx scripts/geos-union-prototype.mts
 */

import { performance } from "node:perf_hooks";
import { union as polyclipUnion } from "polyclip-ts";

import { encodeWkb, decodeWkb } from "../src/shared/geometry/wkb";
import {
    initGeosWasm,
    unaryUnionWKB,
    geosWasmVersion,
} from "../src/shared/geometry/__tests__/helpers/geosWasmShim";
import type { MultiPolygon, Polygon, Position } from "geojson";

// ─── Synthetic worst case ────────────────────────────────────────────────────
// A grid of overlapping square "water" polygons. Each square overlaps its
// neighbours (mimicking the dissolve's overlapDeg seam + real OSM water that
// shares edges). This is the geometry that (a) blows up polyclip-ts memory and
// (b) produces the even-odd false-mask hole when shipped un-unioned.

function makeSquare(x: number, y: number, size: number, ringPts = 40): Polygon {
    // A many-vertex square so each polygon is non-trivial (closer to real OSM
    // water rings than a 4-point box — this is what drives polyclip cost).
    const ring: Position[] = [];
    const per = ringPts / 4;
    for (let i = 0; i < per; i++) ring.push([x + (size * i) / per, y]);
    for (let i = 0; i < per; i++) ring.push([x + size, y + (size * i) / per]);
    for (let i = 0; i < per; i++)
        ring.push([x + size - (size * i) / per, y + size]);
    for (let i = 0; i < per; i++) ring.push([x, y + size - (size * i) / per]);
    ring.push(ring[0]);
    return { type: "Polygon", coordinates: [ring] };
}

function buildWaterSet(cols: number, rows: number): Polygon[] {
    const polys: Polygon[] = [];
    const size = 1.0;
    const step = 0.7; // < size ⇒ neighbours overlap (the seam case)
    for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
            polys.push(makeSquare(cx * step, cy * step, size));
        }
    }
    return polys;
}

function countCoords(g: Polygon | MultiPolygon): number {
    let n = 0;
    const walk = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === "number") n++;
        else if (Array.isArray(c)) for (const i of c) walk(i);
    };
    walk(g.coordinates);
    return n;
}

function rssMB(): number {
    return process.memoryUsage().rss / (1024 * 1024);
}

async function main(): Promise<void> {
    await initGeosWasm();
    console.log(`GEOS version: ${geosWasmVersion()}`);

    const cols = Number(process.env.COLS ?? 24);
    const rows = Number(process.env.ROWS ?? 24);
    const polys = buildWaterSet(cols, rows);
    const inputCoords = polys.reduce((s, p) => s + countCoords(p), 0);
    console.log(
        `\nInput: ${polys.length} overlapping polygons, ` +
            `${inputCoords.toLocaleString()} coords (${cols}×${rows} grid)\n`,
    );

    // ── GEOS path ────────────────────────────────────────────────────────────
    // One MultiPolygon → GEOSUnaryUnion → decode.
    {
        if (global.gc) global.gc();
        const rss0 = rssMB();
        const mp: MultiPolygon = {
            type: "MultiPolygon",
            coordinates: polys.map((p) => p.coordinates),
        };
        const t0 = performance.now();
        const wkb = encodeWkb(mp);
        const outWkb = unaryUnionWKB(wkb);
        const out = outWkb ? decodeWkb(outWkb) : null;
        const ms = performance.now() - t0;
        const peak = rssMB();
        if (!out) {
            console.log("GEOS: FAILED (null result)");
        } else {
            console.log(
                `GEOS unaryUnion : ${ms.toFixed(0).padStart(6)} ms  ` +
                    `Δrss ${(peak - rss0).toFixed(0).padStart(5)} MB  ` +
                    `→ ${out.type}, ${countCoords(out).toLocaleString()} coords`,
            );
        }
    }

    // ── polyclip-ts path (the current pipeline union) ───────────────────────
    {
        if (global.gc) global.gc();
        const rss0 = rssMB();
        const t0 = performance.now();
        let out: Polygon | MultiPolygon | null = null;
        try {
            const coordsList = polys.map((p) => p.coordinates);
            const merged = polyclipUnion(
                coordsList[0] as never,
                ...(coordsList.slice(1) as never[]),
            );
            out = { type: "MultiPolygon", coordinates: merged as never };
        } catch (err) {
            console.log(`polyclip: THREW ${(err as Error).message}`);
        }
        const ms = performance.now() - t0;
        const peak = rssMB();
        if (out) {
            console.log(
                `polyclip union  : ${ms.toFixed(0).padStart(6)} ms  ` +
                    `Δrss ${(peak - rss0).toFixed(0).padStart(5)} MB  ` +
                    `→ ${out.type}, ${countCoords(out).toLocaleString()} coords`,
            );
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
