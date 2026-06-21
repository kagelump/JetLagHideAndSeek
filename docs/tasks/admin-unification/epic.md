# Epic: Unified admin-level model (matching + measuring)

Make admin-level borders a single, coherent system across the app — one schema,
one runtime data source, one settings surface — and finish the data-pipeline
cleanup that the app-side work set up.

**Binding runtime rules:** `AGENTS.md` → "Admin Division Defaults".
**Design of record:** `docs/implementation_notes.md` → "Admin levels — unified
matching + measuring (2026-06-21)".

---

## Background — why this epic exists

Admin boundaries used to flow through **two parallel pipelines with two sources
of truth**:

- **Matching** ("which admin region contains the hider?") — the editable
  4-tier `AdminDivisionNamePack` (`adminDivisionConfig.ts`), polygon
  point-in-polygon from the `boundaries` artifact via
  `adminBoundaryLoader` → `boundaryStore`.
- **Measuring** ("distance to the nearest admin border?") — two **hardcoded**
  categories (`admin-1st-border` = OSM 4, `admin-2nd-border` = OSM 7, with
  Japan-only "Prefecture / Ward" titles), line geometry from a **separate**
  `measuring-admin-*-border` line bundle.

Consequences: the same OSM admin geometry shipped twice per pack (polygons +
ring-lines), the two configs could diverge, Japan titles leaked into every
region, measuring was arbitrarily limited to 2 levels with no respect for what
the installed pack actually contained, and the settings screen let a user pick a
level the pack had no data for.

The chosen direction (confirmed with the maintainer): **one schema, two border
tiers, one unified settings screen, app-side first** — defer the data-pipeline
cut and pack republish to a follow-up phase.

---

## Phase 0 — App-side unification — ✅ SHIPPED (commit `1247bd8`)

This is the foundation the rest of the epic builds on. Done:

- **Single source of truth.** `AdminDivisionNamePack` drives both matching admin
  categories and the two measuring border tiers. Tier→pack mapping via
  `ADMIN_BORDER_TIER_INDEX`; helpers `getAdminBorder{OsmLevel,Label,QueryTags}`
  / `isAdminBorderCategory` in `adminDivisionConfig.ts`. Border titles are
  dynamic (`buildAdminMeasuringBorderConfig` in `measuringCategories.ts`); the
  hardcoded 4/7 + "Prefecture/Ward" strings are gone.
- **One runtime source.** Measuring border lines are derived from the boundary
  polygon rings already in the `boundaries` artifact
  (`buildAdminBorderBundle` in `lineBundleLoader.ts` →
  `boundaryStore.getBoundaryPolygonsAtLevel`). The legacy pack measuring source
  remains a fallback. Pack changes invalidate cached border bundles
  (`invalidateAdminBorderBundles`, called from `questionStore`).
- **Bundle-aware unified UI.** `AdminDivisionScreen` gates the OSM-level picker
  to `getAvailableBoundaryLevels()` with per-level counts
  (`getBoundaryLevelCounts()`); free-text fallback (live Overpass) when no pack
  is installed.
- **Latent bug fixed.** `boundaryStore.getBoundaryPolygon` now unwraps the
  installer's `{ schemaVersion, regionId, polygons }` envelope (it previously
  read the parsed object as a bare relation→encoding map and returned nothing).
  This path backs both the matching async admin query and the new border adapter.
- **Tests added** for the border-tier helpers, the level-count helper, and the
  unified adapter (`adminDivisionConfig.test.ts`, `boundaryStore.test.ts`,
  `lineBundleLoader.test.ts`).

> The remaining phases below are **not started**. The app currently works
> end-to-end with the app-side changes; Phase 1+ removes duplicated data, adds
> polish, and pays down related debt.

---

## Phase 1 — Pipeline cut: stop shipping duplicate admin geometry

**Goal:** packs no longer emit admin-boundary geometry twice. The `boundaries`
artifact becomes the sole admin source; the three admin **measuring** artifacts
(`measuring-admin-1st-border`, `measuring-admin-2nd-border`,
`measuring-admin-boundaries`) are removed and packs are republished.

Current state to remove (verified): all three admin measuring artifacts are
published today — `measuring-admin-1st-border` (×44 regions),
`measuring-admin-2nd-border` (×63), `measuring-admin-boundaries` (×70) in
`site/packs/catalog.json`.

### T1.1 — Drop admin measuring categories from the build

- **Files:** `data/geofabrik/config.yaml` (remove the `admin-1st-border`,
  `admin-2nd-border`, `admin-boundaries` measuring category defs, lines ~75–92),
  `data/packs/scripts/lib/buildMeasuring.mjs` (remove the shared admin osmium
  branch — the `adminTmpDir` three-step pipeline and the `isAdmin` feature
  processing block), `data/packs/regions.yaml` (drop any `measuringOverrides`
  keyed on admin border categories — none today, but assert).
- **Decision:** remove **all three** admin measuring categories. The two border
  tiers are now served from `boundaries`; `admin-boundaries` (polygon) is not in
  the app's `MeasuringCategory` union and is consumed by nothing on-device.
- **Acceptance:** `pnpm data:pack -- --region asia-taiwan` produces no
  `measuring-admin-*.json.gz`; `buildMeasuring` no longer shells out to osmium
  for admin relations.

### T1.2 — Guard: every border tier level exists in `boundaries`

The two border tiers resolve to `adminLevels.matching[0]` / `[1]`. Those levels
**must** be present in `adminLevels.extract` (and actually have relations) or the
border question silently returns nothing.

- **Files:** `data/packs/scripts/pack-lint.mjs` (extend the existing
  `adminLevels.extract` checks around lines 193–220).
- **Add:** assert `matching[0]` and `matching[1]` ∈ `extract`, and that the built
  `boundaries` index has ≥1 relation at each. Fail the lint otherwise.
- **Cross-check now:** NL `matching [4,8,…]` / `extract [4,7,8,…]` ✓;
  Taiwan `matching [4,7,…]` / `extract [4,7,8,9,10]` ✓. Most regions are
  `matching [4,7,8,9]` — confirm 4 and 7 have relations per region (NL notably
  has **zero** level-7 relations, which is why its `matching` starts `4,8`).

### T1.3 — Catalog + publish

- **Run:** rebuild every affected region, `pnpm data:pack:lint`, then
  `pnpm data:pack:publish -- --region <id>` for each; recommit
  `site/packs/catalog.json`.
- **Heap note:** water-dense regions need a large Node heap
  (`NODE_OPTIONS=--max-old-space-size=16384` for `europe-netherlands`).
- **Acceptance:** `grep measuring-admin site/packs/catalog.json` returns
  nothing; installed-from-fresh packs render border questions from boundaries.
- **Schema/compat:** pre-launch, no migration shims (per Offline Pack Rules).
  Stale installs re-download on the next catalog refresh.

### T1.4 — Eyeball with the data viewer

- Use `tools/data-viewer/` to confirm border lines derived from the boundary
  polygons look right for a non-Japan region (Taiwan, NL) before publishing.

---

## Phase 2 — App cleanup once no pack ships admin measuring

Do this **after** Phase 1 is published and the catalog no longer lists admin
measuring artifacts.

### T2.1 — Remove the legacy measuring-admin fallback

- **Files:** `src/features/questions/measuring/lineBundleLoader.ts`.
- Remove the "fall through to legacy pack measuring sources" branch in
  `loadLineBundle` for admin border categories and the corresponding
  `hasPackSources` fallthrough — the boundary store is then the only source.
- **Files:** `src/features/offline/regionPacks.ts` — `registerArtifact` /
  `loadInstalledPacks` still register a measuring source for any
  `measuring-<category>` file on disk; admin categories simply won't exist after
  republish. Optionally skip registering admin border measuring sources
  defensively.
- **Acceptance:** border questions still work with only `boundaries` installed;
  `lineBundleLoader` admin tests updated to drop the fallback case.

### T2.2 — Re-enable the boundary decode test

- **Files:** `src/features/offline/__tests__/boundaryStore.test.ts` (the
  `it.todo("decodes polygon from file and caches in LRU")` at ~line 320).
- The decode is blocked by Jest not resolving the dynamic
  `import("expo-file-system")` inside `getBoundaryPolygon`. Fix the seam (either
  a top-level `jest.mock("expo-file-system")` in that file like
  `lineBundleLoader.test.ts`, or make `getBoundaryPolygon` accept an injectable
  reader). Then assert decode + envelope-unwrap + LRU, giving real coverage to
  `getBoundaryPolygonsAtLevel` (currently only the adapter's ring→line transform
  is covered, via a mocked store).

---

## Phase 3 — Richer per-pack admin labels

**Goal:** non-Japan divisions show human names ("State", "County", "City")
instead of the generic `"1st Admin Division (OSM level 4)"`, so both matching
categories and border titles ("County Border") read naturally per region.

### T3.1 — Carry labels in `regions.yaml` → `meta`

- **Files:** `data/packs/regions.yaml` (add an optional `adminLevels.labels`,
  e.g. `matching: [["State","County","City","Neighborhood"]]` or a
  locale-keyed map), `data/packs/scripts/lib/buildMeta.mjs`/meta builder + meta
  schema (`metaSchema.mjs`) to emit them.
- Seed US-style labels for the US state packs and Generic for the rest; reuse
  the existing `japan` preset for Japan packs.

### T3.2 — Consume labels on install

- **Files:** `src/features/offline/packSchemas.ts` (`metaPayloadSchema` —
  validate the new field), `src/features/offline/adminLevelDefaults.ts`
  (`PackAdminLevelInfo` + `buildPackAdminDivisionPack` — populate `labelEn` /
  `labelNative` from the pack instead of the generic ordinal),
  `src/features/offline/regionPacks.ts` (`registerPackAdminLevels` call sites —
  thread the labels through).
- **Files:** `src/features/playArea/PlayAreaScreen.tsx` — the auto-select effect
  already applies pack levels via `buildPackAdminDivisionPack`; it now
  auto-applies labels too. Verify interplay with `labelLanguage`.
- **Acceptance:** installing a US pack and selecting a US play area shows
  "State / County / City / Neighborhood" in matching and "State Border" /
  "County Border" in measuring, with no code changes per region.

---

## Phase 4 — Settings UX completeness

### T4.1 — Source + zero-data affordances

- **Files:** `src/features/sheet/AdminDivisionScreen.tsx`.
- Surface the active source ("Levels from <pack>" vs "Generic / Japan preset —
  live Overpass"). Visually de-emphasize or disable a level chip whose
  `getBoundaryLevelCounts()` count is 0 (data exists for the level declaration
  but no relations).

### T4.2 — Accessibility + E2E

- Confirm stable accessibility labels on the new level chips (already added) and
  add/extend a Maestro flow that opens Settings → Admin Divisions, switches a
  tier's level via the picker, and asserts the matching/border titles update.
  See `AGENTS.md` → "React Native E2E and Accessibility".

---

## Phase 5 — Retire the mutable admin-config global (related debt)

Audit item #5 (`docs/code-health-audit-2026-06-21.md` §5): the admin pack is
duplicated between React state and the `setDefaultAdminConfig` module global,
kept in sync by call-site discipline across 4 sites. The unified border adapter
now also reads that global (`getDefaultAdminDivisionPack()` in
`lineBundleLoader.ts`), so the divergence risk grew.

### T5.1 — Single accessor / DI

- **Files:** `src/features/questions/matching/matchingCategories.ts` (the
  globals), `questionStore.tsx` + `AppStateProviders.tsx` (the 4 sync sites),
  and the non-React consumers (Overpass-QL generation, the border adapter).
- Replace the mutable singleton with a registered getter/selector that reads the
  single source of truth, so non-React paths can't observe a stale pack. Keep
  the documented behavior; remove the "forgot to sync" failure class.
- **Stretch / optional** — sequence after Phase 3 so labels also flow through the
  same accessor.

---

## Phase 6 — Tests & verification (cross-cutting)

- **T6.1 — Polarity test for the border answer path.** Per the `MASK_RULES`
  discipline (`AGENTS.md` → "Question Rules"), add a render-state polarity test
  for measuring admin-border answers (closer/farther → correct
  hit/miss mask), so the unified border path is covered like every other family.
- **T6.2 — Lint guard test** for T1.2 (`extract ⊇ {matching[0], matching[1]}`
  and non-empty per-level relation counts) under `pnpm test:data:packs`.
- **T6.3 — Full gates** on each phase: `pnpm check` + `pnpm test`
  (UI/state/config), `pnpm test:data:packs` (pipeline), data-viewer eyeball
  (geometry). No GEOS-backend changes are expected, so `pnpm test:geos` is not
  required unless the dissolve path is touched.

---

## Risks & notes

- **Stale installs after the cut (Phase 1).** Acceptable pre-launch — no
  migration shims; clients re-download on catalog refresh. The app already
  prefers the boundaries path, so an installed-but-stale `measuring-admin-*`
  artifact is simply ignored.
- **Border level must have relations.** The single most likely runtime gap: a
  region whose `matching[0/1]` level has zero boundary relations (cf. NL level
  7). T1.2's lint guard is the safety net; do not skip it.
- **Heap for republish.** Water-dense regions need the large Node heap; budget
  build time for a full catalog republish.
- **Ordering.** Phase 2 depends on Phase 1 being **published** (not just built).
  Phases 3–5 are independent of 1–2 and can proceed in parallel.

## Definition of done (whole epic)

1. Packs ship admin geometry exactly once (`boundaries`); no `measuring-admin-*`
   in the catalog. (Phase 1)
2. App reads all admin data — matching polygons and measuring border lines —
   from the boundary store; no legacy fallback. (Phase 2)
3. Divisions are human-named per region with no per-region client code.
   (Phase 3)
4. The settings screen shows only/clearly the levels a pack supports and the
   active source. (Phase 4)
5. No mutable admin-config global; one source of truth. (Phase 5)
6. Border answer polarity + pipeline guards are tested. (Phase 6)
