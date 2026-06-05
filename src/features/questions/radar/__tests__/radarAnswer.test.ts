import { evaluateRadarAnswer } from "@/features/questions/radar/radarAnswer";
import type { RadarQuestion } from "@/features/questions/radar/radarTypes";

function makeRadarQuestion(
    center: [number, number],
    distanceMeters: number,
): RadarQuestion {
    return {
        answer: "unanswered",
        center,
        createdAt: "2026-06-05T00:00:00.000Z",
        distanceMeters,
        distanceOption: "other",
        distanceUnit: "m",
        id: "q-test-1",
        type: "radar",
        updatedAt: "2026-06-05T00:00:00.000Z",
    };
}

describe("evaluateRadarAnswer", () => {
    it('returns "positive" when the location is well inside the radar distance', () => {
        // Tokyo Station ~(139.7671, 35.6812). 500 m away is ~0.0045° lat.
        const center: [number, number] = [139.7671, 35.6812];
        const question = makeRadarQuestion(center, 1000);
        // A point ~200 m north of the center.
        const location: [number, number] = [139.7671, 35.683];
        expect(evaluateRadarAnswer(question, location)).toBe("positive");
    });

    it('returns "negative" when the location is well outside the radar distance', () => {
        const center: [number, number] = [139.7671, 35.6812];
        const question = makeRadarQuestion(center, 100);
        // Tokyo Station to Shinjuku is ~6 km — well outside 100 m.
        const location: [number, number] = [139.7006, 35.6896];
        expect(evaluateRadarAnswer(question, location)).toBe("negative");
    });

    it('returns "positive" when the distance is exactly equal to distanceMeters', () => {
        // Place the center at the equator where 1° lon ≈ 111 320 m.
        const center: [number, number] = [0, 0];
        const question = makeRadarQuestion(center, 5000);
        // 5 000 m east at the equator ≈ 5 000 / 111 320 ≈ 0.04492°.
        const location: [number, number] = [0.04492, 0];
        expect(evaluateRadarAnswer(question, location)).toBe("positive");
    });

    it('returns "positive" when the location is the same as the center (zero distance)', () => {
        const center: [number, number] = [139.7671, 35.6812];
        const question = makeRadarQuestion(center, 5000);
        expect(evaluateRadarAnswer(question, center)).toBe("positive");
    });

    it('returns "negative" when the distance exceeds distanceMeters by a tiny margin', () => {
        const center: [number, number] = [0, 0];
        const question = makeRadarQuestion(center, 100);
        // ~200 m east — well beyond 100 m.
        const location: [number, number] = [0.0018, 0];
        expect(evaluateRadarAnswer(question, location)).toBe("negative");
    });

    it("handles negative coordinates (southern/western hemisphere)", () => {
        // Buenos Aires ~(-58.3816, -34.6037)
        const center: [number, number] = [-58.3816, -34.6037];
        const question = makeRadarQuestion(center, 5000);
        // ~3 km away
        const location: [number, number] = [-58.4, -34.62];
        expect(evaluateRadarAnswer(question, location)).toBe("positive");
    });
});
