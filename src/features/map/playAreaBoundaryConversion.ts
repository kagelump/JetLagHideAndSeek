import osmtogeojson from "osmtogeojson";
import simplify from "@turf/simplify";

import type { GeoJsonFeature, GeoJsonFeatureCollection } from "./geojsonTypes";
import { calculateBbox, calculateCenter, type PlayArea } from "./playArea";
import { MAP } from "@/config/appConfig";

const BOUNDARY_SIMPLIFY_TOLERANCE = MAP.boundarySimplifyTolerance;

export function buildPlayAreaFromOverpass(
    relationId: number,
    overpassJson: unknown,
): PlayArea {
    const converted = osmtogeojson(overpassJson);
    const boundary = filterBoundaryFeatures(
        converted as unknown as GeoJsonFeatureCollection,
    );

    return buildPlayAreaFromBoundary(relationId, boundary);
}

export function buildPlayAreaFromBoundary(
    relationId: number,
    boundary: GeoJsonFeatureCollection,
): PlayArea {
    if (boundary.features.length === 0) {
        throw new Error(`No polygon boundary found for relation ${relationId}`);
    }

    const simplified = simplifyPlayAreaBoundary(boundary);
    const bbox = calculateBbox(simplified);
    return {
        bbox,
        boundary: simplified,
        center: calculateCenter(bbox),
        label: getBoundaryLabel(simplified, relationId),
        osmId: relationId,
        osmType: "R",
    };
}

function simplifyPlayAreaBoundary(
    boundary: GeoJsonFeatureCollection,
): GeoJsonFeatureCollection {
    return {
        ...boundary,
        features: boundary.features.map(
            (feature) =>
                simplify(feature as unknown as Parameters<typeof simplify>[0], {
                    tolerance: BOUNDARY_SIMPLIFY_TOLERANCE,
                    highQuality: false,
                }) as unknown as GeoJsonFeature,
        ),
    };
}

function filterBoundaryFeatures(
    boundary: GeoJsonFeatureCollection,
): GeoJsonFeatureCollection {
    return {
        features: boundary.features.filter(
            (feature) =>
                feature.geometry.type === "Polygon" ||
                feature.geometry.type === "MultiPolygon",
        ),
        type: "FeatureCollection",
    };
}

function getBoundaryLabel(
    boundary: GeoJsonFeatureCollection,
    relationId: number,
): string {
    for (const feature of boundary.features) {
        const name = feature.properties?.name;
        if (typeof name === "string" && name.trim()) return name;
    }

    return `OSM relation ${relationId}`;
}
