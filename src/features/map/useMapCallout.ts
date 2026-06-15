import { useCallback, useState } from "react";
import type { OnPressEvent } from "@maplibre/maplibre-react-native";

/**
 * A POI info bubble anchored to a single map coordinate. Question layers
 * raise one of these from a `ShapeSource` press; `MapPoiCallout` renders it.
 */
export type MapCallout = {
    /** [longitude, latitude] anchor for the bubble. */
    coordinate: [number, number];
    /** Stable identity for the tapped feature (osmId when available). */
    id: number | string;
    title: string;
};

/**
 * Owns the single, map-wide POI callout. Any layer's `ShapeSource` `onPress`
 * can feed `showCalloutFromPress`; the callout itself is rendered once by
 * `MapPoiCallout` as an always-mounted overlay (see that component for why it
 * must not be conditionally mounted among MapLibre native children).
 */
export function useMapCallout() {
    const [callout, setCallout] = useState<MapCallout | null>(null);

    const dismissCallout = useCallback(() => setCallout(null), []);

    const showCalloutFromPress = useCallback((event: OnPressEvent) => {
        const next = calloutFromFeaturePress(event);
        if (next) setCallout(next);
    }, []);

    return { callout, dismissCallout, showCalloutFromPress };
}

/**
 * Extract a callout from a `ShapeSource` press event. Returns null when the
 * tapped feature has no name or isn't a point — callers can wire this directly
 * to `onPress` regardless of layer, so it must fail quietly.
 */
function calloutFromFeaturePress(event: OnPressEvent): MapCallout | null {
    const feature = event.features?.[0];
    if (!feature) return null;

    const props = feature.properties as Record<string, unknown> | undefined;
    const title = typeof props?.name === "string" ? props.name : undefined;
    if (!title) return null;

    const geom = feature.geometry as
        | { coordinates?: [number, number]; type?: string }
        | undefined;
    if (geom?.type !== "Point" || !geom.coordinates) return null;
    const [lon, lat] = geom.coordinates;

    const osmId = props?.osmId;
    const id = typeof osmId === "number" ? osmId : `${lon},${lat}`;

    return { coordinate: [lon, lat], id, title };
}
