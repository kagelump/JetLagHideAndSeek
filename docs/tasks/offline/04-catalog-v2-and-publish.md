# T4 — Catalog v2 + publish tooling (Releases + gh-pages)

## Context

Packs are hosted on this repo: artifact blobs as GitHub Release assets
(tagged `packs-YYYY-MM-DD`), and a small `catalog.json` served from an
orphan `gh-pages` branch via GitHub Pages (see design.md → "Catalog and
hosting"). This task builds the catalog generator and the publish script,
and stands up the hosting once.

No backwards compatibility: catalog `schemaVersion: 2` simply replaces the
v1 `PackManifest` — the app's v1 manifest path is deleted in T5, and no v1
manifest was ever deployed.

## What to build

### 1. Catalog generator — `data/packs/scripts/build-catalog.mjs`

Input: one or more `dist/<region-id>/` dirs (already lint-clean) plus the
release tag to publish under. Output: `data/packs/dist/catalog.json`:

```jsonc
{
    "schemaVersion": 2,
    "generatedAt": "2026-06-12T00:00:00Z",
    "attributionUrl": "https://<user>.github.io/JetLagHideAndSeek/NOTICE",
    "packs": [
        {
            "id": "europe-netherlands",
            "label": "Netherlands",
            "regionPath": ["Europe", "Netherlands"],
            "bbox": [3.31, 50.75, 7.22, 53.7],
            "osmSnapshot": "2026-06-08",
            "totalBytes": 31457280, // sum of artifact bytes
            "artifacts": [
                {
                    "kind": "poi", // "poi" | "measuring" | "boundaries" | "transit" | "meta"
                    "category": null, // measuring only, e.g. "coastline"
                    "url": "https://github.com/<user>/JetLagHideAndSeek/releases/download/<tag>/europe-netherlands-poi.json.gz",
                    "bytes": 1234567,
                    "md5": "…", // of the .gz (device FS verify)
                    "sha256": "…", // of the uncompressed JSON (content verify)
                    "schemaVersion": 1, // payload schema of this artifact kind
                },
            ],
        },
    ],
}
```

Everything is derived from `meta.json` + `hashes.json` — the generator does
no hashing itself. URLs are absolute, built from a `--repo` and `--tag`
flag. Merging: when regenerating for a subset of regions, start from an
existing catalog (`--base catalog.json`) and replace only those packs'
entries, so a one-region republish doesn't drop the others.

Write a JSON-schema-ish validator (`validateCatalog()` in a lib) shared by
the generator and the CI check below.

### 2. Publish script — `data/packs/scripts/publish.mjs`

`pnpm data:pack:publish -- --region europe-netherlands [--tag packs-2026-06-12]`

1. Preflight: dist dir exists and passes lint; `gh auth status` succeeds;
   working tree clean (warn otherwise).
2. Create the release if the tag doesn't exist
   (`gh release create <tag> --prerelease --title "Data packs <date>" --notes …`),
   then `gh release upload <tag> <files> --clobber`. Asset names:
   `<region-id>-<kind>[-<category>].json.gz` + `<region-id>-meta.json`.
   **Always `--prerelease`** so the repo's "Latest release" stays the app's.
3. Rebuild `catalog.json`. Order matters: **first** fetch the currently
   published catalog from the Pages URL (plain `fetch`; a 404 or network
   error on the very first publish falls back to an empty base — any other
   failure aborts, don't risk clobbering published packs), **then** run the
   step-1 generator with that as `--base` so untouched regions survive the
   merge.
4. Commit `catalog.json` + `NOTICE.html` (rendered from the ODbL/Geofabrik
   attribution text — keep it static, no build framework) + a minimal
   `index.html` (human-readable pack table generated from the catalog) to
   the `gh-pages` branch and push. Use a `git worktree` for the orphan
   branch so the main checkout is untouched; the script creates the orphan
   branch on first run.
5. Print the catalog URL and a curl one-liner to sanity-check it.

### 3. One-time hosting setup (manual, document it)

In `data/packs/README.md`: enable Pages for the repo (Settings → Pages →
deploy from `gh-pages` branch, root), note the resulting base URL, and note
that Pages can take ~1 min to update after a push.

The catalog URL is deterministic before Pages is even enabled:
`https://<github-user>.github.io/JetLagHideAndSeek/catalog.json`. T5 can
hardcode it in app config without waiting on this manual step.

### 4. CI catalog check

A tiny GitHub Actions workflow (`.github/workflows/packs-catalog.yml`)
triggered on pushes to `gh-pages`: run `validateCatalog()` against the
committed `catalog.json` and verify every artifact URL returns HTTP 200 via
HEAD requests. No pack building in CI — this is a guard, not a pipeline.

## How to test

`node --test`:

- Catalog generator: synthetic dist fixtures → assert exact catalog output;
  `--base` merge replaces one pack and preserves another; validator rejects
  missing hashes / relative URLs / unknown artifact kinds.
- Publish script: factor the `gh`/`git` invocations behind a thin
  `exec`-wrapper injected in tests; assert the right command sequence for
  first-publish vs republish. (No live GitHub calls in tests.)

Manual (the real test): publish the NL pack from T2/T3 dists end-to-end,
then `curl` the Pages catalog URL and download one artifact URL; verify its
md5 matches the catalog.

## Out of scope

- App-side consumption of the v2 catalog (T5). Boundaries/transit artifacts.

## Done when

- A real `packs-*` prerelease exists on the repo with NL artifacts; the
  Pages catalog validates, lists them with absolute URLs, and the CI guard
  workflow is green.
- `pnpm test` + `pnpm check` green.
