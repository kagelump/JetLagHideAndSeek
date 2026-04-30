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
import { fetchTrainLines, trimTrainLinesToPlayableArea } from "@/maps/api";

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
    const map = useStore(leafletMapContext);
    const $showTrainLineOverlay = useStore(showTrainLineOverlay);
    const $polyGeoJSON = useStore(polyGeoJSON);
    const $mapGeoLocation = useStore(mapGeoLocation);
    const $additionalMapGeoLocations = useStore(additionalMapGeoLocations);
    const $mapGeoJSON = useStore(mapGeoJSON);
    const overlayGenerationRef = useRef(0);
    const rawTrainLinesRef = useRef<{
        lineFeatures: Array<Feature<LineString | MultiLineString>>;
        stationFeatures: Array<Feature<Point>>;
    } | null>(null);
    const [rawDataVersion, setRawDataVersion] = useState(0);

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

    const renderTrainLineOverlay = (
        rawLineFeatures: Array<Feature<LineString | MultiLineString>>,
        stationFeatures: Array<Feature<Point>>,
        area: Feature<Polygon | MultiPolygon> | null,
    ) => {
        if (!map || !$showTrainLineOverlay) return;
        removeTrainLineLayers(map);
        const features = trimTrainLinesToPlayableArea(
            rawLineFeatures,
            stationFeatures,
            area,
        );
        const railGeoJSON: FeatureCollection<LineString> = {
            type: "FeatureCollection",
            features: features as Array<Feature<LineString>>,
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
                const trainLinesData = await fetchTrainLines();
                if (overlayGenerationRef.current !== currentGeneration) return;
                rawTrainLinesRef.current = trainLinesData;
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
        renderTrainLineOverlay(
            rawTrainLines.lineFeatures,
            rawTrainLines.stationFeatures,
            playableArea,
        );
    }, [rawDataVersion, playableArea, map, $showTrainLineOverlay]);

    useEffect(() => {
        if (!map) return;
        return () => removeTrainLineLayers(map);
    }, [map]);

    return null;
};
