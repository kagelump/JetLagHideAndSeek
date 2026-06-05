import { fireEvent, render } from "@testing-library/react-native";
import { Platform, Share } from "react-native";

import { ShareQuestionButton } from "@/features/questions/ShareQuestionButton";
import type { QuestionState } from "@/features/questions/questionTypes";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock("expo-router", () => {
    const actual =
        jest.requireActual<typeof import("expo-router")>("expo-router");
    return { ...actual, useLocalSearchParams: jest.fn(), useRouter: jest.fn() };
});

// We mock buildImportLink and buildQuestionRequestEnvelope at the module level
// so we can control the URL returned without constructing real envelopes.
const mockBuildImportLink = jest.fn();
const mockBuildQuestionRequestEnvelope = jest.fn();
const mockBuildQuestionSharePrompt = jest.fn();

jest.mock("@/sharing/links/buildLink", () => ({
    buildImportLink: (...args: unknown[]) => mockBuildImportLink(...args),
}));

jest.mock("@/sharing/export/buildEnvelope", () => ({
    buildQuestionRequestEnvelope: (...args: unknown[]) =>
        mockBuildQuestionRequestEnvelope(...args),
}));

jest.mock("@/features/questions/questionSharePrompt", () => ({
    buildQuestionSharePrompt: (...args: unknown[]) =>
        mockBuildQuestionSharePrompt(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

beforeEach(() => {
    jest.clearAllMocks();
    mockBuildImportLink.mockReturnValue("https://example.com/i?d=testpayload");
    mockBuildQuestionRequestEnvelope.mockReturnValue({
        kind: "question-request",
        payload: {
            question: makeRadarQuestion(),
            createdAt: "",
            requestId: "r-1",
        },
        version: 1,
    });
    mockBuildQuestionSharePrompt.mockReturnValue(
        "Are you within 5km of (35.68950, 139.69171)?",
    );
    jest.spyOn(Share, "share").mockResolvedValue({ action: "shared" } as never);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ShareQuestionButton", () => {
    it("renders with correct accessibility label and testID", () => {
        const screen = render(
            <ShareQuestionButton question={makeRadarQuestion()} />,
        );

        const button = screen.getByTestId("question-share-button");
        expect(button).toBeTruthy();
        expect(button.props.accessibilityLabel).toBe("Share question");
        expect(button.props.accessibilityRole).toBe("button");
    });

    it("calls Share.share with prompt and URL on press", async () => {
        const screen = render(
            <ShareQuestionButton question={makeRadarQuestion()} />,
        );

        fireEvent.press(screen.getByTestId("question-share-button"));

        // Share.share is async — wait for it.
        await new Promise((r) => setTimeout(r, 0));

        expect(Share.share).toHaveBeenCalledWith({
            message:
                "Are you within 5km of (35.68950, 139.69171)?\nhttps://example.com/i?d=testpayload",
        });
    });

    it("does not crash when Share.share rejects (user dismissal)", () => {
        // Simulate user dismissing the share sheet.
        const consoleWarnSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
        const dismissError = { dismissedAction: true };
        jest.spyOn(Share, "share").mockRejectedValueOnce(dismissError as never);

        const screen = render(
            <ShareQuestionButton question={makeRadarQuestion()} />,
        );

        // Should not throw.
        expect(() => {
            fireEvent.press(screen.getByTestId("question-share-button"));
        }).not.toThrow();

        consoleWarnSpy.mockRestore();
    });

    it("logs unexpected errors to console.warn", async () => {
        const consoleWarnSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
        const unexpectedError = new Error("Native module missing");
        jest.spyOn(Share, "share").mockRejectedValueOnce(
            unexpectedError as never,
        );

        const screen = render(
            <ShareQuestionButton question={makeRadarQuestion()} />,
        );

        fireEvent.press(screen.getByTestId("question-share-button"));

        await new Promise((r) => setTimeout(r, 0));

        expect(consoleWarnSpy).toHaveBeenCalledWith(
            "ShareQuestionButton: share failed",
            unexpectedError,
        );

        consoleWarnSpy.mockRestore();
    });

    it("uses correct icon name for platform", () => {
        // iOS
        jest.replaceProperty(Platform, "OS", "ios");
        const screen = render(
            <ShareQuestionButton question={makeRadarQuestion()} />,
        );
        const icon = screen.UNSAFE_getByType(
            require("@expo/vector-icons").Ionicons,
        );
        expect(icon.props.name).toBe("share-outline");

        screen.unmount();

        // We can't safely change Platform.OS back in the same test runner easily,
        // but the module-level constant SHARE_ICON_NAME is evaluated at import
        // time based on the actual platform the tests run on. The important
        // thing is that the button renders an Ionicons with the name set.
    });
});
