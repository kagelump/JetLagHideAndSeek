import { catalogSchema, type Catalog } from "../packCatalog";

// ─── v2 catalog fixture (valid) ──────────────────────────────────────────

const VALID_CATALOG: unknown = {
    schemaVersion: 2,
    generatedAt: "2026-06-12T00:00:00Z",
    attributionUrl: "https://example.com/NOTICE",
    packs: [
        {
            id: "europe-netherlands",
            label: "Netherlands",
            regionPath: ["Europe", "Netherlands"],
            bbox: [3.31, 50.75, 7.22, 53.7],
            osmSnapshot: "2026-06-08",
            totalBytes: 31457280,
            artifacts: [
                {
                    kind: "poi",
                    url: "https://github.com/example/JetLagHideAndSeek/releases/download/packs-2026-06-12/europe-netherlands-poi.json.gz",
                    bytes: 1234567,
                    md5: "abc123",
                    sha256: "def456",
                    schemaVersion: 1,
                },
                {
                    kind: "measuring",
                    category: "coastline",
                    url: "https://github.com/example/JetLagHideAndSeek/releases/download/packs-2026-06-12/europe-netherlands-measuring-coastline.json.gz",
                    bytes: 500000,
                    md5: "ghi789",
                    sha256: "jkl012",
                    schemaVersion: 1,
                },
            ],
        },
    ],
};

// ─── v1 manifest fixture (invalid for v2 schema) ─────────────────────────

const V1_MANIFEST: unknown = {
    schemaVersion: 1,
    generatedAt: "2026-06-01T00:00:00Z",
    packs: [
        {
            id: "test-region",
            label: "Test Region",
            bbox: [139.5, 35.5, 140.0, 36.0],
            totalCount: 100,
            url: "https://cdn.example.com/poi/test-region.json.gz",
            bytes: 5000,
            sha256: "abc",
            md5: "def",
        },
    ],
};

describe("packCatalog schema", () => {
    it("validates a valid v2 catalog", () => {
        const result = catalogSchema.safeParse(VALID_CATALOG);
        expect(result.success).toBe(true);
        const catalog = result.data as Catalog;
        expect(catalog.schemaVersion).toBe(2);
        expect(catalog.packs).toHaveLength(1);

        const pack = catalog.packs[0];
        expect(pack.id).toBe("europe-netherlands");
        expect(pack.regionPath).toEqual(["Europe", "Netherlands"]);
        expect(pack.bbox).toEqual([3.31, 50.75, 7.22, 53.7]);
        expect(pack.osmSnapshot).toBe("2026-06-08");
        expect(pack.totalBytes).toBe(31457280);
        expect(pack.artifacts).toHaveLength(2);

        const poiArtifact = pack.artifacts[0];
        expect(poiArtifact.kind).toBe("poi");
        expect(poiArtifact.category).toBeUndefined();
        expect(poiArtifact.bytes).toBe(1234567);
        expect(poiArtifact.md5).toBe("abc123");
        expect(poiArtifact.sha256).toBe("def456");
        expect(poiArtifact.schemaVersion).toBe(1);

        const measArtifact = pack.artifacts[1];
        expect(measArtifact.kind).toBe("measuring");
        expect(measArtifact.category).toBe("coastline");
    });

    it("rejects schemaVersion !== 2", () => {
        const result = catalogSchema.safeParse(V1_MANIFEST);
        expect(result.success).toBe(false);
    });

    it("rejects missing required fields", () => {
        const result = catalogSchema.safeParse({
            schemaVersion: 2,
            generatedAt: "2026-06-12T00:00:00Z",
            // missing packs
        });
        expect(result.success).toBe(false);
    });

    it("rejects empty regionPath", () => {
        const result = catalogSchema.safeParse({
            schemaVersion: 2,
            generatedAt: "2026-06-12T00:00:00Z",
            packs: [
                {
                    id: "test",
                    label: "Test",
                    regionPath: [],
                    bbox: [0, 0, 1, 1],
                    osmSnapshot: "2026-06-08",
                    totalBytes: 1000,
                    artifacts: [
                        {
                            kind: "poi",
                            url: "https://example.com/test.json.gz",
                            bytes: 1000,
                            md5: "abc",
                            sha256: "def",
                            schemaVersion: 1,
                        },
                    ],
                },
            ],
        });
        expect(result.success).toBe(false);
    });

    it("rejects artifacts with unknown kind", () => {
        const result = catalogSchema.safeParse({
            schemaVersion: 2,
            generatedAt: "2026-06-12T00:00:00Z",
            packs: [
                {
                    id: "test",
                    label: "Test",
                    regionPath: ["Europe"],
                    bbox: [0, 0, 1, 1],
                    osmSnapshot: "2026-06-08",
                    totalBytes: 1000,
                    artifacts: [
                        {
                            kind: "unknown-kind",
                            url: "https://example.com/test.json.gz",
                            bytes: 1000,
                            md5: "abc",
                            sha256: "def",
                            schemaVersion: 1,
                        },
                    ],
                },
            ],
        });
        expect(result.success).toBe(false);
    });

    it("rejects packs with 0 totalBytes", () => {
        const result = catalogSchema.safeParse({
            schemaVersion: 2,
            generatedAt: "2026-06-12T00:00:00Z",
            packs: [
                {
                    id: "test",
                    label: "Test",
                    regionPath: ["Europe"],
                    bbox: [0, 0, 1, 1],
                    osmSnapshot: "2026-06-08",
                    totalBytes: 0,
                    artifacts: [
                        {
                            kind: "poi",
                            url: "https://example.com/test.json.gz",
                            bytes: 1000,
                            md5: "abc",
                            sha256: "def",
                            schemaVersion: 1,
                        },
                    ],
                },
            ],
        });
        expect(result.success).toBe(false);
    });
});
