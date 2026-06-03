# Review 01 — Bundled Offline POIs implementation

**Date:** 2026-06-03
**Status:** Action required — 2 ship-blockers
**Reviewer:** Architecture review (max-effort code review)
**Scope:** First implementation of the [Bundled Offline POIs epic](epic.md) (tasks 01–06).
**Audience:** A fresh agent fixing the issues. This doc is self-contained — every finding
has the exact location, evidence, and a concrete fix. Work top-down; **Finding 1 must be
fixed before regenerating data in Finding 2.**

## How to read this

Each finding has: severity, the exact file/symbol, **Evidence** (a command + observed
output you can re-run), **Impact**, and **Fix** (current → replacement code). A
[verification appendix](#appendix--verification-commands) reproduces the osmium behavior
the bugs hinge on.

Prereqs to reproduce: `osmium` 1.19.1 on PATH, and the cached PBF at
`data/geofabrik/cache/kanto-latest.osm.pbf` (already present).

## What's correct (do not "fix")

- The `resolveBboxFeatures` seam (`featureSource.ts`) and its wiring into the cell cache
  (`osmMatchingCache.ts` `fetchAndStoreCell` / `cellRevalidateInBackground`).
- Cache staleness stamping (`Date.parse(generatedAt) || Date.now()`) and skip-persist for
  local cells.
- Byte-identical Overpass-QL derivation in `matchingCategories.ts` via `deriveOsmQueryTags`.
- Keeping `station-name-length` at `osmQueryTags: ""` (special station query path preserved).

Keep these as-is.

---

## 🔴 Finding 1 — Every bundled feature gets `osmId: 0` / `osmType: "node"` (data is unusable)

**Where:** `data/geofabrik/scripts/poiReducer.mjs` → `reduceFeature`, and the export call in
`data/geofabrik/scripts/fetch-geofabrik.mjs` → `runBundleStage`.

**Current code (`reduceFeature`):**

```js
const osmId = Number(props["@id"] ?? feature.id ?? 0);
const osmType = TYPE_CODE[props["@type"] ?? "node"] ?? 0;
```

**Current export call (`runBundleStage`):**

```js
execFileSync(
    "osmium",
    ["export", curatedPath, "-f", "geojsonseq", "-o", geoSeqPath, "-O"],
    { stdio: "inherit" },
);
```

**Evidence:** `osmium export` with the _current_ flags emits **no `@id` and no `@type`**.
Re-run [Appendix A](#a-osmium-export-emits-no-id-or-type-by-default): 0 of 400 features
have either property. Therefore:

- `props["@id"]` is `undefined`, `feature.id` is `undefined` → `Number(undefined ?? undefined ?? 0)` = **`0`** for every feature.
- `props["@type"]` is `undefined` → `TYPE_CODE["node"]` = **`0` ("node")** for every feature.

Adding `-u type_id` does **not** fix the current parse: osmium then puts the id in the
**top-level `feature.id`** as a prefixed string like `"n57390915"` (n=node, w=way,
r=relation) — _not_ in `props["@id"]`, and still no `@type`
([Appendix B](#b--u-type_id-puts-the-id-in-featureid-as-a-prefixed-string)). With the flag,
`Number(props["@id"] ?? feature.id)` = `Number("n57390915")` = **`NaN`** → serialized as
`null`.

**Impact (severe):** At runtime, `deduplicateFeatures` (`osmMatchingCache.ts`, used by the
cell cache merge) keys features on `` `${f.osmType}:${f.osmId}` ``. With `osmId` and
`osmType` identical for all features, every key is `node:0` → **an entire category dedupes
down to a single candidate.** `matchingVoronoi.makeOsmKey` collapses the same way, and the
question's `selectedOsmId`/`targetOsmId` all become `0`, so candidate highlighting breaks.
The bundle is effectively non-functional.

**Fix (two parts):**

1. Add `-u type_id` to the export so ids are emitted (into `feature.id`):

```js
execFileSync(
    "osmium",
    [
        "export",
        curatedPath,
        "-f",
        "geojsonseq",
        "-u",
        "type_id",
        "-o",
        geoSeqPath,
        "-O",
    ],
    { stdio: "inherit" },
);
```

2. Parse `feature.id` (prefix → type, rest → numeric id). Replace the two lines in
   `reduceFeature` and add a helper:

```js
const ID_PREFIX_TYPE = { n: 0, w: 1, r: 2 }; // osmium -u type_id prefixes

/** Parses osmium's `type_id` feature id ("n57390915") → { osmId, osmType }. */
export function parseOsmId(featureId) {
    if (typeof featureId !== "string" || featureId.length < 2) {
        return { osmId: 0, osmType: 0 };
    }
    const osmType = ID_PREFIX_TYPE[featureId[0]] ?? 0;
    const osmId = Number(featureId.slice(1));
    return { osmId: Number.isFinite(osmId) ? osmId : 0, osmType };
}
```

```js
// in reduceFeature, replacing the two broken lines:
const { osmId, osmType } = parseOsmId(feature.id);
```

> Keep `TYPE_CODE` only if other code uses it; `parseOsmId` supersedes the `@type` lookup.

**Verify:** after the fix, re-run the bundle stage on a sample and assert ids are non-zero
and types vary — see [Appendix C](#c-end-to-end-after-fix). Then regenerate (Finding 2).

---

## 🔴 Finding 2 — Data artifact missing → Metro build break + inert feature

**Where:** `src/features/questions/matching/bundledPois.ts` (the production loader), and the
committed `assets/poi/` directory.

**Current state:**

- `bundledPois.ts` registers a loader thunk:
    ```js
    case "japan-kanto":
        regionLoaders.set(region.id, () =>
            require("../../../../assets/poi/japan-kanto.json"),
        );
    ```
- `assets/poi/` contains **only** `regions.json`, and that file is the empty placeholder:
    ```json
    { "schemaVersion": 1, "generatedAt": "2026-06-01T00:00:00Z", "regions": [] }
    ```
- `assets/poi/japan-kanto.json` **does not exist.**

**Impact (two facets, same root cause = pipeline never run):**

1. **Build break.** Metro collects every literal `require()`/`import` during static
   analysis, regardless of enclosing control flow. The `require("../../../../assets/poi/japan-kanto.json")`
   resolves a file that doesn't exist → "Unable to resolve module" → the **release/EAS build
   fails**. This is invisible to `pnpm check` and `pnpm test`: `tsc` doesn't resolve
   `require(...)`, and jest never bundles. Only the native build catches it.
2. **Inert feature.** `REGIONS` is read from the empty `regions.json`, so the registration
   loop never runs, `regionCoveringBbox` always returns `null`, and the offline path
   silently always falls back to Overpass — i.e. the feature does nothing even if it built.

**Fix (order matters — do Finding 1 first):**

1. Apply Finding 1.
2. Generate the artifact: `pnpm data:geofabrik:bundle` (writes `assets/poi/japan-kanto.json`,
   `assets/poi/japan-kanto.stats.json`, and a populated `assets/poi/regions.json`).
3. Sanity-check the output: `assets/poi/regions.json` should list `japan-kanto` with a
   `bbox`, `assets/poi/japan-kanto.json` `totalCount` ≈ 58k, and spot-check that `osmId`
   values are non-zero and `osmType` contains a mix of `0`/`1`/`2` (proves Finding 1 fixed).
4. Commit `assets/poi/japan-kanto.json` and `assets/poi/regions.json`.

**Optional hardening:** if you want the build to survive a missing artifact (e.g. a teammate
who hasn't run the pipeline), this is _not_ achievable with a static `require` — Metro needs
the file at build time. Either always commit the artifact (recommended), or gate the region
behind a build-time check that omits the `case` when the file is absent (more complex; skip
unless asked).

---

## 🟠 Finding 3 — Centroid algorithm doesn't match Overpass `out center`

**Where:** `data/geofabrik/scripts/poiReducer.mjs` → `centroid`.

**Current:** computes the **mean of all vertices**.

**Problem:** Overpass `out center` (which the live path uses) returns the **bounding-box
center**, not the vertex mean. For ways/relations (parks, golf courses, airports) the two
differ — sometimes by hundreds of meters — and the vertex mean is skewed by how densely a
side is mapped. Bundled coordinates therefore disagree with Overpass for the same feature.

**Impact:** Distance ranking differs between the bundled and Overpass paths, so a feature's
position can **jump** when a stale local cell is revalidated against Overpass after the
90-day TTL, and "nearest X" can flip near ties. This contradicts the epic's intent that
local and Overpass results be interchangeable.

**Fix:** use the bbox center to match Overpass:

```js
export function centroid(geometry) {
    if (geometry.type === "Point") return geometry.coordinates;
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity,
        n = 0;
    const walk = (c) => {
        if (typeof c[0] === "number") {
            if (c[0] < minX) minX = c[0];
            if (c[0] > maxX) maxX = c[0];
            if (c[1] < minY) minY = c[1];
            if (c[1] > maxY) maxY = c[1];
            n++;
        } else c.forEach(walk);
    };
    walk(geometry.coordinates);
    if (n === 0) return [NaN, NaN];
    return [(minX + maxX) / 2, (minY + maxY) / 2];
}
```

Update the `centroid` unit tests accordingly (a Polygon's center is its bbox center, not the
vertex average).

---

## 🟠 Finding 4 — Reducer tests are green while the pipeline is broken (they masked Finding 1)

**Where:** `data/geofabrik/scripts/poiReducer.test.mjs` — the `makeFeature` fixture helper
sets `"@id"` and `"@type"` (e.g. lines ~46-47, ~202-203).

**Problem:** The fixtures hand-craft features with `properties["@id"]` and
`properties["@type"]`, which `osmium export` **never emits** (Finding 1). All 20 tests pass
against a shape that doesn't occur in production, giving false confidence and hiding the
`osmId:0` bug.

**Fix:** make fixtures reflect real osmium `-u type_id` output — put the id in top-level
`feature.id` as `"n123"`/`"w123"`/`"r123"` and remove `@id`/`@type`. Example:

```js
function makeFeature({ id = "n123", coords = [139.7, 35.6], tags = {} } = {}) {
    return {
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: coords },
        properties: { ...tags },
    };
}
```

Then assert `parseOsmId`/`reduceFeature` derive the right `osmId`/`osmType` from `feature.id`
(e.g. `"w99"` → `osmId 99`, `osmType 1`). Add a regression test that a feature **without**
any id (`feature.id` undefined) yields `osmId 0` and is flagged — so a future flag regression
is caught.

---

## 🟡 Finding 5 — New guard scripts are defined but never run in CI

**Where:** `package.json` scripts + `.github/workflows/app-checks.yml`.

**Problem:** `test:data:poi-selectors` (the registry↔JSON drift guard) and
`test:data:geofabrik` (reducer unit tests) are defined, but CI runs only `pnpm check`
(`app-checks.yml:73`) and `pnpm test` (`:76`). `pnpm test` is jest-only and does not pick up
`node --test` files (except the single one in `pretest`). So neither new guard executes — the
drift guard and reducer tests are inert in CI.

**Fix (pick one, consistent with repo style):**

- Add the reducer tests to the existing `pretest` chain:
    ```json
    "pretest": "node --test scripts/e2e-maestro-stack-config.test.mjs data/geofabrik/scripts/poiReducer.test.mjs"
    ```
- Add the drift guard to `check`:
    ```json
    "check": "pnpm lint && pnpm format:check && pnpm typecheck && pnpm perf:typecheck && pnpm test:data:poi-selectors"
    ```

(The pre-existing `test:data:default-zones`/`test:data:odpt` have the same gap; fixing those
too is in-scope if cheap, but not required.)

---

## 🟡 Finding 6 — Full category array rebuilt on every cell lookup

**Where:** `src/features/questions/matching/bundledPois.ts` → `getBundledCategoryFeatures`,
called per-cell by `featureSource.localBboxFeatures`.

**Problem:** `getBundledCategoryFeatures` reconstructs the **entire** category's
`OsmFeature[]` on every call. The cell cache calls `resolveBboxFeatures` once per _missing
cell_, and a default 50 km search (`DEFAULT_SEARCH_RADIUS_METERS`) spans dozens of 0.1° cells
(`cellsForSearch`). So a `park` query (~30k features in Kantō) rebuilds ~30k objects per cell
→ on the order of 1–2M allocations for a single first-time search, on a user action.

**Fix:** memoize the reconstructed array per `(regionId, category)`; callers already
`.filter(...)` (copy) so sharing the array is safe:

```js
const categoryFeatureCache = new Map(); // `${regionId}:${category}` -> OsmFeature[]

export function getBundledCategoryFeatures(regionId, category) {
    const key = `${regionId}:${category}`;
    const hit = categoryFeatureCache.get(key);
    if (hit) return hit;
    // ... existing reconstruction into `out` ...
    categoryFeatureCache.set(key, out);
    return out;
}
```

Also clear it in `clearBundledRegionCache()` so tests stay isolated.

---

## ⚪ Finding 7 — `registerTestRegion` leaks into module-shared `REGIONS`

**Where:** `bundledPois.ts` → `registerTestRegion` / `clearBundledRegionCache`.

**Problem:** `registerTestRegion` pushes/splices the module-level `REGIONS` array (the same
reference imported from `regions.json`), but `clearBundledRegionCache` only clears the parse
cache. A test that forgets `unregisterTestRegion` leaves a phantom region visible to
`regionCoveringBbox` in later suites.

**Fix:** snapshot the original `REGIONS` at module load and restore it in
`clearBundledRegionCache()` (and clear the Finding 6 cache there too). Minor; test-only.

---

## ⚪ Finding 8 — Inclusive bbox bounds double-count features on shared cell edges

**Where:** `featureSource.ts` → `localBboxFeatures` filter (`>= west && <= east && >= south && <= north`).

**Problem:** The grid (`cellsForSearch`) is effectively half-open, but the filter is inclusive
on all four edges, so a feature exactly on a shared edge is returned by both adjacent cells.
Normally absorbed by `deduplicateFeatures` — but only once Finding 1 makes ids unique.

**Fix (low priority):** make the upper bounds exclusive (`< east`, `< north`) to match the
half-open grid, or rely on dedup (acceptable post-Finding-1).

---

## Recommended fix order

1. **Finding 1** (reducer `feature.id` parse + `-u type_id`) — unblocks correct data.
2. **Finding 4** (realistic fixtures) — turn it red first, then green with the Finding 1 fix.
3. **Finding 3** (bbox-center centroid).
4. **Finding 2** — regenerate `pnpm data:geofabrik:bundle`, sanity-check, commit
   `assets/poi/japan-kanto.json` + populated `regions.json`.
5. **Finding 5** (wire guards into CI), **Finding 6** (memoize).
6. **Findings 7–8** (test hygiene / edge dedup) if time permits.

## Acceptance criteria

- [ ] `pnpm test:data:geofabrik` passes with fixtures shaped like real osmium output, and a
      feature with no id maps to `osmId 0` (regression guard).
- [ ] `assets/poi/japan-kanto.json` is committed, `totalCount` ≈ 58k, `osmId`s are non-zero,
      `osmType` is a mix of 0/1/2.
- [ ] `assets/poi/regions.json` lists `japan-kanto` with a real bbox.
- [ ] A native/EAS build succeeds (the `require` resolves).
- [ ] In-app: a `park` matching query inside Kantō returns many distinct candidates and makes
      **zero** Overpass requests (confirms dedup no longer collapses results).
- [ ] `test:data:poi-selectors` and `test:data:geofabrik` run in CI.
- [ ] `pnpm check` + `pnpm test` pass.

---

## Appendix — verification commands

All commands run from repo root.

### A. `osmium export` emits no `@id` or `@type` by default

```bash
TMP=$(mktemp -d)
osmium tags-filter -o "$TMP/s.pbf" data/geofabrik/cache/kanto-latest.osm.pbf leisure=park railway=station
osmium export "$TMP/s.pbf" -f geojsonseq -o "$TMP/s.seq" --overwrite
node -e 'const fs=require("fs");const L=fs.readFileSync(process.env.TMP+"/s.seq","utf8").split("\n").filter(Boolean);
let id=0,ty=0,fid=0;for(let l of L){l=l.replace(/^\x1e/,"");let f;try{f=JSON.parse(l)}catch{continue}
const p=f.properties||{};if("@id"in p)id++;if("@type"in p)ty++;if(f.id!==undefined)fid++;}
console.log({total:L.length,withAtId:id,withType:ty,withFeatureId:fid});' TMP=$TMP
rm -rf "$TMP"
# Observed: { total: ~62000, withAtId: 0, withType: 0, withFeatureId: 0 }
```

### B. `-u type_id` puts the id in `feature.id` as a prefixed string

```bash
TMP=$(mktemp -d)
osmium tags-filter -o "$TMP/s.pbf" data/geofabrik/cache/kanto-latest.osm.pbf leisure=park
osmium export "$TMP/s.pbf" -f geojsonseq -u type_id -o "$TMP/s.seq" --overwrite
head -c 200 <(tr -d '\036' < "$TMP/s.seq")
rm -rf "$TMP"
# Observed: {"type":"Feature","id":"n57390915","geometry":{...},"properties":{"source":"PGS"}}
# id prefixes: n=node, w=way, r=relation. No "@id"/"@type" in properties.
```

### C. End-to-end after fix

After applying Finding 1, run the bundle stage and confirm ids/types are real:

```bash
pnpm data:geofabrik:bundle
node -e 'const r=require("./assets/poi/japan-kanto.json");
const park=r.categories.park;
console.log("park count:",park.count,"first ids:",park.osmId.slice(0,5),"types seen:",[...new Set(park.osmType)]);'
# Expect: non-zero ids, and types including 1 (way) — parks are mostly ways.
```
