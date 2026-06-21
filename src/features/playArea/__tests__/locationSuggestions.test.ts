import {
    buildLocationSuggestions,
    fetchEnclosingPlayAreas,
    parseEnclosingAreas,
} from "../locationSuggestions";

const REL = 3_600_000_000;

describe("parseEnclosingAreas", () => {
    it("keeps relation-derived admin areas and sorts most-specific-first", () => {
        const areas = parseEnclosingAreas([
            {
                type: "area",
                id: REL + 4,
                tags: { admin_level: "4", name: "Oregon" },
            },
            {
                type: "area",
                id: REL + 8,
                tags: { admin_level: "8", name: "Portland" },
            },
            {
                type: "area",
                id: REL + 6,
                tags: { admin_level: "6", name: "Multnomah County" },
            },
        ]);

        expect(areas.map((a) => a.label)).toEqual([
            "Portland",
            "Multnomah County",
            "Oregon",
        ]);
    });

    it("drops way-derived areas, non-areas, and entries without name/level", () => {
        const areas = parseEnclosingAreas([
            {
                type: "area",
                id: 2_400_000_001,
                tags: { admin_level: "8", name: "Way Area" },
            },
            {
                type: "node",
                id: REL + 8,
                tags: { admin_level: "8", name: "Node" },
            },
            { type: "area", id: REL + 8, tags: { name: "No Level" } },
            { type: "area", id: REL + 8, tags: { admin_level: "8" } },
            {
                type: "area",
                id: REL + 8,
                tags: { admin_level: "8", name: "Keep" },
            },
        ]);

        expect(areas).toEqual([{ osmId: 8, label: "Keep", adminLevel: 8 }]);
    });

    it("prefers name:en and dedupes by relation id", () => {
        const areas = parseEnclosingAreas([
            {
                type: "area",
                id: REL + 8,
                tags: { admin_level: "8", name: "東京", "name:en": "Tokyo" },
            },
            {
                type: "area",
                id: REL + 8,
                tags: { admin_level: "8", name: "Duplicate" },
            },
        ]);

        expect(areas).toEqual([{ osmId: 8, label: "Tokyo", adminLevel: 8 }]);
    });
});

describe("buildLocationSuggestions", () => {
    it("filters to play-area-sized levels and attaches broader context", () => {
        const suggestions = buildLocationSuggestions([
            { osmId: 100, label: "United States", adminLevel: 2 },
            { osmId: 4, label: "Oregon", adminLevel: 4 },
            { osmId: 6, label: "Multnomah County", adminLevel: 6 },
            { osmId: 8, label: "Portland", adminLevel: 8 },
            { osmId: 10, label: "Some Neighborhood", adminLevel: 10 },
        ]);

        expect(suggestions).toEqual([
            {
                osmId: 8,
                label: "Portland",
                adminLevel: 8,
                context: "Multnomah County, Oregon, United States",
            },
            {
                osmId: 6,
                label: "Multnomah County",
                adminLevel: 6,
                context: "Oregon, United States",
            },
            {
                osmId: 4,
                label: "Oregon",
                adminLevel: 4,
                context: "United States",
            },
        ]);
    });

    it("caps the number of suggestions", () => {
        const enclosing = [4, 5, 6, 7, 8].map((level) => ({
            osmId: level,
            label: `L${level}`,
            adminLevel: level,
        }));

        const suggestions = buildLocationSuggestions(enclosing);
        expect(suggestions).toHaveLength(4);
        // Most-specific-first.
        expect(suggestions.map((s) => s.adminLevel)).toEqual([8, 7, 6, 5]);
    });
});

describe("fetchEnclosingPlayAreas", () => {
    beforeEach(() => {
        globalThis.fetch = jest.fn();
    });

    it("queries Overpass is_in with lat,lon and maps the response", async () => {
        (globalThis.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({
                elements: [
                    {
                        type: "area",
                        id: REL + 4,
                        tags: { admin_level: "4", name: "Oregon" },
                    },
                    {
                        type: "area",
                        id: REL + 8,
                        tags: { admin_level: "8", name: "Portland" },
                    },
                ],
            }),
        });

        const result = await fetchEnclosingPlayAreas([-122.6, 45.5]);

        const url = (globalThis.fetch as jest.Mock).mock.calls[0][0] as string;
        expect(url).toContain("is_in(45.5%2C-122.6)");
        expect(result.map((r) => r.label)).toEqual(["Portland", "Oregon"]);
    });

    it("throws on Overpass error", async () => {
        (globalThis.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 504,
        });

        await expect(fetchEnclosingPlayAreas([0, 0])).rejects.toThrow(
            "Overpass is_in error 504",
        );
    });
});
