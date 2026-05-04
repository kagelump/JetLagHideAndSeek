# BUG_1: Train line dropdown ignores transit pass operator filter

## Summary

When a transit pass is active (e.g., Tokyo Metro Daypass), the train line dropdown in a "Station On Same Train Line" matching question shows **all** rail lines near the nearest station, regardless of whether they belong to the pass's operator set. This allows the user to select train lines that are not covered by the active transit pass.

## Severity

Medium — it produces an inconsistent experience where the transit pass filters stations in the hiding zone sidebar, but the matching question dropdown ignores that filter entirely.

## How to reproduce

1. Load the app with Tokyo Metro Daypass active (e.g., `?sid=nyYGTsaO62VnN79AluBrjg`)
2. Confirm the hiding zone sidebar shows "Tokyo Metro Daypass Added" with 455 stations matching
3. Unlock a "Station On Same Train Line" matching question
4. Click the train line dropdown

**Expected:** Only Tokyo Metro lines (e.g., Tokyo Metro Tōzai Line variants) appear as options.

**Actual:** 25 train line options appear (captured from DevTools a11y snapshot of the open dropdown):

| #   | Option label                                                     | OSM ref           |
| --- | ---------------------------------------------------------------- | ----------------- |
| 1   | (auto-detect from nearest station)                               | —                 |
| 2   | Nikko Train                                                      | —                 |
| 3   | Seibu Shinjuku Line                                              | relation/1947333  |
| 4   | **JR Yamanote Line (Outer)**                                     | —                 |
| 5   | **JR Yamanote Line (Inner)**                                     | —                 |
| 6   | Koedo                                                            | relation/3311485  |
| 7   | **Shonan-Shinjuku Line (Maebashi => Odawara)**                   | —                 |
| 8   | **Shonan-Shinjuku Line (Branch)**                                | relation/4684034  |
| 9   | Tokyo Metro Tōzai Line Local: Nakano => Nishi-Funabashi          | —                 |
| 10  | Yamanote Line                                                    | relation/5376382  |
| 11  | **Shonan-Shinjuku Line (North)**                                 | —                 |
| 12  | **JR Yamanote Freight Line**                                     | —                 |
| 13  | Kinugawa Train                                                   | relation/5485481  |
| 14  | **Shōnan–Shinjuku Line**                                         | —                 |
| 15  | Tokyo Metro Tōzai Line Local: Nishi-Funabashi => Nakano          | —                 |
| 16  | **Seibu Shinjuku Line (South->North)**                           | —                 |
| 17  | **Seibu Shinjuku Line (North->South)**                           | —                 |
| 18  | Tokyo Metro Tōzai Line Rapid: Nishi-Funabashi => Nakano          | —                 |
| 19  | Tokyo Metro Tōzai Rapid Line                                     | —                 |
| 20  | **JR Saikyo Line (Southbound)**                                  | —                 |
| 21  | **JR Saikyo Line (Northbound)**                                  | —                 |
| 22  | Tokyo Metro Tōzai Line Commuter Rapid: Nishi-Funabashi => Nakano | —                 |
| 23  | **JR Narita Express**                                            | relation/11688429 |
| 24  | **拝島ライナー: 西武新宿 => 拝島** (Seibu)                       | —                 |
| 25  | Tokyo Metro Tōzai Line                                           | way/23240905      |
| 26  | **Yamanote Freight Line**                                        | way/144655493     |

Only **6 of 26 options** (bold = non-Tokyo Metro, 20 total) belong to Tokyo Metro. The non-matching lines span operators including JR East, Seibu Railway, and Tobu Railway — none of which are in the Tokyo Metro Daypass operator set.

## Root cause

### Primary

`fetchStationTrainLineOptions()` at `src/maps/api/overpass.ts:477-528` queries Overpass geographically around the nearest station (300m for relations, 100m for ways) with no operator/network filtering. The query:

```
rel(around:300, <lat>, <lon>)["route"~"^(train|subway|light_rail|tram|railway|monorail)$"];
way(around:100, <lat>, <lon>)["railway"~"^(rail|subway|light_rail|tram|monorail|narrow_gauge)$"];
```

returns all rail infrastructure near Takadanobaba station (35.7079, 139.7090), which is a major rail junction served by JR East, Seibu Railway, and Tokyo Metro.

### Flow

```
matching.tsx:189-252 (useEffect)
  → fetchStationTrainLineOptions(nearestTrainStationId)
    → overpass.ts:505-514 (Overpass query, no operator filter)
    → overpass.ts:524-527 (elementsToTrainLineOptions, no operator filter)
  → setLineOptions(nextOptions)  // all 25 lines, not just Tokyo Metro
```

The `$displayHidingZoneOperators` atom (set by `applyTransitPassProfile` in `transitPasses.ts:104-106`) is available but never consulted by the train line dropdown logic.

## Relevant source locations

| File                                | Lines   | Role                                                                             |
| ----------------------------------- | ------- | -------------------------------------------------------------------------------- |
| `src/maps/api/overpass.ts`          | 477-528 | `fetchStationTrainLineOptions` — no operator filter applied                      |
| `src/maps/api/overpass.ts`          | 341-377 | `elementsToTrainLineOptions` — builds options without operator check             |
| `src/maps/api/overpass.ts`          | 222-238 | `RAIL_ROUTE_VALUES`, `RAILWAY_VALUES` — broad tag sets                           |
| `src/components/cards/matching.tsx` | 189-252 | Dropdown options useEffect — calls `fetchStationTrainLineOptions`                |
| `src/lib/transitPasses.ts`          | 50-59   | Tokyo Metro Daypass profile with 12 operator strings                             |
| `src/lib/transitPasses.ts`          | 99-114  | `applyTransitPassProfile` — sets `$displayHidingZoneOperators`                   |
| `src/lib/context.ts`                | 280-289 | `$trainStations` atom (operator-filtered in ZoneSidebar)                         |
| `src/components/ZoneSidebar.tsx`    | 357-368 | Operator filter applied to hide zone stations (but never to train line dropdown) |

## Suggested fix

Filter the train line options by the active transit pass's operator set. When `$displayHidingZoneOperators` is non-empty, the options (or the Overpass query) should be restricted to lines where the `operator` or `network` tag matches one of the selected operators.

Options:

1. **(Preferred) Post-filter in `elementsToTrainLineOptions`**: After building the options list, cross-reference each line's OSM tags (`operator`, `network`) against `$displayHidingZoneOperators`. Lines whose operator/network doesn't match any selected operator would be excluded. This requires the Overpass query to return tags (it currently uses `out tags`).

2. **Add operator filter to the Overpass query directly**: Extend the Overpass query in `fetchStationTrainLineOptions` to include operator/network filters from `$displayHidingZoneOperators`. This adds complexity to the query builder but reduces data transfer.

3. **Filter in the card component**: Apply the filter in the matching card's useEffect (line 212-233) after receiving options. This is the least invasive but also the least efficient.

## DevTools diagnostics

### Page state at time of repro

- **Place picker**: "Tokyo 23 Wards, Chiba Prefecture, Japan"
- **Active operators** (from hiding zone sidebar): `東京地下鉄 (12) + 9 more` — 12 specific Tokyo Metro operator strings plus 9 additional variants
- **Station count**: 455 of 455 stations match
- **Auto-detect stations (7)**: 浦和, 栃木, 池袋, 大宮, 新宿, 下今市, 東武日光
    - These are from the Nikko / Tobu / JR Shonan-Shinjuku lines near Takadanobaba
    - **They are not Tokyo Metro stations** — the auto-detect path also ignores the operator filter
    - This auto-detect is the `trainLineNodeFinder` fallback path, which picks the first relation-type line from the same unfiltered Overpass response

### Network requests captured

The Overpass query fired by `fetchStationTrainLineOptions` for the nearest station (Takadanobaba, node/1951954570, lat=35.7079175, lon=139.7090644):

```
GET https://overpass-api.de/api/interpreter?data=
[out:json];
(
  rel(around:300, 35.7079175, 139.7090644)["route"~"^(train|subway|light_rail|tram|railway|monorail)$"];
  way(around:100, 35.7079175, 139.7090644)["railway"~"^(rail|subway|light_rail|tram|monorail|narrow_gauge)$"];
);
out tags;
```

Result: **429 Too Many Requests** from overpass-api.de → **200 OK** from fallback mirror `overpass.private.coffee`. The successful response returned all 26 rail elements within range with no operator filtering.

### localStorage snapshot

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
                "type": "same-train-line"
            }
        }
    ]
}
```

Note: `selectedTrainLineId` and `selectedTrainLineLabel` are absent from the persisted state — the dropdown is in auto-detect mode. The train line options come entirely from the Overpass query response, not from persisted state.

### Console errors

- `Failed to load resource: 429 (Too Many Requests)` (x2) — Overpass rate limiting on initial queries; recovered via fallback mirror `overpass.private.coffee`

## Environment

- **Tested session**: `sid=nyYGTsaO62VnN79AluBrjg` → replaced to `sid=lKd2186UycfH0MY54kcdng`
- **Nearest station**: 高田馬場 (Takadanobaba)
    - OSM node: `node/1894258044` (initial query), `node/1951954570` (re-queried with Tokyo Metro filter)
    - Lat/lon: `35.7079175, 139.7090644`
- **Transit pass**: Tokyo Metro Daypass
    - Selected operators (from DevTools snapshot): `東京地下鉄 (12) + 9 more`
    - Full operator list from `transitPasses.ts:35-48`: `["東京地下鉄", "東京地下鉄;東京都交通局", "西武鉄道;東京地下鉄", "東日本旅客鉄道;東京地下鉄", "東急電鉄;東京地下鉄", "東京地下鉄;埼玉高速鉄道", "東京メトロ半蔵門線", "東京メト", "東京急行電鉄;東京地下鉄", "小田急電鉄;東京地下鉄", "東武鉄道;東京地下鉄", "東京メトロ"]`
    - Hiding zone stations: 455 (all pass the operator filter)
- **Overpass fallback**: `overpass.private.coffee` (used after `overpass-api.de` returned 429)
