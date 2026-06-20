import {
    imperialRadarPresets,
    isImperialRadarPreset,
    metricRadarPresets,
    radarDistanceOptionMeters,
} from "@/features/questions/radar/radarTypes";

const METERS_PER_MILE = 1609.344;

describe("radar distance presets", () => {
    it("exposes parallel metric and imperial ladders of equal length", () => {
        expect(metricRadarPresets).toHaveLength(9);
        expect(imperialRadarPresets).toHaveLength(9);
    });

    it("keeps the two ladders disjoint", () => {
        const overlap = metricRadarPresets.filter((option) =>
            (imperialRadarPresets as string[]).includes(option),
        );
        expect(overlap).toEqual([]);
    });

    it("maps imperial presets to their exact mileage in meters", () => {
        expect(radarDistanceOptionMeters["0.5mi"]).toBeCloseTo(
            0.5 * METERS_PER_MILE,
            6,
        );
        expect(radarDistanceOptionMeters["1mi"]).toBeCloseTo(
            METERS_PER_MILE,
            6,
        );
        expect(radarDistanceOptionMeters["100mi"]).toBeCloseTo(
            100 * METERS_PER_MILE,
            6,
        );
    });

    it("classifies imperial vs metric preset options", () => {
        expect(isImperialRadarPreset("0.5mi")).toBe(true);
        expect(isImperialRadarPreset("100mi")).toBe(true);
        expect(isImperialRadarPreset("500m")).toBe(false);
        expect(isImperialRadarPreset("150km")).toBe(false);
        expect(isImperialRadarPreset("other")).toBe(false);
    });
});
