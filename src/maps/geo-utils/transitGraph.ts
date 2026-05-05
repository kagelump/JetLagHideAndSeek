export interface TransitGraphStation {
    id: string;
    label: string;
    coordinates: [number, number];
    operator?: string;
    network?: string;
}

export interface TransitGraphLine {
    id: string;
    label: string;
    operator?: string;
    network?: string;
}

export interface TransitGraph {
    stationsById: Record<string, TransitGraphStation>;
    linesById: Record<string, TransitGraphLine>;
    stationLineIds: Record<string, string[]>;
    lineStationIds: Record<string, string[]>;
}

export interface TransitLineResolution {
    status:
        | "ok"
        | "missing-graph"
        | "missing-station"
        | "missing-line"
        | "empty-line";
    line?: TransitGraphLine;
    stationIds: string[];
    stationLabels: string[];
}

export function emptyTransitGraph(): TransitGraph {
    return {
        stationsById: {},
        linesById: {},
        stationLineIds: {},
        lineStationIds: {},
    };
}

export function hasTransitGraph(
    graph: TransitGraph | null | undefined,
): boolean {
    if (!graph) return false;
    return Object.keys(graph.stationsById).length > 0;
}

export function getLinesForStation(
    graph: TransitGraph,
    stationId: string,
): TransitGraphLine[] {
    const lineIds = graph.stationLineIds[stationId];
    if (!lineIds || lineIds.length === 0) return [];

    const lines: TransitGraphLine[] = [];
    for (const lid of lineIds) {
        const line = graph.linesById[lid];
        if (line) {
            lines.push(line);
        }
    }

    lines.sort((a, b) => {
        const cmp = a.label.localeCompare(b.label);
        if (cmp !== 0) return cmp;
        return a.id.localeCompare(b.id);
    });

    return lines;
}

export function resolveTransitLine(
    graph: TransitGraph,
    lineId: string,
): TransitLineResolution {
    if (!hasTransitGraph(graph)) {
        return { status: "missing-graph", stationIds: [], stationLabels: [] };
    }

    if (!(lineId in graph.linesById)) {
        return { status: "missing-line", stationIds: [], stationLabels: [] };
    }

    const stationIds = graph.lineStationIds[lineId];
    if (!stationIds || stationIds.length === 0) {
        return {
            status: "empty-line",
            line: graph.linesById[lineId],
            stationIds: [],
            stationLabels: [],
        };
    }

    const pairs = stationIds.map((sid) => {
        const station = graph.stationsById[sid];
        return { id: sid, label: station ? station.label : "" };
    });

    pairs.sort((a, b) => {
        const cmp = a.label.localeCompare(b.label);
        if (cmp !== 0) return cmp;
        return a.id.localeCompare(b.id);
    });

    return {
        status: "ok",
        line: graph.linesById[lineId],
        stationIds: pairs.map((p) => p.id),
        stationLabels: pairs.map((p) => p.label),
    };
}

export function resolveAutoTransitLine(
    graph: TransitGraph,
    stationId: string,
): TransitLineResolution {
    if (!hasTransitGraph(graph)) {
        return { status: "missing-graph", stationIds: [], stationLabels: [] };
    }

    if (!(stationId in graph.stationsById)) {
        return { status: "missing-station", stationIds: [], stationLabels: [] };
    }

    const lines = getLinesForStation(graph, stationId);
    if (lines.length === 0) {
        return { status: "missing-line", stationIds: [], stationLabels: [] };
    }

    return resolveTransitLine(graph, lines[0].id);
}

export function filterStationIdsByTransitLine(
    graph: TransitGraph,
    lineId: string,
    same: boolean,
): Set<string> {
    const memberIds = graph.lineStationIds[lineId] ?? [];
    if (same) {
        return new Set(memberIds);
    }
    const memberSet = new Set(memberIds);
    const allIds = Object.keys(graph.stationsById);
    const filtered = allIds.filter((id) => !memberSet.has(id));
    return new Set(filtered);
}
