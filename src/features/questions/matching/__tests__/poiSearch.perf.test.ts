/**
 * Performance tests for local bundle POI searches.
 *
 * Uses the real japan-kanto bundled data — no mocking of bundledPois or
 * featureSource. Measures cold-start and warm-cache latencies for sparse,
 * medium, and dense categories at typical search radii.
 *
 * Run standalone:
 *   pnpm test -- --testPathPattern=perf/poiSearch.perf
 */

import {
    clearOsmMatchingMemoryCache,
    findMatchingFeaturesWithIndex,
} from "../osmMatchingCache";
import { clearBundledRegionCache } from "../bundledPois";
import { clearSpatialIndexCache } from "../spatialIndex";
import type { MatchingCategory } from "../matchingTypes";

// ─── Helpers ───────────────────────────────────────────────────────────────

type SearchCase = {
    label: string;
    category: MatchingCategory;
    /** [lon, lat] */
    center: [number, number];
    radiusMeters: number;
};

type PerfResult = {
    label: string;
    durationMs: number;
    candidateCount: number;
    source: string;
};

const PERF_BUDGET_MS: Record<string, number> = {
    /** Dense categories (skip fast-path → cell grid). First search pays bundle
     *  reconstruction (~30ms) + cell filtering + ranking.
     *  Budgeted at 100ms to accommodate CI runner variance; local runs
     *  typically complete in 40-70ms. */
    "park cold": 100,
    "park warm": 10,
    /** Medium categories take the fast-path (rank all features globally).
     *  With equirectangular pre-ranking this is well under 10ms. */
    "museum cold": 20,
    "museum warm": 10,
    /** Sparse categories take the fast-path. Negligible cost. */
    "airport cold": 10,
    "airport warm": 5,
};

const CENTERS: Record<string, [number, number]> = {
    shinjuku: [139.7004, 35.6896],
    shibuya: [139.7016, 35.6591],
    ueno: [139.7772, 35.7119],
    ginza: [139.7671, 35.6722],
};

// ─── Cases ─────────────────────────────────────────────────────────────────

const COLD_CASES: SearchCase[] = [
    // Cases from metro logs — park searches at 1200m radius
    {
        label: "park cold",
        category: "park",
        center: CENTERS.shibuya,
        radiusMeters: 1200,
    },
    {
        label: "park cold",
        category: "park",
        center: CENTERS.ueno,
        radiusMeters: 1200,
    },
    {
        label: "park cold",
        category: "park",
        center: CENTERS.ginza,
        radiusMeters: 1200,
    },
    // Sparse category — should be instant via fast-path
    {
        label: "airport cold",
        category: "commercial-airport",
        center: CENTERS.shinjuku,
        radiusMeters: 1200,
    },
    // Medium category — fast-path with moderate feature count
    {
        label: "museum cold",
        category: "museum",
        center: CENTERS.ueno,
        radiusMeters: 1200,
    },
];

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("local bundle POI search performance", () => {
    beforeAll(() => {
        // Prime the region JSON parse once (perf of parsing isn't what we're
        // measuring here — it's a one-time Metro cost in the real app).
        // require() triggers the bundled region registration at module scope,
        // which eagerly parses the ~2 MB japan-kanto.json.
        require("../bundledPois").regionCoveringPoint(35.68, 139.76);
    });

    afterAll(() => {
        clearBundledRegionCache();
    });

    describe("cold start (all caches cleared)", () => {
        beforeEach(async () => {
            clearOsmMatchingMemoryCache();
            await clearSpatialIndexCache();
        });

        for (const c of COLD_CASES) {
            it(`${c.label} — ${c.category} r=${c.radiusMeters}m ${centerLabel(c.center)}`, async () => {
                const result = await measureSearch(c);
                const budget = PERF_BUDGET_MS[`${c.label}`] ?? 100;
                console.log(
                    `[perf:cold] ${c.label} ${c.category} ${centerLabel(c.center)}: ` +
                        `${result.durationMs}ms, ${result.candidateCount} candidates, source=${result.source}`,
                );
                expect(result.durationMs).toBeLessThan(budget);
            });
        }
    });

    describe("warm cache (same location, second call)", () => {
        const warmCases: SearchCase[] = COLD_CASES.map((c) => ({
            ...c,
            label: c.label.replace("cold", "warm"),
        }));

        // Prime each location with one search, then measure the second.
        beforeAll(async () => {
            clearOsmMatchingMemoryCache();
            await clearSpatialIndexCache();
            for (const c of COLD_CASES) {
                await findMatchingFeaturesWithIndex(c.category, c.center, {
                    requestedRadiusMeters: c.radiusMeters,
                    maxCandidates: 10,
                });
            }
        });

        for (const c of warmCases) {
            it(`${c.label} — ${c.category} r=${c.radiusMeters}m ${centerLabel(c.center)}`, async () => {
                const result = await measureSearch(c);
                const budget = PERF_BUDGET_MS[`${c.label}`] ?? 10;
                console.log(
                    `[perf:warm] ${c.label} ${c.category} ${centerLabel(c.center)}: ` +
                        `${result.durationMs}ms, ${result.candidateCount} candidates, source=${result.source}`,
                );
                expect(result.durationMs).toBeLessThan(budget);
            });
        }
    });

    describe("radius scaling", () => {
        beforeEach(async () => {
            clearOsmMatchingMemoryCache();
            await clearSpatialIndexCache();
        });

        const radii = [600, 2400, 10000];

        for (const radius of radii) {
            it(`park r=${radius}m (cold, ${cellsNeeded(radius)} cells)`, async () => {
                const result = await measureSearch({
                    label: "park",
                    category: "park",
                    center: CENTERS.shinjuku,
                    radiusMeters: radius,
                });
                console.log(
                    `[perf:radius] park r=${radius}m: ${result.durationMs}ms, ` +
                        `${result.candidateCount} candidates, source=${result.source}`,
                );
                // Larger radii touch more cells and more features → looser budget.
                const budget = radius <= 600 ? 30 : radius <= 2400 ? 50 : 100;
                expect(result.durationMs).toBeLessThan(budget);
            });
        }
    });
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function centerLabel(center: [number, number]): string {
    for (const [name, coords] of Object.entries(CENTERS)) {
        if (coords[0] === center[0] && coords[1] === center[1]) return name;
    }
    return `${center[1].toFixed(3)},${center[0].toFixed(3)}`;
}

function cellsNeeded(radiusMeters: number): number {
    // Approximate: a 0.1° cell covers ~9.5km at 35°N.
    // A disk of radius R fits roughly (R/9500 * 2 + 1)² cells.
    const spanDeg = (radiusMeters / 111320) * 2; // lat span in degrees
    const cellsPerSide = Math.ceil(spanDeg / 0.1) + 1;
    return cellsPerSide * cellsPerSide;
}

async function measureSearch(c: SearchCase): Promise<PerfResult> {
    const t0 = Date.now();
    const result = await findMatchingFeaturesWithIndex(c.category, c.center, {
        requestedRadiusMeters: c.radiusMeters,
        maxCandidates: 10,
    });
    const durationMs = Date.now() - t0;
    return {
        label: c.label,
        durationMs,
        candidateCount: result.candidates.length,
        source: result.source,
    };
}
