import { buildQuestionRequestEnvelope } from "@/sharing/export/buildEnvelope";
import { decodeEnvelopePayload, encodeEnvelope } from "@/sharing/wire/codec";
import type { QuestionState } from "@/features/questions/questionTypes";

function makeRadarQuestion(): QuestionState {
    return {
        answer: "unanswered",
        center: [139.69171, 35.6895],
        createdAt: "2026-06-05T00:00:00.000Z",
        distanceMeters: 5000,
        distanceOption: "5km",
        distanceUnit: "m",
        id: "q-radar-1",
        type: "radar",
        updatedAt: "2026-06-05T00:00:00.000Z",
    };
}

function makeMatchingQuestion(
    overrides?: Partial<Extract<QuestionState, { type: "matching" }>>,
): QuestionState {
    return {
        answer: "unanswered",
        candidates: [
            {
                lat: 35.681,
                lon: 139.761,
                name: "Nearest Park",
                osmId: 1,
                osmType: "node",
                tags: {},
            },
            {
                lat: 35.685,
                lon: 139.765,
                name: "Farther Park",
                osmId: 2,
                osmType: "way",
                tags: {},
            },
        ],
        category: "park",
        center: [139.7, 35.7],
        createdAt: "2026-06-05T00:00:00.000Z",
        id: "q-matching-1",
        lineId: null,
        lineName: null,
        selectedOsmId: 1,
        selectedOsmType: "node",
        targetName: "Nearest Park",
        targetOsmId: 1,
        targetOsmType: "node",
        type: "matching",
        updatedAt: "2026-06-05T00:00:00.000Z",
        ...overrides,
    };
}

describe("buildQuestionRequestEnvelope", () => {
    it("creates a question-request envelope with a radar question", () => {
        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeRadarQuestion(),
        });

        expect(envelope.kind).toBe("question-request");
        expect(envelope.version).toBe(1);
        expect(envelope.payload.createdAt).toBe("2026-06-05T00:00:00.000Z");
        expect(envelope.payload.requestId).toMatch(/^r-/);
        expect(envelope.payload.question.type).toBe("radar");
    });

    it("strips matching candidates to keep links short", () => {
        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeMatchingQuestion(),
        });

        expect(envelope.kind).toBe("question-request");
        expect(envelope.payload.question.type).toBe("matching");
        if (envelope.payload.question.type === "matching") {
            expect(envelope.payload.question.candidates).toEqual([]);
            // Other fields are preserved.
            expect(envelope.payload.question.category).toBe("park");
            expect(envelope.payload.question.targetName).toBe("Nearest Park");
        }
    });

    it("preserves matching question fields other than candidates", () => {
        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeMatchingQuestion({
                category: "museum",
                targetName: "Tokyo National Museum",
                targetOsmId: 123,
                targetOsmType: "way",
            }),
        });

        expect(envelope.payload.question.type).toBe("matching");
        if (envelope.payload.question.type === "matching") {
            expect(envelope.payload.question.category).toBe("museum");
            expect(envelope.payload.question.targetName).toBe(
                "Tokyo National Museum",
            );
            expect(envelope.payload.question.targetOsmId).toBe(123);
            expect(envelope.payload.question.targetOsmType).toBe("way");
            expect(envelope.payload.question.candidates).toEqual([]);
        }
    });

    it("generates a unique requestId per call", () => {
        const a = buildQuestionRequestEnvelope({
            question: makeRadarQuestion(),
        });
        const b = buildQuestionRequestEnvelope({
            question: makeRadarQuestion(),
        });

        expect(a.payload.requestId).not.toBe(b.payload.requestId);
        expect(a.payload.requestId).toMatch(/^r-/);
        expect(b.payload.requestId).toMatch(/^r-/);
    });
});

describe("question-request round-trip (encode ↔ decode)", () => {
    it("round-trips a radar question through encode/decode", () => {
        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeRadarQuestion(),
        });

        const encoded = encodeEnvelope(envelope);
        const result = decodeEnvelopePayload(encoded);

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");

        expect(result.envelope.kind).toBe("question-request");
        expect(result.envelope.version).toBe(1);

        if (result.envelope.kind !== "question-request") {
            throw new Error("expected question-request envelope");
        }

        const { question, requestId, createdAt } = result.envelope.payload;
        expect(requestId).toBe(envelope.payload.requestId);
        expect(createdAt).toBe(envelope.payload.createdAt);

        expect(question.type).toBe("radar");
        if (question.type === "radar") {
            expect(question.distanceMeters).toBe(5000);
            expect(question.distanceOption).toBe("5km");
            expect(question.center[0]).toBeCloseTo(139.69171, 4);
            expect(question.center[1]).toBeCloseTo(35.6895, 4);
        }
    });

    it("round-trips a matching question (candidates stripped)", () => {
        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeMatchingQuestion({
                targetName: "Ueno Park",
                targetOsmId: 456,
                targetOsmType: "way",
            }),
        });

        const encoded = encodeEnvelope(envelope);
        const result = decodeEnvelopePayload(encoded);

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");

        expect(result.envelope.kind).toBe("question-request");
        if (result.envelope.kind !== "question-request") {
            throw new Error("expected question-request");
        }

        const question = result.envelope.payload.question;
        expect(question.type).toBe("matching");
        if (question.type === "matching") {
            expect(question.candidates).toEqual([]);
            expect(question.category).toBe("park");
            expect(question.targetName).toBe("Ueno Park");
        }
    });

    it("round-trips a transit-line matching question", () => {
        const envelope = buildQuestionRequestEnvelope({
            now: new Date("2026-06-05T00:00:00.000Z"),
            question: makeMatchingQuestion({
                category: "transit-line",
                lineId: "gtfs:test:route:1",
                lineName: "Chuo Line",
                targetName: null,
                targetOsmId: null,
                targetOsmType: null,
            }),
        });

        const encoded = encodeEnvelope(envelope);
        const result = decodeEnvelopePayload(encoded);

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        expect(result.envelope.kind).toBe("question-request");
        if (result.envelope.kind !== "question-request") {
            throw new Error("expected question-request");
        }

        const question = result.envelope.payload.question;
        // Transit-line matching questions get normalized — lineId and lineName
        // are cleared by normalizeTransitLineQuestion during unminify.
        expect(question.type).toBe("matching");
        if (question.type === "matching") {
            expect(question.category).toBe("transit-line");
        }
    });
});
