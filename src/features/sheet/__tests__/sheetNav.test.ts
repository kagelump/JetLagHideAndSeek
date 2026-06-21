import { getBackTarget, getNavDirection } from "@/features/sheet/sheetNav";

describe("getNavDirection", () => {
    it("goes forward from questions to question-detail", () => {
        expect(getNavDirection("questions", "question-detail")).toBe("forward");
    });

    it("goes back from question-detail to questions", () => {
        expect(getNavDirection("question-detail", "questions")).toBe("back");
    });

    it("goes forward from main to station-detail", () => {
        expect(getNavDirection("main", "station-detail")).toBe("forward");
    });

    it("goes forward from add-question to question-detail", () => {
        expect(getNavDirection("add-question", "question-detail")).toBe(
            "forward",
        );
    });

    it("goes forward from matching to question-detail", () => {
        expect(getNavDirection("matching", "question-detail")).toBe("forward");
    });

    it("goes forward from measuring to question-detail", () => {
        expect(getNavDirection("measuring", "question-detail")).toBe("forward");
    });

    describe("same-depth navigation", () => {
        it("goes back from matching to measuring", () => {
            expect(getNavDirection("matching", "measuring")).toBe("back");
        });

        it("goes back from measuring to matching", () => {
            expect(getNavDirection("measuring", "matching")).toBe("back");
        });

        it("goes back between settings siblings", () => {
            expect(getNavDirection("play-area", "hiding-zone")).toBe("back");
        });
    });

    it("goes forward into the operator line picker", () => {
        expect(getNavDirection("hiding-zone", "hiding-zone-operator")).toBe(
            "forward",
        );
    });

    it("goes back out of the operator line picker", () => {
        expect(getNavDirection("hiding-zone-operator", "hiding-zone")).toBe(
            "back",
        );
    });
});

describe("getBackTarget", () => {
    it("returns questions for question-detail", () => {
        expect(getBackTarget("question-detail")).toBe("questions");
    });

    it("returns settings for play-area", () => {
        expect(getBackTarget("play-area")).toBe("settings");
    });

    it("returns main for settings", () => {
        expect(getBackTarget("settings")).toBe("main");
    });

    it("returns null for main", () => {
        expect(getBackTarget("main")).toBeNull();
    });

    it("returns add-question for measuring", () => {
        expect(getBackTarget("measuring")).toBe("add-question");
    });

    it("returns questions for add-question", () => {
        expect(getBackTarget("add-question")).toBe("questions");
    });

    it("returns hiding-zone for the operator line picker (not settings)", () => {
        expect(getBackTarget("hiding-zone-operator")).toBe("hiding-zone");
    });
});
