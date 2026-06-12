# T16 Transit Station Diff — Before / After

Captured **2026-06-12** from committed `assets/transit/` bundles (pre-T16
HEAD) and T16 spec analysis.

---

## Japan Bundles (8 regions)

### Counts — UNCHANGED

| bundle         | presets | routes   | stations  |
| -------------- | ------- | -------- | --------- |
| japan-chubu    | 30      | 625      | 1947      |
| japan-chugoku  | 20      | 625      | 2072      |
| japan-hokkaido | 5       | 625      | 385       |
| japan-kansai   | 35      | 625      | 2000      |
| japan-kanto    | 64      | 640      | 3244      |
| japan-kyushu   | 19      | 625      | 1594      |
| japan-shikoku  | 11      | 625      | 1147      |
| japan-tohoku   | 16      | 625      | 1092      |
| **TOTAL**      | **200** | **5015** | **13481** |

Counts are identical before and after T16. The `useRailwayInfrastructure` flag
defaults to `false`; Japan's extraction mode set is unchanged.

### Entity decode — name strings only

The `decodeXmlEntities()` fix (always-on, shared lib) cleans `&gt;` / `&lt;`
in route names. Per bundle: **110× `&gt;`, 65× `&lt;`** (175 total occurrences
per bundle; some route names contain multiple entities, e.g.
`相模大野 &lt;=&gt; 藤沢 &lt;=&gt; 片瀬江ノ島`). Station names are unaffected
(zero entities found in any station name field).

**What changes:** raw name display strings only.

**What does NOT change:** route/station/preset counts, ids, geometry, colors,
routeIds, collapse grouping, `lineNameKey()` output (entity-encoded chars
inside parentheticals are stripped; `=>` / `<=>` never matched `ARROW_RE`).

#### Sample name diffs (japan-kanto)

| Before (raw)                                                    | After (decoded)                                     |
| --------------------------------------------------------------- | --------------------------------------------------- |
| `えのしま (新宿 &lt;=&gt; 片瀬江ノ島)`                          | `えのしま (新宿 <=> 片瀬江ノ島)`                    |
| `小田急江ノ島線 (相模大野 &lt;=&gt; 藤沢 &lt;=&gt; 片瀬江ノ島)` | `小田急江ノ島線 (相模大野 <=> 藤沢 <=> 片瀬江ノ島)` |
| `JR大糸線 (松本 =&gt; 南小谷)`                                  | `JR大糸線 (松本 => 南小谷)`                         |
| `つがる: 秋田 =&gt; 青森`                                       | `つがる: 秋田 => 青森`                              |
| `JR中央線・青梅線　立川 =&gt; 西立川`                           | `JR中央線・青梅線　立川 => 西立川`                  |
| `Sotetsu: Shinjuku &lt;=&gt; Ebina`                             | `Sotetsu: Shinjuku <=> Ebina`                       |
| `特急 新潟&lt;=&gt;新井`                                        | `特急 新潟<=>新井`                                  |
| `あずさ (新宿 &lt;=&gt; 松本)`                                  | `あずさ (新宿 <=> 松本)`                            |

These are all bidirectional route markers (`<=>` / `=>`) that were
double-encoded in the OSM XML source.

---

## Taiwan Pack (`asia-taiwan`)

Taiwan has not been rebuilt yet (requires `pnpm data:pack -- --region
asia-taiwan`). The following diffs are from the T16 spec analysis of
`data/packs/dist/asia-taiwan/transit.json.gz` and the source PBF.

### Pre-T16 issues (current state)

1. **Every station rendered two colors.** The coverage preset held all 543
   stations, and all 543 also sat in an operator preset (100% overlap). The
   T14 routeId-attach wrote routeIds onto both copies; the coverage copy had
   no matching route entry → fallback `#1f6f78` turquoise ring on every
   station.

2. **Per-train lines cutting across the country.** TRA heavy rail is modeled
   as one `route=train` per scheduled train (e.g. `區間 1112 新竹→基隆`),
   with no `route_master`. T14's masterless collapse couldn't fold them due
   to an XML entity-decode bug: `新竹-&gt;基隆` defeated the arrow-strip in
   `lineNameKey`, so `routeColors["區間"]` never matched → fallback hues.

3. **Stations with no connecting line (大溪, 新埔).** Not members of any
   `route=train` relation; their lines (宜蘭線, 縱貫線) exist only in the
   infrastructure layer (`route=railway`).

### Expected post-T16 state (after rebuild)

| Aspect                  | Before                                                 | After                                           |
| ----------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| Route extraction source | `route=train` (service layer)                          | `route=railway` (infrastructure layer)          |
| Route count (TRA)       | Hundreds (one per scheduled train)                     | ~12 real rail lines                             |
| Line geometry           | Stop-position polylines (zigzag)                       | Track-following `way` geometry (stitched)       |
| Station coloring        | Every station = 2 rings (operator + coverage fallback) | Single-colored unless genuine interchange       |
| Coverage preset         | All 543 stations                                       | Leftovers only (no-operator / <3 per operator)  |
| 大溪, 新埔              | No connecting line                                     | Spatial-attached via `railwayAttachMeters: 120` |
| Route name encoding     | `&gt;` / `&lt;` in names                               | Decoded (`>` / `<`)                             |
| Per-train lines         | `區間 1112 新竹→基隆` etc.                             | Collapsed into real lines: 縱貫線, 海岸線, etc. |
| Color keys              | Service-class: `區間`, `自強`, `莒光`, `復興`          | Line names: `縱貫線`, `海岸線`, `北迴線`, etc.  |

#### Expected Taiwan route lines (post-T16)

| Line                | Color                                   |
| ------------------- | --------------------------------------- |
| 台灣高速鐵路 (THSR) | `#FF0000`                               |
| 縱貫線              | `#0033A0`                               |
| 海岸線              | `#0070BD`                               |
| 北迴線              | `#E4002B`                               |
| 宜蘭線              | `#00843D`                               |
| 臺東線              | `#F58B1F`                               |
| 南迴線              | `#C48C31`                               |
| 屏東線              | `#7B4F9D`                               |
| 集集線              | `#8B5E3C`                               |
| 內灣線              | `#2E8B57`                               |
| 沙崙線, 六家線      | (smaller lines, deterministic fallback) |

---

## Summary

| Region                | Structural changes                                   | Name-only changes                                     | Risk                                                |
| --------------------- | ---------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| **Japan** (8 bundles) | None                                                 | ~1400 decoded entities (`&gt;`/`&lt;` → `>`/`<`)      | Minimal — pure string cleanup                       |
| **Taiwan** (pack)     | Railway infrastructure, coverage fix, spatial attach | Route/station counts, geometry, colors, line grouping | Medium — significant refactor, gated by opt-in flag |
