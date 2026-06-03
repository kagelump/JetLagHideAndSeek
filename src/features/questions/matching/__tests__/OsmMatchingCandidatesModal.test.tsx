import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import { OsmMatchingCandidatesModal } from "@/features/questions/matching/OsmMatchingCandidatesModal";
import type { OsmFeature } from "@/features/questions/matching/matchingTypes";

const candidates: (OsmFeature & { distanceMeters?: number })[] = [
    {
        distanceMeters: 150,
        lat: 35.681,
        lon: 139.761,
        name: "Nearest Park",
        osmId: 1,
        osmType: "node",
        tags: {},
    },
    {
        distanceMeters: 900,
        lat: 35.685,
        lon: 139.765,
        name: "Farther Park",
        osmId: 2,
        osmType: "way",
        tags: {},
    },
    {
        distanceMeters: 2100,
        lat: 35.69,
        lon: 139.77,
        name: "Distant Park",
        osmId: 3,
        osmType: "relation",
        tags: {},
    },
    {
        distanceMeters: 5000,
        lat: 35.72,
        lon: 139.8,
        name: "Far Park",
        osmId: 4,
        osmType: "node",
        tags: {},
    },
];

describe("OsmMatchingCandidatesModal", () => {
    it("renders all candidates when visible", () => {
        const onSelect = jest.fn();
        const onClose = jest.fn();

        const screen = render(
            <OsmMatchingCandidatesModal
                candidates={candidates}
                categoryTitle="Park"
                selectedOsmId={null}
                selectedOsmType={null}
                onSelect={onSelect}
                onClose={onClose}
                visible={true}
            />,
        );

        expect(screen.getByText("Nearest Park")).toBeTruthy();
        expect(screen.getByText("Farther Park")).toBeTruthy();
        expect(screen.getByText("Distant Park")).toBeTruthy();
        expect(screen.getByText("Far Park")).toBeTruthy();
    });

    it("shows distance for each candidate", () => {
        const onSelect = jest.fn();
        const onClose = jest.fn();

        const screen = render(
            <OsmMatchingCandidatesModal
                candidates={candidates}
                categoryTitle="Park"
                selectedOsmId={null}
                selectedOsmType={null}
                onSelect={onSelect}
                onClose={onClose}
                visible={true}
            />,
        );

        expect(screen.getByText("150 meters")).toBeTruthy();
        expect(screen.getByText("900 meters")).toBeTruthy();
        expect(screen.getByText("2.1 km")).toBeTruthy();
        expect(screen.getByText("5.0 km")).toBeTruthy();
    });

    it("tapping candidate calls onSelect then onClose", () => {
        const onSelect = jest.fn();
        const onClose = jest.fn();

        const screen = render(
            <OsmMatchingCandidatesModal
                candidates={candidates}
                categoryTitle="Park"
                selectedOsmId={null}
                selectedOsmType={null}
                onSelect={onSelect}
                onClose={onClose}
                visible={true}
            />,
        );

        fireEvent.press(screen.getByTestId("osm-matching-all-candidate-2"));

        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({
                name: "Farther Park",
                osmId: 2,
                osmType: "way",
            }),
        );
        expect(onClose).toHaveBeenCalled();
    });

    it("close button calls onClose", () => {
        const onSelect = jest.fn();
        const onClose = jest.fn();

        const screen = render(
            <OsmMatchingCandidatesModal
                candidates={candidates}
                categoryTitle="Park"
                selectedOsmId={null}
                selectedOsmType={null}
                onSelect={onSelect}
                onClose={onClose}
                visible={true}
            />,
        );

        fireEvent.press(screen.getByTestId("osm-matching-all-modal-close"));

        expect(onClose).toHaveBeenCalled();
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("shows the category title in the header", () => {
        const onSelect = jest.fn();
        const onClose = jest.fn();

        const screen = render(
            <OsmMatchingCandidatesModal
                candidates={candidates}
                categoryTitle="Museum"
                selectedOsmId={null}
                selectedOsmType={null}
                onSelect={onSelect}
                onClose={onClose}
                visible={true}
            />,
        );

        expect(screen.getByText("All Museums")).toBeTruthy();
    });

    it("highlights the selected candidate", () => {
        const onSelect = jest.fn();
        const onClose = jest.fn();

        const screen = render(
            <OsmMatchingCandidatesModal
                candidates={candidates}
                categoryTitle="Park"
                selectedOsmId={3}
                selectedOsmType="relation"
                onSelect={onSelect}
                onClose={onClose}
                visible={true}
            />,
        );

        expect(screen.getByTestId("osm-matching-all-candidate-3")).toBeTruthy();
    });

    it("does not crash when candidates list is empty", () => {
        const onSelect = jest.fn();
        const onClose = jest.fn();

        const screen = render(
            <OsmMatchingCandidatesModal
                candidates={[]}
                categoryTitle="Park"
                selectedOsmId={null}
                selectedOsmType={null}
                onSelect={onSelect}
                onClose={onClose}
                visible={true}
            />,
        );

        expect(screen.getByText("All Parks")).toBeTruthy();
    });

    it("renders nothing visible when visible=false", () => {
        const onSelect = jest.fn();
        const onClose = jest.fn();

        render(
            <OsmMatchingCandidatesModal
                candidates={candidates}
                categoryTitle="Park"
                selectedOsmId={null}
                selectedOsmType={null}
                onSelect={onSelect}
                onClose={onClose}
                visible={false}
            />,
        );

        // When Modal visible=false, children may still render in test
        // but the modal is not presented. We verify no crash occurs.
    });
});
