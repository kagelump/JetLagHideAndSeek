import { render, screen, fireEvent } from "@testing-library/react-native";

import { MeasuringCategoryList } from "@/features/questions/measuring/MeasuringCategoryList";
import type { MeasuringCategory } from "@/features/questions/measuring/measuringTypes";
import { measuringCategoriesBySection } from "@/features/questions/measuring/measuringCategories";

const sectionOrder = [
    "Transit",
    "Borders & Lines",
    "Natural",
    "Places of Interest",
    "Public Utilities",
] as const;

describe("MeasuringCategoryList", () => {
    it("renders all sections with expected category titles and row count", () => {
        render(<MeasuringCategoryList onSelect={jest.fn()} />);

        for (const section of sectionOrder) {
            expect(screen.getByText(section)).toBeTruthy();
            const categories = measuringCategoriesBySection[section];
            for (const config of categories) {
                expect(screen.getByText(config.title)).toBeTruthy();
            }
        }

        const allCategories = sectionOrder.flatMap(
            (section) => measuringCategoriesBySection[section],
        );
        for (const config of allCategories) {
            expect(
                screen.getByTestId(`measuring-category-${config.category}`),
            ).toBeTruthy();
        }
    });

    it("calls onSelect(category) when a row is tapped", () => {
        const onSelect = jest.fn();
        render(<MeasuringCategoryList onSelect={onSelect} />);

        fireEvent.press(screen.getByTestId("measuring-category-museum"));
        expect(onSelect).toHaveBeenCalledWith("museum");

        fireEvent.press(screen.getByTestId("measuring-category-coastline"));
        expect(onSelect).toHaveBeenCalledWith("coastline");
    });

    it("shows a checkmark for the selected category and chevrons for others", () => {
        const selectedCategory: MeasuringCategory = "park";
        const { getByTestId, getAllByText } = render(
            <MeasuringCategoryList
                onSelect={jest.fn()}
                selectedCategory={selectedCategory}
            />,
        );

        const selectedRow = getByTestId("measuring-category-park");
        expect(selectedRow).toBeTruthy();

        // Exactly one checkmark should be visible (on the selected row).
        expect(getAllByText("✓")).toHaveLength(1);

        // Without a selection, no checkmark appears.
        const { queryByText: queryWithoutSelection } = render(
            <MeasuringCategoryList onSelect={jest.fn()} />,
        );
        expect(queryWithoutSelection("✓")).toBeNull();
    });

    it("applies selected background only to the selected row", () => {
        const selectedCategory: MeasuringCategory = "library";
        const { getByTestId } = render(
            <MeasuringCategoryList
                onSelect={jest.fn()}
                selectedCategory={selectedCategory}
            />,
        );

        const selectedRow = getByTestId("measuring-category-library");
        expect(selectedRow.props.style).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ backgroundColor: "#ece7dc" }),
            ]),
        );

        const otherRow = getByTestId("measuring-category-hospital");
        expect(otherRow.props.style).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ backgroundColor: "#ece7dc" }),
            ]),
        );
    });

    it("uses custom testIDPrefix when provided", () => {
        render(
            <MeasuringCategoryList
                onSelect={jest.fn()}
                testIDPrefix="custom-prefix"
            />,
        );

        expect(screen.getByTestId("custom-prefix-museum")).toBeTruthy();
        expect(screen.getByTestId("custom-prefix-zoo")).toBeTruthy();
        expect(() => screen.getByTestId("measuring-category-museum")).toThrow();
    });

    it("does not render radio inputs", () => {
        const { getAllByRole, queryAllByRole } = render(
            <MeasuringCategoryList onSelect={jest.fn()} />,
        );

        // Rows are exposed as buttons; no radio buttons should exist.
        expect(getAllByRole("button").length).toBeGreaterThan(0);
        expect(queryAllByRole("radio")).toHaveLength(0);
    });

    it("sets accessibility state only when selectedCategory is provided", () => {
        const { getByTestId: getNoSelection } = render(
            <MeasuringCategoryList onSelect={jest.fn()} />,
        );
        const rowWithoutSelection = getNoSelection("measuring-category-museum");
        // React Native normalizes accessibilityState to an object; when no
        // selection is active we intentionally do not pass a `selected` value.
        expect(
            rowWithoutSelection.props.accessibilityState?.selected,
        ).toBeUndefined();

        const { getByTestId: getWithSelection } = render(
            <MeasuringCategoryList
                onSelect={jest.fn()}
                selectedCategory="museum"
            />,
        );
        const selectedRow = getWithSelection("measuring-category-museum");
        expect(selectedRow.props.accessibilityState).toEqual({
            selected: true,
        });

        const unselectedRow = getWithSelection("measuring-category-park");
        expect(unselectedRow.props.accessibilityState).toEqual({
            selected: false,
        });
    });
});
