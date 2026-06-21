import { render, waitFor } from "@testing-library/react-native";

import { encodeE2eScenario } from "@/testing/e2e/parseE2eLink";
import { e2eScenarioSchema } from "@/testing/e2e/scenarioSchema";

let mockHooksEnabled = true;
jest.mock("@/testing/e2e/isE2eHooksEnabled", () => ({
    get E2E_HOOKS_ENABLED() {
        return mockHooksEnabled;
    },
}));

const mockImportPlayArea = jest.fn();
const mockReplaceSetup = jest.fn();
const mockAddImportedQuestion = jest.fn();
const mockImportQuestions = jest.fn();
const mockSetAdminDivisionPack = jest.fn();
const mockSetAdminDivisionPresetName = jest.fn();

jest.mock("@/state/playAreaStore", () => ({
    usePlayArea: () => ({ importPlayArea: mockImportPlayArea }),
}));
jest.mock("@/state/hidingZoneStore", () => ({
    useHidingZoneActions: () => ({ replaceSetup: mockReplaceSetup }),
}));
jest.mock("@/state/questionStore", () => ({
    useQuestionActions: () => ({
        addImportedQuestion: mockAddImportedQuestion,
        importQuestions: mockImportQuestions,
        setAdminDivisionPack: mockSetAdminDivisionPack,
        setAdminDivisionPresetName: mockSetAdminDivisionPresetName,
    }),
}));

const { useLocalSearchParams, useRouter } = jest.requireMock("expo-router") as {
    useLocalSearchParams: jest.Mock;
    useRouter: jest.Mock;
};

import E2eRoute from "../index";

function validPayload(): string {
    const scenario = e2eScenarioSchema.parse({
        kind: "e2e-scenario",
        name: "route-seed",
        controls: { geometryBackend: "js" },
        state: {
            playArea: {
                bbox: [139.5, 35.5, 140.0, 35.9],
                boundary: { type: "FeatureCollection", features: [] },
                center: [139.75, 35.7],
                label: "E2E Test Area",
                osmId: 19631009,
                osmType: "R",
            },
            hidingZones: {
                radiusMeters: 800,
                radiusUnit: "m",
                selectedPresetIds: ["jr-yamanote"],
            },
            questions: [
                {
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
                },
            ],
        },
    });
    return encodeE2eScenario(scenario);
}

describe("E2eRoute (app/e2e)", () => {
    let replaceMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockHooksEnabled = true;
        replaceMock = jest.fn();
        useRouter.mockReturnValue({ replace: replaceMock });
        useLocalSearchParams.mockReturnValue({});
    });

    it("seeds the scenario into the stores and returns to the map (hooks on)", async () => {
        useLocalSearchParams.mockReturnValue({ d: validPayload() });

        render(<E2eRoute />);

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
        expect(mockImportPlayArea).toHaveBeenCalledTimes(1);
        expect(mockImportPlayArea.mock.calls[0][0]).toMatchObject({
            label: "E2E Test Area",
            osmId: 19631009,
        });
        expect(mockReplaceSetup).toHaveBeenCalledTimes(1);
        expect(mockImportQuestions).toHaveBeenCalledTimes(1);
    });

    it("renders not-found and touches no stores when hooks are off", () => {
        mockHooksEnabled = false;
        useLocalSearchParams.mockReturnValue({ d: validPayload() });

        const { getByText } = render(<E2eRoute />);

        expect(getByText("Route not found")).toBeTruthy();
        expect(mockImportPlayArea).not.toHaveBeenCalled();
        expect(mockReplaceSetup).not.toHaveBeenCalled();
        expect(replaceMock).not.toHaveBeenCalled();
    });

    it("shows a visible error node for an invalid payload (hooks on)", async () => {
        useLocalSearchParams.mockReturnValue({ d: "@@not-base64@@" });

        const { getByTestId } = render(<E2eRoute />);

        await waitFor(() => expect(getByTestId("e2e-error")).toBeTruthy());
        expect(mockImportPlayArea).not.toHaveBeenCalled();
        expect(replaceMock).not.toHaveBeenCalled();
    });
});
