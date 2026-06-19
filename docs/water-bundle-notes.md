# Water (body-of-water) bundle — debug & implementation notes

Durable notes from getting the `body-of-water` measuring pack to build, publish,
and run on device. Covers the parallel dissolve fix, the catalog `schemaVersion`
bug, the bundle-error UX, catalog refresh, and the Pages-deploy `[skip ci]` trap.
Read this before touching the packs publish pipeline or polygon-dissolve.

## TL;DR of the failure chain

`body-of-water` was the first **polygon-dissolve** measuring artifact ever shipped
in a pack, which made it the first to be `schemaVersion: 2`. Several layers each
assumed everything was v1 / line-shaped:

1. Build OOM'd on water-dense regions (NL) at the cross-tile union step.
2. The catalog mislabeled the v2 blob as `schemaVersion: 1`, so on-device install
   rejected it (`payload has 2, expected 1`).
3. The failed install was a UI dead-end (no retry path).
4. Even after fixing the catalog, the deploy never ran because the publish
   commit carried `[skip ci]`.

Each is fixed; details below. The load-bearing rule: **the producer (catalog +
deploy) must tell the truth about each artifact, and the consumer must be able to
recover when it doesn't.**

## body-of-water is a polygon bundle consumed as a line category

- Pipeline: `geometry: polygon-dissolve` in `data/geofabrik/config.yaml`. The
  measuring builder emits `schemaVersion: 2` for polygon-dissolve, `1` for line
  bundles (`bundleSchemaVersion` in `data/packs/scripts/lib/buildMeasuring.mjs`).
  The artifact is one `MultiPolygon` (the water) plus many `LineString`s
  (waterway centerlines).
- Runtime: `body-of-water` is in `LINE_MEASURING_CATEGORIES`
  (`src/features/questions/measuring/measuringCategories.ts`) — it's measured as
  distance to the **shoreline**. `polygonFeaturesToLineFeatures` converts the
  water polygon's boundary to lines at render time
  (`lineMeasuringGeometry.ts` / `measuringGeometry.ts`).
- The runtime loader is **version-agnostic** — nothing branches on
  `bundle.schemaVersion`; it iterates features by geometry type. So a v2 polygon
  bundle reads fine (a Jest fixture already exercises a v2 polygon bundle in
  `lineMeasuringGeometry.test.ts`). `schemaVersion` is purely an
  integrity/compat tag, not a runtime switch.
- `MEASURING_EXTRA_BUNDLES["body-of-water"] = ["coastline"]`
  (`lineBundleLoader.ts`) — the ocean is folded in via the coastline bundle.
  `body-of-water`'s own bundle is sufficient on its own; coastline is additive.

### Two-stage runtime load (why "stuck at computing" with 0 features)

`registerMeasuringSource` only records the file **path** (`packSources`).
`getLineBundleSources` reads the parsed **cache**, which is filled lazily by
`loadLineBundle`. `useEnsureMeasuringBundles` fires `loadLineBundle` for a
category only when `hasPackSources(category)` is true. So if the artifact never
installed, `packSources` is empty → no load → `selectWindowFeatures` returns `[]`
→ `buildMeasuringRenderState` logs `lineFeatures derivation: 0 total in 0ms` and
the question sits at "computing…". Absence of `[selectWindow]` / `[lineBundle]`
logs = the bundle was never registered (i.e. never installed), not a geometry bug.

## Parallel dissolve: band-partition clip replaces the OOM-prone union

Water-dense regions (NL) OOM'd in the **parent** at the cross-tile union, not in
the shard workers. The dissolve tiles the bbox with a small `overlapDeg` so a
water body on a tile seam is dissolved in both tiles; concatenating the band
blobs yields interior-overlapping members (an invalid MultiPolygon, the
`Self-intersection at or near point` warnings), which the old code repaired by
unioning everything into one polygon — the step that blew the heap.

Fix (`data/geofabrik/scripts/lib/polygonDissolve.mjs`,
`dissolveWorker.mjs`, `data/packs/scripts/lib/buildMeasuring.mjs`):

- `polygonDissolveParallel` now builds **whole-column bands** and computes each
  band's disjoint nominal rectangle (the column strip **without** the overlap).
- Each worker clips its pre-merged band blob to that rect (`clipCoordsToRect`),
  so the bands partition the extract edge-to-edge — no interior overlap.
- `buildMeasuring` **concatenates** the disjoint blobs for the parallel path
  (`jobs > 1`) instead of unioning them. The whole-region union is gone.
- Sequential path (`jobs === 1`) is unchanged — it still emits overlapping tile
  features and unions them, so **the fix only runs with `--jobs > 1`.** A
  default `pnpm data:pack -- --region X` (jobs=1) does NOT exercise it. Log line
  to confirm the new path: `band-partition: kept N disjoint blob(s)` vs the old
  `cross-tile merge: → 1 merged polygon`.

Caveat: bands simplify independently, so two sides of a seam can disagree by a
fraction of a metre → a hairline gap/overlap exactly on the cut. Negligible for
distance-to-water (a `min`); if strict validity ever matters, union only the thin
seam strips, never the whole region.

## Catalog `schemaVersion` bug (the on-device install rejection)

Symptom on device: `Pack <id>/measuring schemaVersion mismatch: payload has 2,
expected 1`. Install compares the downloaded payload's `schemaVersion` against
the **catalog's** declared value (`src/features/offline/regionPacks.ts`).

Root cause: `buildArtifacts` in `data/packs/scripts/build-catalog.mjs`
**hardcoded `schemaVersion: 1`** for every artifact. Systemic — any artifact that
bumps past v1 (boundaries/transit/poi too) would break identically.

Fix: thread the real version blob → `hashes.json` → catalog.

- `computeHashes` (`data/packs/scripts/lib/hashing.mjs`) now extracts the
  top-level `schemaVersion` via `extractSchemaVersion` (a cheap head-scan; every
  builder emits `schemaVersion` as the first key).
- `buildArtifacts` uses `hashEntry.schemaVersion ?? 1` (the `?? 1` keeps legacy
  `hashes.json` working).

**Critical operational gotcha:** the catalog reads `schemaVersion` from
`hashes.json`, and only a **region build** (`pnpm data:pack`) regenerates
`hashes.json`. Re-running only publish/catalog reuses the stale `hashes.json` and
falls back to `1`. To fix a region you must rebuild it, then publish:

```bash
pnpm data:pack -- --region asia-japan-kanto --jobs auto   # regenerates hashes.json with the true schemaVersion
pnpm data:pack:publish -- --region asia-japan-kanto        # rebuilds catalog from hashes.json + uploads + deploys
```

## Unrecoverable bundle errors: classification + banner

Integrity/validation failures (size, MD5, SHA-256, decompression limit,
`schemaVersion`, payload schema) are **producer-side** — re-downloading the same
blob fails identically. Previously these landed as a generic `failed` →
"incomplete" → a Retry that could never succeed, with no signal it was a data bug.

- `regionPacks.ts`: `PackArtifactError { retryable }`; all integrity throws go
  through `bundleErrorFail()` (`retryable: false`). Network/IO stay plain
  `Error` → retryable. `InstalledArtifact` gained `error` + `retryable`
  (persisted; schema in `packSchemas.ts`).
- `findBundleError(pack)` = first `failed && retryable === false` artifact.
  `buildBugReportUrl` builds a prefilled GitHub issue (pack/artifact/error).
- `OfflineDataScreen.tsx`: new `bundle-error` state (priority over `incomplete`)
  renders a red banner + "Report a bug" button.
- **The row is still tap-to-retry** in `bundle-error` state. This is deliberate:
  a republished fix can only land via re-download, so the state must be
  recoverable. (An earlier version opened the bug report on tap and was a
  dead-end — don't reintroduce that.) `retryPackInternal` re-fetches `failed`
  artifacts, so once the catalog is correct, Retry installs cleanly.
- Note: the banner only appears for failures recorded **after** this change
  (older entries have `retryable: undefined` → treated as plain `incomplete`).

## Catalog refresh + cache-bust

`usePackCatalog` has a 30-min `staleTime`, and GitHub Pages serves `catalog.json`
with its own Cache-Control — so a republish can stay invisible on device twice
over. Fixes:

- `fetchCatalog` (`packCatalog.ts`) appends `?t=<timestamp>` (+ `cache:
"no-store"`) so every fetch bypasses the HTTP cache. The query param is the
  portable guarantee.
- `OfflineDataScreen` has a **Refresh** control showing the loaded catalog's
  `generatedAt` — tap it after publishing and confirm the timestamp updates;
  that proves the device pulled the new catalog before you Retry.

## Pages deploy never ran: the `[skip ci]` trap

Symptom: published, catalog committed + pushed to master, but the live catalog at
`https://jetlag.hinoka.org/packs/catalog.json` stayed stale and no Action ran.

Root cause: `publish.mjs` commits the catalog with `[skip ci]` in the message.
That was added to keep the heavy `app-checks.yml` (which triggers on `push` to
master for `site/**`/`data/**`) off data-only publishes — but `[skip ci]` is a
**blanket** skip that also suppresses `pages.yml`, the workflow that actually
deploys the catalog. So the committed fix never went live.

Fix (`data/packs/scripts/publish.mjs`): after the push, explicitly dispatch the
Pages workflow:

```bash
gh workflow run pages.yml --ref master
```

`pages.yml` has `workflow_dispatch`, so this deploys without removing `[skip ci]`
(app-checks stays off). publish warns (doesn't fail) if `gh` is unavailable. To
deploy a stuck catalog manually, run that same command.

## End-to-end checklist (publish → device)

1. `pnpm data:pack -- --region <id> --jobs auto` — regenerates `hashes.json`
   (true `schemaVersion`) and runs the band-partition dissolve.
2. `pnpm data:pack:publish -- --region <id>` — uploads blobs, rebuilds catalog
   from `hashes.json`, commits `[skip ci]`, **and dispatches `pages.yml`**.
3. Confirm the live catalog (not just the committed one):
    ```bash
    curl -s "https://jetlag.hinoka.org/packs/catalog.json?t=$(date +%s)" \
      | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s);const w=c.packs.find(p=>p.id==='<id>').artifacts.find(a=>a.category==='body-of-water');console.log(c.generatedAt, w?.schemaVersion)})"
    ```
4. On device: **Refresh** (watch `generatedAt` update) → tap the pack row to
   **Retry** if it shows a bundle error.

## Handy debug commands

```bash
# Inspect a built artifact (feature counts, schemaVersion, bbox)
node --input-type=module -e "
import { gunzipSync } from 'node:zlib'; import { readFileSync } from 'node:fs';
const b = JSON.parse(gunzipSync(readFileSync('data/packs/dist/<id>/measuring-body-of-water.json.gz')));
const t={}; for(const f of b.features) t[f.geometry.type]=(t[f.geometry.type]||0)+1;
console.log('schemaVersion', b.schemaVersion, 'types', t);"

# Did the build write schemaVersion into hashes.json? (if not, catalog will be wrong)
node -e "const h=require('./data/packs/dist/<id>/hashes.json'); console.log(h['measuring-body-of-water'])"

# Committed catalog vs blob
node -e "const c=require('./site/packs/catalog.json'); const k=c.packs.find(p=>p.id==='<id>'); console.log(k.artifacts.filter(a=>a.kind==='measuring').map(a=>[a.category,a.schemaVersion]))"
```
