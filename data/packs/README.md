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

# Publish a pack (upload + catalog + commit to master)
pnpm data:pack:publish -- --region europe-netherlands [--tag packs-2026-06-12]

# Run pipeline tests
pnpm test:data:packs
```

## Catalog

The catalog (`catalog.json`) is generated from built pack dist directories. It
uses `schemaVersion: 2` and is served from GitHub Pages via the `pages.yml`
Actions workflow. The catalog generator supports `--base` for merging (replace
specified packs, preserve others).

## Publishing

The publish script (`data/packs/scripts/publish.mjs`) handles the full
workflow:

1. Preflight: dist exists, lint passes, `gh auth status` succeeds
2. Create a prerelease (`packs-YYYY-MM-DD`) if it doesn't exist
3. Upload artifact `.json.gz` files and `meta.json` with `gh release upload`
4. Rebuild `catalog.json`, merging with the currently published catalog
5. Write `catalog.json`, `NOTICE`, and `index.html` to `site/packs/` and
   commit+push master. The `pages.yml` workflow deploys `site/` atomically
   via GitHub Actions — the single deploy path for splash, deep links,
   bundle viewer, and catalog.
6. Print the catalog URL

## GitHub Pages

The site is deployed via the `pages.yml` GitHub Actions workflow, which
uploads the `site/` directory as a Pages artifact. The catalog is served
from the `site/packs/` subdirectory:

```
https://jetlag.hinoka.org/packs/catalog.json
```

GitHub Pages must be set to **GitHub Actions** as the source.

## Adding a region

1. Add an entry to `regions.yaml` with an `id` matching `/^[a-z0-9][a-z0-9-]*$/`,
   a Geofabrik `pbfUrl`, and `adminLevels` (4 `matching` + superset `extract`).
   Check per-level boundary counts via pack-lint to curate the matching levels
   for the region's actual administrative hierarchy.
2. Run `pnpm data:pack -- --region <id>`.
3. Lint the result: `pnpm data:pack:lint -- --region <id>`.
4. Eyeball in the data viewer:
   `node tools/data-viewer/server.mjs --pack data/packs/dist/<id>`.

## CI

- **`pages.yml`**: validates the catalog schema (if `site/packs/catalog.json`
  exists) before deploying `site/` to Pages.
- **`packs-catalog.yml`**: validates the catalog schema and checks all
  artifact URLs (HEAD) on every master push that touches
  `site/packs/catalog.json`.
