# Plan: Real-data seeding for deep-link E2E (the "E2E fixture pack")

Status: **planning** (2026-06-22). Unblocks Phase D of `epic.md`. Read
`epic.md` "Riskiest part" context first.

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
  asset is ~sub-MB and only referenced from `src/testing/e2e/**`, so it
  tree-shakes out of production bundles.
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

| Path                                            | Purpose                           | New/changed |
| ----------------------------------------------- | --------------------------------- | ----------- |
| `data/packs/scripts/build-e2e-fixture.mjs`      | build the fixture from a clip     | new         |
| `data/packs/scripts/build-e2e-fixture.test.mjs` | node test on a tiny sample PBF    | new         |
| `assets/e2e-fixture/e2e-fixture/*.json`         | **committed** frozen artifacts    | new         |
| `assets/e2e-fixture/e2e-fixture/manifest.json`  | provenance (PBF date, bbox, hash) | new         |
| `src/testing/e2e/installE2eFixturePack.ts`      | gated pre-install                 | new         |
| `src/testing/e2e/__tests__/fixturePack.test.ts` | artifacts validate + install      | new         |
| `src/state/AppStateProviders.tsx`               | call install behind the gate      | changed     |
| `src/testing/e2e/E2eDebugReadout.tsx`           | add `stations=<n>` key            | changed     |
| `package.json`                                  | `data:e2e-fixture[:lint]` scripts | changed     |
| `data/packs/README.md`                          | document the clip + rebuild       | changed     |

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
- **gating** — install is gated; the bundled asset must not be imported from any
  production code path (only `src/testing/e2e/**`), so it tree-shakes out.

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
