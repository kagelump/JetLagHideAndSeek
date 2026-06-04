import { render } from "@testing-library/react-native";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

import { VoronoiOutlineLayers } from "../VoronoiOutlineLayers";

const mockOutlineFeatures: FeatureCollection<Polygon | MultiPolygon> = {
    features: [
        {
            geometry: {
                coordinates: [
                    [
                        [139.76, 35.68],
                        [139.77, 35.68],
                        [139.77, 35.69],
                        [139.76, 35.69],
                        [139.76, 35.68],
                    ],
                ],
                type: "Polygon",
            },
            properties: { osmKey: "node/1" },
            type: "Feature",
        },
    ],
    type: "FeatureCollection",
};

describe("VoronoiOutlineLayers", () => {
    it("renders shape source with outline features when visible", () => {
        const screen = render(
            <VoronoiOutlineLayers
                voronoiOutlineFeatures={mockOutlineFeatures}
                visible
            />,
        );

        const source = screen
            .getAllByTestId("map-shape-source")
            .find((s) => s.props.id === "voronoi-outlines");
        expect(source).toBeTruthy();
        expect(source?.props.shape.features).toHaveLength(1);
    });

    it("renders a line layer with the expected style props", () => {
        const screen = render(
            <VoronoiOutlineLayers
                voronoiOutlineFeatures={mockOutlineFeatures}
                visible
            />,
        );

        const lineLayer = screen
            .getAllByTestId("map-line-layer")
            .find((l) => l.props.id === "voronoi-outlines-line");
        expect(lineLayer).toBeTruthy();
        expect(lineLayer?.props.style.lineColor).toBe("#666666");
        expect(lineLayer?.props.style.lineOpacity).toBe(0.25);
        expect(lineLayer?.props.style.lineWidth).toBe(1);
    });

    it("keeps shape source mounted with empty features when not visible", () => {
        const screen = render(
            <VoronoiOutlineLayers
                voronoiOutlineFeatures={mockOutlineFeatures}
                visible={false}
            />,
        );

        const source = screen
            .getAllByTestId("map-shape-source")
            .find((s) => s.props.id === "voronoi-outlines");
        expect(source).toBeTruthy();
        expect(source?.props.shape.features).toHaveLength(0);
    });

    it("does not crash with empty feature collection", () => {
        const emptyFeatures: FeatureCollection<Polygon | MultiPolygon> = {
            features: [],
            type: "FeatureCollection",
        };
        const screen = render(
            <VoronoiOutlineLayers
                voronoiOutlineFeatures={emptyFeatures}
                visible
            />,
        );

        const source = screen
            .getAllByTestId("map-shape-source")
            .find((s) => s.props.id === "voronoi-outlines");
        expect(source).toBeTruthy();
        expect(source?.props.shape.features).toHaveLength(0);
    });
});
