import { getDistanceOptionsFor } from "@/features/questions/radar/RadarQuestionDetailScreen";

describe("getDistanceOptionsFor", () => {
    it("shows the metric ladder for a metric preset regardless of preference", () => {
        const options = getDistanceOptionsFor("500m", "imperial");
        expect(options).toContain("500m");
        expect(options).toContain("150km");
        expect(options).not.toContain("0.5mi");
        expect(options[options.length - 1]).toBe("other");
    });

    it("shows the imperial ladder for an imperial preset regardless of preference", () => {
        const options = getDistanceOptionsFor("5mi", "metric");
        expect(options).toContain("0.5mi");
        expect(options).toContain("100mi");
        expect(options).not.toContain("500m");
    });

    it("falls back to the preference for the 'other' option", () => {
        expect(getDistanceOptionsFor("other", "imperial")).toContain("0.5mi");
        expect(getDistanceOptionsFor("other", "metric")).toContain("500m");
    });
});
