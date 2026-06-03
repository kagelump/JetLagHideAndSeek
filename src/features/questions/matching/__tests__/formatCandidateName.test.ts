import { formatCandidateName } from "../formatCandidateName";
import type { OsmFeature } from "../matchingTypes";

function feature(overrides: Partial<OsmFeature> = {}): OsmFeature {
    return {
        lat: 35.68,
        lon: 139.76,
        name: "Test Feature",
        osmId: 1,
        osmType: "node",
        tags: {},
        ...overrides,
    };
}

describe("formatCandidateName", () => {
    it("returns the bare name when no annotations are present", () => {
        expect(formatCandidateName(feature({ name: "Yoyogi Park" }))).toBe(
            "Yoyogi Park",
        );
    });

    it("appends IATA code in parentheses when present", () => {
        expect(
            formatCandidateName(
                feature({ name: "Narita Airport", iata: "NRT" }),
            ),
        ).toBe("Narita Airport (NRT)");
    });

    it("appends nameLength in parentheses when present", () => {
        expect(
            formatCandidateName(
                feature({ name: "Shinjuku Station", nameLength: 13 }),
            ),
        ).toBe("Shinjuku Station (13)");
    });

    it("appends both annotations when both are present", () => {
        expect(
            formatCandidateName(
                feature({
                    name: "Station X",
                    nameLength: 1,
                    iata: "YYY",
                }),
            ),
        ).toBe("Station X (1) (YYY)");
    });

    it("handles nameLength of 0 (defined falsy)", () => {
        expect(formatCandidateName(feature({ name: "A", nameLength: 0 }))).toBe(
            "A (0)",
        );
    });

    it("skips IATA when it is an empty string", () => {
        expect(formatCandidateName(feature({ name: "B", iata: "" }))).toBe("B");
    });

    it("skips annotations when fields are undefined", () => {
        expect(
            formatCandidateName(
                feature({
                    name: "C",
                    nameLength: undefined,
                    iata: undefined,
                }),
            ),
        ).toBe("C");
    });

    // ── English label preference ──────────────────────────────────────

    it("uses feature.name in native mode (default)", () => {
        expect(
            formatCandidateName(
                feature({
                    name: "東京",
                    tags: { name: "東京", "name:en": "Tokyo" },
                }),
            ),
        ).toBe("東京");
    });

    it("uses tags['name:en'] in english mode when available", () => {
        expect(
            formatCandidateName(
                feature({
                    name: "東京",
                    tags: { name: "東京", "name:en": "Tokyo" },
                }),
                "english",
            ),
        ).toBe("Tokyo");
    });

    it("falls back to feature.name in english mode when tags['name:en'] is missing", () => {
        expect(
            formatCandidateName(
                feature({
                    name: "東京",
                    tags: { name: "東京" },
                }),
                "english",
            ),
        ).toBe("東京");
    });

    it("falls back to feature.name in english mode when tags is empty (bundle path)", () => {
        expect(
            formatCandidateName(
                feature({
                    name: "成田国際空港",
                    tags: {},
                    iata: "NRT",
                }),
                "english",
            ),
        ).toBe("成田国際空港 (NRT)");
    });

    it("uses english name with annotations", () => {
        expect(
            formatCandidateName(
                feature({
                    name: "成田国際空港",
                    tags: {
                        name: "成田国際空港",
                        "name:en": "Narita International Airport",
                    },
                    iata: "NRT",
                }),
                "english",
            ),
        ).toBe("Narita International Airport (NRT)");
    });
});
