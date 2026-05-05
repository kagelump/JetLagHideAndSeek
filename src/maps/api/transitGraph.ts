import type { StationPlace } from "@/maps/api/types";
import {
    getOperatorAndNetwork,
    matchesOperatorSelection,
} from "@/maps/geo-utils/operators-tags";
import { extractStationLabel } from "@/maps/geo-utils/special";
import type {
    TransitGraph,
    TransitGraphLine,
    TransitGraphStation,
} from "@/maps/geo-utils/transitGraph";

import { getOverpassData } from "./overpass";
import { CacheType } from "./types";

export async function buildTransitGraphForStations(
    stations: StationPlace[],
    options: {
        stationNameStrategy: "english-preferred" | "native-preferred";
        operatorFilter: string[];
    },
): Promise<TransitGraph> {
    if (stations.length === 0) {
        return {
            stationsById: {},
            linesById: {},
            stationLineIds: {},
            lineStationIds: {},
        };
    }

    const stationsById: Record<string, TransitGraphStation> = {};
    const stationLineIds: Record<string, string[]> = {};
    const stationNodeIds: number[] = [];

    for (const place of stations) {
        const id = String(place.properties.id);
        const label = extractStationLabel(place, options.stationNameStrategy);
        const coordinates = place.geometry.coordinates as [number, number];
        const { operator, network } = getOperatorAndNetwork(place.properties);

        stationsById[id] = { id, label, coordinates, operator, network };
        stationLineIds[id] = [];

        const match = /^node\/(\d+)$/.exec(id);
        if (match) {
            stationNodeIds.push(Number(match[1]));
        }
    }

    if (stationNodeIds.length === 0) {
        return {
            stationsById,
            linesById: {},
            stationLineIds,
            lineStationIds: {},
        };
    }

    const query = `[out:json];
node(id:${stationNodeIds.join(",")});
rel(bn)[route~"^(train|subway|light_rail|tram|railway|monorail)$"];
out body;`;

    let data: any;
    try {
        data = await getOverpassData(
            query,
            "Building transit graph...",
            CacheType.ZONE_CACHE,
        );
    } catch {
        return {
            stationsById,
            linesById: {},
            stationLineIds,
            lineStationIds: {},
        };
    }

    const elements: any[] = data?.elements ?? [];
    const routeValues = new Set([
        "train",
        "subway",
        "light_rail",
        "tram",
        "railway",
        "monorail",
    ]);

    const linesById: Record<string, TransitGraphLine> = {};
    const lineStationIds: Record<string, string[]> = {};

    for (const element of elements) {
        if (element.type !== "relation") continue;

        const route = element.tags?.route;
        if (typeof route !== "string" || !routeValues.has(route)) continue;

        if (
            options.operatorFilter.length > 0 &&
            !matchesOperatorSelection(element.tags, options.operatorFilter)
        ) {
            continue;
        }

        const lineId = `relation/${element.id}`;
        const tags = element.tags ?? {};

        const rawLabel = [tags["name:en"], tags.name, tags.ref].find(
            (v: unknown): v is string =>
                typeof v === "string" && v.trim().length > 0,
        );
        let label = rawLabel?.trim();
        if (label) {
            label = label
                .replace(/\s*\([^)]*(?:-->|\u2192)\s*[^)]*\)\s*/g, "")
                .trim();
        }
        if (!label) label = lineId;

        const { operator, network } = getOperatorAndNetwork(tags);

        linesById[lineId] = { id: lineId, label, operator, network };

        const memberNodeIds = new Set<number>(
            (element.members ?? [])
                .filter((m: any) => m.type === "node" && Number.isFinite(m.ref))
                .map((m: any) => m.ref as number),
        );

        const memberStationIds: string[] = [];
        for (const nodeId of stationNodeIds) {
            if (memberNodeIds.has(nodeId)) {
                memberStationIds.push(`node/${nodeId}`);
            }
        }

        lineStationIds[lineId] = memberStationIds;

        for (const sid of memberStationIds) {
            stationLineIds[sid].push(lineId);
        }
    }

    for (const lineId of Object.keys(lineStationIds)) {
        if (lineStationIds[lineId].length === 0) {
            delete linesById[lineId];
            delete lineStationIds[lineId];
        }
    }

    return { stationsById, linesById, stationLineIds, lineStationIds };
}
