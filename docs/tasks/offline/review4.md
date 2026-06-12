# Review 4 — Offline Data Packs epic

Reviewed: commit `fc20a21` ("unify Pages deployment — single path via
Actions") pushed to `origin/master`, the live `jetlag.hinoka.org` site, the
repo's first CI runs against the epic, and the rebuilt/published pack state.

## Verdict

**The Pages strategy is resolved and verified live.** All four site uses now
serve from the single Actions deployment:

| URL                                       | Status                                         |
| ----------------------------------------- | ---------------------------------------------- |
| `/` (splash)                              | **200**                                        |
| `/.well-known/apple-app-site-association` | **200**                                        |
| `/bundle-viewer/`                         | **200**                                        |
| `/i/`                                     | **200**                                        |
| `/packs/catalog.json`                     | **200** — correct `attributionUrl`, both packs |
| `/packs/NOTICE`                           | **200**                                        |

The orphan `gh-pages` branch is deleted, `publish.mjs` lost its riskiest
code (worktree/orphan logic), `pages.yml` gates the deploy on catalog
validation, and the repurposed `packs-catalog.yml` ran on the push and
**passed** — the first successful run of that guard ever. The epic is also
finally pushed: `origin/master` == local master, so CI has now seen the
code. Jest is green locally (87 suites / 1081 tests).

Two regressions/gaps block calling this round clean, both cheap to fix:

### R1. App Checks CI is red — `pnpm check` was not run before pushing

The first-ever CI run of the epic failed lint with **18
`no-unused-vars` errors**, almost all dead imports/locals left behind by
the gh-pages removal (`publish.mjs`: `githubUser`, `githubRepo`, `child`,
`readdir`, `basename`; `pack-lint.mjs`: `verifyHashes`, `readdir`,
`lintBoundaries`' unused params; `buildTransit.mjs`: 5;
`extract-measuring-bundles.mjs`: `simplifyCoords`, `haversineMeters`;
`publish.test.mjs`: 2). Reproduced locally — `pnpm lint` fails identically.
The epic's own house rule ("if `pnpm check` + `pnpm test` aren't both
green, the task isn't done") was skipped on the unification commit.
Mechanical fix; do it first, since a red default-branch check masks any
future real failure.

### R2. Taiwan's level fix is config-only — the published pack still ships the old mapping

`regions.yaml` now says `matching: [4, 7, 8, 9]` (good), but
`dist/asia-taiwan/meta.json` still contains `[4, 7, 9, 10]`, and the
**published catalog's Taiwan `meta` artifact is byte-identical to that
stale dist file** (sha256 verified equal). The pack was never rebuilt
after the config change, so a device installing Taiwan today still gets
admin-4th → level 10 (3 relations). Rebuild `asia-taiwan` (the meta
artifact is the only one whose content changes), re-upload to the release,
and republish the catalog. The new per-level count printout + `<10`
warning in pack-lint (both landed ✓) will confirm the fix on the rebuild.

### R3. Follow-up surfaced by N4/P4: measuring admin-border categories don't follow per-region levels

The measuring `admin-1st-border` / `admin-2nd-border` categories hardcode
`postFilter: admin-4` / `admin-7`
([config.yaml:79-90](data/geofabrik/config.yaml),
[postFilters.mjs:44-47](data/geofabrik/scripts/lib/postFilters.mjs)).
Now that matching levels are per-region (NL admin-2nd = 8, TW = 7), the
border _measuring_ category diverges: NL has no `admin-2nd-border`
artifact at all (level 7 ≈ empty there), even though admin-2nd _matching_
works at level 8. Fix direction: parameterize `adminLevelPostFilter` by
the region's `adminLevels.matching[0]`/`[1]` in `buildMeasuring` instead
of the named `admin-4`/`admin-7` constants (the Japan pipeline keeps its
constants — 4/7 are correct there). Small, but it's the difference between
"admin border measuring works in pack regions" and "silently absent".

### R4. Minor

- `/packs/` (the human-readable pack table) is 404 — `site/packs/`
  contains only `catalog.json` + `NOTICE`. `publish.mjs` step 5 writes
  `index.html` there, so the catalog files were evidently hand-copied
  rather than produced by a full `publish` run. Self-heals on the next
  real publish; worth one run to confirm the new step 5 end-to-end.
- Maestro E2E runs for the two pushed commits were still in progress at
  review time — check they're green before calling the push validated
  (`gh run watch`).

## Carried backlog (unchanged this round)

T10 badge/prompt/update UI and T8 country-default flow (both still
caller-less); transit data quality (P5: operator normalization, preset
thresholds, hsl→hex); `getBoundaryPolygon` full-file re-parse per LRU
miss + `it.todo` decode test + missing encoder→decoder fixture vectors;
`usePlayAreaSearch` error swallowing / no offline badge / `cacheSource`
mislabel; play-area + search-merge + `queryAdminBoundaryAsync` tests;
viewer pack routes for poi/measuring (now superseded by
[T12](12-bundle-viewer-packs.md)); `data:poi` shared-lib refactor +
golden snapshots; `buildMeasuring` orchestration duplication; T11 §§1–2,
4–7.

## Milestone assessment

| Milestone | Status                                                                                                                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1        | **Functionally complete pending device proof.** Catalog serves, assets verify, install path is wired and tested. Remaining: fix R1 (red CI), then the Wi-Fi-off matching+measuring run on a device with the NL pack. |
| M2        | Blocked only by R2 (stale Taiwan meta) and the airplane-mode device run (Utrecht + 台北). R3 affects the admin-border _measuring_ question in pack regions but not the M2 criterion itself.                          |
| M3        | Transit presets load (structurally); coverage logic tested but UI still unbuilt (T10); preset quality untested on device.                                                                                            |

## Next steps, in order

1. **Fix R1 today** — delete the 18 dead identifiers, run `pnpm check` +
   `pnpm test`, push, confirm App Checks goes green (and check the
   in-flight Maestro runs).
2. **R2** — rebuild `asia-taiwan`, re-upload, republish; this also
   exercises the new unified publish step 5 for real (fixing R4's missing
   `/packs/` page as a side effect).
3. **M1/M2 device runs** — NL pack, Wi-Fi off: matching + coastline
   measuring; full reset + airplane mode: search "Utrecht" and "台北",
   select, admin-2nd matching. Record results per T11 §7. This closes two
   milestones.
4. **T10 UI** (badge + prompt + update flow) — the largest remaining
   feature gap, now fully unblocked: `useCoverageStatus` + the three
   surfaces, against the already-tested selector.
5. **T8 country defaults** (consume `findPackForPlayArea` on play-area
   change, sticky override, screen label) and **R3** together — they're
   both "make admin levels per-region everywhere".
6. **T12 — bundle viewer for packs** ([12-bundle-viewer-packs.md](12-bundle-viewer-packs.md)),
   then the rest of the carried backlog (P5 transit quality, T11).
