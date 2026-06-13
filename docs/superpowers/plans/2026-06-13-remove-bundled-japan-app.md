# Remove Bundled Japan Data — App Code, Assets, and Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all bundled-Japan special cases from the app code, delete bundled Japan assets (except the Tokyo boundary placeholder), and update documentation.

**Architecture:** Collapse every data type to a single pack-based `register*` path. Delete literal `require()` switch-cases, `BUNDLED_*` constants, and generated manifest files. Migrate tests to synthetic fixtures via existing test seams.

**Tech Stack:** TypeScript, React Native, Metro, Jest, Maestro, pnpm.

**Hard prerequisite:** Phase 0 plan (`2026-06-13-remove-bundled-japan-phase0.md`) must be complete — all 8 `asia-japan-*` packs published and the parity gate green.

---

## File structure

| File                                                     | Responsibility                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/features/map/playArea.ts`                           | Keep Tokyo boundary default; add placeholder comment.                 |
| `src/features/map/playAreaBoundary.ts`                   | Remove Osaka bundled boundary; simplify bundled checks to Tokyo-only. |
| `e2e/*.yaml`                                             | Delete all flows except `smoke.yaml` + `bootstrap.yaml`.              |
| `scripts/e2e-maestro-stack.mjs`                          | Trim flows list to smoke-only.                                        |
| `scripts/e2e-maestro-stack-config.test.mjs`              | Update fixtures and tests.                                            |
| `.github/workflows/maestro-e2e.yml`                      | Trim flow choice to smoke.                                            |
| `package.json`                                           | Update `test:e2e` and `pretest` scripts.                              |
| `src/features/questions/matching/bundledPois.ts`         | Remove bundled `japan-kanto` loader and `regions.json` import.        |
| `src/features/hidingZone/transitBundles.generated.ts`    | Delete.                                                               |
| `src/features/hidingZone/hidingZoneData.ts`              | Drop manifest/loader imports; pack-only preset loading.               |
| `jest.setup.ts`                                          | Update hidingZoneData mock to be pack-only.                           |
| `src/features/questions/measuring/lineBundleLoader.ts`   | Remove bundled `require()` switch; pack-only categories.              |
| `src/features/questions/matching/adminBoundaryLoader.ts` | Drop sync bundled bundle; async pack-only path.                       |
| `src/features/offline/coverage.ts`                       | Remove Japan short-circuit.                                           |
| `assets/poi/*`, `assets/measuring/*`, `assets/transit/*` | Delete Japan files.                                                   |
| `AGENTS.md`                                              | Update bundled-vs-pack guidance.                                      |
| `docs/tasks/remove-bundle/implementers-log.md`           | Finalize.                                                             |

---

## Phase 1 — First-run placeholder

### Task 1: Mark Tokyo default as a placeholder

**Files:**

- Modify: `src/features/map/playArea.ts:89-99`

- [ ] **Step 1: Add a comment above `defaultPlayArea`**

Replace:

```ts
export const defaultPlayArea: DefaultPlayArea = {
```

with:

```ts
// Placeholder default play area — the Tokyo 23 Wards boundary is bundled only
// so the map has something to render on first run. Game data (POI, measuring,
// transit) for Tokyo/Japan comes from downloadable offline packs like every
// other region. This will be replaced by an out-of-the-box wizard later.
export const defaultPlayArea: DefaultPlayArea = {
```

- [ ] **Step 2: Run tests**

```bash
pnpm test -- src/features/map/__tests__/playArea.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/map/playArea.ts
git commit -m "chore(play-area): mark Tokyo boundary as placeholder default"
```

---

### Task 2: Remove Osaka bundled boundary

**Files:**

- Delete: `assets/default-zones/osaka.json`
- Modify: `src/features/map/playAreaBoundary.ts`

- [ ] **Step 1: Delete the Osaka boundary asset**

```bash
rm assets/default-zones/osaka.json
```

- [ ] **Step 2: Remove the Osaka import and `BUNDLED_BOUNDARIES` entry**

In `src/features/map/playAreaBoundary.ts`:

1. Delete line 4:

```ts
import osakaBoundaryJson from "../../../assets/default-zones/osaka.json";
```

2. Replace lines 33-35:

```ts
const BUNDLED_BOUNDARIES: Partial<Record<number, GeoJsonFeatureCollection>> = {
    358674: osakaBoundaryJson as unknown as GeoJsonFeatureCollection,
};
```

with:

```ts
const BUNDLED_BOUNDARIES: Partial<Record<number, GeoJsonFeatureCollection>> =
    {};
```

3. Replace `isBundledPlayAreaId` (lines 56-60):

```ts
export function isBundledPlayAreaId(relationId: number): boolean {
    return (
        relationId === defaultPlayArea.osmId || relationId in BUNDLED_BOUNDARIES
    );
}
```

with:

```ts
export function isBundledPlayAreaId(relationId: number): boolean {
    return relationId === defaultPlayArea.osmId;
}
```

4. Replace `getBundledPlayArea` (lines 332-339):

```ts
function getBundledPlayArea(relationId: number): PlayArea | null {
    if (relationId === defaultPlayArea.osmId) return defaultPlayArea;

    const bundledBoundary = BUNDLED_BOUNDARIES[relationId];
    return bundledBoundary
        ? buildPlayAreaFromBoundary(relationId, bundledBoundary)
        : null;
}
```

with:

```ts
function getBundledPlayArea(relationId: number): PlayArea | null {
    return relationId === defaultPlayArea.osmId ? defaultPlayArea : null;
}
```

- [ ] **Step 3: Update load comments**

Update the resolution-order comment in `loadPlayAreaByRelationId` (lines 104-110) from:

```ts
/**
 * Load a play area by relation ID. Resolution order:
 * 1. Bundled Tokyo/Osaka
 * ...
 */
```

to:

```ts
/**
 * Load a play area by relation ID. Resolution order:
 * 1. Bundled Tokyo placeholder
 * ...
 */
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- src/features/map/__tests__/playArea.test.ts
pnpm test -- src/features/playArea/__tests__/playAreaSearch.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add assets/default-zones/osaka.json src/features/map/playAreaBoundary.ts
git commit -m "chore(play-area): remove Osaka bundled boundary"
```

---

## Phase 2 — E2E reduction

### Task 3: Delete non-smoke Maestro flows

**Files:**

- Delete: `e2e/warmup.yaml`
- Delete: `e2e/play-area.yaml`
- Delete: `e2e/hiding-zone.yaml`
- Delete: `e2e/radar-question.yaml`
- Delete: `e2e/transit-line-question.yaml`
- Delete: `e2e/thermometer-question.yaml`
- Delete: `e2e/reconnect.yaml`
- Delete: `e2e/geos-crash-fuzz.yaml`
- Delete: `e2e/geos-measuring-smoke.yaml`
- Delete: `e2e/dismiss-continue.yaml`
- Keep: `e2e/smoke.yaml`, `e2e/bootstrap.yaml`

- [ ] **Step 1: Delete flows**

```bash
rm e2e/warmup.yaml \
   e2e/play-area.yaml \
   e2e/hiding-zone.yaml \
   e2e/radar-question.yaml \
   e2e/transit-line-question.yaml \
   e2e/thermometer-question.yaml \
   e2e/reconnect.yaml \
   e2e/geos-crash-fuzz.yaml \
   e2e/geos-measuring-smoke.yaml \
   e2e/dismiss-continue.yaml
```

- [ ] **Step 2: Verify only smoke + bootstrap remain**

```bash
ls e2e/*.yaml
```

Expected: `bootstrap.yaml`, `smoke.yaml`.

- [ ] **Step 3: Commit**

```bash
git add e2e/
git commit -m "test(e2e): remove non-smoke Maestro flows"
```

---

### Task 4: Trim E2E runner script

**Files:**

- Modify: `scripts/e2e-maestro-stack.mjs:33-60`

- [ ] **Step 1: Replace the `flows` array**

Replace:

```js
const flows = [
    {
        name: "warmup",
        artifactSubdir: "warmup",
        flowPath: "e2e/warmup.yaml",
    },
    { name: "smoke", artifactSubdir: "smoke", flowPath: "e2e/smoke.yaml" },
    {
        name: "play-area",
        artifactSubdir: "play-area",
        flowPath: "e2e/play-area.yaml",
    },
    {
        name: "hiding-zone",
        artifactSubdir: "hiding-zone",
        flowPath: "e2e/hiding-zone.yaml",
    },
    {
        name: "radar-question",
        artifactSubdir: "radar-question",
        flowPath: "e2e/radar-question.yaml",
    },
    {
        name: "transit-line-question",
        artifactSubdir: "transit-line-question",
        flowPath: "e2e/transit-line-question.yaml",
    },
];
```

with:

```js
const flows = [
    { name: "smoke", artifactSubdir: "smoke", flowPath: "e2e/smoke.yaml" },
];
```

- [ ] **Step 2: Remove warmup references**

Search for any remaining `warmup` references in the file and remove them (e.g., `warmMetroBundle` function is unrelated — keep it).

- [ ] **Step 3: Run config test**

```bash
pnpm test -- scripts/e2e-maestro-stack-config.test.mjs
```

This will fail until Task 5. That's expected.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-maestro-stack.mjs
git commit -m "chore(e2e): trim runner to smoke-only"
```

---

### Task 5: Update E2E config test

**Files:**

- Modify: `scripts/e2e-maestro-stack-config.test.mjs`

- [ ] **Step 1: Update the fixture and tests**

Replace the entire file content with:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
    createMetroWarmUrl,
    resolveE2ePlatform,
    selectFlows,
} from "./e2e-maestro-stack-config.mjs";

const flows = [{ name: "smoke" }];

test("resolveE2ePlatform uses an explicit platform when provided", () => {
    assert.equal(resolveE2ePlatform("android", "darwin"), "android");
    assert.equal(resolveE2ePlatform("ios", "linux"), "ios");
});

test("resolveE2ePlatform defaults Linux to Android and other hosts to iOS", () => {
    assert.equal(resolveE2ePlatform(undefined, "linux"), "android");
    assert.equal(resolveE2ePlatform(undefined, "darwin"), "ios");
});

test("resolveE2ePlatform rejects unsupported values", () => {
    assert.throws(
        () => resolveE2ePlatform("web", "linux"),
        /Unknown E2E_PLATFORM "web"/,
    );
});

test("createMetroWarmUrl targets the selected platform", () => {
    assert.equal(
        createMetroWarmUrl(8081, "android"),
        "http://127.0.0.1:8081/node_modules/expo-router/entry.js?platform=android&dev=true&minify=false",
    );
});

test("selectFlows keeps the full list for all", () => {
    assert.deepEqual(selectFlows(flows, "all"), flows);
});

test("selectFlows returns smoke for smoke", () => {
    assert.deepEqual(selectFlows(flows, "smoke"), [{ name: "smoke" }]);
});

test("selectFlows rejects unknown flow names", () => {
    assert.throws(
        () => selectFlows(flows, "missing"),
        /Unknown E2E_FLOW "missing"/,
    );
});
```

- [ ] **Step 2: Run config test**

```bash
node --test scripts/e2e-maestro-stack-config.test.mjs
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-maestro-stack-config.test.mjs
git commit -m "test(e2e): update config test for smoke-only flows"
```

---

### Task 6: Update package.json E2E script and workflow

**Files:**

- Modify: `package.json:54`
- Modify: `.github/workflows/maestro-e2e.yml:22-26`

- [ ] **Step 1: Update `test:e2e`**

Change:

```json
"test:e2e": "maestro test e2e/smoke.yaml && maestro test e2e/play-area.yaml && maestro test e2e/hiding-zone.yaml && maestro test e2e/radar-question.yaml && maestro test e2e/transit-line-question.yaml",
```

to:

```json
"test:e2e": "maestro test e2e/smoke.yaml",
```

- [ ] **Step 2: Update workflow flow choices**

In `.github/workflows/maestro-e2e.yml`, replace:

```yaml
options:
    - all
    - smoke
    - play-area
    - hiding-zone
    - radar-question
    - transit-line-question
```

with:

```yaml
options:
    - all
    - smoke
```

- [ ] **Step 3: Run pretest**

```bash
pnpm pretest
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json .github/workflows/maestro-e2e.yml
git commit -m "chore(e2e): smoke-only test:e2e and workflow choices"
```

---

## Phase 3 — Collapse loaders

### Task 7: POI loader collapse

**Files:**

- Modify: `src/features/questions/matching/bundledPois.ts`
- Modify: `src/features/questions/matching/__tests__/bundledPois.test.ts` (if needed)

- [ ] **Step 1: Remove `regions.json` import and eager REGIONS parse**

Delete line 3:

```ts
import regionsJson from "../../../../assets/poi/regions.json";
```

Replace lines 42-45:

```ts
/** Parsed regions.json registry (small, eager import). */
const REGIONS: RegionMeta[] = (
    regionsJson as unknown as { regions: RegionMeta[] }
).regions;
```

with:

```ts
/** Registry of regions with available POI data. Starts empty; populated by
 *  registerRegion (installed packs and test fixtures). */
const REGIONS: RegionMeta[] = [];
```

- [ ] **Step 2: Remove bundled loader switch and DEV guards**

Delete lines 69-105 (the `for (const region of REGIONS) { switch ... }` block and the `__DEV__` fatal guard).

Also delete the `sortRegionsByArea()` call immediately after (line 90), since `REGIONS` is now empty at import time.

- [ ] **Step 3: Keep `registerRegion` / `unregisterRegion` unchanged**

They already populate `REGIONS` and `regionLoaders`.

- [ ] **Step 4: Update tests if needed**

The existing `bundledPois.test.ts` already uses `registerTestRegion` with `poi-mini.json` fixture. It should continue to pass. Run:

```bash
pnpm test -- src/features/questions/matching/__tests__/bundledPois.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/questions/matching/bundledPois.ts
git commit -m "refactor(poi): remove bundled Japan POI loader"
```

---

### Task 8: Transit loader collapse

**Files:**

- Delete: `src/features/hidingZone/transitBundles.generated.ts`
- Modify: `src/features/hidingZone/hidingZoneData.ts`
- Modify: `jest.setup.ts:305-376`
- Modify: `src/features/hidingZone/__tests__/hidingZoneData.test.ts`

- [ ] **Step 1: Delete generated transit manifest file**

```bash
rm src/features/hidingZone/transitBundles.generated.ts
```

- [ ] **Step 2: Remove manifest imports from hidingZoneData.ts**

Delete lines 4-7:

```ts
import {
    TRANSIT_MANIFEST,
    transitBundleLoaders,
} from "./transitBundles.generated";
```

- [ ] **Step 3: Rewrite `loadHidingZonePresets`**

Replace lines 111-178 with:

```ts
export async function loadHidingZonePresets(
    playAreaBbox?: Bbox | null,
): Promise<HidingZonePreset[]> {
    const bundles = pickBundles(playAreaBbox);

    const promises: Promise<HidingZonePreset[]>[] = [];
    for (const bundle of bundles) {
        const packSource = findPackSourceByBundleId(bundle.id);
        const cacheKey = packSource ? packSource.packId : bundle.id;

        if (bundleCache.has(cacheKey)) {
            const cached = bundleCache.get(cacheKey);
            if (cached) promises.push(Promise.resolve(cached));
            continue;
        }

        bundleCache.set(cacheKey, null);

        if (packSource) {
            promises.push(loadPackTransitBundle(packSource));
        } else {
            // No pack source and no bundled loader — empty result.
            bundleCache.set(cacheKey, []);
            promises.push(Promise.resolve([]));
        }
    }

    await Promise.all(promises);

    const all: HidingZonePreset[] = [];
    for (const [packId] of packTransitSources) {
        const cached = bundleCache.get(packId);
        if (cached) all.push(...cached);
    }

    return all;
}
```

- [ ] **Step 4: Rewrite `getHidingZonePresets`**

Replace lines 184-201 with:

```ts
export function getHidingZonePresets(): HidingZonePreset[] {
    const all: HidingZonePreset[] = [];
    for (const [packId] of packTransitSources) {
        const cached = bundleCache.get(packId);
        if (cached) all.push(...cached);
    }
    if (all.length === 0) {
        throw new Error(
            "Hiding zone presets not loaded yet. " +
                "Call loadHidingZonePresets() first.",
        );
    }
    return all;
}
```

- [ ] **Step 5: Rewrite `getHidingZonePresetsOrEmpty`**

Replace lines 207-218 with:

```ts
export function getHidingZonePresetsOrEmpty(): HidingZonePreset[] {
    const all: HidingZonePreset[] = [];
    for (const [packId] of packTransitSources) {
        const cached = bundleCache.get(packId);
        if (cached) all.push(...cached);
    }
    return all;
}
```

- [ ] **Step 6: Remove `getTransitManifest` or make it return empty**

Replace lines 224-226:

```ts
export function getTransitManifest() {
    return TRANSIT_MANIFEST;
}
```

with:

```ts
export function getTransitManifest() {
    return { version: 1, bundles: [] };
}
```

Search for callers of `getTransitManifest` with `Grep` first; if any rely on non-empty bundles, update them. Likely only tests.

- [ ] **Step 7: Rewrite `pickBundles` to pack-only**

Replace lines 301-337 with:

```ts
function pickBundles(playAreaBbox?: Bbox | null) {
    const bundles: {
        id: string;
        bbox: Bbox;
        file: string;
        presets: { id: string; label: string; bbox: Bbox; kind?: string }[];
    }[] = [];

    for (const [packId, source] of packTransitSources) {
        for (const summary of source.presetSummaries) {
            const match =
                !playAreaBbox || bboxIntersects(summary.bbox, playAreaBbox);
            if (match) {
                bundles.push({
                    id: `${packId}:${summary.id}`,
                    bbox: summary.bbox,
                    file: source.path,
                    presets: [
                        {
                            id: `${packId}:${summary.id}`,
                            label: summary.label,
                            bbox: summary.bbox,
                            kind: summary.kind,
                        },
                    ],
                });
            }
        }
    }

    if (!playAreaBbox) {
        return bundles;
    }
    return bundles.filter((b) => bboxIntersects(b.bbox, playAreaBbox));
}
```

- [ ] **Step 8: Update jest.setup.ts mock**

Replace the hidingZoneData mock (lines 305-376) with:

```ts
jest.mock("@/features/hidingZone/hidingZoneData", () => {
    const packPresets: any[] = [];
    const packSourcesListeners = new Set<() => void>();

    return {
        __esModule: true,
        loadHidingZonePresets: jest.fn(() => Promise.resolve([...packPresets])),
        getHidingZonePresets: () => {
            if (packPresets.length === 0)
                throw new Error("Presets not loaded yet");
            return [...packPresets];
        },
        getHidingZonePresetsOrEmpty: () => [...packPresets],
        getTransitManifest: () => ({ version: 1, bundles: [] }),
        clearTransitBundleCache: () => {
            packPresets.length = 0;
        },
        registerTransitSource: (..._args: any[]) => {
            void _args;
            for (const listener of packSourcesListeners) {
                listener();
            }
        },
        onPackSourcesChanged: (listener: () => void) => {
            packSourcesListeners.add(listener);
            return () => {
                packSourcesListeners.delete(listener);
            };
        },
        __addPackPresetForTest: (preset: any) => {
            packPresets.push(preset);
        },
        __clearPackTransitSourcesForTest: () => {
            packPresets.length = 0;
        },
    };
});
```

- [ ] **Step 9: Update hidingZoneData.test.ts**

The existing tests assume bundled presets exist. Replace the test content that asserts `tokyo-metro` exists with pack-source-based assertions.

Change the describe block from:

```ts
describe("generated hiding-zone preset data", () => {
    beforeAll(() => loadHidingZonePresets());

    it("contains canonical source-adapter transit ids", () => { ... });

    it("has at least the Tokyo Metro preset", () => {
        const presets = getHidingZonePresets();
        expect(presets.some((p) => p.id === "tokyo-metro")).toBe(true);
    });

    it("returns the same cached presets on repeated calls", async () => { ... });

    it("getHidingZonePresetsOrEmpty returns presets after loading", () => { ... });

    // pack tests...
});
```

to:

```ts
const mockMod = require("@/features/hidingZone/hidingZoneData") as {
    __addPackPresetForTest: (preset: any) => void;
    __clearPackTransitSourcesForTest: () => void;
    registerTransitSource: (
        packId: string,
        path: string,
        summaries: any[],
    ) => void;
    onPackSourcesChanged: (listener: () => void) => () => void;
};

describe("hiding-zone preset data (pack-only)", () => {
    beforeEach(() => {
        mockMod.__clearPackTransitSourcesForTest();
    });

    it("returns empty array when no pack sources are registered", async () => {
        const presets = await loadHidingZonePresets();
        expect(presets).toEqual([]);
        expect(getHidingZonePresetsOrEmpty()).toEqual([]);
    });

    it("returns pack presets after loading", async () => {
        mockMod.__addPackPresetForTest(PACK_PRESET);
        const presets = await loadHidingZonePresets();
        expect(presets.some((p) => p.id === PACK_PRESET.id)).toBe(true);
    });

    it("getHidingZonePresets includes pack presets", () => {
        mockMod.__addPackPresetForTest(PACK_PRESET);
        const presets = getHidingZonePresets();
        expect(presets.some((p) => p.id === PACK_PRESET.id)).toBe(true);
    });

    it("throws when presets not loaded and no pack presets exist", () => {
        expect(() => getHidingZonePresets()).toThrow("Presets not loaded yet");
    });

    // keep existing pack-source notification tests
});
```

- [ ] **Step 10: Run tests**

```bash
pnpm test -- src/features/hidingZone/__tests__/hidingZoneData.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/features/hidingZone/hidingZoneData.ts jest.setup.ts src/features/hidingZone/__tests__/hidingZoneData.test.ts
git rm src/features/hidingZone/transitBundles.generated.ts
git commit -m "refactor(transit): remove bundled Japan transit loader"
```

---

### Task 9: Measuring loader collapse

**Files:**

- Modify: `src/features/questions/measuring/lineBundleLoader.ts`
- Modify: `src/features/questions/measuring/__tests__/lineBundleLoader.test.ts`

- [ ] **Step 1: Remove bundled `require()` from `getLineBundle`**

Replace lines 133-166 with:

```ts
export function getLineBundle(category: MeasuringCategory): LineBundle | null {
    return cache.get(category) ?? null;
}
```

- [ ] **Step 2: Remove `requirePristineBundle`**

Delete lines 282-297 (the `requirePristineBundle` function).

- [ ] **Step 3: Simplify `loadLineBundle`**

Remove the `isPackOnlyCategory` check and the bundled branch. Replace lines 198-219:

```ts
// If no pack sources and we have a bundled require(), cache and return it.
if (!hasSources && !isPackOnlyCategory(category)) {
    const bundled = getLineBundle(category);
    cache.set(category, bundled);
    return bundled;
}

// Build merged bundle from pristine sources.
let merged: LineBundle | null = null;

if (!isPackOnlyCategory(category)) {
    const bundled = requirePristineBundle(category);
    if (bundled) {
        merged = {
            ...bundled,
            features: [...bundled.features],
        };
    }
}
```

with:

```ts
// Build merged bundle from registered pack sources.
let merged: LineBundle | null = null;
```

- [ ] **Step 4: Remove `isPackOnlyCategory`**

Delete the `isPackOnlyCategory` function (lines 310-321).

- [ ] **Step 5: Update tests**

The tests currently rely on bundled `coastline` existing. Rewrite the test assertions that expect bundled features to use synthetic bundles instead.

Key changes in `lineBundleLoader.test.ts`:

- Remove or rewrite `"loads a bundled category from require() when no pack sources"` to register a pack source and assert the loaded bundle.
- Remove or rewrite `"merges pack sources into bundled category"` and `"merges multiple pack sources for the same category"` to use only pack sources.
- Keep `__setLineBundleForTest` tests.

A minimal updated describe block for `loadLineBundle`:

```ts
describe("loadLineBundle", () => {
    it("returns existing cached bundle immediately", async () => {
        const bundle = makeBundle("coastline", { source: "cached" });
        __setLineBundleForTest("coastline", bundle);
        const result = await loadLineBundle("coastline");
        expect(result).toBe(bundle);
    });

    it("loads a pack-only category from pack sources", async () => {
        fsCache["/test/coastline-pack.json"] = JSON.stringify(
            makeBundle("coastline", {
                source: "pack-source",
                extractBbox: [5, 5, 15, 15],
                features: [
                    {
                        type: "Feature",
                        geometry: {
                            type: "LineString",
                            coordinates: [
                                [2, 2],
                                [3, 3],
                            ],
                        },
                        properties: {},
                    },
                ],
            }),
        );
        registerMeasuringSource(
            "test-pack",
            "coastline",
            "/test/coastline-pack.json",
        );

        const result = await loadLineBundle("coastline");

        expect(result).not.toBeNull();
        expect(result!.category).toBe("coastline");
        expect(result!.features).toHaveLength(1);
        expect(result!.source).toBe("pack-source");
    });

    it("merges multiple pack sources for the same category", async () => {
        fsCache["/test/pack1.json"] = JSON.stringify(
            makeBundle("coastline", {
                source: "pack1",
                extractBbox: [0, 0, 5, 5],
                features: [
                    {
                        type: "Feature",
                        geometry: {
                            type: "LineString",
                            coordinates: [
                                [0, 0],
                                [1, 1],
                            ],
                        },
                        properties: {},
                    },
                ],
            }),
        );
        fsCache["/test/pack2.json"] = JSON.stringify(
            makeBundle("coastline", {
                source: "pack2",
                extractBbox: [3, 3, 8, 8],
                features: [
                    {
                        type: "Feature",
                        geometry: {
                            type: "LineString",
                            coordinates: [
                                [2, 2],
                                [3, 3],
                            ],
                        },
                        properties: {},
                    },
                ],
            }),
        );
        registerMeasuringSource("pack-1", "coastline", "/test/pack1.json");
        registerMeasuringSource("pack-2", "coastline", "/test/pack2.json");

        const result = await loadLineBundle("coastline");

        expect(result).not.toBeNull();
        expect(result!.features).toHaveLength(2);
        expect(result!.source).toContain("pack1");
        expect(result!.source).toContain("pack2");
        expect(result!.extractBbox[0]).toBe(0);
        expect(result!.extractBbox[2]).toBeGreaterThanOrEqual(8);
    });

    it("caches the merged result so getLineBundle is sync afterwards", async () => {
        fsCache["/test/sync.json"] = JSON.stringify(
            makeBundle("coastline", {
                source: "pack-sync",
                features: [
                    {
                        type: "Feature",
                        geometry: {
                            type: "LineString",
                            coordinates: [
                                [0, 0],
                                [10, 10],
                            ],
                        },
                        properties: {},
                    },
                ],
            }),
        );
        registerMeasuringSource("sync-pack", "coastline", "/test/sync.json");

        await loadLineBundle("coastline");
        const cached = getLineBundle("coastline");
        expect(cached).not.toBeNull();
        expect(cached!.source).toBe("pack-sync");
    });

    it("returns null when no sources exist for a category", async () => {
        __clearLineBundlesForTest();
        __clearPackSourcesForTest();
        const result = await loadLineBundle("coastline");
        expect(result).toBeNull();
    });
});
```

- [ ] **Step 6: Update other measuring tests that require bundled files**

Find tests that `require()` bundled measuring assets:

```bash
rg "assets/measuring" src/features/questions/measuring/__tests__/ src/features/map/__tests__/
```

For each, replace with `__setLineBundleForTest` or a synthetic fixture.

At minimum, update:

- `src/features/questions/measuring/__tests__/lineMeasuringGeometry.test.ts`
- `src/features/questions/measuring/__tests__/bodyWaterMask.geos.test.ts`
- `src/features/questions/measuring/__tests__/measuringDissolve.geos.test.ts`
- `src/features/questions/measuring/__tests__/measuringGeometry.test.ts`

If a test only needs a few features, inject a minimal synthetic bundle. If it needs real geometry, keep the asset until after tests are updated, then delete in Task 12.

- [ ] **Step 7: Run tests**

```bash
pnpm test -- src/features/questions/measuring/__tests__/lineBundleLoader.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/questions/measuring/lineBundleLoader.ts src/features/questions/measuring/__tests__/lineBundleLoader.test.ts
git commit -m "refactor(measuring): remove bundled Japan measuring loaders"
```

---

### Task 10: Admin boundary loader collapse

**Files:**

- Modify: `src/features/questions/matching/adminBoundaryLoader.ts`
- Modify: `src/features/questions/matching/__tests__/adminBoundaryLoader.test.ts`

- [ ] **Step 1: Remove bundled `require()` and sync grid**

Delete the `getBundle()` function (lines 189-198).

Replace `queryAdminBoundary` (lines 222-257) with:

```ts
export function queryAdminBoundary(
    lng: number,
    lat: number,
    osmLevel: string,
): OsmFeatureWithDistance[] | null {
    // Sync path: only checks entries already in the polygon cache.
    // For pack-backed queries, callers should use queryAdminBoundaryAsync
    // which can decode polygons on demand.
    const levelNum = parseInt(osmLevel, 10);
    if (!Number.isFinite(levelNum)) return null;

    const entries = getAllBoundaryEntries().filter(
        (e) =>
            e.adminLevel === levelNum &&
            lng >= e.bbox[0] &&
            lng <= e.bbox[2] &&
            lat >= e.bbox[1] &&
            lat <= e.bbox[3],
    );

    // Return null to signal "not in cache — call async variant".
    if (entries.length > 0) return null;

    return null;
}
```

- [ ] **Step 2: Rewrite `queryAdminBoundaryAsync`**

Replace lines 263-317 with:

```ts
export async function queryAdminBoundaryAsync(
    lng: number,
    lat: number,
    osmLevel: string,
): Promise<OsmFeatureWithDistance[] | null> {
    const levelNum = parseInt(osmLevel, 10);
    if (!Number.isFinite(levelNum)) return null;

    const entries = getAllBoundaryEntries().filter(
        (e) =>
            e.adminLevel === levelNum &&
            lng >= e.bbox[0] &&
            lng <= e.bbox[2] &&
            lat >= e.bbox[1] &&
            lat <= e.bbox[3],
    );

    for (const entry of entries) {
        const match = findBoundaryRelation(entry.relationId);
        if (!match) continue;

        const coords = await getBoundaryPolygon(match.packId, entry.relationId);
        if (!coords || coords.length === 0) continue;

        const geometry = multiPolygonCoordsToGeoJSON(coords);
        if (pointInGeometry(lng, lat, geometry)) {
            return [
                {
                    lat,
                    lon: lng,
                    name: entry.nameEn ?? entry.name,
                    osmId: entry.relationId,
                    osmType: "relation",
                    tags: {
                        "name:en": entry.nameEn ?? "",
                        admin_level: String(entry.adminLevel),
                    },
                    distanceMeters: 0,
                },
            ];
        }
    }

    return null;
}
```

- [ ] **Step 3: Keep `setAdminBoundaryBundle` for tests**

The test seam should still inject into a `_bundle` variable and the sync grid path should use it. However, since we removed the grid, we need to keep a minimal in-memory bundle for tests.

Add at module level:

```ts
let _testBundle: AdminBoundaryBundle | null = null;
```

Update `setAdminBoundaryBundle`:

```ts
export function setAdminBoundaryBundle(
    bundle: AdminBoundaryBundle | null,
): void {
    _testBundle = bundle;
    gridCache.clear();
}
```

Update `queryAdminBoundary` and `queryAdminBoundaryAsync` to check `_testBundle` first and route through the existing grid logic. Simpler: keep the grid logic but only when `_testBundle` is set.

A pragmatic approach: keep `getBundle()` returning `_testBundle`, and keep `queryBundleGrid` for tests. Update `getBundle` to:

```ts
function getBundle(): AdminBoundaryBundle | null {
    return _testBundle ?? null;
}
```

Then `queryAdminBoundary` and `queryAdminBoundaryAsync` can keep their original bundled-bundle checks, which now only hit `_testBundle`.

- [ ] **Step 4: Verify callers handle async path**

Search for `queryAdminBoundary` callers:

```bash
rg "queryAdminBoundary\b" src/
```

Ensure every caller that may hit a pack source awaits `queryAdminBoundaryAsync` when `queryAdminBoundary` returns `null`.

- [ ] **Step 5: Run tests**

```bash
pnpm test -- src/features/questions/matching/__tests__/adminBoundaryLoader.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/questions/matching/adminBoundaryLoader.ts
git commit -m "refactor(admin): remove bundled Japan admin boundary sync loader"
```

---

### Task 11: Coverage badge Japan short-circuit removal

**Files:**

- Modify: `src/features/offline/coverage.ts`
- Modify: `src/features/offline/__tests__/coverage.test.ts`

- [ ] **Step 1: Remove bundled Japan constants and functions**

Delete lines 48-85:

```ts
const BUNDLED_REGION_BBOXES: ...
export function isBboxInJapan(_bbox: Bbox): boolean { ... }
function isCoveredByBundledJapan(_bbox: Bbox): boolean { ... }
```

- [ ] **Step 2: Remove Japan short-circuit from `getCoverageStatus`**

Delete lines 106-113:

```ts
// 1. Bundled Japan regions are always covered.
if (isCoveredByBundledJapan(playAreaBbox)) {
    return {
        state: "covered",
        packId: "japan-bundled",
        updateAvailable: false,
    };
}
```

Renumber the remaining rules in the comment (1→installed, 2→catalog, etc.).

- [ ] **Step 3: Update coverage tests**

Replace the "Bundled Japan" describe block in `coverage.test.ts` with a test that Japan now shows `available` when a catalog pack intersects:

```ts
describe("getCoverageStatus — Japan (pack-only)", () => {
    it("returns available for Japan when a catalog pack intersects but none installed", () => {
        const catalog = [
            makeCatalogPack({
                id: "asia-japan-kanto",
                label: "Kanto",
                bbox: JP_KANTO_BBOX,
            }),
        ];
        const result = getCoverageStatus(JP_KANTO_BBOX, catalog, []);
        expect(result.state).toBe("available");
        if (result.state === "available") {
            expect(result.packId).toBe("asia-japan-kanto");
        }
    });

    it("returns covered for Japan when the pack is installed", () => {
        const installed = [
            makeInstalledPack({
                id: "asia-japan-kanto",
                bbox: JP_KANTO_BBOX,
            }),
        ];
        const result = getCoverageStatus(JP_KANTO_BBOX, [], installed);
        expect(result.state).toBe("covered");
        if (result.state === "covered") {
            expect(result.packId).toBe("asia-japan-kanto");
        }
    });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- src/features/offline/__tests__/coverage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/offline/coverage.ts src/features/offline/__tests__/coverage.test.ts
git commit -m "refactor(coverage): remove bundled Japan always-covered short-circuit"
```

---

## Phase 4 — Delete assets & prune pipelines

### Task 12: Delete bundled Japan assets

**Files:**

- Delete: `assets/poi/japan-kanto.json`
- Delete: `assets/poi/japan-kanto.stats.json`
- Delete: `assets/poi/regions.json`
- Delete: `assets/measuring/*.json`
- Delete: `assets/transit/japan-*.json`
- Delete: `assets/transit/manifest.json`
- Keep: `assets/default-zones/tokyo.json`, `assets/default-zones/tokyo-metadata.json`

- [ ] **Step 1: Delete files**

```bash
rm assets/poi/japan-kanto.json \
   assets/poi/japan-kanto.stats.json \
   assets/poi/regions.json
rm assets/measuring/*.json
rm assets/transit/japan-*.json assets/transit/manifest.json
```

- [ ] **Step 2: Verify no dangling require()**

```bash
pnpm typecheck
```

Expected: no errors about missing assets. If a test or source file still `require()`s a deleted asset, fix it before continuing.

- [ ] **Step 3: Run tests**

```bash
pnpm test
```

Expected: PASS (may reveal tests still depending on deleted assets).

- [ ] **Step 4: Commit**

```bash
git add assets/
git commit -m "chore(assets): delete bundled Japan POI/measuring/transit assets"
```

---

### Task 13: Prune bundled-emit data scripts

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Review and update package.json scripts**

Change:

```json
"data:poi": "pnpm data:poi-selectors && node data/geofabrik/scripts/fetch-geofabrik.mjs --bundle",
"data:geofabrik:bundle": "node data/geofabrik/scripts/fetch-geofabrik.mjs --cache-only --bundle",
```

Remove or rename `data:measuring` if it only emitted bundled assets. If it is also used by the packs pipeline, keep it but ensure it no longer writes to `assets/measuring/`.

The packs pipeline uses separate scripts (e.g., `data:poi:packs`, `data:geofabrik:packs`). Verify:

```bash
rg "assets/(poi|measuring|transit)" data/ scripts/
```

Remove any remaining bundled-emit paths.

- [ ] **Step 2: Update `pretest`**

The `pretest` script currently includes data pipeline tests. Remove any tests that guarded bundled-emit behavior. Keep pack-pipeline tests.

- [ ] **Step 3: Update drift guards**

`test:data:poi-selectors` and `test:data:default-zones` should remain (they guard committed selectors/default-zone metadata). `test:data:geofabrik` may need to be removed if it only tested bundled extraction.

- [ ] **Step 4: Run checks**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore(scripts): remove bundled-emit data pipeline scripts"
```

---

## Phase 5 — Docs & cleanup

### Task 14: Update AGENTS.md

**Files:**

- Modify: `AGENTS.md`

- [ ] **Step 1: Update "Bundled POI and Measuring Data" section**

Rewrite to state that Japan POI/measuring data is no longer bundled; it ships via downloadable packs. The only bundled Japan asset is the Tokyo 23 Wards boundary placeholder.

- [ ] **Step 2: Update "Offline Pack Rules" bundled-vs-published table**

Add a row or note: Japan game data (POI/measuring/transit/admin) is published via packs; only the Tokyo boundary is bundled.

- [ ] **Step 3: Update "Default play area" section**

State that `defaultPlayArea` is the Tokyo boundary placeholder and game data requires a pack download.

- [ ] **Step 4: Update "Hiding Zone Rules"**

Remove references to bundled transit; state that hiding-zone presets come from installed packs.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): update for pack-only Japan data"
```

---

### Task 15: Finalize implementer's log

**Files:**

- Modify: `docs/tasks/remove-bundle/implementers-log.md`

- [ ] **Step 1: Mark all Phase 1-5 tasks complete**

Check off every item in the log.

- [ ] **Step 2: Add final verification entry**

```markdown
## Final verification

- [x] `pnpm typecheck && pnpm test && pnpm check` green
- [x] Smoke E2E green
- [x] Binary size reduction noted: ~68 MB → ~175 KB Japan data in binary
- [x] Accepted regressions documented: <list>
```

- [ ] **Step 3: Commit**

```bash
git add docs/tasks/remove-bundle/implementers-log.md
git commit -m "docs(remove-bundle): finalize implementer's log"
```

---

## Final gate

- [ ] Run full verification:

```bash
pnpm typecheck && pnpm test && pnpm check
```

- [ ] Run smoke E2E (or GitHub Actions `Maestro E2E` workflow):

```bash
pnpm test:e2e:stack
```

- [ ] Confirm `assets/default-zones/` contains only `tokyo.json` + `tokyo-metadata.json`, and no `assets/poi/japan-*`, `assets/measuring/*.json`, or `assets/transit/japan-*` files remain.

When all gates pass, the task is complete.
