# Review — Task 07 (On-Demand Region Packs) implementation

**Date:** 2026-06-03
**Status:** Action required — 3 blockers (Phase 2 not yet functional)
**Reviewer:** Architecture review (max-effort code review)
**Scope:** Working-tree implementation of [task 07](07-task-offline-region-packs.md) on
`master` (Phase 1 already merged in #7). Files: `regionPacks.ts`, `OfflineDataScreen.tsx`,
`bundledPois.ts` (registry changes), `fetch-geofabrik.mjs` (pack stage), `config.yaml`,
sheet wiring, `package.json`/`pnpm-lock.yaml`, `.gitignore`/`.prettierignore`.
**Audience:** A fresh agent fixing the issues. Self-contained — each finding has the exact
location, evidence (re-runnable), impact, and a concrete fix.

## How to read this

`typecheck` passes and 34 region-pack/bundled-POI unit tests are green — but the unit tests
**mock** `expo-file-system` and `registerRegion`, so they do not catch the
integration/native issues below. Findings 1–3 each break a different axis (native build,
restart persistence, the regenerate command). Fix in order.

## What's correct (do not "fix")

- `registerRegion` resolves the sync-loader blocker the right way: inflate + parse the pack
  into memory at install, then register a sync `() => raw` thunk. The whole Phase 1 loader
  path stays unchanged.
- bbox-area precedence sort (`sortRegionsByArea`, smallest-first) so a downloaded
  Japan-wide pack doesn't shadow bundled Kantō.
- Integrity chain: md5 + byte-size + `schemaVersion` guards before registering.
- 8 MB pack size budget in the pipeline; `dist/` added to **both** `.gitignore` and
  `.prettierignore` (Phase 1 lesson applied).
- `registerTestRegion`/`unregisterTestRegion` kept as deprecated aliases.

Keep these.

---

## 🔴 Finding 1 — `expo-file-system` pinned to the wrong major version for SDK 54

**Where:** `package.json` → `"expo-file-system": "^56.0.7"`.

**Evidence:** SDK 54's canonical version (authoritative) is `~19.0.22`:

```bash
grep '"expo-file-system"' node_modules/expo/bundledNativeModules.json
#   "expo-file-system": "~19.0.22"
cat node_modules/expo-file-system/package.json | grep '"version"'
#   "version": "56.0.7"   ← installed, wrong major
```

**Impact:** A native module two majors ahead of the SDK is an ABI/JS-API mismatch with
SDK 54 → dev-client / EAS build failure or a runtime crash the moment a pack download runs.
**Invisible to `pnpm typecheck` and `pnpm test`** — jest mocks `expo-file-system`, and TS
types resolve from the installed 56. It only bites at native build/runtime. The `^` range
is also wrong for an Expo native module (Expo requires `~`/exact to match the SDK).

> Note: the code imports `expo-file-system/legacy` (`regionPacks.ts:4`), which is the
> **v19-correct** path for the classic API. So only the version pin is wrong — the code is
> already written for v19.

**Fix:**

```bash
npx expo install expo-file-system   # pins ~19.0.22 in package.json + lockfile
```

Then, because it is a native module, rebuild per AGENTS "Native Build Rules"
(`expo prebuild` + run). Confirm `package.json` shows `"expo-file-system": "~19.0.22"`.

---

## 🔴 Finding 2 — `loadInstalledPacks()` is never called → packs don't survive a restart

**Where:** `src/features/questions/matching/regionPacks.ts` exports `loadInstalledPacks`,
but nothing calls it outside the test.

**Evidence:**

```bash
grep -rn "loadInstalledPacks" src app --include="*.ts" --include="*.tsx" | grep -v "regionPacks.ts:"
#   only matches in __tests__/regionPacks.test.ts
```

**Impact:** `downloadAndInstallPack` registers the pack in-memory (`registerRegion`) so it
works **during the install session**. But on the next app launch nothing re-registers the
installed packs, so `REGIONS` lacks them, `regionCoveringBbox` returns `null`, and matching
silently falls back to Overpass. The persisted `.json`/`.gz` files and the AsyncStorage
index become dead weight. Persistence is half-wired.

**Fix:** call `loadInstalledPacks()` once on app start, before the first matching query.
The async-cache/init seam is `src/state/AppStateProviders.tsx` (where `QueryClientProvider`
mounts). Add a fire-and-forget effect:

```tsx
// src/state/AppStateProviders.tsx
import { useEffect } from "react";
import { loadInstalledPacks } from "@/features/questions/matching/regionPacks";

useEffect(() => {
    void loadInstalledPacks();
}, []);
```

(Place it inside the providers component. It is idempotent and safe to run before the first
query — `registerRegion` just populates the in-memory registry.)

---

## 🔴 Finding 3 — `--bundle` emits all 8 config regions, but only `japan-kanto` has a loader

**Where:** `data/geofabrik/scripts/fetch-geofabrik.mjs` `main()` loop +
`data/geofabrik/config.yaml` (now 8 regions) vs `bundledPois.ts` (one `require` case).

**Evidence:** the bundle stage runs for **every** `config.regions` entry:

```js
for (const region of config.regions) {        // 8 regions now
    ...
    if (runBundle) {
        const result = await runBundleStage(region, pbfPath, categoryOf, bundleDir);
        regionMetas.push(result.meta);          // → writeRegionsIndex(all 8)
    }
}
```

`bundledPois.ts` only registers a loader for `japan-kanto`:

```js
switch (region.id) {
    case "japan-kanto":
        regionLoaders.set(region.id, () =>
            require("../../../../assets/poi/japan-kanto.json"),
        );
        break;
    // no other cases
}
```

**Impact:** running the **documented** `pnpm data:poi` (which is `--bundle`, no
`--cache-only`) would:

1. download ~2 GB of PBFs (all of Japan),
2. write 7 extra region JSONs into committed `assets/poi/`, and
3. list all 8 in `regions.json` — but 7 have **no loader**. Those become
   **covered-but-empty**: `regionCoveringBbox` returns the region →
   `getBundledCategoryFeatures` returns `[]` (loader missing) → `localBboxFeatures` returns
   an empty **non-null** result → `resolveBboxFeatures` reports `source:"local"` with no
   features → **matching returns nothing instead of falling back to Overpass** across
   Kansai/Chūbu/Tōhoku/etc.

(It is latent today because `regions.json`/`assets/poi` still hold only Kantō — but the
docs tell maintainers to run `pnpm data:poi`, so they will hit it.)

**Fix:** distinguish in-binary regions from pack-only regions.

1. `config.yaml` — flag the in-binary region(s):
    ```yaml
    - id: japan-kanto
      label: Kantō, Japan
      bundle: true            # ← in the app binary
      url: "..."
      relations: [ ... ]
    - id: japan-kansai        # no `bundle:` → pack-only
      ...
    ```
2. `fetch-geofabrik.mjs` — gate the bundle stage on the flag, and emit packs for the rest:
    ```js
    if (runBundle && region.bundle) {
        const result = await runBundleStage(
            region,
            pbfPath,
            categoryOf,
            bundleDir,
        );
        regionMetas.push(result.meta);
        if (runPacks)
            packMetas.push(
                await emitPack(result.meta, result.serialized, packsDir),
            );
    } else if (runPacks) {
        const result = await runBundleStage(
            region,
            pbfPath,
            categoryOf,
            packsDir,
        );
        packMetas.push(
            await emitPack(result.meta, result.serialized, packsDir),
        );
    }
    ```
    `writeRegionsIndex(regionMetas)` then lists only bundled regions, so `regions.json`
    never contains a region without a loader.

**Guard:** add a startup/dev assertion that every `regions.json` id has a `regionLoaders`
entry, so a covered-but-empty region can't recur silently.

---

## 🟠 Finding 4 — `registerRegion`/`unregisterRegion` don't purge `categoryFeatureCache`

**Where:** `src/features/questions/matching/bundledPois.ts` — both functions only do
`regionCache.delete(id)`.

**Impact:** `getBundledCategoryFeatures` checks `categoryFeatureCache[${id}:${category}]`
first. On a pack **update / re-install** (remove → re-add, or `registerRegion` over an
existing id), the stale memoized arrays from the old pack are returned instead of the new
data. (Also a minor memory leak on `unregisterRegion`.)

**Fix:** purge the per-region category entries in both functions:

```ts
function purgeCategoryCache(id: string): void {
    for (const key of categoryFeatureCache.keys()) {
        if (key.startsWith(`${id}:`)) categoryFeatureCache.delete(key);
    }
}
// call purgeCategoryCache(id) in both registerRegion() and unregisterRegion()
```

---

## 🟠 Finding 5 — `TextDecoder` may be undefined in Hermes → install crash

**Where:** `regionPacks.ts:152` — `const jsonStr = new TextDecoder().decode(inflated);`

**Impact:** Hermes (React Native) does not ship `TextDecoder` by default, so this can throw
at pack-install time on-device. `fflate` (already imported, and `strFromU8` is exported by
the installed version) is the portable decoder.

**Fix:**

```ts
import { gunzipSync, strFromU8 } from "fflate";
// ...
const jsonStr = strFromU8(inflated); // replaces new TextDecoder().decode(inflated)
```

> Secondary: `base64ToBytes` relies on `atob` (`regionPacks.ts:99`). `atob` exists in
> Hermes on RN 0.74+ (this repo is 0.81), so it is lower-risk — but verify on-device, or
> read the gz with a byte-oriented path to avoid base64 entirely.

---

## 🟡 Polish

- **md5 fails open** (`regionPacks.ts:127`): `if (downloadResult.md5 && downloadResult.md5… !== meta.md5…)` skips the check when `downloadResult.md5` is falsy — only the size check guards then. The pipeline emits md5 and Expo returns it on iOS/Android, but consider failing closed if md5 is missing. `PackMeta.sha256` is carried but never verified at runtime — verify it (hash the gz bytes) or drop the field.
- **`.gz` kept after inflation** (`downloadAndInstallPack`): it writes `<id>.json` but never deletes `<id>.json.gz`, so each pack uses gz + json (~4× the needed space). Delete the `.gz` after writing the `.json`.
- **Installed-index race**: `getInstalledIndex` → mutate → `setInstalledIndex` is read-modify-write; concurrent install/remove can lose an entry (Phase 1's cell cache used a mutex). Low likelihood (user-driven), but real.
- **Manifest URL placeholder**: `fetch-geofabrik.mjs` writes `url: "https://<cdn>/poi/${id}.json.gz"` literally, so generated `packs.json` is non-functional. Make the base a `config.yaml` value (e.g. `packsBaseUrl`). (Hosting itself remains out of scope.)
- **`data:poi:packs` can't bootstrap**: it is `--cache-only --packs`, so it throws if the 7 pack PBFs aren't already cached, and nothing downloads them. Document/add a non-cache-only packs path for first generation.

---

## Recommended fix order

1. **Finding 1** — `npx expo install expo-file-system` + rebuild.
2. **Finding 5** — `strFromU8` (so install doesn't crash once #1 builds).
3. **Finding 2** — wire `loadInstalledPacks()` in `AppStateProviders.tsx`.
4. **Finding 3** — `bundle:` flag + pipeline gating + loader-coverage guard.
5. **Finding 4** — purge `categoryFeatureCache` on register/unregister.
6. Polish (md5 fail-closed, delete `.gz`, index mutex, manifest URL, packs bootstrap).

## Acceptance criteria

- [ ] `package.json` shows `expo-file-system: ~19.0.22`; a native build succeeds.
- [ ] After installing a pack and **restarting** the app, matching in that region resolves
      locally (zero Overpass) — proves `loadInstalledPacks` is wired.
- [ ] `pnpm data:poi` regenerates **only** `assets/poi/japan-kanto.json` + a `regions.json`
      listing only loadered regions; un-bundled regions fall back to Overpass (not empty).
- [ ] `pnpm data:poi:packs` emits `<region>.json.gz` for pack regions + a `packs.json`.
- [ ] Re-installing/updating a pack serves the new data (no stale `categoryFeatureCache`).
- [ ] Pack install uses `strFromU8` (no `TextDecoder`).
- [ ] `pnpm check` + `pnpm test` pass.

---

## Appendix — verification commands

```bash
# Finding 1 — SDK-correct version vs installed
grep '"expo-file-system"' node_modules/expo/bundledNativeModules.json   # ~19.0.22
grep '"version"' node_modules/expo-file-system/package.json             # 56.0.7

# Finding 2 — not wired
grep -rn "loadInstalledPacks" src app --include="*.ts" --include="*.tsx" | grep -v regionPacks.ts

# Finding 3 — bundle stage iterates all regions; only kanto has a loader
grep -nE "for \(const region of config.regions|if \(runBundle\)" data/geofabrik/scripts/fetch-geofabrik.mjs
grep -nE "case \"japan-|require\(" src/features/questions/matching/bundledPois.ts

# Finding 5 — fflate exports strFromU8 (portable decode)
grep -o "strFromU8" node_modules/fflate/lib/index.d.ts
```
