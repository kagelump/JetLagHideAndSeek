import type { MultiLineString } from "geojson";

export type TransitSource =
    | { kind: "gtfs"; namespace: string }
    | { kind: "osm"; namespace: "openstreetmap" }
    | { kind: "osm-pack"; namespace: string };

export type TransitRoute = {
    color: string;
    geometry: MultiLineString;
    id: string;
    name: string;
    /** Best English / romanized name (from OSM name:en tag on route relations). */
    nameEn?: string;
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
    /** Normalized operator name (from OSM tags or GTFS feed). */
    operator?: string;
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
    // osm-pack and osm both get priority 1 (GTFS wins over OSM data)
}
