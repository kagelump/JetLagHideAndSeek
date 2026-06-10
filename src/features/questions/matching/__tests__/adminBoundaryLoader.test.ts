import {
    queryAdminBoundary,
    clearAdminBoundaryCache,
    resetAdminBoundaryState,
    setAdminBoundaryBundle,
} from "../adminBoundaryLoader";

// ─── Test fixture ────────────────────────────────────────────────────────────

const TEST_BUNDLE = {
    schemaVersion: 1,
    category: "admin-boundaries",
    generatedAt: "2025-01-01T00:00:00.000Z",
    source: "test",
    extractBbox: [139.0, 35.0, 140.0, 36.0] as [number, number, number, number],
    features: [
        // Prefecture A (level 4): large square.
        {
            type: "Feature" as const,
            bbox: [139.0, 35.0, 139.5, 35.5] as [
                number,
                number,
                number,
                number,
            ],
            geometry: {
                type: "Polygon" as const,
                coordinates: [
                    [
                        [139.0, 35.0],
                        [139.5, 35.0],
                        [139.5, 35.5],
                        [139.0, 35.5],
                        [139.0, 35.0],
                    ],
                ],
            },
            properties: {
                osmId: 1001,
                admin_level: "4",
                name: "Prefecture A",
                "name:en": "Prefecture A",
            },
        },
        // Prefecture B (level 4): another square, no overlap.
        {
            type: "Feature" as const,
            bbox: [139.5, 35.0, 140.0, 35.5] as [
                number,
                number,
                number,
                number,
            ],
            geometry: {
                type: "Polygon" as const,
                coordinates: [
                    [
                        [139.5, 35.0],
                        [140.0, 35.0],
                        [140.0, 35.5],
                        [139.5, 35.5],
                        [139.5, 35.0],
                    ],
                ],
            },
            properties: {
                osmId: 1002,
                admin_level: "4",
                name: "Prefecture B",
                "name:en": "Prefecture B",
            },
        },
        // City X (level 7): smaller square inside Prefecture A.
        {
            type: "Feature" as const,
            bbox: [139.1, 35.1, 139.3, 35.3] as [
                number,
                number,
                number,
                number,
            ],
            geometry: {
                type: "Polygon" as const,
                coordinates: [
                    [
                        [139.1, 35.1],
                        [139.3, 35.1],
                        [139.3, 35.3],
                        [139.1, 35.3],
                        [139.1, 35.1],
                    ],
                ],
            },
            properties: {
                osmId: 2001,
                admin_level: "7",
                name: "City X",
                "name:en": "City X",
            },
        },
        // A MultiPolygon: two disjoint parts, level 7.
        {
            type: "Feature" as const,
            bbox: [139.0, 35.5, 139.6, 35.9] as [
                number,
                number,
                number,
                number,
            ],
            geometry: {
                type: "MultiPolygon" as const,
                coordinates: [
                    [
                        [
                            [139.0, 35.5],
                            [139.3, 35.5],
                            [139.3, 35.7],
                            [139.0, 35.7],
                            [139.0, 35.5],
                        ],
                    ],
                    [
                        [
                            [139.4, 35.6],
                            [139.6, 35.6],
                            [139.6, 35.9],
                            [139.4, 35.9],
                            [139.4, 35.6],
                        ],
                    ],
                ],
            },
            properties: {
                osmId: 2002,
                admin_level: "7",
                name: "Multi-Town",
                "name:en": "Multi-Town",
            },
        },
        // Polygon with a hole (level 7).
        {
            type: "Feature" as const,
            bbox: [139.6, 35.0, 139.9, 35.4] as [
                number,
                number,
                number,
                number,
            ],
            geometry: {
                type: "Polygon" as const,
                coordinates: [
                    [
                        [139.6, 35.0],
                        [139.9, 35.0],
                        [139.9, 35.4],
                        [139.6, 35.4],
                        [139.6, 35.0],
                    ],
                    // Hole in the middle.
                    [
                        [139.7, 35.1],
                        [139.8, 35.1],
                        [139.8, 35.3],
                        [139.7, 35.3],
                        [139.7, 35.1],
                    ],
                ],
            },
            properties: {
                osmId: 2003,
                admin_level: "7",
                name: "Donut City",
                "name:en": "Donut City",
            },
        },
    ],
};

beforeEach(() => {
    resetAdminBoundaryState();
    setAdminBoundaryBundle(TEST_BUNDLE as any);
});

// ─── Point-in-polygon containment ────────────────────────────────────────────

describe("queryAdminBoundary", () => {
    describe("containment", () => {
        it("returns the matching feature for a point inside a polygon", () => {
            const result = queryAdminBoundary(139.2, 35.2, "4");
            expect(result).not.toBeNull();
            expect(result!).toHaveLength(1);
            expect(result![0].name).toBe("Prefecture A");
            expect(result![0].osmId).toBe(1001);
            expect(result![0].osmType).toBe("relation");
            expect(result![0].distanceMeters).toBe(0);
        });

        it("returns the other feature for a point in Prefecture B", () => {
            const result = queryAdminBoundary(139.7, 35.2, "4");
            expect(result).not.toBeNull();
            expect(result!).toHaveLength(1);
            expect(result![0].name).toBe("Prefecture B");
        });

        it("returns City X for a point inside both Prefecture A and City X", () => {
            const result = queryAdminBoundary(139.2, 35.2, "7");
            expect(result).not.toBeNull();
            expect(result!).toHaveLength(1);
            expect(result![0].name).toBe("City X");
        });

        it("returns empty array for a point inside extract bbox but no boundary at this level", () => {
            // (139.65, 35.65) is inside Prefecture B (level 4) but no level 7
            // polygon covers this point.
            const result = queryAdminBoundary(139.65, 35.65, "7");
            expect(result).not.toBeNull();
            expect(result!).toHaveLength(0);
        });

        it("handles MultiPolygon: point in first part", () => {
            const result = queryAdminBoundary(139.15, 35.6, "7");
            expect(result).not.toBeNull();
            expect(result!).toHaveLength(1);
            expect(result![0].name).toBe("Multi-Town");
        });

        it("handles MultiPolygon: point in second part", () => {
            const result = queryAdminBoundary(139.5, 35.75, "7");
            expect(result).not.toBeNull();
            expect(result!).toHaveLength(1);
            expect(result![0].name).toBe("Multi-Town");
        });

        it("excludes points inside a polygon hole", () => {
            // (139.75, 35.2) is inside Donut City's hole.
            const result = queryAdminBoundary(139.75, 35.2, "7");
            expect(result).not.toBeNull();
            expect(result!).toHaveLength(0);
        });

        it("includes points outside the hole but inside the polygon", () => {
            // (139.65, 35.05) is in Donut City's exterior ring, outside the hole.
            const result = queryAdminBoundary(139.65, 35.05, "7");
            expect(result).not.toBeNull();
            expect(result!).toHaveLength(1);
            expect(result![0].name).toBe("Donut City");
        });
    });

    describe("bounding-box rejection", () => {
        it("returns null for a point outside the extract bbox", () => {
            const result = queryAdminBoundary(138.0, 35.0, "4");
            expect(result).toBeNull();
        });
    });

    describe("unknown admin_level", () => {
        it("returns null for a level with no features", () => {
            const result = queryAdminBoundary(139.2, 35.2, "99");
            expect(result).toBeNull();
        });
    });

    describe("grid caching", () => {
        it("reuses the grid on repeated queries for the same level", () => {
            queryAdminBoundary(139.2, 35.2, "4");
            const result = queryAdminBoundary(139.7, 35.2, "4");
            expect(result).not.toBeNull();
            expect(result![0].name).toBe("Prefecture B");
        });

        it("rebuilds after cache clear", () => {
            queryAdminBoundary(139.2, 35.2, "4");
            clearAdminBoundaryCache();
            const result = queryAdminBoundary(139.7, 35.2, "4");
            expect(result).not.toBeNull();
            expect(result![0].name).toBe("Prefecture B");
        });
    });
});

describe("setAdminBoundaryBundle", () => {
    it("overrides the bundle and clears the grid cache", () => {
        // First query builds the grid from TEST_BUNDLE.
        const r1 = queryAdminBoundary(139.2, 35.2, "4");
        expect(r1![0].name).toBe("Prefecture A");

        // Inject a new bundle.
        setAdminBoundaryBundle({
            ...TEST_BUNDLE,
            features: [
                {
                    ...TEST_BUNDLE.features[0],
                    properties: {
                        ...TEST_BUNDLE.features[0].properties,
                        name: "Changed",
                    },
                },
            ],
        } as any);

        const r2 = queryAdminBoundary(139.2, 35.2, "4");
        expect(r2![0].name).toBe("Changed");
    });
});
