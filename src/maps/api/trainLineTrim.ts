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

/** Quantize step for corridor signatures (~90 m latitude at mid-latitudes). */
const CORRIDOR_QUANTIZE_STEP_DEG = 0.0008;

/** Endpoint must be within this distance of playable boundary to run station extension (boundaryOnly mode). */
const BOUNDARY_NEAR_KM = 0.65;

export type TrainOverlaySimplifyPreset = "balanced" | "fast" | "veryFast";

export type TrainOverlayExtensionMode = "off" | "boundaryOnly" | "full";

export type TrainOverlayTrimOptions = {
    /** When true, worker returns a perf snapshot and logs phase timings (also enabled by RUN_PERF=1 in Vitest). */
    debugPerf?: boolean;
    simplifyPreset?: TrainOverlaySimplifyPreset;
    extensionMode?: TrainOverlayExtensionMode;
};

export type TrainOverlayTrimPerfSnapshot = {
    rawLineFeatures: number;
    corridorDedupedLineFeatures: number;
    simplifyPreset: TrainOverlaySimplifyPreset;
    extensionMode: TrainOverlayExtensionMode;
    outputFeatures: number;
    outputCoordinatePairs: number;
    segmentClipMs: number;
    extendStationMs: number;
    segmentClipCalls: number;
    extendStationCalls: number;
    extendStationSkippedNearBoundary: number;
    edgeCount: number;
    stationsScanned: number;
    totalTrimMs: number;
};

const SIMPLIFY_TOLERANCE_BY_PRESET: Record<TrainOverlaySimplifyPreset, number> = {
    balanced: 0.00035,
    fast: 0.0009,
    veryFast: 0.0015,
};

/** Spatial hash cell size in degrees (~2.2 km latitude). */
const STATION_GRID_CELL_DEG = 0.02;

/** Expand line bbox when collecting candidate stations (km). Must exceed station cutoff below. */
const STATION_LINE_BBOX_PAD_KM = 2;

/** Stations farther than this from the line never participate (matches prior behavior). */
const STATION_MAX_DISTANCE_TO_LINE_KM = 1.5;

const KM_PER_DEG_LAT = 111;

type StationGrid = Map<string, Array<Feature<Point>>>;

type TrimPerfStats = {
    segmentClipMs: number;
    extendStationMs: number;
    segmentClipCalls: number;
    extendStationCalls: number;
    extendStationSkippedNearBoundary: number;
    edgeCount: number;
    stationsScanned: number;
};

const perfEnvEnabled =
    typeof process !== "undefined" &&
    typeof process.env !== "undefined" &&
    process.env.RUN_PERF === "1";

const createPerfStats = (): TrimPerfStats => ({
    segmentClipMs: 0,
    extendStationMs: 0,
    segmentClipCalls: 0,
    extendStationCalls: 0,
    extendStationSkippedNearBoundary: 0,
    edgeCount: 0,
    stationsScanned: 0,
});

const nowMs = () => performance.now();

type ResolvedTrimOptions = {
    debugPerf: boolean;
    simplifyPreset: TrainOverlaySimplifyPreset;
    extensionMode: TrainOverlayExtensionMode;
};

const resolveTrimOptions = (
    options: TrainOverlayTrimOptions | undefined,
): ResolvedTrimOptions => ({
    debugPerf: Boolean(options?.debugPerf),
    simplifyPreset: options?.simplifyPreset ?? "fast",
    extensionMode: options?.extensionMode ?? "off",
});

const shouldCollectPerfStats = (resolved: ResolvedTrimOptions): boolean =>
    resolved.debugPerf || perfEnvEnabled;

const bboxIntersects = (a: turf.BBox, b: turf.BBox): boolean =>
    !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);

/** Axis-aligned bbox pad derived from km at bbox mid-latitude */
const padBBoxKm = (bbox: turf.BBox, padKm: number): turf.BBox => {
    const midLat = (bbox[1] + bbox[3]) / 2;
    const cosLat = Math.cos((midLat * Math.PI) / 180);
    const padLat = padKm / KM_PER_DEG_LAT;
    const padLon = padKm / (KM_PER_DEG_LAT * Math.max(0.2, cosLat));
    return [
        bbox[0] - padLon,
        bbox[1] - padLat,
        bbox[2] + padLon,
        bbox[3] + padLat,
    ];
};

const stationDedupeKey = (station: Feature<Point>): string => {
    const props = station.properties as Record<string, unknown> | undefined;
    const id = props?.id;
    if (typeof id === "string" || typeof id === "number") return String(id);
    const [lon, lat] = station.geometry.coordinates;
    return `${lon.toFixed(7)},${lat.toFixed(7)}`;
};

const buildStationGrid = (stations: Array<Feature<Point>>): StationGrid => {
    const grid: StationGrid = new Map();
    for (const station of stations) {
        const [lon, lat] = station.geometry.coordinates;
        const key = `${Math.floor(lon / STATION_GRID_CELL_DEG)},${Math.floor(
            lat / STATION_GRID_CELL_DEG,
        )}`;
        let bucket = grid.get(key);
        if (!bucket) {
            bucket = [];
            grid.set(key, bucket);
        }
        bucket.push(station);
    }
    return grid;
};

const getStationsNearLine = (
    line: Feature<LineString>,
    stationGrid: StationGrid,
    padKm: number,
): Array<Feature<Point>> => {
    const paddedBox = padBBoxKm(turf.bbox(line), padKm);
    const i0 = Math.floor(paddedBox[0] / STATION_GRID_CELL_DEG);
    const i1 = Math.floor(paddedBox[2] / STATION_GRID_CELL_DEG);
    const j0 = Math.floor(paddedBox[1] / STATION_GRID_CELL_DEG);
    const j1 = Math.floor(paddedBox[3] / STATION_GRID_CELL_DEG);
    const out: Array<Feature<Point>> = [];
    const seen = new Set<string>();
    for (let i = i0; i <= i1; i += 1) {
        for (let j = j0; j <= j1; j += 1) {
            const bucket = stationGrid.get(`${i},${j}`);
            if (!bucket) continue;
            for (const station of bucket) {
                const dedupe = stationDedupeKey(station);
                if (seen.has(dedupe)) continue;
                seen.add(dedupe);
                out.push(station);
            }
        }
    }
    return out;
};

const simplifyTrainLineWithTolerance = (
    line: Feature<LineString | MultiLineString>,
    toleranceDeg: number,
): Feature<LineString | MultiLineString> => {
    try {
        const simplified = turf.simplify(line as any, {
            tolerance: toleranceDeg,
            highQuality: false,
        }) as Feature<LineString | MultiLineString>;
        simplified.properties = line.properties;
        if (simplified.geometry.type === "LineString") {
            if (simplified.geometry.coordinates.length < 2) return line;
            return simplified;
        }
        const hasSegment = simplified.geometry.coordinates.some((ring) => ring.length >= 2);
        return hasSegment ? simplified : line;
    } catch {
        return line;
    }
};

const railIdentityKey = (props: Record<string, unknown>): string => {
    const railway = props.railway ?? "";
    const name = props.name ?? props["name:en"] ?? "";
    const operator = props.operator ?? "";
    const network = props.network ?? "";
    const ref = props.ref ?? "";
    return [railway, name, operator, network, ref].join("|");
};

const quantizeCoord = (lon: number, lat: number, stepDeg: number): [number, number] => [
    Math.round(lon / stepDeg) * stepDeg,
    Math.round(lat / stepDeg) * stepDeg,
];

const dedupeConsecutiveCoords = (points: Array<[number, number]>): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (const p of points) {
        const prev = out[out.length - 1];
        if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
    }
    return out;
};

const directionNeutralLineSignature = (
    coords: number[][],
    quantizeStepDeg: number,
): string => {
    const q = dedupeConsecutiveCoords(
        coords.map(([lon, lat]) => quantizeCoord(lon, lat, quantizeStepDeg)),
    );
    if (q.length < 2) {
        return q.map((c) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).join(";");
    }
    const first = q[0];
    const last = q[q.length - 1];
    const forward =
        first[0] < last[0] ||
        (first[0] === last[0] && first[1] < last[1]) ||
        (first[0] === last[0] && first[1] === last[1]);
    const seq = forward ? q : [...q].reverse();
    return seq.map((c) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).join(";");
};

const corridorDedupeKeyForLine = (
    line: Feature<LineString | MultiLineString>,
    quantizeStepDeg: number,
): string => {
    const props = (line.properties ?? {}) as Record<string, unknown>;
    const idKey = railIdentityKey(props);
    if (line.geometry.type === "LineString") {
        return `${idKey}@@${directionNeutralLineSignature(line.geometry.coordinates, quantizeStepDeg)}`;
    }
    const partSigs = line.geometry.coordinates
        .filter((c) => c.length >= 2)
        .map((c) => directionNeutralLineSignature(c, quantizeStepDeg))
        .sort();
    return `${idKey}@@${partSigs.join("||")}`;
};

const lineLengthKm = (line: Feature<LineString | MultiLineString>): number => {
    try {
        return turf.length(line, { units: "kilometers" });
    } catch {
        return 0;
    }
};

/**
 * Collapse near-duplicate corridors (e.g. paired tracks) using simplified geometry + quantized signatures.
 */
const collapseParallelCorridorLines = (
    lines: Array<Feature<LineString | MultiLineString>>,
    simplifyToleranceDeg: number,
    quantizeStepDeg: number,
): Array<Feature<LineString | MultiLineString>> => {
    const bestByKey = new Map<string, Feature<LineString | MultiLineString>>();
    for (const line of lines) {
        const simplified = simplifyTrainLineWithTolerance(line, simplifyToleranceDeg);
        const key = corridorDedupeKeyForLine(simplified, quantizeStepDeg);
        const prev = bestByKey.get(key);
        if (!prev || lineLengthKm(simplified) > lineLengthKm(prev)) {
            bestByKey.set(key, simplified);
        }
    }
    return [...bestByKey.values()];
};

const countCoordinatePairsInFeatures = (
    features: Array<Feature<LineString | MultiLineString>>,
): number => {
    let n = 0;
    for (const f of features) {
        if (f.geometry.type === "LineString") {
            n += f.geometry.coordinates.length;
        } else {
            for (const ring of f.geometry.coordinates) {
                n += ring.length;
            }
        }
    }
    return n;
};

const minEndpointDistanceToBoundaryKm = (
    segment: Feature<LineString>,
    boundary: Feature<LineString | MultiLineString>,
): number => {
    const coords = segment.geometry.coordinates;
    const a = turf.point(coords[0]);
    const b = turf.point(coords[coords.length - 1]);
    const na = turf.nearestPointOnLine(boundary as any, a, { units: "kilometers" });
    const nb = turf.nearestPointOnLine(boundary as any, b, { units: "kilometers" });
    return Math.min(
        turf.distance(a, na, { units: "kilometers" }),
        turf.distance(b, nb, { units: "kilometers" }),
    );
};

const shouldRunStationExtension = (
    mode: TrainOverlayExtensionMode,
    segment: Feature<LineString>,
    boundary: Feature<LineString | MultiLineString>,
    perf: TrimPerfStats | null,
): boolean => {
    if (mode === "off") return false;
    if (mode === "full") return true;
    const near = minEndpointDistanceToBoundaryKm(segment, boundary) <= BOUNDARY_NEAR_KM;
    if (!near && perf) perf.extendStationSkippedNearBoundary += 1;
    return near;
};

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
            .filter((entry) => entry.stationDistanceToLineKm <= STATION_MAX_DISTANCE_TO_LINE_KM)
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
    stationGrid: StationGrid,
    playableArea: Feature<Polygon | MultiPolygon>,
    boundary: Feature<LineString | MultiLineString>,
    resolved: ResolvedTrimOptions,
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
        const nearbyStations = getStationsNearLine(
            partLine,
            stationGrid,
            STATION_LINE_BBOX_PAD_KM,
        );
        const clippedSegments = segmentClipInside(partLine, playableArea, boundary, perf);
        for (const segment of clippedSegments) {
            const allowExtend =
                nearbyStations.length >= 3 &&
                shouldRunStationExtension(resolved.extensionMode, segment, boundary, perf);

            if (!allowExtend) {
                outputSegments.push(segment);
                continue;
            }

            outputSegments.push(
                extendSegmentToOutsideStation(
                    partLine,
                    segment,
                    nearbyStations,
                    playableArea,
                    perf,
                ),
            );
        }
    }

    return outputSegments;
};

export const trimTrainLinesForOverlay = (
    lineFeatures: Array<Feature<LineString | MultiLineString>>,
    stationFeatures: Array<Feature<Point>>,
    playableArea: Feature<Polygon | MultiPolygon> | null,
    options?: TrainOverlayTrimOptions,
): {
    features: Array<Feature<LineString | MultiLineString>>;
    perf?: TrainOverlayTrimPerfSnapshot;
} => {
    const resolved = resolveTrimOptions(options);
    const collectPerf = shouldCollectPerfStats(resolved);
    const perf = collectPerf ? createPerfStats() : null;
    const trimStartedAt = nowMs();

    if (!playableArea) {
        return { features: lineFeatures };
    }

    const tol = SIMPLIFY_TOLERANCE_BY_PRESET[resolved.simplifyPreset];
    const rawLineFeatures = lineFeatures.length;
    const dedupedLines = collapseParallelCorridorLines(
        lineFeatures,
        tol,
        CORRIDOR_QUANTIZE_STEP_DEG,
    );

    const playableBbox = turf.bbox(playableArea);
    const boundary = turf.polygonToLine(playableArea as any) as Feature<
        LineString | MultiLineString
    >;
    const stationGrid = buildStationGrid(stationFeatures);

    const output = dedupedLines.flatMap((line) => {
        const lineBbox = turf.bbox(line);
        if (!bboxIntersects(lineBbox, playableBbox)) {
            return [];
        }
        return trimLineFeature(line, stationGrid, playableArea, boundary, resolved, perf);
    });

    const totalTrimMs = nowMs() - trimStartedAt;

    let perfSnapshot: TrainOverlayTrimPerfSnapshot | undefined;
    if (collectPerf && perf) {
        perfSnapshot = {
            rawLineFeatures,
            corridorDedupedLineFeatures: dedupedLines.length,
            simplifyPreset: resolved.simplifyPreset,
            extensionMode: resolved.extensionMode,
            outputFeatures: output.length,
            outputCoordinatePairs: countCoordinatePairsInFeatures(output),
            segmentClipMs: Math.round(perf.segmentClipMs),
            extendStationMs: Math.round(perf.extendStationMs),
            segmentClipCalls: perf.segmentClipCalls,
            extendStationCalls: perf.extendStationCalls,
            extendStationSkippedNearBoundary: perf.extendStationSkippedNearBoundary,
            edgeCount: perf.edgeCount,
            stationsScanned: perf.stationsScanned,
            totalTrimMs: Math.round(totalTrimMs),
        };
        if (resolved.debugPerf || perfEnvEnabled) {
            console.log("[train-line-trim-perf]", perfSnapshot);
        }
    }

    return { features: output, perf: perfSnapshot };
};

/** @deprecated Prefer trimTrainLinesForOverlay when perf/options are needed */
export const trimTrainLinesToPlayableArea = (
    lineFeatures: Array<Feature<LineString | MultiLineString>>,
    stationFeatures: Array<Feature<Point>>,
    playableArea: Feature<Polygon | MultiPolygon> | null,
    options?: TrainOverlayTrimOptions,
) =>
    trimTrainLinesForOverlay(lineFeatures, stationFeatures, playableArea, options).features;

/** Stats-only helper for blob analyzers (no playable polygon required). */
export const trainOverlayCorridorCollapseStats = (
    lineFeatures: Array<Feature<LineString | MultiLineString>>,
    preset: TrainOverlaySimplifyPreset = "fast",
): { rawLineFeatures: number; dedupedLineFeatures: number } => {
    const tol = SIMPLIFY_TOLERANCE_BY_PRESET[preset];
    const deduped = collapseParallelCorridorLines(lineFeatures, tol, CORRIDOR_QUANTIZE_STEP_DEG);
    return {
        rawLineFeatures: lineFeatures.length,
        dedupedLineFeatures: deduped.length,
    };
};
