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
    __clearPackSourcesForTest,
    __setLineBundleForTest,
    registerMeasuringSource,
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
        extractBbox: [
            Math.min(...xs),
            Math.min(...ys),
            Math.max(...xs),
            Math.max(...ys),
        ],
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
        seekerDistanceMeters: null,
        nearestPoiName: null,
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
        __clearPackSourcesForTest();
        clearBundledRegionCache();
        registerTestRegion("test-point-region", makeTestRegion());
        delete (globalThis as unknown as { __fsCache?: Record<string, string> })
            .__fsCache;
    });

    // ── Point categories ──────────────────────────────────────────────────

    describe("Point categories", () => {
        it("shows the category change header when unanswered", async () => {
            const question = makeQuestion();
            const onUpdate = jest.fn();

            render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                expect(
                    screen.getByTestId("measuring-category-change"),
                ).toBeTruthy();
                expect(screen.getByText("Museum")).toBeTruthy();
                expect(screen.getByText("Change")).toBeTruthy();
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

        it("reveals the inline category list when change header is pressed", async () => {
            const question = makeQuestion();
            const onUpdate = jest.fn();

            const rendered = render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                expect(
                    rendered.getByTestId("measuring-category-change"),
                ).toBeTruthy();
            });

            fireEvent.press(rendered.getByTestId("measuring-category-change"));

            await waitFor(() => {
                // Park should be a selectable row in the inline list.
                expect(
                    rendered.getByTestId("measuring-category-park"),
                ).toBeTruthy();
            });
        });

        it("selects a new category from the inline list", async () => {
            const question = makeQuestion();
            const onUpdate = jest.fn();

            const rendered = render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                expect(
                    rendered.getByTestId("measuring-category-change"),
                ).toBeTruthy();
            });

            fireEvent.press(rendered.getByTestId("measuring-category-change"));

            await waitFor(() => {
                expect(
                    rendered.getByTestId("measuring-category-park"),
                ).toBeTruthy();
            });

            fireEvent.press(rendered.getByTestId("measuring-category-park"));

            await waitFor(() => {
                const lastCall = onUpdate.mock.calls.at(-1)!;
                const updater = lastCall[1];
                const result = updater(question) as MeasuringQuestion;
                expect(result.category).toBe("park");
            });
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

        it("shows the category change header (same control as point categories)", async () => {
            const question = makeQuestion({ category: "coastline" });
            const onUpdate = jest.fn();

            const rendered = render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                expect(
                    rendered.getByTestId("measuring-category-change"),
                ).toBeTruthy();
                expect(rendered.getByText("Coastline")).toBeTruthy();
                expect(rendered.getByText("Change")).toBeTruthy();
            });
        });

        it("reveals the inline category list for line categories", async () => {
            const question = makeQuestion({ category: "coastline" });
            const onUpdate = jest.fn();

            const rendered = render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            await waitFor(() => {
                expect(
                    rendered.getByTestId("measuring-category-change"),
                ).toBeTruthy();
            });

            fireEvent.press(rendered.getByTestId("measuring-category-change"));

            await waitFor(() => {
                // Museum should be a selectable row in the inline list.
                expect(
                    rendered.getByTestId("measuring-category-museum"),
                ).toBeTruthy();
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

        it("does not freeze when the line bundle loads asynchronously", async () => {
            // Simulate a pack source whose bundle is not cached yet.
            const packPath = "/mock-documents/packs/test-pack/coastline.json";
            registerMeasuringSource("test-pack", "coastline", packPath);
            (
                globalThis as unknown as { __fsCache?: Record<string, string> }
            ).__fsCache = {
                [packPath]: JSON.stringify(
                    makeLineBundle([
                        [139.0, 35.675],
                        [140.0, 35.675],
                    ]),
                ),
            };

            const question = makeQuestion({ category: "coastline" });
            const onUpdate = jest.fn();

            const rendered = render(
                <TestScreen initialQuestion={question} onUpdate={onUpdate} />,
            );

            // Bundle has not loaded yet, so the distance is still computing.
            await waitFor(() => {
                expect(
                    rendered.getByTestId("measuring-auto-distance"),
                ).toHaveTextContent("Computing...");
            });

            // After the async bundle load completes, the distance resolves
            // without requiring a center change.
            await waitFor(() => {
                const distance = rendered.getByTestId(
                    "measuring-auto-distance",
                );
                expect(distance.props.children).not.toBe("Computing...");
                expect(distance.props.children).toMatch(/^\d/);
            });

            expect(onUpdate).not.toHaveBeenCalled();
        });
    });
});
