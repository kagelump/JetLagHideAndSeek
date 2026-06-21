import { e2eScenarioSchema } from "../scenarioSchema";

const playArea = {
    bbox: [139.5, 35.5, 140.0, 35.9],
    center: [139.75, 35.7],
    label: "Tokyo 23 Wards",
    osmId: 19631009,
    osmType: "R",
} as const;

const radarQuestion = {
    answer: "unanswered",
    center: [139.69171, 35.6895],
    createdAt: "2026-06-05T00:00:00.000Z",
    distanceMeters: 5000,
    distanceOption: "5km",
    distanceUnit: "m",
    id: "q-radar-1",
    isLocked: false,
    type: "radar",
    updatedAt: "2026-06-05T00:00:00.000Z",
} as const;

const measuringQuestion = {
    answer: "unanswered",
    category: "rail-station",
    center: [139.7, 35.7],
    createdAt: "2026-06-05T00:00:00.000Z",
    id: "q-measuring-1",
    isLocked: false,
    nearestPoiName: null,
    seekerDistanceMeters: null,
    seekerDistanceUnit: "m",
    type: "measuring",
    updatedAt: "2026-06-05T00:00:00.000Z",
} as const;

describe("e2eScenarioSchema", () => {
    it("parses a minimal valid scenario", () => {
        const result = e2eScenarioSchema.safeParse({
            kind: "e2e-scenario",
            name: "smoke-seed",
            state: { playArea },
        });
        expect(result.success).toBe(true);
    });

    it("defaults controls.showReadout to true when controls is omitted", () => {
        const result = e2eScenarioSchema.parse({
            kind: "e2e-scenario",
            name: "smoke-seed",
            state: { playArea },
        });
        expect(result.controls.showReadout).toBe(true);
    });

    it("validates a scenario carrying a full radar + measuring question", () => {
        const result = e2eScenarioSchema.safeParse({
            kind: "e2e-scenario",
            name: "elimination-math",
            controls: { geometryBackend: "geos", location: [139.7, 35.65] },
            state: {
                playArea,
                hidingZones: {
                    radiusMeters: 800,
                    radiusUnit: "m",
                    selectedPresetIds: ["jr-yamanote"],
                },
                questions: [radarQuestion, measuringQuestion],
            },
            expect: { totalPctMin: 40, totalPctMax: 50 },
        });
        expect(result.success).toBe(true);
    });

    it("rejects a malformed scenario with a useful error", () => {
        const result = e2eScenarioSchema.safeParse({
            kind: "not-an-e2e-scenario",
            state: {},
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            // name is required and kind is wrong — both surface in the message.
            expect(result.error.message).toMatch(/kind|name/);
        }
    });

    it("rejects an invalid geometryBackend value", () => {
        const result = e2eScenarioSchema.safeParse({
            kind: "e2e-scenario",
            name: "bad-backend",
            controls: { geometryBackend: "cuda" },
            state: { playArea },
        });
        expect(result.success).toBe(false);
    });
});
