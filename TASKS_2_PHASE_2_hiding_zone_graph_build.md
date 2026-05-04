# TASKS_2 PHASE 2: Build Transit Graph During Hiding-Zone Discovery

## Source Bugs And Design Direction

This phase depends on [TASKS_2_PHASE_1_transit_graph_contract.md](TASKS_2_PHASE_1_transit_graph_contract.md).

It addresses the core architectural issue from [BUG_2_zero_matched_stations_on_mismatched_operator.md](BUG_2_zero_matched_stations_on_mismatched_operator.md): same-transit-line logic currently asks fresh raw Overpass questions that do not share the hiding-zone station scope. This phase makes hiding-zone initialization produce the canonical transit graph used by later phases.

## Goal

When default Overpass-based hiding-zone transit stops are configured, build and cache a `TransitGraph` from the same configured station universe.

The graph must only include stations that survive the existing hiding-zone filters:

- play area / custom polygon;
- station type options such as `[railway=station]` and `[railway=stop]`;
- operator/network filter;
- additional locations / subtracted locations;
- disabled/default/custom station settings where applicable.

## Store Design

Add a new atom near `trainStations` in `src/lib/context.ts`:

```ts
export const transitGraph = atom<TransitGraph | null>(null);
```

Behavior:

- Set `transitGraph` after station discovery completes.
- Set `transitGraph` to `null` when no default Overpass station discovery is active.
- Do not persist this atom to localStorage.
- Do not add it to CAS/wire snapshots.
- Derived graph data is allowed to rely on Cache API through existing `CacheType.ZONE_CACHE`.

## Overpass/Data Design

Add graph-building APIs in a focused module, for example `src/maps/api/transitGraph.ts`.

Recommended API:

```ts
export async function buildTransitGraphForStations(
    stations: StationPlace[],
    options: {
        stationNameStrategy: "english-preferred" | "native-preferred";
        operatorFilter: string[];
    },
): Promise<TransitGraph>;
```

Implementation approach:

- Convert the final filtered `StationPlace[]` into `TransitGraphStation` records.
- Query Overpass for route relations connected to those station node IDs.
- Use route values consistent with existing rail/transit support: train, subway, light_rail, tram, railway, monorail.
- Include relation tags with `out tags` and enough relation/member data to determine which configured stations belong to each relation.
- Post-filter relations with existing operator/network semantics when `operatorFilter` is non-empty.
- Keep only lines with at least one configured/playable station member.
- Do not include raw nearby track ways unless they have reliable configured station membership. Relation membership is the preferred v1 source.

If direct relation membership misses stations because OSM uses stop areas or stop positions:

- Add a conservative expansion inside the graph builder that maps stop positions or stop areas back to configured station IDs only when the relation data clearly references them.
- Do not fall back to geographic radius matching in v1; that risks reintroducing out-of-scope lines.

## ZoneSidebar Integration

In `src/components/ZoneSidebar.tsx`:

- Build graph after `places` has been fetched, operator-filtered, custom-merged if applicable, and clipped to playable station circles.
- Use the final stations that become `$trainStations` as graph stations.
- If `useCustomStations && !includeDefaultStations`, set `transitGraph` to `null`.
- If graph building fails, set `transitGraph` to `null`, toast a warning, and keep station discovery usable.

Important ordering:

- Build graph before applying same-transit-line question filters to `circles`.
- Later phases will use the graph to apply those filters.

## TDD Plan

### Red

Add tests for graph building. Suggested test files:

- `src/maps/api/transitGraph.test.ts`
- optional fixture under `tests/fixtures/` or inline Overpass element arrays.

Test cases:

- Builds graph stations from final `StationPlace[]`.
- Builds lines from route relations and only includes configured station IDs.
- Excludes route relations with zero configured station membership.
- Applies operator/network filtering to line records.
- Handles duplicate relation/station members deterministically.
- Returns an empty graph rather than throwing for empty station input.

Use fetch mocking or pure element-to-graph helpers so tests do not hit live Overpass.

### Green

Implement graph building with the smallest Overpass surface needed for tests.

### Refactor

Separate pure parsing from network fetching:

- Pure: Overpass elements + stations -> `TransitGraph`.
- Network: build query, call `getOverpassData`, pass elements to parser.

This keeps future OSM data edge cases testable without browser E2E.

## Acceptance Criteria

- Hiding-zone initialization populates `transitGraph` when default stations are configured.
- `transitGraph` is null for custom-only stations or missing station configuration.
- Graph data is derived from the same stations that populate `$trainStations`.
- Existing hiding-zone station discovery behavior remains intact if graph building fails.
- No same-transit-line UI rewiring yet; later phases consume the graph.

## Out Of Scope

- Updating the train-line dropdown.
- Updating station preview.
- Updating ZoneSidebar same-train-line filtering.
- Supporting custom station line membership.
- Persisting graph data in CAS/wire.
