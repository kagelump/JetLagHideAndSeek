import { useStore } from "@nanostores/react";
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
import * as L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";

import {
    additionalMapGeoLocations,
    leafletMapContext,
    mapGeoJSON,
    mapGeoLocation,
    polyGeoJSON,
    showTrainLineOverlay,
} from "@/lib/context";
import { fetchTrainLines } from "@/maps/api";
import type {
    TrainOverlayTrimOptions,
    TrainOverlayTrimPerfSnapshot,
} from "@/maps/api/trainLineTrim";

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

const readTrainOverlayTrimOptionsFromStorage = (): TrainOverlayTrimOptions => {
    const defaults: TrainOverlayTrimOptions = {
        simplifyPreset: "fast",
        extensionMode: "off",
        debugPerf: false,
    };
    if (typeof window === "undefined" || typeof localStorage === "undefined") {
        return defaults;
    }
    const debugPerf = localStorage.getItem("trainOverlayDebugPerf") === "1";
    const sp = localStorage.getItem("trainOverlaySimplifyPreset");
    const em = localStorage.getItem("trainOverlayExtensionMode");
    const simplifyPreset =
        sp === "balanced" || sp === "fast" || sp === "veryFast"
            ? sp
            : defaults.simplifyPreset;
    const extensionMode =
        em === "off" || em === "boundaryOnly" || em === "full"
            ? em
            : defaults.extensionMode;
    return {
        simplifyPreset,
        extensionMode,
        debugPerf,
    };
};

const removeTrainLineLayers = (map: L.Map) => {
    map.eachLayer((layer: any) => {
        if (layer.trainLineOverlay) {
            map.removeLayer(layer);
        }
    });
};

const isCssColorLike = (input: string) =>
    /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(input) ||
    /^rgb(a)?\(/i.test(input) ||
    /^[a-z]+$/i.test(input);

const hashString = (value: string) => {
    let hash = 0;
    for (let idx = 0; idx < value.length; idx += 1) {
        hash = (hash << 5) - hash + value.charCodeAt(idx);
        hash |= 0;
    }
    return Math.abs(hash);
};

const buildZoneSignature = (
    poly: ReturnType<typeof polyGeoJSON.get>,
    primaryLocation: ReturnType<typeof mapGeoLocation.get>,
    additionalLocations: ReturnType<typeof additionalMapGeoLocations.get>,
) => {
    const polyCoordCount = poly ? JSON.stringify(poly).length : 0;
    const additionalKey = additionalLocations
        .map((entry) => `${entry.location.properties.osm_id}:${entry.added ? 1 : 0}`)
        .join(",");
    return [
        `polyLen=${polyCoordCount}`,
        `base=${primaryLocation?.properties?.osm_id ?? "none"}`,
        `extra=${additionalKey}`,
    ].join("|");
};

const resolveTrainLineColor = (feature?: Feature) => {
    const properties = (feature?.properties ?? {}) as Record<string, unknown>;
    const directColor = [
        properties.colour,
        properties.color,
        properties["ref:colour"],
    ]
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .find((entry) => entry.length > 0 && isCssColorLike(entry));

    if (directColor) return directColor;

    const lineIdentity = [
        properties.network,
        properties.ref,
        properties.name,
        properties.id,
    ]
        .filter((entry): entry is string | number => typeof entry === "string" || typeof entry === "number")
        .join("|");
    const hue = hashString(lineIdentity || "default-rail-line") % 360;
    return `hsl(${hue}, 75%, 45%)`;
};

export const TrainLinesOverlay = () => {
    const componentStartedAtRef = useRef(performance.now());
    const map = useStore(leafletMapContext);
    const $showTrainLineOverlay = useStore(showTrainLineOverlay);
    const $polyGeoJSON = useStore(polyGeoJSON);
    const $mapGeoLocation = useStore(mapGeoLocation);
    const $additionalMapGeoLocations = useStore(additionalMapGeoLocations);
    const $mapGeoJSON = useStore(mapGeoJSON);
    const overlayGenerationRef = useRef(0);
    const workerRef = useRef<Worker | null>(null);
    const workerRequestIdRef = useRef(0);
    const trimRequestStartedAtRef = useRef(new Map<number, number>());
    const trimComputationSeqRef = useRef(0);
    const rawTrainLinesRef = useRef<{
        lineFeatures: Array<Feature<LineString | MultiLineString>>;
        stationFeatures: Array<Feature<Point>>;
    } | null>(null);
    const [rawDataVersion, setRawDataVersion] = useState(0);
    const [trimmedLineFeatures, setTrimmedLineFeatures] = useState<
        Array<Feature<LineString | MultiLineString>> | null
    >(null);

    const zoneKey = useMemo(
        () =>
            buildZoneSignature(
                $polyGeoJSON,
                $mapGeoLocation,
                $additionalMapGeoLocations,
            ),
        [$polyGeoJSON, $mapGeoLocation, $additionalMapGeoLocations],
    );

    const playableArea = useMemo(() => {
        const zone = $mapGeoJSON ?? $polyGeoJSON;
        if (!zone || zone.features.length === 0) return null;
        const combined = turf.combine(zone as any);
        return combined.features[0] as Feature<Polygon | MultiPolygon>;
    }, [$mapGeoJSON, $polyGeoJSON]);

    const trimWorkerOptions = useMemo(() => readTrainOverlayTrimOptionsFromStorage(), []);

    const renderTrainLineOverlay = (
        lineFeatures: Array<Feature<LineString | MultiLineString>>,
    ) => {
        if (!map || !$showTrainLineOverlay) return;
        removeTrainLineLayers(map);
        const railGeoJSON: FeatureCollection<LineString> = {
            type: "FeatureCollection",
            features: lineFeatures as Array<Feature<LineString>>,
        };
        const overlay = L.geoJSON(railGeoJSON as any, {
            interactive: false,
            style(feature) {
                return {
                    color: resolveTrainLineColor(feature),
                    weight: 3,
                    opacity: 0.85,
                };
            },
        });
        // @ts-expect-error Custom marker property for cleanup.
        overlay.trainLineOverlay = true;
        overlay.addTo(map);
        overlay.bringToBack();
    };

    const elapsedMs = () =>
        Math.round(performance.now() - componentStartedAtRef.current);

    useEffect(() => {
        console.log("[train-overlay] worker init", { elapsedMs: elapsedMs() });
        const worker = new Worker(
            new URL("../workers/trainOverlay.worker.ts", import.meta.url),
            {
                type: "module",
            },
        );
        workerRef.current = worker;
        return () => {
            console.log("[train-overlay] worker terminate", {
                elapsedMs: elapsedMs(),
            });
            workerRef.current = null;
            worker.terminate();
        };
    }, []);

    const trimInWorker = (request: Omit<TrimRequest, "id">) =>
        new Promise<Array<Feature<LineString | MultiLineString>>>(
            (resolve, reject) => {
                const worker = workerRef.current;
                if (!worker) {
                    console.log("[train-overlay] worker unavailable, using raw lines", {
                        elapsedMs: elapsedMs(),
                    });
                    resolve(request.lineFeatures);
                    return;
                }
                const id = ++workerRequestIdRef.current;
                trimRequestStartedAtRef.current.set(id, performance.now());
                console.log("[train-overlay] dispatch trim", {
                    id,
                    elapsedMs: elapsedMs(),
                    lineFeatures: request.lineFeatures.length,
                    stationFeatures: request.stationFeatures.length,
                    hasPlayableArea: request.playableArea !== null,
                    trimOptions: request.trimOptions ?? null,
                });
                const onMessage = (event: MessageEvent<TrimResponse>) => {
                    if (event.data.id !== id) return;
                    worker.removeEventListener("message", onMessage);
                    const startedAt = trimRequestStartedAtRef.current.get(id);
                    trimRequestStartedAtRef.current.delete(id);
                    if (event.data.ok) {
                        console.log("[train-overlay] trim complete", {
                            id,
                            elapsedMs: elapsedMs(),
                            durationMs: startedAt
                                ? Math.round(performance.now() - startedAt)
                                : null,
                            outputFeatures: event.data.features.length,
                            perf: event.data.perf ?? null,
                        });
                        resolve(event.data.features);
                    } else {
                        console.warn("[train-overlay] trim failed", {
                            id,
                            elapsedMs: elapsedMs(),
                            durationMs: startedAt
                                ? Math.round(performance.now() - startedAt)
                                : null,
                            error: event.data.error,
                        });
                        reject(new Error(event.data.error));
                    }
                };
                worker.addEventListener("message", onMessage);
                worker.postMessage({ id, ...request } satisfies TrimRequest);
            },
        );

    useEffect(() => {
        if (!map) return;

        if (!$showTrainLineOverlay) {
            rawTrainLinesRef.current = null;
            removeTrainLineLayers(map);
            return;
        }

        const currentGeneration = ++overlayGenerationRef.current;
        const timer = setTimeout(async () => {
            try {
                const fetchStartedAt = performance.now();
                console.log("[train-overlay] fetch start", {
                    generation: currentGeneration,
                    elapsedMs: elapsedMs(),
                    zoneKey,
                });
                const trainLinesData = await fetchTrainLines();
                if (overlayGenerationRef.current !== currentGeneration) return;
                console.log("[train-overlay] fetch complete", {
                    generation: currentGeneration,
                    elapsedMs: elapsedMs(),
                    durationMs: Math.round(performance.now() - fetchStartedAt),
                    lineFeatures: trainLinesData.lineFeatures.length,
                    stationFeatures: trainLinesData.stationFeatures.length,
                });
                rawTrainLinesRef.current = trainLinesData;
                setTrimmedLineFeatures(null);
                setRawDataVersion((prev) => prev + 1);
            } catch (error) {
                if (overlayGenerationRef.current !== currentGeneration) return;
                toast.error(`Failed to load train lines: ${error}`);
            }
        }, 250);

        return () => clearTimeout(timer);
    }, [$showTrainLineOverlay, map, zoneKey]);

    useEffect(() => {
        if (!map || !$showTrainLineOverlay) return;
        const rawTrainLines = rawTrainLinesRef.current;
        if (!rawTrainLines) return;
        const currentGeneration = overlayGenerationRef.current;
        const trimSeq = ++trimComputationSeqRef.current;
        void trimInWorker({
            lineFeatures: rawTrainLines.lineFeatures,
            stationFeatures: rawTrainLines.stationFeatures,
            playableArea,
            trimOptions: trimWorkerOptions,
        })
            .then((features) => {
                if (overlayGenerationRef.current !== currentGeneration) return;
                if (trimComputationSeqRef.current !== trimSeq) return;
                console.log("[train-overlay] trim accepted", {
                    generation: currentGeneration,
                    trimSeq,
                    elapsedMs: elapsedMs(),
                    outputFeatures: features.length,
                });
                setTrimmedLineFeatures(features);
            })
            .catch((error) => {
                if (overlayGenerationRef.current !== currentGeneration) return;
                if (trimComputationSeqRef.current !== trimSeq) return;
                console.warn("Train overlay worker fallback to raw lines", error);
                console.warn("[train-overlay] fallback timing", {
                    generation: currentGeneration,
                    trimSeq,
                    elapsedMs: elapsedMs(),
                });
                setTrimmedLineFeatures(rawTrainLines.lineFeatures);
            });
    }, [rawDataVersion, playableArea, map, $showTrainLineOverlay, trimWorkerOptions]);

    useEffect(() => {
        if (!map || !$showTrainLineOverlay || !trimmedLineFeatures) return;
        console.log("[train-overlay] render overlay", {
            elapsedMs: elapsedMs(),
            features: trimmedLineFeatures.length,
        });
        renderTrainLineOverlay(trimmedLineFeatures);
    }, [trimmedLineFeatures, map, $showTrainLineOverlay]);

    useEffect(() => {
        if (!map) return;
        return () => removeTrainLineLayers(map);
    }, [map]);

    return null;
};
