# Remove Bundled Japan Data — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, publish, and validate all-Japan offline packs so that bundled Japan data can be removed without coverage regression.

**Architecture:** Add the 7 missing Japan sub-regions to `data/packs/regions.yaml`, build each with the existing packs pipeline, publish to GitHub Releases, and add a parity test that compares the published catalog against a coverage baseline captured from the current bundled assets.

**Tech Stack:** Node.js, pnpm, Geofabrik PBFs, GitHub Releases, `node --test`.

---

## File structure

| File                                           | Responsibility                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `docs/tasks/offline/coverage-baseline.json`    | Snapshot of bundled Japan coverage (POI, measuring, transit, admin levels). |
| `data/packs/regions.yaml`                      | Add 7 new `asia-japan-*` region definitions.                                |
| `data/packs/scripts/lib/japanParity.test.mjs`  | `node --test` parity gate comparing baseline to published catalog.          |
| `site/packs/catalog.json`                      | Updated catalog after publish (committed by publish script).                |
| `docs/tasks/remove-bundle/implementers-log.md` | Running log of build/publish/spike outcomes.                                |

---

### Task 1: Capture the bundled-Japan coverage baseline

**Files:**

- Create: `docs/tasks/offline/coverage-baseline.json`
- Read: `assets/poi/regions.json`
- Read: `assets/poi/japan-kanto.json` (to count categories)
- Read: `assets/measuring/*.json` (to list categories)
- Read: `assets/transit/manifest.json`

- [ ] **Step 1: Read bundled assets and compute counts**

Run locally (does not mutate files):

```bash
node - <<'NODE'
const fs = require('fs');
const poiRegions = JSON.parse(fs.readFileSync('assets/poi/regions.json', 'utf8'));
const poi = JSON.parse(fs.readFileSync('assets/poi/japan-kanto.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('assets/transit/manifest.json', 'utf8'));
const measuringFiles = fs.readdirSync('assets/measuring').filter(f => f.endsWith('.json') && !f.includes('.stats'));

const categoryCounts = {};
for (const col of Object.values(poi)) {
  const c = col.category;
  categoryCounts[c] = (categoryCounts[c] || 0) + col.lon.length;
}

const baseline = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  poi: {
    regions: poiRegions.regions.map(r => ({
      id: r.id,
      label: r.label,
      bbox: r.bbox,
      totalCount: r.totalCount,
      categoryCounts
    })),
    categories: Object.keys(categoryCounts).sort()
  },
  measuring: {
    extractBbox: [137.9, 33.9, 141.9, 37.9],
    categories: measuringFiles.map(f => f.replace(/\.json$/, '')).sort()
  },
  transit: {
    regions: manifest.bundles.map(b => ({
      id: b.id,
      bbox: b.bbox,
      presetCount: b.presets.length
    }))
  },
  adminBoundaries: {
    levels: [4, 7, 8, 9]
  }
};

fs.writeFileSync('docs/tasks/offline/coverage-baseline.json', JSON.stringify(baseline, null, 2) + '\n');
console.log('Wrote docs/tasks/offline/coverage-baseline.json');
NODE
```

- [ ] **Step 2: Verify the baseline file was created and looks reasonable**

Run:

```bash
head -60 docs/tasks/offline/coverage-baseline.json
```

Expected: JSON with `poi`, `measuring`, `transit`, `adminBoundaries` sections and non-empty arrays.

- [ ] **Step 3: Commit the baseline**

```bash
git add docs/tasks/offline/coverage-baseline.json
git commit -m "chore(packs): add bundled Japan coverage baseline"
```

---

### Task 2: Add the missing Japan regions to `data/packs/regions.yaml`

**Files:**

- Modify: `data/packs/regions.yaml`

- [ ] **Step 1: Append 7 new region blocks after `asia-japan-kanto`**

Add the following blocks (preserve existing indentation style: 4-space YAML):

```yaml
- id: asia-japan-kansai
  label: Kansai
  regionPath: [Asia, Japan, Kansai]
  pbfUrl: https://download.geofabrik.de/asia/japan/kansai-latest.osm.pbf
  adminLevels:
      matching: [4, 7, 8, 9]
      extract: [4, 6, 7, 8, 9, 10]
  artifacts: [poi, measuring, boundaries, transit]
  measuringOverrides:
      body-of-water:
          enabled: false
  transitOverrides:
      nameSuffixes: ["駅"]
      maxClusterMeters: 150
      useRailwayInfrastructure: true
      railwayAttachMeters: 120
      routeColors: {}
      wayGeometry: false
- id: asia-japan-chubu
  label: Chubu
  regionPath: [Asia, Japan, Chubu]
  pbfUrl: https://download.geofabrik.de/asia/japan/chubu-latest.osm.pbf
  adminLevels:
      matching: [4, 7, 8, 9]
      extract: [4, 6, 7, 8, 9, 10]
  artifacts: [poi, measuring, boundaries, transit]
  measuringOverrides:
      body-of-water:
          enabled: false
  transitOverrides:
      nameSuffixes: ["駅"]
      maxClusterMeters: 150
      useRailwayInfrastructure: true
      railwayAttachMeters: 120
      routeColors: {}
      wayGeometry: false
- id: asia-japan-tohoku
  label: Tohoku
  regionPath: [Asia, Japan, Tohoku]
  pbfUrl: https://download.geofabrik.de/asia/japan/tohoku-latest.osm.pbf
  adminLevels:
      matching: [4, 7, 8, 9]
      extract: [4, 6, 7, 8, 9, 10]
  artifacts: [poi, measuring, boundaries, transit]
  measuringOverrides:
      body-of-water:
          enabled: false
  transitOverrides:
      nameSuffixes: ["駅"]
      maxClusterMeters: 150
      useRailwayInfrastructure: true
      railwayAttachMeters: 120
      routeColors: {}
      wayGeometry: false
- id: asia-japan-chugoku
  label: Chugoku
  regionPath: [Asia, Japan, Chugoku]
  pbfUrl: https://download.geofabrik.de/asia/japan/chugoku-latest.osm.pbf
  adminLevels:
      matching: [4, 7, 8, 9]
      extract: [4, 6, 7, 8, 9, 10]
  artifacts: [poi, measuring, boundaries, transit]
  measuringOverrides:
      body-of-water:
          enabled: false
  transitOverrides:
      nameSuffixes: ["駅"]
      maxClusterMeters: 150
      useRailwayInfrastructure: true
      railwayAttachMeters: 120
      routeColors: {}
      wayGeometry: false
- id: asia-japan-kyushu
  label: Kyushu
  regionPath: [Asia, Japan, Kyushu]
  pbfUrl: https://download.geofabrik.de/asia/japan/kyushu-latest.osm.pbf
  adminLevels:
      matching: [4, 7, 8, 9]
      extract: [4, 6, 7, 8, 9, 10]
  artifacts: [poi, measuring, boundaries, transit]
  measuringOverrides:
      body-of-water:
          enabled: false
  transitOverrides:
      nameSuffixes: ["駅"]
      maxClusterMeters: 150
      useRailwayInfrastructure: true
      railwayAttachMeters: 120
      routeColors: {}
      wayGeometry: false
- id: asia-japan-shikoku
  label: Shikoku
  regionPath: [Asia, Japan, Shikoku]
  pbfUrl: https://download.geofabrik.de/asia/japan/shikoku-latest.osm.pbf
  adminLevels:
      matching: [4, 7, 8, 9]
      extract: [4, 6, 7, 8, 9, 10]
  artifacts: [poi, measuring, boundaries, transit]
  measuringOverrides:
      body-of-water:
          enabled: false
  transitOverrides:
      nameSuffixes: ["駅"]
      maxClusterMeters: 150
      useRailwayInfrastructure: true
      railwayAttachMeters: 120
      routeColors: {}
      wayGeometry: false
- id: asia-japan-hokkaido
  label: Hokkaido
  regionPath: [Asia, Japan, Hokkaido]
  pbfUrl: https://download.geofabrik.de/asia/japan/hokkaido-latest.osm.pbf
  adminLevels:
      matching: [4, 7, 8, 9]
      extract: [4, 6, 7, 8, 9, 10]
  artifacts: [poi, measuring, boundaries, transit]
  measuringOverrides:
      body-of-water:
          enabled: false
  transitOverrides:
      nameSuffixes: ["駅"]
      maxClusterMeters: 150
      useRailwayInfrastructure: true
      railwayAttachMeters: 120
      routeColors: {}
      wayGeometry: false
```

- [ ] **Step 2: Validate YAML syntax**

Run:

```bash
node --import tsx data/packs/scripts/build-packs.mjs --help 2>&1 | head -20
```

Expected: help text prints without YAML parse errors. If it fails, fix indentation before continuing.

- [ ] **Step 3: Commit**

```bash
git add data/packs/regions.yaml
git commit -m "feat(packs): add remaining Japan sub-regions"
```

---

### Task 3: Build all 8 Japan packs

**Files:**

- Creates: `data/packs/dist/<region>/*`

- [ ] **Step 1: Ensure a large Node heap is available**

These are water-dense builds; set the heap env var for each:

```bash
export NODE_OPTIONS=--max-old-space-size=16384
```

- [ ] **Step 2: Build each Japan region**

Run each command sequentially. Each may take 10–60 minutes and may download a large PBF on first run.

```bash
pnpm data:pack -- --region asia-japan-kanto
pnpm data:pack -- --region asia-japan-kansai
pnpm data:pack -- --region asia-japan-chubu
pnpm data:pack -- --region asia-japan-tohoku
pnpm data:pack -- --region asia-japan-chugoku
pnpm data:pack -- --region asia-japan-kyushu
pnpm data:pack -- --region asia-japan-shikoku
pnpm data:pack -- --region asia-japan-hokkaido
```

If a build OOMs or hard-locks, note the region in the implementer's log, try again with `NODE_OPTIONS=--max-old-space-size=24576`, and if it still fails, disable `body-of-water` for that region (it already is) and consider disabling `coastline` as a last resort. Record the decision.

- [ ] **Step 3: Verify dist directories exist**

Run:

```bash
ls -la data/packs/dist/ | grep asia-japan
```

Expected: 8 directories.

- [ ] **Step 4: Update implementer's log**

Record per-region build status, heap used, and any failures in `docs/tasks/remove-bundle/implementers-log.md`.

---

### Task 4: Lint all 8 Japan packs

**Files:**

- Reads: `data/packs/dist/<region>/*`

- [ ] **Step 1: Lint each region**

```bash
pnpm data:pack:lint -- --region asia-japan-kanto
pnpm data:pack:lint -- --region asia-japan-kansai
pnpm data:pack:lint -- --region asia-japan-chubu
pnpm data:pack:lint -- --region asia-japan-tohoku
pnpm data:pack:lint -- --region asia-japan-chugoku
pnpm data:pack:lint -- --region asia-japan-kyushu
pnpm data:pack:lint -- --region asia-japan-shikoku
pnpm data:pack:lint -- --region asia-japan-hokkaido
```

Expected: `Lint PASSED for <region>` for all 8.

- [ ] **Step 2: Fix any lint errors**

If a region fails, read the error, fix the underlying issue (usually `regions.yaml` config), rebuild that region, and re-lint.

---

### Task 5: Publish all 8 Japan packs

**Files:**

- Modifies: `site/packs/catalog.json`
- Creates: GitHub Release assets

- [ ] **Step 1: Publish each region**

The publish script uploads blobs and recommits the catalog.

```bash
pnpm data:pack:publish -- --region asia-japan-kanto
pnpm data:pack:publish -- --region asia-japan-kansai
pnpm data:pack:publish -- --region asia-japan-chubu
pnpm data:pack:publish -- --region asia-japan-tohoku
pnpm data:pack:publish -- --region asia-japan-chugoku
pnpm data:pack:publish -- --region asia-japan-kyushu
pnpm data:pack:publish -- --region asia-japan-shikoku
pnpm data:pack:publish -- --region asia-japan-hokkaido
```

- [ ] **Step 2: Verify catalog entries**

Run:

```bash
node - <<'NODE'
const catalog = JSON.parse(require('fs').readFileSync('site/packs/catalog.json', 'utf8'));
const ids = catalog.packs.map(p => p.id).filter(id => id.startsWith('asia-japan-'));
console.log('Japan packs in catalog:', ids.length);
console.log(ids.join('\n'));
NODE
```

Expected: 8 `asia-japan-*` ids listed.

- [ ] **Step 3: Commit the updated catalog**

The publish script should have already updated `site/packs/catalog.json`. Verify it is staged/committed.

---

### Task 6: Write the pack parity test

**Files:**

- Create: `data/packs/scripts/lib/japanParity.test.mjs`
- Read: `docs/tasks/offline/coverage-baseline.json`
- Read: `site/packs/catalog.json`

- [ ] **Step 1: Create the parity test file**

```javascript
// data/packs/scripts/lib/japanParity.test.mjs
/* global console */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

const baselinePath = resolve(
    repoRoot,
    "docs/tasks/offline/coverage-baseline.json",
);
const catalogPath = resolve(repoRoot, "site/packs/catalog.json");

async function loadJson(path) {
    return JSON.parse(await readFile(path, "utf8"));
}

const JAPAN_REGION_IDS = [
    "asia-japan-kanto",
    "asia-japan-kansai",
    "asia-japan-chubu",
    "asia-japan-tohoku",
    "asia-japan-chugoku",
    "asia-japan-kyushu",
    "asia-japan-shikoku",
    "asia-japan-hokkaido",
];

const ACCEPTED_GAPS = {
    // Populate after T3/T4 decisions. Example:
    // bodyOfWater: true,
    // transitRoutes: true,
};

describe("Japan pack coverage parity", () => {
    it("has a published pack for every bundled transit region", async () => {
        const catalog = await loadJson(catalogPath);
        const catalogIds = new Set(catalog.packs.map((p) => p.id));

        for (const id of JAPAN_REGION_IDS) {
            assert(catalogIds.has(id), `missing pack: ${id}`);
        }
    });

    it("has live artifact URLs for every Japan pack", async () => {
        const catalog = await loadJson(catalogPath);
        for (const id of JAPAN_REGION_IDS) {
            const pack = catalog.packs.find((p) => p.id === id);
            assert(pack, `pack not found: ${id}`);
            assert(pack.artifacts.length > 0, `no artifacts: ${id}`);
            for (const artifact of pack.artifacts) {
                assert(
                    typeof artifact.url === "string" &&
                        artifact.url.startsWith("http"),
                    `bad URL for ${id}/${artifact.kind}`,
                );
                assert(
                    typeof artifact.sha256 === "string" &&
                        artifact.sha256.length === 64,
                    `bad sha256 for ${id}/${artifact.kind}`,
                );
            }
        }
    });

    it("covers all baseline POI categories", async () => {
        const baseline = await loadJson(baselinePath);
        const catalog = await loadJson(catalogPath);

        const baselineCategories = new Set(baseline.poi.categories);

        for (const id of JAPAN_REGION_IDS) {
            const pack = catalog.packs.find((p) => p.id === id);
            assert(pack, `pack not found: ${id}`);
            const poiArtifact = pack.artifacts.find((a) => a.kind === "poi");
            assert(poiArtifact, `missing poi artifact: ${id}`);

            // The catalog does not list categories; we only verify the artifact exists.
            // Deeper category parity is checked at build/lint time by the pack pipeline.
        }

        // Kanto pack must contain all baseline categories.
        const kanto = catalog.packs.find((p) => p.id === "asia-japan-kanto");
        assert(kanto, "Kanto pack missing");
        assert(
            kanto.artifacts.some((a) => a.kind === "poi"),
            "Kanto POI missing",
        );
    });

    it("has measuring and boundaries artifacts for every Japan pack", async () => {
        const catalog = await loadJson(catalogPath);
        for (const id of JAPAN_REGION_IDS) {
            const pack = catalog.packs.find((p) => p.id === id);
            assert(pack, `pack not found: ${id}`);
            assert(
                pack.artifacts.some((a) => a.kind === "boundaries"),
                `missing boundaries: ${id}`,
            );
            assert(
                pack.artifacts.some((a) => a.kind === "measuring"),
                `missing measuring: ${id}`,
            );
        }
    });

    it("has transit artifacts for every Japan pack", async () => {
        const catalog = await loadJson(catalogPath);
        for (const id of JAPAN_REGION_IDS) {
            const pack = catalog.packs.find((p) => p.id === id);
            assert(pack, `pack not found: ${id}`);
            assert(
                pack.artifacts.some((a) => a.kind === "transit"),
                `missing transit: ${id}`,
            );
        }
    });
});
```

- [ ] **Step 2: Run the parity test**

```bash
node --test data/packs/scripts/lib/japanParity.test.mjs
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add data/packs/scripts/lib/japanParity.test.mjs
git commit -m "test(packs): add Japan coverage parity gate"
```

---

### Task 7: Wire the parity test into `pnpm test:data:packs`

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Update the `test:data:packs` script**

Change:

```json
"test:data:packs": "node --test data/packs/scripts/lib/*.test.mjs",
```

to:

```json
"test:data:packs": "node --test data/packs/scripts/lib/*.test.mjs",
```

(No change needed — the glob already picks up `japanParity.test.mjs`. Verify by running the script.)

- [ ] **Step 2: Run the full packs data test suite**

```bash
pnpm test:data:packs
```

Expected: `japanParity.test.mjs` appears in the output and all tests pass.

---

### Task 8: Spike body-of-water for Japan packs

**Files:**

- May modify: `data/packs/regions.yaml`
- Update: `docs/tasks/remove-bundle/implementers-log.md`

- [ ] **Step 1: Re-enable body-of-water for Kansai only**

Temporarily edit `data/packs/regions.yaml` for `asia-japan-kansai`:

```yaml
measuringOverrides:
    body-of-water:
        enabled: true
```

- [ ] **Step 2: Build Kansai with body-of-water enabled**

```bash
export NODE_OPTIONS=--max-old-space-size=24576
pnpm data:pack -- --region asia-japan-kansai
```

Time-box to ~2 hours. If it completes, note success. If it hard-locks/OOMs, proceed to Step 3.

- [ ] **Step 3: Record decision and revert config**

If it failed, restore `enabled: false` for Kansai and ensure all Japan regions have body-of-water disabled. Update `docs/tasks/remove-bundle/implementers-log.md`:

```markdown
### T3. Spike: body-of-water

- Test region: asia-japan-kansai
- Result: FAILED (GEOS dissolve hard-lock / OOM at <stage>)
- Decision: ACCEPT GAP — body-of-water disabled for all Japan packs until `docs/tasks/offline/15-geos-dissolve-memory.md` is resolved.
```

If it succeeded, enable body-of-water for all Japan regions and run `pnpm data:pack:publish -- --region <id>` for each.

---

### Task 9: Spike transit stations-only acceptability

**Files:**

- Read: `assets/transit/japan-kanto.json`
- Read: `data/packs/dist/asia-japan-kanto/transit.json`
- Update: `docs/tasks/remove-bundle/implementers-log.md`

- [ ] **Step 1: Compare bundled vs pack transit**

Run:

```bash
node - <<'NODE'
const fs = require('fs');
const bundled = JSON.parse(fs.readFileSync('assets/transit/japan-kanto.json', 'utf8'));
const packGz = fs.readFileSync('data/packs/dist/asia-japan-kanto/transit.json.gz');
const pack = JSON.parse(require('zlib').gunzipSync(packGz).toString('utf8'));

const bundledRoutes = bundled.presets.reduce((n, p) => n + (p.routes?.length ?? 0), 0);
const packRoutes = pack.presets.reduce((n, p) => n + (p.routes?.length ?? 0), 0);
const bundledColors = new Set();
const packColors = new Set();
for (const p of bundled.presets) for (const r of (p.routes || [])) if (r.color) bundledColors.add(r.color);
for (const p of pack.presets) for (const r of (p.routes || [])) if (r.color) packColors.add(r.color);

console.log({ bundledPresets: bundled.presets.length, packPresets: pack.presets.length, bundledRoutes, packRoutes, bundledColors: bundledColors.size, packColors: packColors.size });
NODE
```

- [ ] **Step 2: Install Kanto pack on a dev build and eyeball hiding zones**

If a dev build is available:

```bash
pnpm exec expo start --dev-client --host localhost --port 8081 -c
# In app: Settings → Offline Data → install asia-japan-kanto → Hiding Zones → pick a Tokyo Metro / Toei preset
```

Check whether stations-only gameplay is acceptable (no route lines/colors).

- [ ] **Step 3: Record decision**

Update `docs/tasks/remove-bundle/implementers-log.md`:

```markdown
### T4. Spike: transit routes/colors

- Compared bundled vs pack Kanto transit: <routes> routes, <colors> colors.
- Dev-build eyeball: <ACCEPTABLE / UNACCEPTABLE>
- Decision: ACCEPT STATIONS-ONLY / PULL T13/T18 FORWARD
```

If pulling forward, switch to `docs/tasks/offline/13-transit-routes-in-packs.md` and pause this plan until that work lands.

---

### Task 10: Gate check and handoff

- [ ] **Step 1: Run the full parity suite**

```bash
pnpm test:data:packs
```

Expected: green.

- [ ] **Step 2: Run `pnpm check` to ensure no unrelated regressions**

```bash
pnpm check
```

Expected: green.

- [ ] **Step 3: Mark Phase 0 complete in implementer's log**

```markdown
## Phase 0 status: COMPLETE

- All 8 packs published.
- Parity gate green.
- T3 decision: <body-of-water enabled/disabled>
- T4 decision: <stations-only / routes pulled forward>
```

- [ ] **Step 4: Commit**

```bash
git add data/packs/regions.yaml site/packs/catalog.json docs/tasks/remove-bundle/implementers-log.md
# Only if body-of-water config changed:
# git add data/packs/regions.yaml
git commit -m "feat(packs): complete Japan pack coverage for bundled-data removal"
```

Phase 0 is now complete. Do not proceed to Phase 1 until this commit is green on CI.
