/**
 * Out-of-the-box play-area suggestions derived from the device's current
 * location.
 *
 * When the player opens Play Area for the first time there are no relevant
 * presets (the bundled Tokyo placeholder is filtered out everywhere but Japan),
 * so the most useful thing we can offer is "here are the administrative areas
 * you're standing in". For someone in Portland that surfaces Portland (city),
 * Multnomah County, and Oregon (state) as one-tap play-area options.
 *
 * Implementation: Overpass `is_in(lat,lon)` returns every area enclosing the
 * point. We keep the administrative ones, convert their area ids back to OSM
 * relation ids (the units the play-area loader understands), and present them
 * most-specific-first with the broader enclosing names as context.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { NETWORK } from "@/config/appConfig";
import type { Position } from "@/shared/geojson";
import {
    hasLocationPermission,
    requestUserCoordinate,
} from "@/shared/location";
import { createLogger } from "@/shared/logger";

const log = createLogger("playAreaNearby");

const OVERPASS_API = "https://overpass-api.de/api/interpreter";

/**
 * Overpass encodes relation-derived areas as `3600000000 + relationId`
 * (way-derived areas use a `2400000000` offset). We only want relations, since
 * the play-area loader resolves OSM relation ids.
 */
const AREA_RELATION_OFFSET = 3_600_000_000;

/** Admin levels worth offering as a play area: state/region down to city. */
const MIN_SELECTABLE_ADMIN_LEVEL = 4;
const MAX_SELECTABLE_ADMIN_LEVEL = 9;

/** Cap how many suggestions and context entries we surface. */
const MAX_SUGGESTIONS = 4;
const MAX_CONTEXT_ENTRIES = 3;

export type LocationPlayAreaSuggestion = {
    /** OSM relation id — apply directly via the play-area loader. */
    osmId: number;
    /** Display name (prefers `name:en`, then `name`). */
    label: string;
    /** OSM administrative level (lower = broader). */
    adminLevel: number;
    /** Broader enclosing area names, specific-first (e.g. "Oregon, USA"). */
    context: string;
};

type OverpassAreaElement = {
    id?: number;
    tags?: Record<string, string>;
    type?: string;
};

type OverpassAreaResponse = {
    elements?: OverpassAreaElement[];
};

type EnclosingArea = {
    osmId: number;
    label: string;
    adminLevel: number;
};

/**
 * Parses Overpass `is_in` area elements into enclosing administrative areas,
 * relation-only, sorted most-specific-first (highest admin_level first).
 * Exported for unit testing.
 */
export function parseEnclosingAreas(
    elements: OverpassAreaElement[],
): EnclosingArea[] {
    const byOsmId = new Map<number, EnclosingArea>();

    for (const element of elements) {
        if (element.type !== "area" || typeof element.id !== "number") continue;
        if (element.id < AREA_RELATION_OFFSET) continue; // way-derived area

        const tags = element.tags ?? {};
        const adminLevel = Number.parseInt(tags.admin_level ?? "", 10);
        if (!Number.isFinite(adminLevel)) continue;

        const label = tags["name:en"]?.trim() || tags.name?.trim();
        if (!label) continue;

        const osmId = element.id - AREA_RELATION_OFFSET;
        // Keep the first occurrence; dedupe defensively.
        if (!byOsmId.has(osmId)) {
            byOsmId.set(osmId, { osmId, label, adminLevel });
        }
    }

    return [...byOsmId.values()].sort((a, b) => b.adminLevel - a.adminLevel);
}

/**
 * Builds the player-facing suggestion list from enclosing areas: keeps
 * play-area-sized levels and attaches the broader enclosing names as context.
 * Exported for unit testing.
 */
export function buildLocationSuggestions(
    enclosing: EnclosingArea[],
): LocationPlayAreaSuggestion[] {
    const sorted = [...enclosing].sort((a, b) => b.adminLevel - a.adminLevel);

    const suggestions: LocationPlayAreaSuggestion[] = [];
    for (const area of sorted) {
        if (
            area.adminLevel < MIN_SELECTABLE_ADMIN_LEVEL ||
            area.adminLevel > MAX_SELECTABLE_ADMIN_LEVEL
        ) {
            continue;
        }

        // Context = broader enclosing areas (lower admin_level), specific-first.
        const context = sorted
            .filter((other) => other.adminLevel < area.adminLevel)
            .slice(0, MAX_CONTEXT_ENTRIES)
            .map((other) => other.label)
            .join(", ");

        suggestions.push({
            osmId: area.osmId,
            label: area.label,
            adminLevel: area.adminLevel,
            context,
        });

        if (suggestions.length >= MAX_SUGGESTIONS) break;
    }

    return suggestions;
}

/**
 * Fetches the administrative areas enclosing a coordinate from Overpass and
 * maps them to play-area suggestions.
 */
export async function fetchEnclosingPlayAreas(
    coordinate: Position,
    signal?: AbortSignal,
): Promise<LocationPlayAreaSuggestion[]> {
    const [lon, lat] = coordinate;
    const query =
        `[out:json][timeout:25];` +
        `is_in(${lat},${lon})->.a;` +
        `area.a["boundary"="administrative"]["admin_level"];` +
        `out tags;`;

    const response = await fetch(
        `${OVERPASS_API}?data=${encodeURIComponent(query)}`,
        { signal, headers: NETWORK.overpassHeaders },
    );
    if (!response.ok) {
        throw new Error(`Overpass is_in error ${response.status}`);
    }

    const data = (await response.json()) as OverpassAreaResponse;
    return buildLocationSuggestions(parseEnclosingAreas(data.elements ?? []));
}

export type NearbyPlayAreasStatus =
    | "idle"
    | "locating"
    | "ready"
    | "denied"
    | "unavailable";

/**
 * Rounds a coordinate so the react-query cache key (and Overpass request) is
 * stable across tiny GPS jitter — ~100 m is plenty for admin-area resolution.
 */
function coordinateKey(coordinate: Position): string {
    return `${coordinate[0].toFixed(3)},${coordinate[1].toFixed(3)}`;
}

/**
 * Drives the "Near you" play-area section: resolves the device coordinate
 * (auto when permission is already granted, otherwise behind an explicit
 * opt-in via `requestLocation`) and loads enclosing administrative areas.
 */
export function useNearbyPlayAreas() {
    const [coordinate, setCoordinate] = useState<Position | null>(null);
    const [status, setStatus] = useState<NearbyPlayAreasStatus>("idle");
    const locatingRef = useRef(false);

    const locate = useCallback(async () => {
        if (locatingRef.current) return;
        locatingRef.current = true;
        setStatus("locating");
        try {
            const result = await requestUserCoordinate();
            if (result.status === "granted" && result.coordinate) {
                setCoordinate(result.coordinate);
                setStatus("ready");
            } else if (result.status === "denied") {
                setStatus("denied");
            } else {
                setStatus("unavailable");
            }
        } finally {
            locatingRef.current = false;
        }
    }, []);

    // Auto-load when permission is already granted — never prompt on mount.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const granted = await hasLocationPermission();
            if (!cancelled && granted) void locate();
        })();
        return () => {
            cancelled = true;
        };
    }, [locate]);

    const query = useQuery({
        queryKey: [
            "nearby-play-areas",
            coordinate ? coordinateKey(coordinate) : null,
        ],
        queryFn: async ({ signal }) => {
            try {
                return await fetchEnclosingPlayAreas(coordinate!, signal);
            } catch (err) {
                log.warn("enclosing-area lookup failed", err);
                throw err;
            }
        },
        enabled: coordinate !== null,
        staleTime: 60 * 60 * 1000, // admin areas are stable within a session
    });

    return {
        status,
        requestLocation: locate,
        suggestions: query.data ?? [],
        isLoading:
            status === "locating" ||
            (coordinate !== null && query.isFetching && !query.data),
        isError: query.isError,
    };
}
