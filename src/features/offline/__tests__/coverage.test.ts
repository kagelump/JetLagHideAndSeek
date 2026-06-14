/**
 * Tests for coverage status computation.
 *
 * Covers:
 * - Japan (pack-only) → available/covered via packs
 * - Installed pack intersecting → covered/partial
 * - Installed pack bbox fallback (no catalog needed)
 * - Catalog-available packs
 * - Uncovered / unknown states
 * - Multiple overlapping packs (prefer installed, then smallest)
 */

import { getCoverageStatus } from "../coverage";
import type { InstalledPackInfo } from "../coverage";

const JP_KANTO_BBOX: [number, number, number, number] = [
    139.0, 35.0, 140.0, 36.0,
];
const NETHERLANDS_BBOX: [number, number, number, number] = [
    3.3, 50.7, 7.2, 53.6,
];
const OUTSIDE_BBOX: [number, number, number, number] = [-50, -50, -49, -49];

function makeCatalogPack(overrides?: Record<string, unknown>) {
    return {
        id: "europe-netherlands",
        label: "Netherlands",
        bbox: NETHERLANDS_BBOX,
        osmSnapshot: "2026-06-01",
        totalBytes: 5_000_000,
        ...overrides,
    };
}

function makeInstalledPack(
    overrides?: Partial<InstalledPackInfo>,
): InstalledPackInfo {
    return {
        id: "europe-netherlands",
        osmSnapshot: "2026-06-01",
        bbox: NETHERLANDS_BBOX,
        artifactKinds: ["poi", "measuring", "boundaries", "transit", "meta"],
        missingKinds: [],
        ...overrides,
    };
}

// ─── Japan (pack-only) ──────────────────────────────────────────────────

describe("getCoverageStatus — Japan (pack-only)", () => {
    it("returns available for Japan when a catalog pack intersects but none installed", () => {
        const catalog = [
            makeCatalogPack({
                id: "asia-japan-kanto",
                label: "Kantō",
                bbox: JP_KANTO_BBOX,
            }),
        ];
        const result = getCoverageStatus(JP_KANTO_BBOX, catalog, []);
        expect(result.state).toBe("available");
        if (result.state === "available") {
            expect(result.packId).toBe("asia-japan-kanto");
        }
    });

    it("returns covered for Japan when the pack is installed", () => {
        const installed = [
            makeInstalledPack({
                id: "asia-japan-kanto",
                bbox: JP_KANTO_BBOX,
            }),
        ];
        const result = getCoverageStatus(JP_KANTO_BBOX, [], installed);
        expect(result.state).toBe("covered");
        if (result.state === "covered") {
            expect(result.packId).toBe("asia-japan-kanto");
        }
    });

    it("returns unknown for Japan with no catalog and no installed packs", () => {
        const result = getCoverageStatus(JP_KANTO_BBOX, undefined, []);
        expect(result.state).toBe("unknown");
    });
});

// ─── Installed pack ─────────────────────────────────────────────────────

describe("getCoverageStatus — installed pack", () => {
    it("returns covered when installed pack intersects and has no missing kinds", () => {
        const installed = [makeInstalledPack()];
        const catalog = [makeCatalogPack()];

        const result = getCoverageStatus(NETHERLANDS_BBOX, catalog, installed);
        expect(result.state).toBe("covered");
        expect((result as { packId: string }).packId).toBe(
            "europe-netherlands",
        );
    });

    it("returns partial when installed pack has missing kinds", () => {
        const installed = [makeInstalledPack({ missingKinds: ["transit"] })];
        const catalog = [makeCatalogPack()];

        const result = getCoverageStatus(NETHERLANDS_BBOX, catalog, installed);
        expect(result.state).toBe("partial");
        if (result.state === "partial") {
            expect(result.missingKinds).toEqual(["transit"]);
        }
    });

    it("uses installed bbox when catalog is unreachable", () => {
        // No catalog → coverage should still work from installed index bbox.
        const installed = [makeInstalledPack()];

        const result = getCoverageStatus(
            NETHERLANDS_BBOX,
            undefined,
            installed,
        );
        expect(result.state).toBe("covered");
        expect((result as { packId: string }).packId).toBe(
            "europe-netherlands",
        );
    });

    it("returns updateAvailable when catalog has newer snapshot", () => {
        const installed = [makeInstalledPack({ osmSnapshot: "2026-05-01" })];
        const catalog = [makeCatalogPack({ osmSnapshot: "2026-06-01" })];

        const result = getCoverageStatus(NETHERLANDS_BBOX, catalog, installed);
        expect(result.state).toBe("covered");
        if (result.state === "covered") {
            expect(result.updateAvailable).toBe(true);
        }
    });

    it("returns updateAvailable false when installed is same or newer", () => {
        const installed = [makeInstalledPack({ osmSnapshot: "2026-06-01" })];
        const catalog = [makeCatalogPack({ osmSnapshot: "2026-06-01" })];

        const result = getCoverageStatus(NETHERLANDS_BBOX, catalog, installed);
        expect(result.state).toBe("covered");
        if (result.state === "covered") {
            expect(result.updateAvailable).toBe(false);
        }
    });
});

// ─── Catalog-available ──────────────────────────────────────────────────

describe("getCoverageStatus — catalog available", () => {
    it("returns available when catalog pack intersects but none installed", () => {
        const catalog = [makeCatalogPack()];

        const result = getCoverageStatus(NETHERLANDS_BBOX, catalog, []);
        expect(result.state).toBe("available");
        if (result.state === "available") {
            expect(result.packId).toBe("europe-netherlands");
            expect(result.label).toBe("Netherlands");
            expect(result.totalBytes).toBe(5_000_000);
        }
    });

    it("prefers installed over catalog when both intersect", () => {
        const catalog = [makeCatalogPack()];
        const installed = [makeInstalledPack()];

        // Even though the catalog also has the pack, the installed one
        // is preferred.
        const result = getCoverageStatus(NETHERLANDS_BBOX, catalog, installed);
        expect(result.state).toBe("covered");
    });

    it("prefers smallest-area when multiple catalog packs intersect", () => {
        const catalog = [
            makeCatalogPack(),
            makeCatalogPack({
                id: "europe-benelux",
                label: "Benelux",
                bbox: [2.0, 49.0, 8.0, 54.0] as [
                    number,
                    number,
                    number,
                    number,
                ],
                totalBytes: 15_000_000,
            }),
        ];

        // Netherlands is smaller → should be preferred.
        const result = getCoverageStatus(NETHERLANDS_BBOX, catalog, []);
        expect(result.state).toBe("available");
        if (result.state === "available") {
            expect(result.packId).toBe("europe-netherlands");
        }
    });

    it("prefers container over non-container even when the container is larger", () => {
        // Tokyo 23 Wards bbox. Kanto's real (inflated) bbox is
        // huge because of Pacific islands, but it fully contains Tokyo.
        // Chubu's tighter bbox intersects but the east edge (139.909) is
        // just west of Tokyo's east edge (139.92) — it does NOT contain.
        const tokyoBbox: [number, number, number, number] = [
            139.56, 35.48, 139.92, 35.82,
        ];
        const kantoBbox: [number, number, number, number] = [
            134.05, 18.63, 155.61, 37.16,
        ];
        const chubuBbox: [number, number, number, number] = [
            135.44, 34.27, 139.909, 38.91,
        ];
        const catalog = [
            makeCatalogPack({
                id: "asia-japan-kanto",
                label: "Kanto",
                bbox: kantoBbox,
                totalBytes: 5_000_000,
            }),
            makeCatalogPack({
                id: "asia-japan-chubu",
                label: "Chubu",
                bbox: chubuBbox,
                totalBytes: 3_000_000,
            }),
        ];

        const result = getCoverageStatus(tokyoBbox, catalog, []);
        expect(result.state).toBe("available");
        if (result.state === "available") {
            // Kanto wins despite being 19× larger, because it contains Tokyo.
            expect(result.packId).toBe("asia-japan-kanto");
        }
    });

    it("prefers smaller container when multiple packs fully contain", () => {
        const tokyoBbox: [number, number, number, number] = [
            139.56, 35.48, 139.92, 35.82,
        ];
        // Both fully contain Tokyo; the smaller one should win.
        const bigJapan: [number, number, number, number] = [
            120.0, 20.0, 160.0, 50.0,
        ];
        const smallJapan: [number, number, number, number] = [
            138.0, 34.0, 142.0, 37.0,
        ];
        const catalog = [
            makeCatalogPack({
                id: "big-japan",
                label: "Big Japan",
                bbox: bigJapan,
            }),
            makeCatalogPack({
                id: "small-japan",
                label: "Small Japan",
                bbox: smallJapan,
            }),
        ];

        const result = getCoverageStatus(tokyoBbox, catalog, []);
        expect(result.state).toBe("available");
        if (result.state === "available") {
            expect(result.packId).toBe("small-japan");
        }
    });

    it("uses highest intersection ratio when no pack fully contains", () => {
        // A play area that isn't fully contained by any pack. The pack
        // with the most overlap (by ratio) should win.
        const playArea: [number, number, number, number] = [
            5.0, 45.0, 15.0, 55.0,
        ];
        // Pack A covers ~80% of the play area.
        const packA: [number, number, number, number] = [5.0, 45.0, 13.0, 55.0];
        // Pack B covers only ~20%.
        const packB: [number, number, number, number] = [5.0, 45.0, 7.0, 55.0];
        const catalog = [
            makeCatalogPack({
                id: "pack-b",
                label: "Pack B",
                bbox: packB,
            }),
            makeCatalogPack({
                id: "pack-a",
                label: "Pack A",
                bbox: packA,
            }),
        ];

        const result = getCoverageStatus(playArea, catalog, []);
        expect(result.state).toBe("available");
        if (result.state === "available") {
            // Pack A has higher overlap ratio.
            expect(result.packId).toBe("pack-a");
        }
    });
});

// ─── Uncovered / unknown ────────────────────────────────────────────────

describe("getCoverageStatus — uncovered and unknown", () => {
    it("returns uncovered when nothing intersects", () => {
        const catalog = [makeCatalogPack()];
        const installed = [makeInstalledPack()];

        const result = getCoverageStatus(OUTSIDE_BBOX, catalog, installed);
        expect(result.state).toBe("uncovered");
    });

    it("returns unknown when no catalog data is available", () => {
        // No catalog, no installed packs in this area.
        const result = getCoverageStatus(OUTSIDE_BBOX, undefined, []);
        expect(result.state).toBe("unknown");
    });

    it("returns uncovered when catalog is empty", () => {
        const result = getCoverageStatus(OUTSIDE_BBOX, [], []);
        expect(result.state).toBe("uncovered");
    });

    it("returns unknown when catalog is undefined and nothing installed", () => {
        const installed = [
            makeInstalledPack({ bbox: undefined }), // no bbox to match
        ];

        // Even though a pack is installed, without a bbox it can't
        // be matched to the play area, and with no catalog we have
        // no way to know.
        const result = getCoverageStatus(OUTSIDE_BBOX, undefined, installed);
        expect(result.state).toBe("unknown");
    });
});

// ─── Edge cases ─────────────────────────────────────────────────────────

describe("getCoverageStatus — edge cases", () => {
    it("handles empty installed packs array", () => {
        const catalog = [makeCatalogPack()];
        const result = getCoverageStatus(NETHERLANDS_BBOX, catalog, []);
        expect(result.state).toBe("available");
    });

    it("handles empty catalog array with installed pack", () => {
        const installed = [makeInstalledPack()];
        // Empty catalog but installed pack has bbox → covered.
        const result = getCoverageStatus(NETHERLANDS_BBOX, [], installed);
        expect(result.state).toBe("covered");
    });

    it("handles installed pack outside play area", () => {
        const installed = [makeInstalledPack()];
        // Installed pack doesn't intersect → should look at catalog or
        // return uncovered.
        const result = getCoverageStatus(OUTSIDE_BBOX, undefined, installed);
        // Pack bbox is NETHERLANDS_BBOX, play area is OUTSIDE_BBOX.
        expect(result.state).toBe("unknown");
    });
});
