/**
 * Tests for coverage status computation.
 *
 * Covers:
 * - Bundled Japan → always covered
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

// ─── Bundled Japan ──────────────────────────────────────────────────────

describe("getCoverageStatus — bundled Japan", () => {
    it("returns covered for Japan Kantō bbox", () => {
        const result = getCoverageStatus(JP_KANTO_BBOX, [], []);
        expect(result.state).toBe("covered");
        expect((result as { packId: string }).packId).toBe("japan-bundled");
    });

    it("returns covered even with no catalog and no installed packs", () => {
        const result = getCoverageStatus(JP_KANTO_BBOX, undefined, []);
        expect(result.state).toBe("covered");
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
