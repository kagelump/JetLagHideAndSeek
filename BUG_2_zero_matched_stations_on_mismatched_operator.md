# BUG_2: Selecting non-matching-operator train line → 0 matched stations, broken UI

## Summary

When a transit pass with operator filtering is active (e.g., Tokyo Metro Daypass), selecting **any** train line from the dropdown whose stations don't overlap with the operator-filtered local station set results in:

1. **0 matched stations** in the station preview
2. The train line selector showing an empty/invalid state
3. **"Closest POI: Unavailable"** replacing the previously-working closest station display

## Severity

High — this renders the "Station On Same Train Line" question type unusable when a transit pass is active and the user selects a non-matching train line (which is the most likely scenario given Bug 1 where all lines appear in the dropdown).

## How to reproduce

1. Load the app with Tokyo Metro Daypass active (e.g., `?sid=nyYGTsaO62VnN79AluBrjg`)
2. Unlock a "Station On Same Train Line" matching question
3. Note: closest station shows "高田馬場" (Takadanobaba) correctly
4. Click the train line dropdown and select "JR Yamanote Line (Inner)"

**Expected:** The station preview shows Yamanote Line stations (or at minimum, stations that exist in both the Tokyo Metro and JR Yamanote sets, such as 高田馬場 which is served by both the Tokyo Metro Tōzai Line and JR Yamanote Line).

**Actual:**

- "Stations matched: 0" with "No stations found for this line"
- Train line selector shows no current value (the selected value "JR Yamanote Line (Inner)" is not displayed in the closed trigger)
- "Closest POI: Unavailable" (was "Closest station: 高田馬場" before selection)
- Console error: `Uncaught Error: Must have at least 2 geometries` (Turf.js)

## Root cause

### Primary: Operator-filtered station set mismatch

There are two independent station data sets that become incompatible when operators don't align:

**Set A — Local stations (`$trainStations` / `stationPoints`):**

- Populated by ZoneSidebar (`ZoneSidebar.tsx:274-419`)
- Queries Overpass for stations in the play area, then **filters by operator** at line 357-368 against `$displayHidingZoneOperators` (Tokyo Metro operators)
- Result: 455 stations that are ONLY served by Tokyo Metro operators
- Stored in the `$trainStations` atom (`context.ts:280`)

**Set B — Train line stations (from `findNodesOnTrainLine` / `findStationLabelsOnTrainLine`):**

- Queries Overpass for all station nodes/labels on a specific OSM train line relation/way
- No operator filtering applied
- `findNodesOnTrainLine("relation/1972960")` returns node IDs for JR Yamanote stations → **JR East stations, not Tokyo Metro**

**The matching gap:**

```
matching.tsx:259-271
stationLabelByNodeId = Map built from Set A (Tokyo Metro station node IDs)

matching.tsx:287
nodes = findNodesOnTrainLine("relation/1972960")  // from Set B (JR Yamanote node IDs)

matching.tsx:312-325
matchedLabels = nodes.flatMap(nodeId => stationLabelByNodeId.get(nodeId))
               → ALL undefined (no intersection between JR and Tokyo Metro node IDs)
               → result: []
```

Even shared stations like 高田馬場 (Takadanobaba) — which is physically served by both Tokyo Metro Tōzai Line and JR Yamanote Line — have **different OSM node IDs**: the Tokyo Metro 高田馬場 station has one OSM node (node/1894258044), while the JR Yamanote 高田馬場 station has a different OSM node. OSM typically models separate station nodes for different operators/entrances even at the same location. So the ID-based lookup fails entirely.

### Secondary: "Closest POI: Unavailable"

`resolveMatchingNearestPoi()` at `nearestPoi.ts:241-309` is called by the card's useEffect (line 167). For `same-train-line`, it resolves to:

```
nearestPoi.ts:294-299
} else if (stationPoints.length > 0) {
    const nearest = turf.nearestPoint(
        turf.point([question.lng, question.lat]),
        turf.featureCollection(stationPoints as NamedPoint[]),
    );
    name = extractStationLabel(nearest, strategy);
}
```

Since `stationPoints` (Set A) still has 455 Tokyo Metro stations, this call normally succeeds. However, the Turf error `Must have at least 2 geometries` suggests that somewhere a `turf.nearestPoint` or `turf.featureCollection` call receives fewer than 2 features. Possible sources:

1. The ZoneSidebar's `initializeHidingZones` re-runs when the question's `selectedTrainLineId` changes (detected via atom subscription), and its same-train-line filtering logic (ZoneSidebar.tsx:455-503) may reduce `circles` to fewer than 2 stations, causing subsequent `turf.nearestPoint` calls within ZoneSidebar to throw.
2. A race condition where `$trainStations` is temporarily empty during re-initialization, causing `stationPoints` to become `[]` in the card's useEffect.

When `resolveMatchingNearestPoi` catches the Turf error, it returns `{status: "error"}`. The `NearestPoiRow` component (`NearestPoiInfo.tsx:34`) checks `"category" in nearestPoi` — since `{status:"error"}` has no `category` field, it falls back to displaying the hardcoded string `"POI"`:

```tsx
Closest {"category" in nearestPoi ? nearestPoi.category : "POI"}:
```

Result: "Closest POI: Unavailable" instead of "Closest station: Unavailable".

### Tertiary: Train line selector shows no value

The train line `Select` component (`matching.tsx:406-432`) uses `data.selectedTrainLineLabel ?? "Train line"` as the trigger text and `data.selectedTrainLineId ?? AUTO_TRAIN_LINE` as the value. After selection, `selectedTrainLineLabel` is set to "JR Yamanote Line (Inner)" and `selectedTrainLineId` is set to `"relation/1972960"`. But the `lineOptions` map that the Select references for rendering may have changed due to the 429 Overpass errors or the effect cleanup, leaving the selected value orphaned from the available options.

## Detailed flow

```
1. User selects "JR Yamanote Line (Inner)" from dropdown
2. matching.tsx:418-427 — onValueChange sets selectedTrainLineId/selectedTrainLineLabel, calls questionModified()
3. nearestPoiKey changes (includes stationPoints serialization)
4. matching.tsx:157-176 — nearestPoi useEffect fires
   → resolveMatchingNearestPoi(data, stationPoints) called
   → stationPoints has 455 Tokyo Metro stations → normally succeeds
   → BUT ZoneSidebar re-initialization may have temporarily emptied $trainStations
   → OR Turf error from ZoneSidebar crosses over to the card indirectly
5. matching.tsx:254-359 — station preview useEffect fires
   → stationLabelByNodeId built from Tokyo Metro stationPoints (Set A)
   → findNodesOnTrainLine("relation/1972960") queries Overpass → JR station nodes (Set B)
   → findStationLabelsOnTrainLine("relation/1972960") queries Overpass → JR station labels
   → lineLabels may be non-empty (station names from Overpass) but don't match Set A labels
   → nodes.flatMap(nodeId → stationLabelByNodeId.get(nodeId)) → all undefined
   → matchedLabels = [] → "Stations matched: 0"
6. ZoneSidebar:355-364 — operator filter re-applies, keeping 455 stations
7. ZoneSidebar:455-503 — same-train-line filter tries findNodesOnTrainLine or trainLineNodeFinder
   → May fail or reduce circles to 0 → subsequent turf.nearestPoint throws
   → "Must have at least 2 geometries"
8. Card UI shows: stations matched 0, closest POI unavailable
```

## Relevant source locations

| File                                      | Lines   | Role                                                                         |
| ----------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `src/components/cards/matching.tsx`       | 189-252 | Train line dropdown options useEffect                                        |
| `src/components/cards/matching.tsx`       | 254-359 | Station preview useEffect — where the ID mismatch occurs                     |
| `src/components/cards/matching.tsx`       | 259-271 | `stationLabelByNodeId` built from `$trainStations` (operator-filtered Set A) |
| `src/components/cards/matching.tsx`       | 286-293 | `findNodesOnTrainLine` / `findStationLabelsOnTrainLine` called (Set B)       |
| `src/components/cards/matching.tsx`       | 308-331 | Promise.all → node ID matching → 0 results                                   |
| `src/components/cards/matching.tsx`       | 157-176 | nearestPoi useEffect — calls `resolveMatchingNearestPoi`                     |
| `src/maps/api/overpass.ts`                | 556-570 | `findNodesOnTrainLine` — returns node IDs for any line                       |
| `src/maps/api/overpass.ts`                | 572-587 | `findStationLabelsOnTrainLine` — returns labels for any line                 |
| `src/maps/api/overpass.ts`                | 379-409 | `extractTrainLineNodeIds` — extracts node IDs from Overpass response         |
| `src/maps/api/overpass.ts`                | 530-554 | `exactTrainLineQuery` — builds Overpass geometry query for a line            |
| `src/lib/nearestPoi.ts`                   | 241-309 | `resolveMatchingNearestPoi` — try/catch returns `{status:"error"}`           |
| `src/lib/nearestPoi.ts`                   | 294-299 | `turf.nearestPoint` on `stationPoints` — can fail if points < 2              |
| `src/components/cards/NearestPoiInfo.tsx` | 34      | Falls back to "POI" when no `category` in result                             |
| `src/components/ZoneSidebar.tsx`          | 357-368 | Operator filter on hide zone stations                                        |
| `src/components/ZoneSidebar.tsx`          | 455-503 | Same-train-line filter in ZoneSidebar → may reduce circles to < 2            |
| `src/components/ZoneSidebar.tsx`          | 448-453 | `turf.nearestPoint` on circles — can throw with < 2 geometries               |
| `src/lib/context.ts`                      | 280-289 | `$trainStations` atom — operator-filtered station circles                    |

## Suggested fix

The core issue is that the node ID matching in the card's useEffect implicitly assumes the two data sets (local operator-filtered stations and Overpass train line stations) share node IDs. This is architecturally flawed when operators don't overlap.

Options:

1. **(Preferred) Make station discovery query include the selected line's stations**: When `selectedTrainLineId` is set, the `findStationLabelsOnTrainLine` result should be used directly as the matched stations, rather than trying to cross-reference node IDs against the operator-filtered local set. The labels returned by `findStationLabelsOnTrainLine` already come from OSM station tags and can be displayed directly. Node IDs from `findNodesOnTrainLine` could then be used to filter the hiding zone circles (as ZoneSidebar already attempts).

2. **Use names instead of node IDs for matching**: After `findNodesOnTrainLine` returns node IDs, query Overpass for the names of those nodes and match by name against `stationLabelByNodeId` values (instead of node IDs). This handles the case where the same station has different node IDs across operators.

3. **Fix the dropdown first (Bug 1)**: If Bug 1 is fixed (only matching-operator lines appear), users won't be able to select incompatible lines. However, this is a partial fix — the underlying issue of node ID mismatch between operator-filtered stations and OSM train line data could still occur for lines that partially overlap operators.

## DevTools diagnostics

### Page state transitions (before → after selecting JR Yamanote Inner)

| Field                  | Before (auto-detect)                           | After (JR Yamanote Inner)               |
| ---------------------- | ---------------------------------------------- | --------------------------------------- |
| Train line combobox    | `(auto-detect from nearest station)`           | _(no value displayed in trigger)_       |
| Stations matched count | `7`                                            | `0`                                     |
| Station preview        | 浦和, 栃木, 池袋, 大宮, 新宿, 下今市, 東武日光 | `No stations found for this line`       |
| Closest category       | `station`                                      | `POI` (fallback, no category in result) |
| Closest name           | `高田馬場`                                     | `Unavailable`                           |
| Result radios          | `Same` checked, disabled                       | `Same` checked, enabled                 |

### Network requests captured

**Overpass 429 rate limiting (2 requests):**

```
GET overpass-api.de/interpreter?data=[out:json];(rel(around:300,35.7079175,139.7090644)...;way(around:100,...)...);out tags;
→ 429 Too Many Requests
GET overpass-api.de/interpreter?data=[out:json];(rel(around:300,35.7133447,139.7050055)...;way(around:100,...)...);out tags;
→ 429 Too Many Requests
```

These are the initial dropdown population queries for Takadanobaba and the question pin's nearest stations. Both recovered via fallback to `overpass.private.coffee` (200 OK).

**JR Yamanote Line (Inner) station query (1 request):**

```
GET overpass-api.de/interpreter?data=
[out:json];
relation(1972960)->.line;
way(r.line)->.lineWays;
node(w.lineWays)->.lineWayNodes;
node(r.line)->.lineRelationNodes;
rel(bn.lineRelationNodes)["public_transport"="stop_area"]->.stopAreas;
node(r.stopAreas)["railway"="station"]->.stopAreaStations;
(.line; .lineWays; .lineWayNodes; .lineRelationNodes; .stopAreas; .stopAreaStations;);
out geom;
→ 200 OK
```

This is the `exactTrainLineQuery` for the selected line. Returns all JR Yamanote Line geometry and station nodes — but the returned node IDs don't exist in the Tokyo Metro `$trainStations` set.

### localStorage state after selection

```json
{
    "questions": [
        {
            "id": "matching",
            "key": 0.6120832008057422,
            "data": {
                "lat": 35.713049955808216,
                "lng": 139.7037367012773,
                "drag": true,
                "color": "green",
                "same": true,
                "type": "same-train-line",
                "selectedTrainLineId": "relation/1972960",
                "selectedTrainLineLabel": "JR Yamanote Line (Inner)"
            }
        }
    ],
    "questions_backup": [
        {
            "id": "matching",
            "key": 0.6120832008057422,
            "data": {
                "same-train-line": "...",
                "drag": false,
                "selectedTrainLineId": null,
                "selectedTrainLineLabel": null
            }
        }
    ]
}
```

Key observations:

- `selectedTrainLineId` = `"relation/1972960"` persisted to the active state
- `questions_backup` still has the old state (drag=false, no train line selection) — the backup sync hasn't caught up
- The 7 auto-detected stations (浦和, 栃木, 池袋, 大宮, 新宿, 下今市, 東武日光) were from the initial `trainLineNodeFinder` auto-query, which found Nikko/Tobu line stations near Takadanobaba — not Tokyo Metro stations. This is another instance of the same root cause: the auto-detect path (`trainLineNodeFinder` at `overpass.ts:589-631`) also lacks operator filtering. Even without selecting a specific line, the auto-detected stations may be wrong when a transit pass is active.

### Console errors (full log)

```
1. [error] Failed to load resource: 429 (Too Many Requests) — overpass-api.de rate limit
2. [error] Failed to load resource: 429 (Too Many Requests) — overpass-api.de rate limit
3. [warn] Blocked aria-hidden on an element because its descendant retained focus — Radix UI a11y warning
4. [error] Uncaught Error: Must have at least 2 geometries — Turf.js
```

Error #4 is the critical one — uncaught Turf error, likely from:

- `ZoneSidebar.tsx:448` — `turf.nearestPoint(location, turf.featureCollection(circles.map(...)))` after the same-train-line filter reduced `circles` to < 2 stations
- OR `ZoneSidebar.tsx:552` — `turf.nearestPoint` for measuring questions with 0 POI points
- OR `nearestPoi.ts:295` — `turf.nearestPoint` inside `resolveMatchingNearestPoi` if `stationPoints` temporarily became empty

### ZoneSidebar operator filter state

From the DevTools snapshot:

- **Selected operators button**: `東京地下鉄 (12) + 9 more` — the first 12 operators matched exactly, 9 additional variants auto-detected
- **Display style**: `no-overlap` (set by `applyTransitPassProfile`)
- **Hiding radius**: 600 meters
- **Station types**: `railway=station`, `railway=stop`

## Environment

- **Tested session**: `sid=nyYGTsaO62VnN79AluBrjg` → replaced to `sid=lKd2186UycfH0MY54kcdng`
- **Selected line**: JR Yamanote Line (Inner)
    - OSM relation ID: `relation/1972960`
    - Verified via DevTools network request: `GET overpass-api.de/...relation(1972960)...` → 200 OK
- **Question pin**: lat=35.71305, lng=139.70374
- **Nearest station (auto-detect)**: 高田馬場 (Takadanobaba), node/1951954570
- **Transit pass**: Tokyo Metro Daypass
    - 12 operators: `["東京地下鉄", "東京地下鉄;東京都交通局", "西武鉄道;東京地下鉄", "東日本旅客鉄道;東京地下鉄", "東急電鉄;東京地下鉄", "東京地下鉄;埼玉高速鉄道", "東京メトロ半蔵門線", "東京メト", "東京急行電鉄;東京地下鉄", "小田急電鉄;東京地下鉄", "東武鉄道;東京地下鉄", "東京メトロ"]`
    - +9 additional auto-detected operator variants
- **Local stations**: 455 Tokyo Metro stations (operator-filtered via `matchesOperatorSelection`)
- **Overpass errors**: 2x 429 Too Many Requests (recovered via `overpass.private.coffee` fallback mirror)
- **Runtime error**: `Uncaught Error: Must have at least 2 geometries` (Turf.js)
