import type {
    Feature,
    LineString,
    MultiLineString,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";

import {
    trimTrainLinesForOverlay,
    type TrainOverlayTrimOptions,
    type TrainOverlayTrimPerfSnapshot,
} from "../maps/api/trainLineTrim";

const workerStartedAt = performance.now();
const workerElapsedMs = () => Math.round(performance.now() - workerStartedAt);

type TrimRequest = {
    id: number;
    lineFeatures: Array<Feature<LineString | MultiLineString>>;
    stationFeatures: Array<Feature<Point>>;
    playableArea: Feature<Polygon | MultiPolygon> | null;
    trimOptions?: TrainOverlayTrimOptions;
};

type TrimResponse =
    | {
          id: number;
          ok: true;
          features: Array<Feature<LineString | MultiLineString>>;
          perf?: TrainOverlayTrimPerfSnapshot;
      }
    | { id: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<TrimRequest>) => {
    const { id, lineFeatures, stationFeatures, playableArea, trimOptions } = event.data;
    const startedAt = performance.now();
    console.log("[train-overlay-worker] start", {
        id,
        workerElapsedMs: workerElapsedMs(),
        lineFeatures: lineFeatures.length,
        stationFeatures: stationFeatures.length,
        hasPlayableArea: playableArea !== null,
        trimOptions: trimOptions ?? null,
    });
    try {
        const { features, perf } = trimTrainLinesForOverlay(
            lineFeatures,
            stationFeatures,
            playableArea,
            trimOptions,
        );
        console.log("[train-overlay-worker] finish", {
            id,
            workerElapsedMs: workerElapsedMs(),
            outputFeatures: features.length,
            durationMs: Math.round(performance.now() - startedAt),
            perf: perf ?? null,
        });
        const response: TrimResponse = { id, ok: true, features, perf };
        self.postMessage(response);
    } catch (error) {
        console.warn("[train-overlay-worker] error", {
            id,
            workerElapsedMs: workerElapsedMs(),
            durationMs: Math.round(performance.now() - startedAt),
            error: String(error),
        });
        const response: TrimResponse = {
            id,
            ok: false,
            error: String(error),
        };
        self.postMessage(response);
    }
};
