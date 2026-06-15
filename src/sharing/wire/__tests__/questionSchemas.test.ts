import { appStateQuestionsSchema } from "@/state/appState";
import {
    minifyEnvelope,
    wireEnvelopeMinifiedSchema,
} from "@/sharing/wire/minified";
import { questionWireSchema } from "@/sharing/wire/schema";
import type { AppStateEnvelopeV1 } from "@/sharing/wire/schema";

function tentaclesQuestion(
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        answer: "unanswered",
        candidates: [],
        category: "museum",
        center: [139.7, 35.7],
        createdAt: "2026-06-16T00:00:00.000Z",
        distanceMeters: 2000,
        distanceOption: "2km",
        id: "q-tentacles-1",
        isLocked: false,
        selectedOsmId: null,
        selectedOsmType: null,
        selectedName: null,
        type: "tentacles",
        updatedAt: "2026-06-16T00:00:00.000Z",
        ...overrides,
    };
}

describe("shared question schema — POI answer normalization", () => {
    // Regression: a tentacles "None" answer (negative) with no POI selection is
    // a valid answered state. The Zod transforms used to re-derive it to
    // "unanswered" unconditionally, silently dropping it on every reload/import.
    it("preserves an explicit tentacles negative through appStateQuestionsSchema", () => {
        const parsed = appStateQuestionsSchema.parse([
            tentaclesQuestion({ answer: "negative" }),
        ]);
        expect(parsed[0].answer).toBe("negative");
    });

    it("preserves an explicit tentacles negative through questionWireSchema", () => {
        const parsed = questionWireSchema.parse(
            tentaclesQuestion({ answer: "negative" }),
        );
        expect(parsed.answer).toBe("negative");
    });

    it("re-derives a positive answer to unanswered when no POI is selected", () => {
        const parsed = appStateQuestionsSchema.parse([
            tentaclesQuestion({ answer: "positive", selectedOsmId: null }),
        ]);
        expect(parsed[0].answer).toBe("unanswered");
    });

    it("keeps a positive answer when a POI is selected", () => {
        const parsed = appStateQuestionsSchema.parse([
            tentaclesQuestion({
                answer: "positive",
                selectedOsmId: 42,
                selectedOsmType: "node",
                selectedName: "Some Museum",
            }),
        ]);
        expect(parsed[0].answer).toBe("positive");
    });
});

describe("shared question schema — legacy radius normalization", () => {
    it("normalizes type:radius to type:radar through both schemas", () => {
        const legacy = {
            center: [139.7, 35.7],
            createdAt: "2026-06-16T00:00:00.000Z",
            id: "q-legacy-1",
            radiusMeters: 1000,
            radiusOption: "1km",
            radiusUnit: "m",
            type: "radius",
            updatedAt: "2026-06-16T00:00:00.000Z",
        };
        expect(appStateQuestionsSchema.parse([legacy])[0].type).toBe("radar");
        expect(questionWireSchema.parse(legacy).type).toBe("radar");
    });
});

describe("minified schema — category validation", () => {
    function envelopeWithMatchingQuestion(): AppStateEnvelopeV1 {
        return {
            kind: "app-state",
            payload: {
                gameId: "g1",
                metadata: {
                    createdAt: "2026-06-16T00:00:00.000Z",
                    updatedAt: "2026-06-16T00:00:00.000Z",
                },
                questions: [
                    {
                        answer: "unanswered",
                        candidates: [],
                        category: "museum",
                        center: [139.7, 35.7],
                        createdAt: "2026-06-16T00:00:00.000Z",
                        id: "q-match-1",
                        isLocked: false,
                        lineId: null,
                        lineName: null,
                        selectedOsmId: null,
                        selectedOsmType: null,
                        targetName: null,
                        targetOsmId: null,
                        targetOsmType: null,
                        type: "matching",
                        updatedAt: "2026-06-16T00:00:00.000Z",
                    },
                ],
            },
            version: 1,
        };
    }

    it("accepts a valid minified category", () => {
        const mini = minifyEnvelope(envelopeWithMatchingQuestion());
        expect(wireEnvelopeMinifiedSchema.safeParse(mini).success).toBe(true);
    });

    it("rejects an unknown minified category (previously accepted as any string)", () => {
        const mini = minifyEnvelope(envelopeWithMatchingQuestion()) as Record<
            string,
            any
        >;
        // Corrupt the question category to a bogus value.
        mini.p.q[0].b = "not-a-real-category";
        expect(wireEnvelopeMinifiedSchema.safeParse(mini).success).toBe(false);
    });
});
