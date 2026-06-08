import React from "react";
import {
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react-native";

import { MeasuringQuestionDetailScreen } from "@/features/questions/measuring/MeasuringQuestionDetailScreen";
import {
    clearPointBufferCache,
    clearPointDistanceCache,
} from "@/features/questions/measuring/pointMeasuringGeometry";
import {
    clearLineBufferCache,
    clearLineDistanceCache,
} from "@/features/questions/measuring/lineMeasuringGeometry";
import {
    clearBundledRegionCache,
    registerTestRegion,
    type RawRegion,
} from "@/features/questions/matching/bundledPois";
import {
    __clearLineBundlesForTest,
    __setLineBundleForTest,
    type LineBundle,
} from "@/features/questions/measuring/lineBundleLoader";
import type { MeasuringQuestion } from "@/features/questions/measuring/measuringTypes";
import type { QuestionState } from "@/features/questions/questionTypes";

// ─── Test region helpers ────────────────────────────────────────────────────

const TEST_BBOX: [number, number, number, number] = [139.0, 35.0, 141.0, 36.0];

function makeTestRegion(): RawRegion {
    return {
        schemaVersion: 1,
        region: "test-point-region",
        label: "Test Point Region",
        generatedAt: "2026-01-01T00:00:00.000Z",
        bbox: TEST_BBOX,
        totalCount: 2,
        categories: {
            museum: {
                count: 2,
                lon: [139.761, 139.77],
                lat: [35.681, 35.69],
                name: ["Museum A", "Museum B"],
                osmId: [100, 200],
                osmType: [0, 1],
            },
        },
    };
}

function makeLineBundle(coords: [number, number][]): LineBundle {
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    return {
        schemaVersion: 1,
        category: "coastline",
        generatedAt: "2026-01-01T00:00:00.000Z",
        source: "test-fixture",
        extractBbox: [137.9, 33.9, 141.9, 37.9],
        features: [
            {
                type: "Feature",
                bbox: [
                    Math.min(...xs),
                    Math.min(...ys),
                    Math.max(...xs),
                    Math.max(...ys),
                ],
                geometry: { type: "LineString", coordinates: coords },
                properties: {},
            },
        ],
    };
}

const mockPlayAreaCenter: [number, number] = [139.75, 35.675];

function TestScreen({
    initialQuestion,
    onUpdate,
}: {
    initialQuestion: MeasuringQuestion;
    onUpdate: jest.Mock;
}) {
    const [question, setQuestion] =
        React.useState<MeasuringQuestion>(initialQuestion);

    React.useEffect(() => {
        setQuestion(initialQuestion);
    }, [initialQuestion]);

    const wrappedUpdate = jest.fn(
        (questionId: string, updater: (q: QuestionState) => QuestionState) => {
            const updated = updater(question) as MeasuringQuestion;
            setQuestion(updated);
            onUpdate(questionId, updater);
            return updated;
        },
    );

    return (
        <MeasuringQuestionDetailScreen
            question={question}
            updateQuestion={wrappedUpdate}
        />
    );
}

function makeQuestion(
    overrides: Partial<MeasuringQuestion> = {},
): MeasuringQuestion {
    return {
        answer: "unanswered",
        category: "museum",
        center: mockPlayAreaCenter,
        createdAt: "2026-05-30T00:00:00.000Z",
        id: "measuring-1",
        isLocked: false,
        seekerDistanceUnit: "m",
        type: "measuring",
        updatedAt: "2026-05-30T00:00:00.000Z",
        ...overrides,
    };
}

describe("MeasuringQuestionDetailScreen", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearPointBufferCache();
        clearPointDistanceCache();
        clearLineBufferCache();
        clearLineDistanceCache();
        __clearLineBundlesForTest();
        clearBundledRegionCache();
        registerTestRegion("test-point-region", makeTestRegion());
    });

    // ── Point categories ──────────────────────────────────────────────────

    describe("Point categories", () => {
        it("renders the category picker with section labels", async () => {
            const question = makeQuestion();
            const onUpdate = jest.fn();

            render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                expect(
                    screen.getByTestId("measuring-category-museum"),
                ).toBeTruthy();
            });
        });

        it("shows the position selector", async () => {
            const question = makeQuestion();
            const onUpdate = jest.fn();

            const rendered = render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                expect(
                    rendered.getByTestId("measuring-center-summary"),
                ).toBeTruthy();
            });
        });

        it("shows the auto-computed nearest distance", async () => {
            const question = makeQuestion();
            const onUpdate = jest.fn();

            const rendered = render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                expect(
                    rendered.getByTestId("measuring-auto-result"),
                ).toBeTruthy();
                expect(
                    rendered.getByTestId("measuring-auto-distance"),
                ).toBeTruthy();
            });
        });

        it("shows the planning phrase when distance resolves", async () => {
            const question = makeQuestion();
            const onUpdate = jest.fn();

            const rendered = render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                expect(rendered.getByText(/I'm/)).toBeTruthy();
                // "museum" appears in both the category picker and the phrase.
                const museumMatches = rendered.getAllByText(/museum/i);
                expect(museumMatches.length).toBeGreaterThanOrEqual(2);
                expect(rendered.getByText(/closer or farther/)).toBeTruthy();
            });
        });

        it("renders unit toggle buttons", async () => {
            const question = makeQuestion();
            const onUpdate = jest.fn();

            const rendered = render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                expect(rendered.getByTestId("measuring-unit-m")).toBeTruthy();
                expect(rendered.getByTestId("measuring-unit-km")).toBeTruthy();
                expect(rendered.getByTestId("measuring-unit-mi")).toBeTruthy();
            });
        });

        it("unit toggle changes display unit", async () => {
            const question = makeQuestion();
            const onUpdate = jest.fn((_questionId, updater) => {
                return updater(question);
            });

            const rendered = render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                expect(rendered.getByTestId("measuring-unit-km")).toBeTruthy();
            });

            fireEvent.press(rendered.getByTestId("measuring-unit-km"));

            const lastCall = onUpdate.mock.calls.at(-1)!;
            const updater = lastCall[1];
            const result = updater(question) as MeasuringQuestion;
            expect(result.seekerDistanceUnit).toBe("km");
        });

        it("enables answer selector when distance is computed", async () => {
            const question = makeQuestion();
            const onUpdate = jest.fn();

            const rendered = render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                const closerButton = rendered.getByTestId(
                    "measuring-answer-option-positive",
                );
                expect(
                    closerButton.props.accessibilityState.disabled,
                ).toBeFalsy();
            });
        });

        it("switches category when a different category is pressed", async () => {
            const question = makeQuestion();
            const onUpdate = jest.fn((_questionId, updater) => {
                return updater(question);
            });

            const rendered = render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                expect(
                    rendered.getByTestId("measuring-category-park"),
                ).toBeTruthy();
            });

            fireEvent.press(rendered.getByTestId("measuring-category-park"));

            const lastCall = onUpdate.mock.calls.at(-1)!;
            const updater = lastCall[1];
            const result = updater(question) as MeasuringQuestion;
            expect(result.category).toBe("park");
        });
    });

    // ── Line categories ───────────────────────────────────────────────────

    describe("Line categories", () => {
        beforeEach(() => {
            __setLineBundleForTest(
                "coastline",
                makeLineBundle([
                    [139.0, 35.675],
                    [140.0, 35.675],
                ]),
            );
        });

        it("shows static category readout instead of picker", async () => {
            const question = makeQuestion({ category: "coastline" });
            const onUpdate = jest.fn();

            const rendered = render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                // "Coastline" appears as a static label, not a picker row
                expect(rendered.getByText("Coastline")).toBeTruthy();
                // Category picker testIDs should not exist for line categories
                expect(() =>
                    rendered.getByTestId("measuring-category-coastline"),
                ).toThrow();
            });
        });

        it("shows the auto-computed distance for line categories", async () => {
            const question = makeQuestion({ category: "coastline" });
            const onUpdate = jest.fn();

            const rendered = render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                expect(
                    rendered.getByTestId("measuring-auto-distance"),
                ).toBeTruthy();
            });
        });

        it("enables answer for line categories", async () => {
            const question = makeQuestion({ category: "coastline" });
            const onUpdate = jest.fn();

            const rendered = render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                const closerButton = rendered.getByTestId(
                    "measuring-answer-option-positive",
                );
                expect(
                    closerButton.props.accessibilityState.disabled,
                ).toBeFalsy();
            });
        });
    });
});
