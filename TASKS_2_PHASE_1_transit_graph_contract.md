# TASKS_2 PHASE 1: Transit Graph Contract

## Source Bugs And Design Direction

This phase is part of the same-transit-line redesign motivated by:

- [BUG_2_zero_matched_stations_on_mismatched_operator.md](BUG_2_zero_matched_stations_on_mismatched_operator.md)
- [BUG_1_train_line_dropdown_no_operator_filter.md](BUG_1_train_line_dropdown_no_operator_filter.md)
- [TASKS_1_train_line_dropdown_no_operator_filter.md](TASKS_1_train_line_dropdown_no_operator_filter.md)

Design decision: same-transit-line questions should be answered from the transit stops and line membership discovered while configuring hiding zones, not from fresh per-question Overpass calls. If hiding-zone transit stops are not configured, the same-transit-line question does not work.

This phase defines the pure data contract and resolver behavior. It should not wire UI or Overpass yet.

## Goal

Create a canonical in-memory "transit graph" model for:

- playable stations discovered by hiding-zone setup;
- valid transit lines connected to those stations;
- station-to-line membership for auto-detect;
- line-to-station membership for preview and ZoneSidebar filtering.

The result should let later phases replace card-local train-line queries with deterministic graph lookups.

## Proposed Public Types

Create these types in a shared location such as `src/maps/transitGraph.ts` or `src/maps/geo-utils/transitGraph.ts`.

```ts
export interface TransitGraphStation {
    id: string;
    label: string;
    coordinates: [number, number]; // GeoJSON [lng, lat]
    operator?: string;
    network?: string;
}

export interface TransitGraphLine {
    id: string; // relation/<id> or way/<id> if needed
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
```

Use records rather than `Map` so the data is easy to inspect in tests and React state. This graph is derived/cache data and should not be added to the wire format.

## Required Pure Helpers

Implement pure helpers with no React, Nanostores, Overpass, or DOM dependency:

- `emptyTransitGraph(): TransitGraph`
- `hasTransitGraph(graph: TransitGraph | null | undefined): boolean`
- `getLinesForStation(graph, stationId): TransitGraphLine[]`
- `resolveTransitLine(graph, lineId): TransitLineResolution`
- `resolveAutoTransitLine(graph, stationId): TransitLineResolution`
- `filterStationIdsByTransitLine(graph, lineId, same): Set<string>`

Sorting and determinism:

- Station labels should be sorted by locale-aware natural order.
- Line options should be sorted by label, with stable ID tiebreaking.
- Auto-detect should pick the first sorted line for the nearest configured station. Later phases may improve ranking, but this phase must be deterministic.

## TDD Plan

### Red

Add focused unit tests before implementation. Suggested file:

```text
src/maps/transitGraph.test.ts
```

Test cases:

- Empty graph reports `missing-graph`.
- Station with two lines returns sorted line options.
- Existing line resolves station IDs and labels in deterministic order.
- Missing station returns `missing-station` for auto-detect.
- Missing selected line returns `missing-line`.
- Line with no station membership returns `empty-line`.
- `filterStationIdsByTransitLine(..., true)` returns only line members.
- `filterStationIdsByTransitLine(..., false)` returns all graph station IDs except line members.

### Green

Implement only enough pure graph logic to pass the tests.

### Refactor

Keep helper names explicit and small. Do not add Overpass parsing in this phase. Do not touch React components.

## Acceptance Criteria

- Pure unit tests pass without browser APIs.
- The graph contract is explicit enough for later phases to build, read, and filter same-transit-line data without choosing new data shapes.
- No production UI behavior changes in this phase unless imports require harmless re-exports.

## Out Of Scope

- Building graph data from Overpass.
- Storing graph data in Nanostores.
- Updating the matching card.
- Updating ZoneSidebar filtering.
- Editing CAS/wire serialization.
