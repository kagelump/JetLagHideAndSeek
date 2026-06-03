# Task 01 — Category → OSM Selector Registry

**Epic:** [Bundled Offline POIs](epic.md)
**Phase:** 1 (MVP)
**Status:** Not started
**Depends on:** —
**Blocks:** 02 (pipeline), 04 (feature source)

## Objective

Create one structured, typed source of truth that maps each `MatchingCategory` to its
OSM tag selector(s). Today the same mapping is expressed twice and can drift:

- As hand-written Overpass-QL strings in
  [`src/features/questions/matching/matchingCategories.ts`](../../../src/features/questions/matching/matchingCategories.ts)
  (`osmQueryTags`, e.g. `["leisure"="park"]`).
- As a loose `poiNodeKeys` **key** list in
  [`data/geofabrik/config.yaml`](../../../data/geofabrik/config.yaml) (which is
  node-only and omits `diplomatic`).

The pipeline (task 02) and the runtime query layer must agree exactly, or bundled data
will silently miss categories. This task makes the runtime QL **derive from** the
registry, and emits a JSON snapshot the (non-TS) pipeline consumes, guarded by a
`--check` script.

## Context — facts to preserve

- `buildOverpassQuery` / `buildOverpassBboxQuery` accept a `tags` string like
  `["leisure"="park"]` and `["boundary"="administrative"]["admin_level"="4"]`. Existing
  tests in
  [`src/features/questions/matching/__tests__/osmMatching.test.ts`](../../../src/features/questions/matching/__tests__/osmMatching.test.ts)
  assert the exact emitted QL. **Derived QL must be byte-identical to today's literals.**
- `station-name-length` has `osmQueryTags: ""` and uses the special `buildStationQuery`
  path. Keep that path. Its registry entry exists only for **extraction**.
- `transit-line` has `osmQueryTags: ""` and no OSM tags. It is **not** bundleable; mark it
  excluded.
- `admin-1st`…`admin-4th` use two ANDed conditions. The registry model must support AND.

## Files to create / modify

**Create:**

- `src/features/questions/matching/matchingSelectors.ts` — the registry + helpers.
- `src/features/questions/matching/__tests__/matchingSelectors.test.ts` — unit tests.
- `scripts/emit-poi-selectors.mjs` — writes the JSON snapshot; supports `--check`.

**Modify:**

- `src/features/questions/matching/matchingCategories.ts` — derive `osmQueryTags` from the
  registry instead of hard-coding the strings.
- `package.json` — add `data:poi-selectors` and `test:data:poi-selectors` scripts.

**Generated (committed):**

- `data/geofabrik/poi-selectors.json` — the emitted snapshot the pipeline reads.

## Implementation

### 1. `matchingSelectors.ts`

```ts
import type { MatchingCategory } from "./matchingTypes";

export type OsmElementType = "node" | "way" | "relation";

/** A single ANDed tag condition, e.g. { key: "leisure", value: "park" }. */
export type OsmTagCondition = { key: string; value: string };

/**
 * One selector = a set of ANDed conditions plus the element types to match.
 * A category's selectors are ORed together.
 */
export type OsmSelector = {
    match: OsmTagCondition[];
    /** Defaults to all three types when omitted. */
    types?: OsmElementType[];
};

/** Categories that produce OSM-tag-based point POIs bundleable for offline use. */
export const CATEGORY_SELECTORS: Partial<
    Record<MatchingCategory, OsmSelector[]>
> = {
    "commercial-airport": [{ match: [{ key: "aeroway", value: "aerodrome" }] }],
    mountain: [{ match: [{ key: "natural", value: "peak" }] }],
    landmark: [{ match: [{ key: "tourism", value: "attraction" }] }],
    park: [{ match: [{ key: "leisure", value: "park" }] }],
    "amusement-park": [{ match: [{ key: "tourism", value: "theme_park" }] }],
    zoo: [{ match: [{ key: "tourism", value: "zoo" }] }],
    aquarium: [{ match: [{ key: "tourism", value: "aquarium" }] }],
    "golf-course": [{ match: [{ key: "leisure", value: "golf_course" }] }],
    museum: [{ match: [{ key: "tourism", value: "museum" }] }],
    "movie-theater": [{ match: [{ key: "amenity", value: "cinema" }] }],
    hospital: [{ match: [{ key: "amenity", value: "hospital" }] }],
    library: [{ match: [{ key: "amenity", value: "library" }] }],
    "foreign-consulate": [
        { match: [{ key: "diplomatic", value: "consulate" }] },
    ],
    // railway=station already covers station=subway (the latter is a subset).
    "station-name-length": [{ match: [{ key: "railway", value: "station" }] }],
    // admin-1st..4th map to boundary=administrative relations and are intentionally
    // NOT bundled in Phase 1 — see epic "Category set". Keep them OUT of this map so
    // they fall through to Overpass.
};

/** Converts ANDed conditions to an Overpass-QL tag-filter string. */
export function selectorToOverpassTags(conditions: OsmTagCondition[]): string {
    return conditions.map((c) => `["${c.key}"="${c.value}"]`).join("");
}

/**
 * Derives the Overpass-QL `osmQueryTags` string for a category whose selectors form a
 * single ANDed group (every Phase 1 category does). Returns "" when not in the registry
 * or when the category requires multiple ORed selectors (caller keeps its special path).
 */
export function deriveOsmQueryTags(category: MatchingCategory): string {
    const selectors = CATEGORY_SELECTORS[category];
    if (!selectors || selectors.length !== 1) return "";
    return selectorToOverpassTags(selectors[0].match);
}

/** True when the category has bundleable OSM POI selectors. */
export function isBundleableCategory(category: MatchingCategory): boolean {
    return Boolean(CATEGORY_SELECTORS[category]);
}

/**
 * Flattens the registry into `osmium tags-filter` arguments, e.g.
 * "leisure=park", "amenity=hospital,cinema,library". Used by the emit script and the
 * pipeline. Groups single-condition selectors by key with comma-joined values; emits
 * multi-condition selectors as separate `key=value` args (osmium ANDs nothing, so
 * multi-condition AND selectors — none in Phase 1 — must be filtered post-hoc).
 */
export function toTagsFilterArgs(): string[] {
    const byKey = new Map<string, Set<string>>();
    for (const selectors of Object.values(CATEGORY_SELECTORS)) {
        for (const sel of selectors ?? []) {
            if (sel.match.length !== 1) continue; // Phase 1 has none; guard anyway.
            const { key, value } = sel.match[0];
            if (!byKey.has(key)) byKey.set(key, new Set());
            byKey.get(key)!.add(value);
        }
    }
    return [...byKey.entries()].map(
        ([key, values]) => `${key}=${[...values].sort().join(",")}`,
    );
}
```

> Note on `station=subway`: in OSM, subway stations carry `railway=station`, so the
> `railway=station` selector already includes them. Do **not** add a separate
> `station=subway` selector — it would double-count and is redundant.

### 2. Refactor `matchingCategories.ts`

Replace each literal `osmQueryTags` with the derived value, keeping output identical.
Two safe approaches — pick one:

- **(a) Compute at module load:** keep the `matchingCategories` array but set
  `osmQueryTags: deriveOsmQueryTags(category)` for the bundled categories, and keep `""`
  for `transit-line` / `station-name-length`. Keep the admin literals as-is (admin is not
  in the registry).
- **(b) Map over a base array:** define `{category, section, title}` and attach
  `osmQueryTags` via `deriveOsmQueryTags` for registry categories, falling back to the
  existing literal for admin/station/transit.

Either way, the emitted QL for `park`, `museum`, `hospital`, etc. must remain exactly
`["leisure"="park"]`, `["tourism"="museum"]`, `["amenity"="hospital"]`. The admin
categories keep their two-condition literals (`["boundary"="administrative"]["admin_level"="4"]`)
because they are not registry-driven in Phase 1.

### 3. `scripts/emit-poi-selectors.mjs`

Mirror `scripts/build-default-zone-metadata.mjs` conventions. The script must import the
TS registry (run via the project's existing `tsx` path) **or**, to avoid a TS import from
a `.mjs`, re-declare nothing — instead import the compiled selector data. Simplest robust
option: run the emit through `node --import tsx scripts/emit-poi-selectors.mjs` so it can
`import` the `.ts` registry directly (the perf scripts already use `node --import tsx`).

Behavior:

- Build the snapshot object:
    ```json
    {
        "schemaVersion": 1,
        "generatedFrom": "src/features/questions/matching/matchingSelectors.ts",
        "categories": {
            "park": {
                "selectors": [
                    { "match": [{ "key": "leisure", "value": "park" }] }
                ]
            },
            "...": {}
        },
        "tagsFilterArgs": [
            "amenity=cinema,hospital,library",
            "aeroway=aerodrome",
            "..."
        ]
    }
    ```
- Default run: write `data/geofabrik/poi-selectors.json` (pretty-printed, trailing
  newline, then `prettier --write` per repo convention — see how `data:default-zones`
  output is formatted).
- `--check`: build the snapshot in memory, compare to the committed file, exit non-zero
  with a diff hint if they differ. This is the CI drift guard.

### 4. `package.json` scripts

```json
"data:poi-selectors": "node --import tsx scripts/emit-poi-selectors.mjs",
"test:data:poi-selectors": "node --import tsx scripts/emit-poi-selectors.mjs --check"
```

Wire `test:data:poi-selectors` into the same place the other `test:data:*` scripts run in
CI (check `.github/` workflows and the `check`/`test` aggregation).

## Edge cases

- A future category with **ORed** selectors (`selectors.length > 1`): `deriveOsmQueryTags`
  returns `""` so the caller must keep a special query path (document this in a code
  comment). Phase 1 has none.
- A future **multi-condition** selector for the bundle: `toTagsFilterArgs` skips it (can't
  express AND in `osmium tags-filter`); task 02's reducer must post-filter. Add a TODO.
- Keep `admin-*` out of the registry so `isBundleableCategory("admin-1st")` is `false` and
  those queries fall through to Overpass.

## Testing

`matchingSelectors.test.ts`:

- `selectorToOverpassTags([{key:"leisure",value:"park"}])` → `["leisure"="park"]`.
- `selectorToOverpassTags` with two conditions → `["boundary"="administrative"]["admin_level"="4"]`.
- `deriveOsmQueryTags("park")` → `["leisure"="park"]`; `deriveOsmQueryTags("transit-line")`
  → `""`; `deriveOsmQueryTags("admin-1st")` → `""` (not in registry).
- `isBundleableCategory` true for the 14 bundled categories, false for `transit-line`,
  `admin-1st`…`admin-4th`.
- `toTagsFilterArgs()` contains `aeroway=aerodrome`, `natural=peak`, `diplomatic=consulate`,
  `railway=station`, and `amenity=cinema,hospital,library` (values sorted); does **not**
  contain `boundary` or `admin_level`.
- **Drift guard test:** for every category in `CATEGORY_SELECTORS`, `deriveOsmQueryTags`
  equals the `osmQueryTags` currently in `matchingCategories` (proves the refactor kept QL
  identical).

Run the existing `osmMatching.test.ts` to confirm QL assertions still pass after the
`matchingCategories.ts` refactor.

## Acceptance criteria

- [ ] `matchingSelectors.ts` exports `CATEGORY_SELECTORS` and the four helpers.
- [ ] `matchingCategories.ts` derives `osmQueryTags` from the registry; `osmMatching.test.ts`
      passes unchanged.
- [ ] `pnpm data:poi-selectors` writes `data/geofabrik/poi-selectors.json`.
- [ ] `pnpm test:data:poi-selectors` passes on a clean tree and fails if the registry and
      the committed JSON diverge.
- [ ] `pnpm check` (lint + format + typecheck) passes.

## Out of scope

- Admin-division selectors (Phase 1.5).
- The pipeline that consumes the JSON (task 02).
