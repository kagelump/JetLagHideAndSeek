import type { MultiLineString } from "geojson";

export type TransitSource =
    | { kind: "gtfs"; namespace: string }
    | { kind: "osm"; namespace: "openstreetmap" };

export type TransitRoute = {
    color: string;
    geometry: MultiLineString;
    id: string;
    name: string;
    sourceId: string;
};

export type TransitStationContribution = {
    id: string;
    lat: number;
    lon: number;
    mergeKey: string;
    name: string;
    /** Best English / romanized name across sources. */
    nameEn?: string;
    routeIds: string[];
    sourceId: string;
};

export type TransitStation = {
    id: string;
    lat: number;
    lon: number;
    name: string;
    /** Best English / romanized name across sources. */
    nameEn?: string;
    routeColors?: string[];
    routeIds: string[];
    sourceStationIds?: string[];
};

/**
 * Priority for source-kind merge: lower = wins.  GTFS has richer data
 * (lines, colors); OSM is the fallback.
 */
export function sourcePriority(source: TransitSource): number {
    return source.kind === "gtfs" ? 0 : 1;
}
