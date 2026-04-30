import * as turf from "@turf/turf";
import type {
    Feature,
    LineString,
    MultiLineString,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";
import _ from "lodash";

type TrimPerfStats = {
    segmentClipMs: number;
    extendStationMs: number;
    segmentClipCalls: number;
    extendStationCalls: number;
    edgeCount: number;
    stationsScanned: number;
};

const PERF_ENV_ENABLED =
    typeof process !== "undefined" &&
    typeof process.env !== "undefined" &&
    process.env.RUN_PERF === "1";

const createPerfStats = (): TrimPerfStats => ({
    segmentClipMs: 0,
    extendStationMs: 0,
    segmentClipCalls: 0,
    extendStationCalls: 0,
    edgeCount: 0,
    stationsScanned: 0,
});

const nowMs = () => performance.now();

const segmentClipInside = (
    line: Feature<LineString>,
    playableArea: Feature<Polygon | MultiPolygon>,
    boundary: Feature<LineString | MultiLineString>,
    perf: TrimPerfStats | null,
) => {
    const startedAt = perf ? nowMs() : 0;
    const segments: Array<Feature<LineString>> = [];
    const coords = line.geometry.coordinates;
    if (coords.length < 2) return segments;
    if (perf) perf.edgeCount += coords.length - 1;

    let currentCoords: number[][] = [];
    const finalizeCurrent = () => {
        if (currentCoords.length >= 2) {
            segments.push(turf.lineString(currentCoords, line.properties));
        }
        currentCoords = [];
    };

    for (let idx = 1; idx < coords.length; idx += 1) {
        const start = coords[idx - 1];
        const end = coords[idx];
        const segment = turf.lineString([start, end]);
        const mid = turf.midpoint(turf.point(start), turf.point(end));
        const midInside = turf.booleanPointInPolygon(mid, playableArea as any);
        const intersections = turf.lineIntersect(segment, boundary as any).features;
        const uniqueIntersections = _.uniqBy(
            intersections.map((feature) => feature.geometry.coordinates),
            (coord) => `${coord[0].toFixed(7)}_${coord[1].toFixed(7)}`,
        );

        if (uniqueIntersections.length === 0) {
            if (midInside) {
                if (currentCoords.length === 0) currentCoords.push(start);
                currentCoords.push(end);
            } else {
                finalizeCurrent();
            }
            continue;
        }

        const intersectionPoints = uniqueIntersections
            .map((coord) => turf.point(coord))
            .map((point) => ({
                point,
                distanceFromStart: turf.distance(turf.point(start), point, {
                    units: "kilometers",
                }),
            }))
            .sort((a, b) => a.distanceFromStart - b.distanceFromStart);

        let cursor = start;
        let cursorInside = turf.booleanPointInPolygon(
            turf.midpoint(turf.point(start), intersectionPoints[0].point),
            playableArea as any,
        );

        for (const intersect of intersectionPoints) {
            const cut = intersect.point.geometry.coordinates;
            if (cursorInside) {
                if (currentCoords.length === 0) currentCoords.push(cursor);
                currentCoords.push(cut);
                finalizeCurrent();
            } else {
                finalizeCurrent();
            }
            cursor = cut;
            cursorInside = !cursorInside;
        }

        if (cursorInside) {
            if (currentCoords.length === 0) currentCoords.push(cursor);
            currentCoords.push(end);
        } else {
            finalizeCurrent();
        }
    }

    finalizeCurrent();
    if (perf) {
        perf.segmentClipMs += nowMs() - startedAt;
        perf.segmentClipCalls += 1;
    }
    return segments;
};

const extendSegmentToOutsideStation = (
    fullLine: Feature<LineString>,
    segment: Feature<LineString>,
    stations: Array<Feature<Point>>,
    playableArea: Feature<Polygon | MultiPolygon>,
    perf: TrimPerfStats | null,
) => {
    const startedAt = perf ? nowMs() : 0;
    try {
        const segmentCoords = segment.geometry.coordinates;
        if (segmentCoords.length < 2) return segment;
        if (perf) perf.stationsScanned += stations.length;

        const projectedStations = stations
            .map((station) => {
                const snapped = turf.nearestPointOnLine(fullLine, station, {
                    units: "kilometers",
                });
                const stationDistanceToLineKm = turf.distance(station, snapped, {
                    units: "kilometers",
                });
                return {
                    station,
                    location: (snapped.properties?.location ?? 0) as number,
                    stationDistanceToLineKm,
                    inside: turf.booleanPointInPolygon(station, playableArea as any),
                };
            })
            .filter((entry) => entry.stationDistanceToLineKm <= 1.5)
            .sort((a, b) => a.location - b.location);

        if (projectedStations.length < 3) return segment;
        const monotonic = projectedStations.every((entry, idx) => {
            if (idx === 0) return true;
            return entry.location >= projectedStations[idx - 1].location;
        });
        if (!monotonic) return segment;

        const lengthKm = turf.length(fullLine, { units: "kilometers" });
        const startProjection = turf.nearestPointOnLine(
            fullLine,
            turf.point(segmentCoords[0]),
            { units: "kilometers" },
        );
        const endProjection = turf.nearestPointOnLine(
            fullLine,
            turf.point(segmentCoords[segmentCoords.length - 1]),
            { units: "kilometers" },
        );
        const startLoc = Math.max(
            0,
            Math.min(lengthKm, (startProjection.properties?.location ?? 0) as number),
        );
        const endLoc = Math.max(
            0,
            Math.min(lengthKm, (endProjection.properties?.location ?? 0) as number),
        );

        const MAX_EXTENSION_KM = 80;
        const startOutside = [...projectedStations]
            .reverse()
            .find((entry) => !entry.inside && entry.location < startLoc);
        const endOutside = projectedStations.find(
            (entry) => !entry.inside && entry.location > endLoc,
        );

        const merged = [...segmentCoords];
        if (
            startOutside &&
            startLoc - startOutside.location <= MAX_EXTENSION_KM &&
            startLoc > startOutside.location
        ) {
            const preSlice = turf.lineSliceAlong(
                fullLine,
                startOutside.location,
                startLoc,
                {
                    units: "kilometers",
                },
            );
            const preCoords = preSlice.geometry.coordinates;
            if (preCoords.length >= 2) {
                const withoutLast = preCoords.slice(0, -1);
                merged.splice(0, 0, ...withoutLast);
            }
        }

        if (
            endOutside &&
            endOutside.location - endLoc <= MAX_EXTENSION_KM &&
            endOutside.location > endLoc
        ) {
            const postSlice = turf.lineSliceAlong(
                fullLine,
                endLoc,
                endOutside.location,
                {
                    units: "kilometers",
                },
            );
            const postCoords = postSlice.geometry.coordinates;
            if (postCoords.length >= 2) {
                const withoutFirst = postCoords.slice(1);
                merged.push(...withoutFirst);
            }
        }

        const dedupedCoords = merged.filter((coord, idx) => {
            if (idx === 0) return true;
            const prev = merged[idx - 1];
            return coord[0] !== prev[0] || coord[1] !== prev[1];
        });
        if (dedupedCoords.length < 2) return segment;
        return turf.lineString(dedupedCoords, segment.properties);
    } finally {
        if (perf) {
            perf.extendStationMs += nowMs() - startedAt;
            perf.extendStationCalls += 1;
        }
    }
};

const trimLineFeature = (
    line: Feature<LineString | MultiLineString>,
    stations: Array<Feature<Point>>,
    playableArea: Feature<Polygon | MultiPolygon>,
    boundary: Feature<LineString | MultiLineString>,
    perf: TrimPerfStats | null,
) => {
    const lineParts =
        line.geometry.type === "LineString"
            ? [line.geometry.coordinates]
            : line.geometry.coordinates;
    const outputSegments: Array<Feature<LineString>> = [];

    for (const coords of lineParts) {
        if (coords.length < 2) continue;
        const partLine = turf.lineString(coords, line.properties);
        const clippedSegments = segmentClipInside(
            partLine,
            playableArea,
            boundary,
            perf,
        );
        for (const segment of clippedSegments) {
            outputSegments.push(
                extendSegmentToOutsideStation(
                    partLine,
                    segment,
                    stations,
                    playableArea,
                    perf,
                ),
            );
        }
    }

    return outputSegments;
};

export const trimTrainLinesToPlayableArea = (
    lineFeatures: Array<Feature<LineString | MultiLineString>>,
    stationFeatures: Array<Feature<Point>>,
    playableArea: Feature<Polygon | MultiPolygon> | null,
) => {
    if (!playableArea) return lineFeatures;
    const boundary = turf.polygonToLine(playableArea as any) as Feature<
        LineString | MultiLineString
    >;
    const perf = PERF_ENV_ENABLED ? createPerfStats() : null;
    const output = lineFeatures.flatMap((line) =>
        trimLineFeature(line, stationFeatures, playableArea, boundary, perf),
    );
    if (perf) {
        console.log("[train-line-trim-perf]", {
            lineFeatures: lineFeatures.length,
            stationFeatures: stationFeatures.length,
            outputFeatures: output.length,
            segmentClipMs: Math.round(perf.segmentClipMs),
            extendStationMs: Math.round(perf.extendStationMs),
            segmentClipCalls: perf.segmentClipCalls,
            extendStationCalls: perf.extendStationCalls,
            edgeCount: perf.edgeCount,
            stationsScanned: perf.stationsScanned,
        });
    }
    return output;
};
