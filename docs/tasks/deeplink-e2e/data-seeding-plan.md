# Plan: Real-data seeding for deep-link E2E (the "E2E fixture pack")

Status: **F1–F3 complete** (2026-06-22). F1a–F1d (transit), F2 (measuring:
high-speed-rail + body-of-water), F3 (boundaries + POI: 96 features / 8
categories) all shipped. Committed fixture is 96 KB across 6 artifacts.
Install function dynamically writes all manifest-declared artifacts.
Unblocks Phase D of `epic.md`.

## 1. The problem this solves

Every numeric Phase-D scenario (D1 totalPct band, D2 JS/GEOS parity, D3
station-name-length polarity, D5 multi-question ordering) and the data-heavy
ones (D6 body-of-water) need a **populated hiding zone**:
`useEliminationPercentage` returns `null` unless `zoneFeatures.features.length >
0`, and `zoneFeatures` derives from `selectedStations`, which derives from
**transit presets registered by installed offline packs**
(`src/features/hidingZone/hidingZoneData.ts`).

The seed format only carries `selectedPresetIds`
(`hidingZonesWireSchema` — no raw stations), and a fresh E2E dev build has **no
packs installed** (the default Tokyo play area is a boundary-only placeholder).
So `selectedPresetIds` resolve to nothing → no stations → no numbers. Confirmed
on-device: the C4 smoke run showed `ready=1` but no `totalPct` and an empty
station count.

**We will not** invent synthetic stations. We build a **tiny slice of real OSM
data** with the existing packs pipeline, commit it as a frozen fixture, and
pre-install it behind the E2E gate so scenarios get real, deterministic stations
(and later POI / measuring / boundaries).

## 2. Design: a committed, pre-installed "E2E fixture pack"

```
data/packs/scripts/lib/build*.mjs   (REUSED, unchanged)
        │  run on a small clipped real PBF
        ▼
assets/e2e-fixture/<id>/*.json       (COMMITTED frozen artifacts — small)
        │  bundled into the app
        ▼
installE2eFixturePack()              (NEW, gated by E2E_HOOKS_ENABLED)
        │  copy bundled artifacts → Paths.document/packs/<id>/…
        │  write installed-index entry, then loadInstalledPacks()
        ▼
registerTransitSource / registerRegion / registerMeasuringSource / registerBoundarySource
        │  (the SAME runtime seams real packs use)
        ▼
scenario.state.hidingZones.selectedPresetIds = ["e2e-fixture:tokyo-rail"]
        →  real stations → zoneFeatures → totalPct computable
```

Key properties:

- **Real data, built the pack way.** Reuses `buildTransit.mjs`,
  `extractPois.mjs`, `buildMeasuring.mjs`, `buildBoundaries.mjs` — same
  artifact schemas (`packSchemas.ts`), same registration seams, so the fixture
  exercises the production data path end to end. No parallel fake-data code to
  drift.
- **Committed, unlike real packs.** Real pack blobs live in git-ignored
  `data/packs/dist/` and ship via GitHub Releases. The fixture is the opposite:
  a **committed** asset (like the ~175 KB Tokyo boundary placeholder), so the
  E2E run needs no network and is byte-stable.
- **Gated + inert.** Pre-install runs only when `E2E_HOOKS_ENABLED`; the bundled
  asset is ~sub-MB. Metro resolves `require("…/transit.json")` at bundle time
  regardless of runtime gating, so the ~40 KB fixture JSON ships in all binaries.
  The gate prevents execution, not bundling — accepted cost given the tiny size.
- **Frozen snapshot.** Like the GEOS golden fixtures: rebuilding is an explicit,
  reviewed action (`pnpm data:e2e-fixture`), not a CI step. OSM drift is handled
  by re-observing scenario bands when you intentionally rebuild.

## 3. Region & clip choice

- **Region:** Tokyo core, coherent with the bundled default play area (Tokyo 23
  Wards, relation `19631009`). A scenario's play-area bbox must intersect the
  fixture preset bbox for stations to load, so reusing Tokyo keeps everything
  aligned.
- **Clip:** a ~5–10 km² bbox dense with named rail stations and with **varied
  station-name lengths** (required for D3 station-name-length). Candidate:
  Shinjuku–Shibuya–Tokyo-station triangle, e.g. `139.69,35.66,139.78,35.70`
  (tune to land ~15–40 stations). Include a touch of Tokyo Bay water on the east
  edge later for D6 (v2).
- **Source PBF:** a Geofabrik Japan/Kantō PBF (developer fetches via the
  existing pbf cache flow; git-ignored). Clip once with
  `osmium extract --bbox <W,S,E,N> kanto-latest.osm.pbf -o e2e-tokyo.osm.pbf`.
  The clipped PBF is a git-ignored intermediate; **only the built JSON is
  committed.**

## 4. Build pipeline (`pnpm data:e2e-fixture`)

A dedicated script `data/packs/scripts/build-e2e-fixture.mjs` (kept **separate
from `regions.yaml`** so the fixture never enters the published catalog / dist):

1. Reads a small inline config (id `e2e-fixture`, bbox, source clipped PBF path,
   enabled artifacts, the one or two POI/measuring categories needed).
2. Calls the same `scripts/lib/build*.mjs` builders the real pipeline uses.
3. Writes artifacts to the **committed** `assets/e2e-fixture/e2e-fixture/`:
   `transit.json`, `meta.json` (always); later `poi-<cat>.json`,
   `measuring-<cat>.json`, `boundaries.json`.
4. Records a `manifest.json` with the source PBF date + bbox + content hashes
   (provenance, so a rebuild diff is legible).

Add `pnpm data:e2e-fixture` (build) and `pnpm data:e2e-fixture:lint` (validate
the committed artifacts against `packSchemas.ts`, reusing `pack-lint.mjs`
logic). Document the osmium clip step in `data/packs/README.md`.

## 5. Runtime pre-install (gated)

New `src/testing/e2e/installE2eFixturePack.ts`, called from
`AppStateProviders.tsx` immediately before/around the existing
`loadInstalledPacks()` (line ~179), guarded by `E2E_HOOKS_ENABLED`:

1. **Resolve bundled artifacts.** JSON imported via Metro `require` (POI, parsed
   in-memory) and, for the lazy-loaded kinds (transit/measuring/boundaries),
   materialized to files. Because `registerTransitSource` /
   `registerMeasuringSource` / `registerBoundarySource` register a **file URI**
   that is read lazily by bbox, the artifacts must exist on disk at
   `Paths.document/packs/e2e-fixture/<kind>[-category].json`. Copy the bundled
   asset bytes there with `expo-asset` + `expo-file-system` (idempotent: skip if
   a version marker matches).
2. **Write the installed-index entry** for `e2e-fixture` (status `installed`,
   the artifact list), then call `loadInstalledPacks()` — this **reuses all the
   existing registration logic** (the `loadInstalledPacks` switch already reads
   files and calls the four seams). Net new code is just "copy bundled → disk +
   index entry."
3. `e2e-fixture` matches `VALID_PACK_ID` (`/^[a-z0-9][a-z0-9-]*$/i`); preset ids
   in the artifact must not contain `:` (the registrar prefixes
   `e2e-fixture:<presetId>`).

Alternative if asset→file copy proves fiddly on iOS: add a thin
`registerBundledFixture(rawArtifacts)` that writes the lazy files + registers
directly, bypassing the installed-index round-trip. Prefer reusing
`loadInstalledPacks` first.

## 6. Scenario integration

Scenarios that need elimination numbers add:

```json
"hidingZones": {
  "radiusMeters": 800,
  "radiusUnit": "m",
  "selectedPresetIds": ["e2e-fixture:tokyo-rail"]
}
```

with `playArea` = bundled Tokyo (or a Tokyo bbox). Add a readout key
`stations=<n>` (count of `selectedStations`) so a flow can assert the fixture
actually loaded (`assertVisible "e2e-readout:stations=[1-9][0-9]*"`) before
trusting `totalPct` — this catches a missing/empty fixture loudly instead of a
silent `null`.

## 7. Phasing (smallest first)

- **F1 — transit-only fixture.** `transit.json` + `meta.json`. Unblocks **D1,
  D2, D3, D5** using radar / thermometer questions (these eliminate against the
  zone and need no POI/measuring). Smallest committed footprint (~tens of KB).
- **F2 — + measuring.** Add `measuring-rail-station.json` and a water-inclusive
  clip + `measuring-body-of-water.json` → unblocks **D6** and a measuring-based
  D1 variant.
- **F3 — + boundaries / POI.** Add `boundaries.json` (+ a POI category) →
  unblocks admin-division and `matching` scenarios.

D1/D2/D3/D5 do **not** need to wait for F2/F3.

## 8. Determinism & refresh

- Artifacts are committed and frozen. `pnpm data:e2e-fixture` rebuilds; review
  the JSON diff like a golden-fixture regen.
- Scenario expected bands (D1/D3) are derived from an **observed run** ±
  tolerance, so an intentional rebuild → re-observe → update the band. Document
  this beside the scenarios.
- `manifest.json` pins the source PBF snapshot date so a rebuild is reproducible
  enough and drift is visible.

## 9. File inventory

| Path                                            | Purpose                            | New/changed |
| ----------------------------------------------- | ---------------------------------- | ----------- |
| `data/packs/scripts/build-e2e-fixture.mjs`      | build the fixture from a clip      | new         |
| `data/packs/scripts/build-e2e-fixture.test.mjs` | node test on a tiny sample PBF     | new         |
| `assets/e2e-fixture/e2e-fixture/*.json`         | **committed** frozen artifacts     | new         |
| `assets/e2e-fixture/e2e-fixture/manifest.json`  | provenance (PBF date, bbox, hash)  | new         |
| `src/testing/e2e/installE2eFixturePack.ts`      | gated pre-install                  | new         |
| `src/testing/e2e/__tests__/fixturePack.test.ts` | artifacts validate + install       | new         |
| `src/state/AppStateProviders.tsx`               | call install behind the gate       | changed     |
| `src/testing/e2e/E2eDebugReadout.tsx`           | add `stations=<n>` key             | changed     |
| `data/packs/scripts/lint-e2e-fixture.mjs`       | validate committed artifacts       | new         |
| `package.json`                                  | `data:e2e-fixture[:lint]` scripts  | changed     |
| `data/packs/README.md`                          | document the clip + rebuild        | changed     |
| `jest.setup.ts`                                 | support `new Directory()` in mocks | changed     |
| `scripts/e2e-maestro-stack.mjs`                 | register `deeplink-stations` flow  | changed     |

## 10. Risks / watch-items

- **asset → file copy on iOS** (§5 step 1) is the one genuinely native bit;
  validate it on the sim early (it mirrors what the pack downloader already does
  when writing artifacts). Falls back to `registerBundledFixture`.
- **bbox intersection** — the scenario's play-area bbox must overlap the fixture
  preset bbox or stations never load. Keep both Tokyo; assert `stations=<n>`.
- **size** — keep the committed fixture sub-MB; the transit-only F1 is tiny.
  Don't commit the PBF or clip.
- **OSM drift** — frozen artifacts + re-observe bands on rebuild; never assert
  exact station counts that a future rebuild would shift (use `> 0` / ranges).
- **gating** — install is gated (execution only, not bundling — Metro resolves the
  `require` calls in `AppStateProviders`'s dependency graph at bundle time, so the
  ~40 KB fixture JSON ships in all binaries; accepted cost).

## 11. Task breakdown (Phase F, do before Phase D numeric scenarios)

- **F1a** Build script + tiny committed transit fixture (`pnpm data:e2e-fixture`)
    - node test on a committed sample clip. 🤖🧪
- **F1b** `installE2eFixturePack` (gated) + AppStateProviders hook + jest test
  (artifacts validate vs `packSchemas`; install calls the seams with mocked
  FileSystem). 🔒🧪
- **F1c** `stations=<n>` readout key + formatting test. 🧪
- **F1d** A `deeplink-stations` flow proving stations load on-device
  (`assertVisible "e2e-readout:stations=..."`). 🤖 — the integration proof, and
  the precondition for D1/D2/D3/D5.
- **F2 / F3** measuring then boundaries/POI, as their scenarios need them.

## 12. Detailed implementation tasks (F1)

This section expands §11 into concrete, commit-sized steps. Execute in order; each task produces working, testable software.

---

### F1a: Build script + committed transit fixture

**Goal:** Generate `assets/e2e-fixture/e2e-fixture/{transit.json,meta.json,manifest.json}` from a clipped Kanto PBF using the production transit builder.

**Files:**

- Create: `data/packs/scripts/build-e2e-fixture.mjs`
- Create: `data/packs/scripts/build-e2e-fixture.test.mjs`
- Create: `data/packs/scripts/lint-e2e-fixture.mjs`
- Modify: `package.json`
- Modify: `data/packs/README.md`
- Create (after first run): `assets/e2e-fixture/e2e-fixture/*.json`

#### Step 1: Create the fixture builder

Create `data/packs/scripts/build-e2e-fixture.mjs`:

```js
#!/usr/bin/env node
/**
 * Build the committed E2E fixture pack.
 *
 * Intentionally separate from `regions.yaml` / `build-packs.mjs` so the fixture
 * never enters the published catalog or dist directory. It reuses the same
 * artifact builders, producing byte-identical schemas.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildTransitArtifact } from "./lib/buildTransit.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const FIXTURE_ID = "e2e-fixture";
const FIXTURE_BBOX = [139.69, 35.66, 139.78, 35.7]; // W,S,E,N — Tokyo core
const DEFAULT_SOURCE_PBF = join(
    REPO_ROOT,
    "data",
    "packs",
    "cache",
    "e2e-fixture",
    "e2e-tokyo.osm.pbf",
);
const OUT_DIR = join(REPO_ROOT, "assets", "e2e-fixture", FIXTURE_ID);
const CACHE_DIR = join(REPO_ROOT, "data", "packs", "cache", FIXTURE_ID);

/** Inline fixture config — not part of `regions.yaml`. */
export const fixtureConfig = {
    id: FIXTURE_ID,
    label: "E2E fixture (Tokyo core)",
    bbox: FIXTURE_BBOX,
    transitOverrides: {},
};

/**
 * Build the fixture artifacts.
 *
 * @param {object} [deps]
 * @param {string} [deps.pbfPath] - clipped source PBF
 * @param {string} [deps.outDir] - committed asset output directory
 * @param {string} [deps.cacheDir] - temp cache directory
 * @param {(opts: object) => Promise<{uncompressed: Buffer, presets: object[]}|null>} [deps.buildTransit]
 * @returns {Promise<void>}
 */
export async function buildE2eFixture({
    pbfPath = DEFAULT_SOURCE_PBF,
    outDir = OUT_DIR,
    cacheDir = CACHE_DIR,
    buildTransit = buildTransitArtifact,
} = {}) {
    await mkdir(cacheDir, { recursive: true });
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });

    const transitResult = await buildTransit({
        region: fixtureConfig,
        pbfPath,
        distDir: outDir,
        cacheDir,
    });

    if (!transitResult) {
        throw new Error(
            `No transit data found in ${pbfPath}. Check the bbox / clip.`,
        );
    }

    const transitJson = transitResult.uncompressed;
    await writeFile(join(outDir, "transit.json"), transitJson);

    // The builder also writes a .json.gz intermediate to distDir; keep only the
    // uncompressed committed JSON.
    await rm(join(outDir, "transit.json.gz"), { force: true });

    const meta = {
        schemaVersion: 1,
        regionId: FIXTURE_ID,
        label: fixtureConfig.label,
        bbox: FIXTURE_BBOX,
        osmSnapshot: new Date().toISOString().slice(0, 10),
        adminLevels: { matching: [4, 7, 9, 10] }, // Japan preset
        artifacts: ["transit.json"],
        attribution: {
            text: "© OpenStreetMap contributors. Data available under the Open Database License (ODbL).",
            license: "ODbL-1.0",
            url: "https://www.openstreetmap.org/copyright",
        },
    };
    const metaJson = JSON.stringify(meta, null, 2);
    await writeFile(join(outDir, "meta.json"), metaJson);

    const manifest = {
        id: FIXTURE_ID,
        sourcePbf: pbfPath,
        sourcePbfDate: meta.osmSnapshot,
        bbox: FIXTURE_BBOX,
        version: 1,
        artifacts: {
            "transit.json": {
                sha256: createHash("sha256").update(transitJson).digest("hex"),
                bytes: transitJson.length,
                presets: transitResult.presets.length,
                stations: transitResult.presets.reduce(
                    (sum, p) => sum + p.stations.length,
                    0,
                ),
            },
        },
        meta: {
            sha256: createHash("sha256").update(metaJson).digest("hex"),
            bytes: metaJson.length,
        },
    };
    await writeFile(
        join(outDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
    );

    console.log(`Wrote fixture to ${outDir}`);
    console.log(JSON.stringify(manifest, null, 2));
}

function main() {
    const args = process.argv.slice(2);
    const pbfFlag = args.find((a) => a.startsWith("--pbf="));
    const pbfPath = pbfFlag ? pbfFlag.slice("--pbf=".length) : undefined;

    buildE2eFixture({ pbfPath }).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    main();
}
```

#### Step 2: Add the build + lint commands

In `package.json`, add to `scripts`:

```json
"data:e2e-fixture": "node data/packs/scripts/build-e2e-fixture.mjs",
"data:e2e-fixture:lint": "node --import tsx data/packs/scripts/lint-e2e-fixture.mjs"
```

#### Step 3: Create the lint script

Create `data/packs/scripts/lint-e2e-fixture.mjs`:

```js
#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import {
    metaPayloadSchema,
    transitPayloadSchema,
} from "@/features/offline/packSchemas";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(
    __dirname,
    "..",
    "..",
    "..",
    "assets",
    "e2e-fixture",
    "e2e-fixture",
);

async function lintArtifact(name, schema, filename) {
    const path = join(FIXTURE_DIR, filename);
    const text = await readFile(path, "utf8");
    const raw = JSON.parse(text);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        console.error(`${filename} validation failed:`);
        for (const issue of parsed.error.issues) {
            console.error(`  ${issue.path.join(".")}: ${issue.message}`);
        }
        throw new Error(`${filename} invalid`);
    }
    const hash = createHash("sha256").update(text).digest("hex");
    console.log(
        `${filename}: OK (${text.length} bytes, sha256 ${hash.slice(0, 16)}…)`,
    );
}

async function main() {
    await lintArtifact("transit", transitPayloadSchema, "transit.json");
    await lintArtifact("meta", metaPayloadSchema, "meta.json");
    console.log("E2E fixture lint passed.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
```

#### Step 4: Document the clip step

Append to `data/packs/README.md` under a new heading:

````markdown
## E2E fixture pack

A tiny committed fixture pack lives in `assets/e2e-fixture/e2e-fixture/` and is
pre-installed when `EXPO_PUBLIC_E2E_HOOKS=1`. It supplies real Tokyo transit
stations to deep-link E2E scenarios without network.

### Clipping the source PBF

```bash
mkdir -p data/packs/cache/e2e-fixture
osmium extract --bbox 139.69,35.66,139.78,35.70 \
  data/packs/cache/asia-japan-kanto-latest.osm.pbf \
  -o data/packs/cache/e2e-fixture/e2e-tokyo.osm.pbf -O
```
````

### Building / refreshing the fixture

```bash
pnpm data:e2e-fixture
pnpm data:e2e-fixture:lint
```

Review the diff in `assets/e2e-fixture/e2e-fixture/` before committing; update
scenario expected bands if station counts shift.

````

#### Step 5: Run the clip + build once

```bash
mkdir -p data/packs/cache/e2e-fixture
osmium extract --bbox 139.69,35.66,139.78,35.70 \
  data/packs/cache/asia-japan-kanto-latest.osm.pbf \
  -o data/packs/cache/e2e-fixture/e2e-tokyo.osm.pbf -O

pnpm data:e2e-fixture
````

Expected output (approximate — exact counts depend on the OSM snapshot):

```text
Wrote fixture to /Users/ryantseng/projects/JetLagHideAndSeek/assets/e2e-fixture/e2e-fixture
{
  "id": "e2e-fixture",
  "sourcePbf": "...",
  "sourcePbfDate": "2026-06-22",
  "bbox": [139.69, 35.66, 139.78, 35.7],
  "version": 1,
  "artifacts": {
    "transit.json": {
      "sha256": "...",
      "bytes": 12345,
      "presets": 3,
      "stations": 27
    }
  },
  ...
}
```

If `stations` is outside 15–40, adjust `FIXTURE_BBOX` in the script and rerun.

#### Step 6: Add a node test for the builder

Create `data/packs/scripts/build-e2e-fixture.test.mjs`:

```js
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildE2eFixture, fixtureConfig } from "./build-e2e-fixture.mjs";

describe("build-e2e-fixture", () => {
    /** @type {string} */
    let outDir;

    before(async () => {
        outDir = await mkdtemp(join(tmpdir(), "e2e-fixture-test-"));
    });

    after(async () => {
        await rm(outDir, { recursive: true, force: true });
    });

    it("writes transit, meta, and manifest artifacts without a real PBF", async () => {
        const fakePresets = [
            {
                id: "osm-e2e-fixture-test",
                label: "Test Operator",
                stations: [
                    { id: "n1", name: "Shinjuku", lat: 35.69, lon: 139.7 },
                    { id: "n2", name: "Shibuya", lat: 35.66, lon: 139.7 },
                ],
            },
        ];
        const uncompressed = Buffer.from(
            JSON.stringify({ schemaVersion: 1, presets: fakePresets }),
            "utf8",
        );

        await buildE2eFixture({
            outDir,
            cacheDir: join(outDir, "cache"),
            pbfPath: "/dev/null/does-not-exist.osm.pbf",
            buildTransit: async () => ({
                gzPath: join(outDir, "transit.json.gz"),
                uncompressed,
                presets: fakePresets,
            }),
        });

        const files = await readdir(outDir);
        assert.deepEqual(files.sort(), [
            "manifest.json",
            "meta.json",
            "transit.json",
        ]);

        const transit = JSON.parse(
            await readFile(join(outDir, "transit.json"), "utf8"),
        );
        assert.strictEqual(transit.presets.length, 1);
        assert.strictEqual(transit.presets[0].stations.length, 2);

        const meta = JSON.parse(
            await readFile(join(outDir, "meta.json"), "utf8"),
        );
        assert.strictEqual(meta.regionId, "e2e-fixture");
        assert.deepStrictEqual(meta.adminLevels.matching, [4, 7, 9, 10]);

        const manifest = JSON.parse(
            await readFile(join(outDir, "manifest.json"), "utf8"),
        );
        assert.strictEqual(manifest.id, "e2e-fixture");
        assert.strictEqual(manifest.artifacts["transit.json"].stations, 2);
        assert.strictEqual(manifest.artifacts["transit.json"].presets, 1);
        assert.strictEqual(
            typeof manifest.artifacts["transit.json"].sha256,
            "string",
        );
    });
});
```

#### Step 7: Run the node tests

```bash
node --test data/packs/scripts/build-e2e-fixture.test.mjs
```

Expected: one passing test.

#### Step 8: Lint the freshly built fixture

```bash
pnpm data:e2e-fixture:lint
```

Expected:

```text
transit.json: OK (12345 bytes, sha256 a1b2c3d4…)
meta.json: OK (890 bytes, sha256 e5f6a7b8…)
E2E fixture lint passed.
```

#### Step 9: Commit

```bash
git add data/packs/scripts/build-e2e-fixture.mjs \
        data/packs/scripts/build-e2e-fixture.test.mjs \
        data/packs/scripts/lint-e2e-fixture.mjs \
        package.json data/packs/README.md \
        assets/e2e-fixture/e2e-fixture/
git commit -m "feat(e2e): committed Tokyo transit fixture pack (F1a)"
```

---

### F1b: Gated runtime pre-install

**Goal:** On E2E runs, copy the bundled fixture to `Paths.document/packs/e2e-fixture/`, write an installed-index entry, and reuse `loadInstalledPacks()` for registration.

**Files:**

- Create: `src/testing/e2e/installE2eFixturePack.ts`
- Create: `src/testing/e2e/__tests__/fixturePack.test.ts`
- Modify: `src/state/AppStateProviders.tsx`
- Modify: `jest.setup.ts`

#### Step 1: Implement the install function

Create `src/testing/e2e/installE2eFixturePack.ts`:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";

import { OFFLINE } from "@/config/appConfig";
import { loadInstalledPacks } from "@/features/offline/regionPacks";
import { createLogger } from "@/shared/logger";

import { E2E_HOOKS_ENABLED } from "./isE2eHooksEnabled";

const log = createLogger("e2eFixturePack");

const FIXTURE_ID = "e2e-fixture";
const PACK_DIR = new Directory(
    new Directory(Paths.document, "packs"),
    FIXTURE_ID,
);

let fixtureAssetsOverride: ReturnType<typeof loadFixtureAssets> | null = null;

/** Test-only hook to avoid bundling real assets in Jest. */
export function __setFixtureAssetsForTest(
    assets: ReturnType<typeof loadFixtureAssets>,
): void {
    fixtureAssetsOverride = assets;
}

function loadFixtureAssets() {
    if (fixtureAssetsOverride) return fixtureAssetsOverride;
    return {
        transit: require("../../../assets/e2e-fixture/e2e-fixture/transit.json"),
        meta: require("../../../assets/e2e-fixture/e2e-fixture/meta.json"),
        manifest: require("../../../assets/e2e-fixture/e2e-fixture/manifest.json"),
    };
}

type InstalledArtifactEntry = {
    kind: "transit" | "meta" | "poi" | "measuring" | "boundaries";
    category?: string;
    bytes: number;
    status: "installed";
};

/**
 * Pre-install the bundled E2E fixture pack into the app's document directory
 * and register it through the production pack loading path. Gated by
 * {@link E2E_HOOKS_ENABLED}; no-ops in production.
 */
export async function installE2eFixturePack(): Promise<void> {
    if (!E2E_HOOKS_ENABLED) return;

    const { transit, meta, manifest } = loadFixtureAssets();

    const versionFile = new File(PACK_DIR, "version");
    const versionMarker = `${manifest.id}@${manifest.version ?? 0}:${manifest.sourcePbfDate}`;

    if (versionFile.exists) {
        try {
            const current = await versionFile.text();
            if (current === versionMarker) {
                log.debug("E2E fixture pack already installed; re-registering");
                await loadInstalledPacks();
                return;
            }
        } catch {
            // ignore read failure and reinstall
        }
    }

    if (PACK_DIR.exists) {
        try {
            PACK_DIR.delete();
        } catch {
            // best-effort
        }
    }
    PACK_DIR.create({ intermediates: true });

    const transitJson = JSON.stringify(transit);
    const transitFile = new File(PACK_DIR, "transit.json");
    transitFile.create({ overwrite: true });
    transitFile.write(transitJson);

    const metaJson = JSON.stringify(meta);
    const metaFile = new File(PACK_DIR, "meta.json");
    metaFile.create({ overwrite: true });
    metaFile.write(metaJson);

    versionFile.create({ overwrite: true });
    versionFile.write(versionMarker);

    const artifacts: InstalledArtifactEntry[] = [
        { kind: "transit", bytes: transitJson.length, status: "installed" },
        { kind: "meta", bytes: metaJson.length, status: "installed" },
    ];

    const installedPack = {
        id: FIXTURE_ID,
        osmSnapshot: meta.osmSnapshot ?? manifest.sourcePbfDate,
        installedAt: new Date().toISOString(),
        bbox: meta.bbox,
        artifacts,
    };

    const indexKey = OFFLINE.installedIndexKey;
    const raw = await AsyncStorage.getItem(indexKey);
    const index = raw ? JSON.parse(raw) : {};
    index[FIXTURE_ID] = installedPack;
    await AsyncStorage.setItem(indexKey, JSON.stringify(index));

    await loadInstalledPacks();

    log.debug("E2E fixture pack installed and registered");
}
```

#### Step 2: Wire it into app startup

In `src/state/AppStateProviders.tsx`:

1. Add the logger + install import near the top:

```ts
import { createLogger } from "@/shared/logger";
import { installE2eFixturePack } from "@/testing/e2e/installE2eFixturePack";

const log = createLogger("appStateProviders");
```

2. Replace the existing `void loadInstalledPacks();` (around line 179) with:

```ts
// On E2E runs, pre-install the committed fixture pack so scenarios have real
// stations without downloading anything. Failures are logged and non-fatal —
// the normal installed-packs path still runs.
void (async () => {
    try {
        await installE2eFixturePack();
    } catch (err) {
        log.error("E2E fixture pack install failed", err);
    }
    await loadInstalledPacks();
})();
```

#### Step 3: Update the Jest `expo-file-system` mock

`jest.setup.ts` currently mocks `Directory` as a plain object and `Paths.document` as an array. The fixture test needs `new Directory(parent, name)` and string `Paths.document`. Replace the existing `jest.mock("expo-file-system", …)` block with this version:

```ts
jest.mock("expo-file-system", () => {
    const cache: Record<string, string> = {};
    const dirCache: Record<string, boolean> = {};

    function resolveFromCache(
        pathLike: string,
        name?: string,
    ): string | undefined {
        const fullPath = name !== undefined ? `${pathLike}/${name}` : pathLike;
        const globalCache = (
            globalThis as unknown as {
                __fsCache?: Record<string, string>;
            }
        ).__fsCache;
        return globalCache?.[fullPath] ?? cache[fullPath];
    }

    function dirExists(fullPath: string): boolean {
        const globalCache = (
            globalThis as unknown as { __fsCache?: Record<string, string> }
        ).__fsCache;
        if (dirCache[fullPath]) return true;
        if (globalCache?.[fullPath] !== undefined) return true;
        for (const key of Object.keys({ ...cache, ...globalCache })) {
            if (key.startsWith(fullPath + "/")) return true;
        }
        return false;
    }

    return {
        __esModule: true,
        File: jest
            .fn()
            .mockImplementation(
                (dirOrPath: string | { uri: string }, name?: string) => {
                    const parentPath =
                        typeof dirOrPath === "string"
                            ? dirOrPath
                            : dirOrPath.uri;
                    const fullPath =
                        name !== undefined
                            ? `${parentPath}/${name}`
                            : parentPath;
                    return {
                        get exists(): boolean {
                            return resolveFromCache(fullPath) !== undefined;
                        },
                        create: jest.fn(
                            ({ overwrite }: { overwrite?: boolean }) => {
                                if (
                                    !overwrite &&
                                    resolveFromCache(fullPath) !== undefined
                                ) {
                                    return Promise.reject(
                                        new Error(
                                            `expo-file-system: file already exists: ${fullPath}`,
                                        ),
                                    );
                                }
                                cache[fullPath] = cache[fullPath] ?? "";
                                return Promise.resolve();
                            },
                        ),
                        write: jest.fn((content: string) => {
                            cache[fullPath] = content;
                            return Promise.resolve();
                        }),
                        text: jest.fn(() => {
                            const content = resolveFromCache(fullPath);
                            if (content !== undefined) {
                                return Promise.resolve(content);
                            }
                            return Promise.reject(
                                new Error(
                                    `expo-file-system: file not found: ${fullPath}`,
                                ),
                            );
                        }),
                        uri: fullPath,
                    };
                },
            ),
        Directory: jest
            .fn()
            .mockImplementation(
                (parent: string | { uri: string }, name?: string) => {
                    const parentPath =
                        typeof parent === "string" ? parent : parent.uri;
                    const fullPath =
                        name !== undefined
                            ? `${parentPath}/${name}`
                            : parentPath;
                    return {
                        uri: fullPath,
                        get exists(): boolean {
                            return dirExists(fullPath);
                        },
                        create: jest.fn(
                            ({
                                intermediates,
                            }: {
                                intermediates?: boolean;
                            }) => {
                                dirCache[fullPath] = true;
                                if (intermediates) {
                                    let p = fullPath;
                                    while (p) {
                                        dirCache[p] = true;
                                        const idx = p.lastIndexOf("/");
                                        if (idx <= 0) break;
                                        p = p.slice(0, idx);
                                    }
                                }
                                return Promise.resolve();
                            },
                        ),
                        delete: jest.fn(() => {
                            delete dirCache[fullPath];
                            for (const key of Object.keys(cache)) {
                                if (key.startsWith(fullPath + "/"))
                                    delete cache[key];
                            }
                            return Promise.resolve();
                        }),
                    };
                },
            ),
        readAsStringAsync: jest.fn((path: string) => {
            const content = resolveFromCache(path);
            if (content !== undefined) {
                return Promise.resolve(content);
            }
            return Promise.reject(
                new Error(`expo-file-system: file not found: ${path}`),
            );
        }),
        Paths: {
            document: "/mock-documents/",
            cache: "/mock-cache/",
        },
        documentDirectory: "/mock-documents/",
        cacheDirectory: "/mock-cache/",
    };
});
```

#### Step 4: Add the Jest test

Create `src/testing/e2e/__tests__/fixturePack.test.ts`:

```ts
import { installE2eFixturePack } from "../installE2eFixturePack";
import {
    __clearPackTransitSourcesForTest,
    __getPackTransitSourcesForTest,
} from "@/features/hidingZone/hidingZoneData";

const fixtureAssets = {
    transit: {
        schemaVersion: 1,
        presets: [
            {
                id: "osm-e2e-fixture-coverage",
                label: "Coverage",
                bbox: [139.69, 35.66, 139.78, 35.7],
                stations: [
                    { id: "n1", name: "Shinjuku", lat: 35.69, lon: 139.7 },
                    { id: "n2", name: "Shibuya", lat: 35.66, lon: 139.7 },
                ],
            },
        ],
    },
    meta: {
        schemaVersion: 1,
        regionId: "e2e-fixture",
        label: "E2E fixture",
        bbox: [139.69, 35.66, 139.78, 35.7],
        osmSnapshot: "2026-06-22",
        adminLevels: { matching: [4, 7, 9, 10] },
    },
    manifest: {
        id: "e2e-fixture",
        sourcePbfDate: "2026-06-22",
        version: 1,
        artifacts: {
            "transit.json": {
                sha256: "abc",
                bytes: 100,
                presets: 1,
                stations: 2,
            },
        },
        meta: { sha256: "def", bytes: 100 },
    },
};

beforeAll(() => {
    const mod = require("../installE2eFixturePack");
    mod.__setFixtureAssetsForTest(fixtureAssets);
});

beforeEach(() => {
    __clearPackTransitSourcesForTest();
    process.env.EXPO_PUBLIC_E2E_HOOKS = "1";
});

afterEach(() => {
    delete process.env.EXPO_PUBLIC_E2E_HOOKS;
});

describe("installE2eFixturePack", () => {
    it("no-ops when E2E hooks are disabled", async () => {
        process.env.EXPO_PUBLIC_E2E_HOOKS = "0";
        await installE2eFixturePack();
        expect(__getPackTransitSourcesForTest().has("e2e-fixture")).toBe(false);
    });

    it("writes files and registers the transit source", async () => {
        await installE2eFixturePack();
        const sources = __getPackTransitSourcesForTest();
        expect(sources.has("e2e-fixture")).toBe(true);
        const source = sources.get("e2e-fixture")!;
        expect(source.packId).toBe("e2e-fixture");
        expect(source.presetSummaries.length).toBe(1);
        expect(source.path).toMatch(/\/packs\/e2e-fixture\/transit.json$/);
    });
});
```

#### Step 5: Run the Jest test

```bash
pnpm test -- fixturePack.test.ts
```

Expected: both tests pass.

#### Step 6: Run typecheck

```bash
pnpm typecheck
```

Expected: no errors from new files.

#### Step 7: Commit

```bash
git add src/testing/e2e/installE2eFixturePack.ts \
        src/testing/e2e/__tests__/fixturePack.test.ts \
        src/state/AppStateProviders.tsx \
        jest.setup.ts
git commit -m "feat(e2e): gated fixture pack pre-install (F1b)"
```

---

### F1c: `stations=<n>` readout key

**Goal:** Surface the count of selected hiding-zone stations in the debug readout so flows can assert the fixture loaded before trusting `totalPct`.

**Files:**

- Modify: `src/testing/e2e/E2eDebugReadout.tsx`
- Modify: `src/testing/e2e/__tests__/E2eDebugReadout.test.tsx`

#### Step 1: Add the stations readout

Modify `src/testing/e2e/E2eDebugReadout.tsx`:

1. Import `useHidingZoneDerived`:

```ts
import { useHidingZoneDerived } from "@/state/hidingZoneStore";
```

2. In `E2eDebugReadoutInner`, read `selectedStations` and render a row:

```tsx
function E2eDebugReadoutInner() {
    const { active, name } = useE2eReadoutState();
    const { value, isComputing } = useEliminationPercentage();
    const { selectedStations } = useHidingZoneDerived();
    const backend = getActiveGeometryBackend();

    if (!active) return null;

    const settled = !isComputing;

    return (
        <View pointerEvents="none" style={styles.overlay} testID="e2e-readout">
            <ReadoutRow label={readoutLabel("name", name ?? "")} />
            <ReadoutRow label={readoutLabel("backend", backend)} />
            <ReadoutRow
                label={readoutLabel("stations", selectedStations.length)}
            />
            {settled && value !== null ? (
                <ReadoutRow
                    label={readoutLabel("totalPct", formatReadoutPct(value))}
                />
            ) : null}
            {settled ? <ReadoutRow label={readoutLabel("ready", 1)} /> : null}
        </View>
    );
}
```

#### Step 2: Update the readout test

Modify `src/testing/e2e/__tests__/E2eDebugReadout.test.tsx`:

1. Add a mock for `useHidingZoneDerived` after the existing mocks:

```ts
let mockSelectedStations: unknown[] = [{ id: "s1" }, { id: "s2" }];
jest.mock("@/state/hidingZoneStore", () => ({
    ...jest.requireActual("@/state/hidingZoneStore"),
    useHidingZoneDerived: jest.fn(() => ({
        selectedStations: mockSelectedStations,
    })),
}));
```

2. Reset it in `beforeEach`:

```ts
beforeEach(() => {
    mockHooksEnabled = true;
    mockReadout = { active: true, name: "scn", expect: null, location: null };
    mockBackend = "geos";
    mockElim = { value: 42.134, isComputing: false };
    mockSelectedStations = [{ id: "s1" }, { id: "s2" }];
});
```

3. Update the existing settled test to assert the station row:

```ts
it("renders name + backend + stations + totalPct + ready once settled", () => {
    const { getByLabelText } = render(<E2eDebugReadout />);
    expect(getByLabelText("e2e-readout:name=scn")).toBeTruthy();
    expect(getByLabelText("e2e-readout:backend=geos")).toBeTruthy();
    expect(getByLabelText("e2e-readout:stations=2")).toBeTruthy();
    expect(getByLabelText("e2e-readout:totalPct=42.13")).toBeTruthy();
    expect(getByLabelText("e2e-readout:ready=1")).toBeTruthy();
});
```

4. Add a focused test:

```ts
it("renders the station count readout", () => {
    mockSelectedStations = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const { getByLabelText } = render(<E2eDebugReadout />);
    expect(getByLabelText("e2e-readout:stations=3")).toBeTruthy();
});
```

#### Step 3: Run the readout tests

```bash
pnpm test -- E2eDebugReadout.test.tsx
```

Expected: all tests pass.

#### Step 4: Commit

```bash
git add src/testing/e2e/E2eDebugReadout.tsx \
        src/testing/e2e/__tests__/E2eDebugReadout.test.tsx
git commit -m "feat(e2e): stations=<n> readout key (F1c)"
```

---

### F1d: On-device integration flow

**Goal:** Prove the fixture loads real stations on a device/simulator and that the Maestro flow can assert `e2e-readout:stations=<n>` before any numeric question is added.

**Files:**

- Create: `e2e/scenarios/deeplink-stations.json`
- Create: `e2e/deeplink-stations.yaml`
- Modify: `scripts/e2e-maestro-stack.mjs`

#### Step 1: Choose a preset id from the built fixture

After F1a, list the fixture presets:

```bash
node -e "const t=require('./assets/e2e-fixture/e2e-fixture/transit.json'); t.presets.forEach(p => console.log(p.id, p.bbox.join(',')))"
```

Pick a preset whose `bbox` intersects the play-area bbox `[139.5,35.5,140.0,35.9]`. Most will; prefer a large operator preset (e.g. `osm-e2e-fixture-jr-east`) over `coverage` if available.

#### Step 2: Create the scenario JSON

Create `e2e/scenarios/deeplink-stations.json`, replacing `<preset-id>` with the value from Step 1:

```json
{
    "kind": "e2e-scenario",
    "name": "deeplink-stations",
    "controls": { "geometryBackend": "js", "showReadout": true },
    "state": {
        "playArea": {
            "bbox": [139.5, 35.5, 140.0, 35.9],
            "center": [139.75, 35.7],
            "label": "Tokyo 23 Wards",
            "osmId": 19631009,
            "osmType": "R"
        },
        "hidingZones": {
            "radiusMeters": 800,
            "radiusUnit": "m",
            "selectedPresetIds": ["e2e-fixture:<preset-id>"]
        }
    }
}
```

#### Step 3: Create the Maestro flow

Create `e2e/deeplink-stations.yaml`:

```yaml
appId: com.raycatdev.hideandseek.v2
---
# Prove the E2E fixture pack pre-installs and produces real stations.
- clearState
- runFlow: bootstrap.yaml
- openLink: "${E2E_DEEPLINK_STATIONS_LINK}"
- waitForAnimationToEnd:
      timeout: 5000
- runFlow:
      when:
          visible: "Open"
      commands:
          - tapOn: "Open"
- extendedWaitUntil:
      visible: "e2e-readout:ready=1"
      timeout: 60000
- assertVisible: "e2e-readout:name=deeplink-stations"
- assertVisible: "e2e-readout:stations=[1-9][0-9]*"
- takeScreenshot: e2e/artifacts/deeplink-stations/stations-loaded
```

#### Step 4: Register the flow in the stack

In `scripts/e2e-maestro-stack.mjs`, add to the `flows` array:

```js
{
    name: "deeplink-stations",
    artifactSubdir: "deeplink-stations",
    flowPath: "e2e/deeplink-stations.yaml",
},
```

#### Step 5: Build the link and run locally

```bash
node scripts/e2e/build-scenario-link.mjs e2e/scenarios/deeplink-stations.json
# Or run the full stack:
E2E_FLOW=deeplink-stations pnpm test:e2e:stack
```

Expected: flow passes, screenshot shows `stations=<n>` with `n > 0`.

#### Step 6: Commit

```bash
git add e2e/scenarios/deeplink-stations.json \
        e2e/deeplink-stations.yaml \
        scripts/e2e-maestro-stack.mjs
git commit -m "feat(e2e): deeplink-stations integration flow (F1d)"
```

---

## 13. F2 / F3 extension notes

After F1 is merged, extend the fixture the same way:

- **F2 — measuring:** In `build-e2e-fixture.mjs`, call `buildMeasuringArtifact`
  for `rail-station` and (after widening the clip east to include Tokyo Bay)
  `body-of-water`. Write `measuring-rail-station.json` and
  `measuring-body-of-water.json`. Add the categories to `meta.artifacts` and to
  the `artifacts` list in `installE2eFixturePack.ts`.
- **F3 — boundaries / POI:** Call `buildBoundariesArtifact` (it emits a combined
  payload that the installer splits into `boundaries-index.json` +
  `boundaries-polygons.json`) and `buildPoiArtifact` for one category. Update
  the artifact lists in the build script, the install function, and
  `lint-e2e-fixture.mjs`.
