import type { Polygon } from "geojson";

import {
    EARTH_RADIUS,
    projectionFor,
    projectGeometry,
} from "@/shared/geometry/bufferProjection";
import { EARTH_RADIUS_METERS } from "@/shared/geometry/earthRadius";

function visitCoords(
    value: unknown,
    visitor: (c: [number, number]) => void,
): void {
    if (
        Array.isArray(value) &&
        typeof value[0] === "number" &&
        typeof value[1] === "number"
    ) {
        visitor(value as [number, number]);
    } else if (Array.isArray(value)) {
        for (const item of value) visitCoords(item, visitor);
    }
}

test("earth radius constants are finite and positive at import", () => {
    expect(Number.isFinite(EARTH_RADIUS)).toBe(true);
    expect(EARTH_RADIUS).toBeGreaterThan(0);
    expect(Number.isFinite(EARTH_RADIUS_METERS)).toBe(true);
    expect(EARTH_RADIUS_METERS).toBeGreaterThan(0);
    expect(EARTH_RADIUS).toBe(EARTH_RADIUS_METERS);
});

test("projectionFor produces finite coordinates", () => {
    const feature = {
        type: "Feature" as const,
        properties: {},
        geometry: {
            type: "Polygon" as const,
            coordinates: [
                [
                    [139.0, 35.0],
                    [140.0, 35.0],
                    [140.0, 36.0],
                    [139.0, 36.0],
                    [139.0, 35.0],
                ],
            ],
        },
    };
    const proj = projectionFor(feature);
    const center: [number, number] = [139.5, 35.5];
    const projected = proj(center);
    expect(projected).not.toBeNull();
    expect(Number.isFinite(projected![0])).toBe(true);
    expect(Number.isFinite(projected![1])).toBe(true);
});

test("projectGeometry produces only finite coordinates", () => {
    const polygon: Polygon = {
        type: "Polygon",
        coordinates: [
            [
                [139.0, 35.0],
                [140.0, 35.0],
                [140.0, 36.0],
                [139.0, 36.0],
                [139.0, 35.0],
                [139.2, 35.2],
                [139.8, 35.2],
                [139.8, 35.8],
                [139.2, 35.8],
                [139.2, 35.2],
            ],
        ],
    };
    const proj = projectionFor({
        type: "Feature",
        properties: {},
        geometry: polygon,
    });
    const projected = projectGeometry(polygon, proj);
    visitCoords(projected.coordinates, (c) => {
        expect(Number.isFinite(c[0])).toBe(true);
        expect(Number.isFinite(c[1])).toBe(true);
    });
});
