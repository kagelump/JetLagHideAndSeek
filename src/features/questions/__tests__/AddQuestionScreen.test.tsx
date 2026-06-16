import { act, fireEvent, render } from "@testing-library/react-native";
import { useEffect } from "react";

import { AddQuestionScreen } from "@/features/questions/AddQuestionScreen";
import { defaultPlayArea } from "@/features/map/playArea";
import { PlayAreaProvider, usePlayArea } from "@/state/playAreaStore";
import { QuestionProvider } from "@/state/questionStore";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRequestUserCoordinate = jest.fn();
jest.mock("@/shared/location", () => ({
    requestUserCoordinate: (...args: unknown[]) =>
        mockRequestUserCoordinate(...args),
}));

const mockGetLastKnownMapCenter = jest.fn();
jest.mock("@/features/map/mapCenter", () => ({
    getLastKnownMapCenter: (...args: unknown[]) =>
        mockGetLastKnownMapCenter(...args),
    setLastKnownMapCenter: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SetDefaultPlayArea() {
    const { importPlayArea } = usePlayArea();

    useEffect(() => {
        importPlayArea(defaultPlayArea);
    }, [importPlayArea]);

    return null;
}

/**
 * Renders AddQuestionScreen inside the required providers with the default
 * Tokyo play area already set.
 */
function renderAddQuestionScreen() {
    const onNavigate = jest.fn();
    const result = render(
        <PlayAreaProvider>
            <SetDefaultPlayArea />
            <QuestionProvider>
                <AddQuestionScreen onNavigate={onNavigate} />
            </QuestionProvider>
        </PlayAreaProvider>,
    );
    return { ...result, onNavigate };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AddQuestionScreen", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default: GPS succeeds with a coordinate.
        mockRequestUserCoordinate.mockResolvedValue({
            coordinate: [100, 20],
            status: "granted" as const,
        });
        mockGetLastKnownMapCenter.mockReturnValue(null);
    });

    // -- GPS success: navigation fires immediately ------------------------

    it("navigates immediately on radar question creation", async () => {
        const { onNavigate, getByTestId } = renderAddQuestionScreen();

        await act(async () => {
            fireEvent.press(getByTestId("add-radar-question-row"));
        });

        expect(onNavigate).toHaveBeenCalledWith("question-detail");
    });

    // -- GPS failure with map center fallback ------------------------------

    it("falls back to map center when GPS is denied (radar)", async () => {
        mockRequestUserCoordinate.mockResolvedValue({
            coordinate: null,
            status: "denied" as const,
        });
        mockGetLastKnownMapCenter.mockReturnValue([139.7, 35.7]);

        const { onNavigate, getByTestId } = renderAddQuestionScreen();

        await act(async () => {
            fireEvent.press(getByTestId("add-radar-question-row"));
        });

        expect(onNavigate).toHaveBeenCalledWith("question-detail");
    });

    it("falls back to map center when GPS is denied (tentacles)", async () => {
        mockRequestUserCoordinate.mockResolvedValue({
            coordinate: null,
            status: "denied" as const,
        });
        mockGetLastKnownMapCenter.mockReturnValue([139.7, 35.7]);

        const { onNavigate, getByTestId } = renderAddQuestionScreen();

        await act(async () => {
            fireEvent.press(getByTestId("add-tentacles-question-row"));
        });

        expect(onNavigate).toHaveBeenCalledWith("question-detail");
    });

    it("falls back to map center when GPS is denied (thermometer)", async () => {
        mockRequestUserCoordinate.mockResolvedValue({
            coordinate: null,
            status: "denied" as const,
        });
        mockGetLastKnownMapCenter.mockReturnValue([139.7, 35.7]);

        const { onNavigate, getByTestId } = renderAddQuestionScreen();

        await act(async () => {
            fireEvent.press(getByTestId("add-thermometer-question-row"));
        });

        expect(onNavigate).toHaveBeenCalledWith("question-detail");
    });

    it("opens measuring modal when GPS is denied with map center fallback", async () => {
        mockRequestUserCoordinate.mockResolvedValue({
            coordinate: null,
            status: "denied" as const,
        });
        mockGetLastKnownMapCenter.mockReturnValue([139.7, 35.7]);

        const { onNavigate, getByTestId } = renderAddQuestionScreen();

        await act(async () => {
            fireEvent.press(getByTestId("add-measuring-question-row"));
        });

        // Measuring opens a category modal first — no immediate navigation.
        expect(onNavigate).not.toHaveBeenCalled();
    });

    // -- Both GPS and map center unavailable: update skipped ---------------

    it("navigates with playArea.center when both GPS and map center are null", async () => {
        mockRequestUserCoordinate.mockResolvedValue({
            coordinate: null,
            status: "unavailable" as const,
        });
        mockGetLastKnownMapCenter.mockReturnValue(null);

        const { onNavigate, getByTestId } = renderAddQuestionScreen();

        await act(async () => {
            fireEvent.press(getByTestId("add-radar-question-row"));
        });

        // Navigation fires with playArea.center — the fallback of last resort.
        expect(onNavigate).toHaveBeenCalledWith("question-detail");
    });
});
