# Offline Data Packs Pipeline

Builds downloadable per-region data packs for the JetLag Hide & Seek app.
Packs are built locally from Geofabrik PBF extracts and published to GitHub
Releases (see [design doc](../../docs/tasks/offline/design.md)).

## Quick start

```bash
# Build one region
pnpm data:pack -- --region europe-netherlands

# Build all enabled regions
pnpm data:pack -- --all

# Use cached PBFs only (no network)
pnpm data:pack -- --all --cache-only

# Lint a built pack
pnpm data:pack:lint -- --region europe-netherlands

# Generate catalog.json from built packs
pnpm data:pack:catalog -- --region europe-netherlands --tag packs-2026-06-12

# Generate catalog for all built packs
pnpm data:pack:catalog -- --all --tag packs-2026-06-12

# Publish a pack (upload + catalog + gh-pages)
pnpm data:pack:publish -- --region europe-netherlands [--tag packs-2026-06-12]

# Run pipeline tests
pnpm test:data:packs
```

## Catalog

The catalog (`catalog.json`) is generated from built pack dist directories. It
uses `schemaVersion: 2` and is served from GitHub Pages. The catalog generator
supports `--base` for merging (replace specified packs, preserve others).

## Publishing

The publish script (`data/packs/scripts/publish.mjs`) handles the full
workflow:

1. Preflight: dist exists, lint passes, `gh auth status` succeeds
2. Create a prerelease (`packs-YYYY-MM-DD`) if it doesn't exist
3. Upload artifact `.json.gz` files and `meta.json` with `gh release upload`
4. Rebuild `catalog.json`, merging with the currently published catalog
5. Commit to the `gh-pages` branch via a git worktree
6. Print the catalog URL

## GitHub Pages Setup (one-time)

The catalog is served from the `gh-pages` branch via GitHub Pages. To enable:

1. Go to the repository **Settings → Pages**
2. Under **Source**, select **Deploy from a branch**
3. Set **Branch** to `gh-pages` and **folder** to `/ (root)`
4. Click **Save**

The catalog URL will be deterministic:

```
https://<github-user>.github.io/JetLagHideAndSeek/catalog.json
```

For this repo: `https://kagelump.github.io/JetLagHideAndSeek/catalog.json`

Note: GitHub Pages can take ~1 minute to update after a push.

## Adding a region

1. Add an entry to `regions.yaml` with an `id` matching `/^[a-z0-9][a-z0-9-]*$/`,
   a Geofabrik `pbfUrl`, and `adminLevels` (4 `matching` + superset `extract`).
2. Run `pnpm data:pack -- --region <id>`.
3. Lint the result: `pnpm data:pack:lint -- --region <id>`.
4. Eyeball in the data viewer:
   `node tools/data-viewer/server.mjs --pack data/packs/dist/<id>`.

## CI

A GitHub Actions workflow (`.github/workflows/packs-catalog.yml`) validates
`catalog.json` on every push to the `gh-pages` branch. It checks the schema
and verifies all artifact URLs return HTTP 200.
