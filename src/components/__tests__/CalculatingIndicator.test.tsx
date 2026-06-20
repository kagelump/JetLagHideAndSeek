import { render } from "@testing-library/react-native";

import { CalculatingIndicator, CalculatingPill } from "../CalculatingIndicator";

describe("CalculatingIndicator", () => {
    it("renders an accessible spinner", () => {
        const { getByLabelText } = render(<CalculatingIndicator />);
        expect(getByLabelText("Calculating")).toBeTruthy();
    });
});

describe("CalculatingPill", () => {
    it("renders nothing when inactive", () => {
        const { queryByText } = render(<CalculatingPill active={false} />);
        expect(queryByText("Calculating…")).toBeNull();
    });

    it("renders label and spinner when active", () => {
        const { getByText, getByLabelText } = render(
            <CalculatingPill active />,
        );
        expect(getByText("Calculating…")).toBeTruthy();
        expect(getByLabelText("Calculating")).toBeTruthy();
    });

    it("honors a custom label", () => {
        const { getByText } = render(
            <CalculatingPill active label="Crunching numbers" />,
        );
        expect(getByText("Crunching numbers")).toBeTruthy();
    });
});
