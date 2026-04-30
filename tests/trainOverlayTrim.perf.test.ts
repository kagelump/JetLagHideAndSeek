import * as turf from "@turf/turf";
import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiLineString,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";
import osmtogeojson from "osmtogeojson";
import { performance } from "perf_hooks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";

import { trimTrainLinesToPlayableArea } from "@/maps/api/trainLineTrim";

type OverpassElement = {
    type: string;
    id: number;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: Record<string, string>;
};

type OverpassBlob = {
    elements?: OverpassElement[];
};

const shouldRunPerf = process.env.RUN_PERF === "1";
const maybeDescribe = shouldRunPerf ? describe : describe.skip;

const toStationFeatures = (elements: OverpassElement[]) => {
    const stations: Array<Feature<Point>> = [];
    for (const element of elements) {
        const lon = element.center?.lon ?? element.lon;
        const lat = element.center?.lat ?? element.lat;
        if (typeof lon !== "number" || typeof lat !== "number") continue;
        stations.push(
            turf.point([lon, lat], {
                id: `${element.type}/${element.id}`,
                ...element.tags,
            }),
        );
    }
    return stations;
};

const countPolygonVertices = (
    playableArea: Feature<Polygon | MultiPolygon>,
): number => {
    if (playableArea.geometry.type === "Polygon") {
        return playableArea.geometry.coordinates.reduce(
            (acc, ring) => acc + ring.length,
            0,
        );
    }
    return playableArea.geometry.coordinates.reduce(
        (polyAcc, polygon) =>
            polyAcc + polygon.reduce((ringAcc, ring) => ringAcc + ring.length, 0),
        0,
    );
};

maybeDescribe("train overlay trim perf", () => {
    it(
        "profiles trim stages using tokyo overpass blob fixture",
        () => {
            const blobPath = resolve(process.cwd(), "testdata/blob");
            const playableAreaPath = resolve(
                process.cwd(),
                "testdata/playable-area-tokyo.fixture.json",
            );

            const rawBlob = readFileSync(blobPath, "utf8");
            const rawPlayableArea = readFileSync(playableAreaPath, "utf8");
            const overpassBlob = JSON.parse(rawBlob) as OverpassBlob;
            const playableArea = JSON.parse(rawPlayableArea) as Feature<
                Polygon | MultiPolygon
            >;

            const toGeoJsonStartedAt = performance.now();
            const geoJSON = osmtogeojson(overpassBlob) as FeatureCollection;
            const toGeoJsonMs = performance.now() - toGeoJsonStartedAt;

            const extractStartedAt = performance.now();
            const lineFeatures = geoJSON.features.filter((feature: any) => {
                const geometryType = feature?.geometry?.type;
                return (
                    geometryType === "LineString" ||
                    geometryType === "MultiLineString"
                );
            }) as Array<Feature<LineString | MultiLineString>>;
            const stationFeatures = toStationFeatures(overpassBlob.elements ?? []);
            const extractMs = performance.now() - extractStartedAt;

            const cloneProbeStartedAt = performance.now();
            const lineCloneBytes = JSON.stringify(lineFeatures).length;
            const cloneProbeMs = performance.now() - cloneProbeStartedAt;

            const trimStartedAt = performance.now();
            const output = trimTrainLinesToPlayableArea(
                lineFeatures,
                stationFeatures,
                playableArea,
            );
            const trimMs = performance.now() - trimStartedAt;

            console.log("[train-overlay-perf]", {
                lineFeatures: lineFeatures.length,
                stationFeatures: stationFeatures.length,
                outputFeatures: output.length,
                playablePolygonVertexCount: countPolygonVertices(playableArea),
                osmtogeojsonMs: Math.round(toGeoJsonMs),
                stationExtractionMs: Math.round(extractMs),
                trimTotalMs: Math.round(trimMs),
                lineCloneBytes,
                cloneProbeMs: Math.round(cloneProbeMs),
            });
        },
        600_000,
    );
});
