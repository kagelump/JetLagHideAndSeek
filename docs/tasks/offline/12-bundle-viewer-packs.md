# T12 — Bundle viewer for offline packs (one pack at a time)

## Context

The bundle viewer exists in two forms with one codebase
(`tools/data-viewer/`):

- **Local server** (`node tools/data-viewer/server.mjs`) — `node:http`
  handler with `/api/<name>` routes reading repo files; the pipeline
  eyeballing tool. It already has a `--pack <distDir>` flag with two
  routes: `/api/pack/regions` and `/api/pack/<regionId>/boundaries/<level>`.
- **Static build** (`tools/data-viewer/build.mjs` → `site/bundle-viewer/`,
  deployed by `pages.yml`) — pre-bakes committed assets (measuring, POIs,
  zones, transit) into `data/*.json` files and fetches them client-side.

Neither can show a full pack today: the local server lacks poi/measuring/
transit pack routes (T2/T3 left them unfinished), and the hosted viewer
only knows committed Japan assets.

**Hard constraint, verified by probe (2026-06-12):** GitHub release-asset
downloads send **no `Access-Control-Allow-Origin` header** (checked
against `packs-2026-06-12` with an `Origin:` header; neither the
`github.com` 302 nor the `release-assets.githubusercontent.com` 200
carries CORS headers). The hosted viewer therefore **cannot fetch
artifacts from release URLs in the browser**. The plan below works with
that constraint instead of fighting it.

The UX model in both modes is **one pack at a time**: select a pack, see
its artifacts as toggleable layers, switching packs unloads the previous
one. That matches both the review need ("eyeball NL before publishing")
and the memory budget (body-of-water alone is 4.4 MB gz / ~25 MB raw).

## What to build

### Part 1 — Local server: finish the `--pack` routes (the pipeline tool)

Extend `server.mjs` (pattern: gunzip with `node:zlib`, transform to a
FeatureCollection, return; follow the existing boundaries route):

- `/api/pack/<regionId>/meta` — the parsed `meta.json` verbatim (drives
  the UI: which artifacts/categories/levels exist, bbox, snapshot).
- `/api/pack/<regionId>/poi/<category>` — columnar → Point features
  (reuse the columnar→GeoJSON conversion `build.mjs` already has; move it
  into `tools/data-viewer/lib/` so server and build share one copy).
- `/api/pack/<regionId>/measuring/<category>` — features straight out of
  the bundle (same shape the committed-asset route serves).
- `/api/pack/<regionId>/transit` — reuse `lib/transitGeojson.js` on the
  pack bundle (post-N3 the schema matches committed bundles, so this
  should be a pass-through; if it isn't, that's a finding, not a viewer
  special case).
- `/api/pack/<regionId>/boundaries/<level>` — exists; keep.

UI (`index.html`): when `/api/pack/regions` returns entries, show a
**pack picker** (dropdown, one active pack). Selecting a pack builds its
layer panel from `meta`: one toggle per POI category, per measuring
category, per boundary level, plus transit stations/routes and a bbox
outline. Selecting a different pack tears down the previous layers.
Layers fetch lazily on first toggle (don't prefetch body-of-water).

### Part 2 — Hosted viewer: "Inspect a pack" mode without CORS

Add a third data source to the static viewer, alongside the baked-in
Japan data:

1. **Catalog browse (same-origin, works today):** fetch
   `/packs/catalog.json` (the viewer and catalog share
   `jetlag.hinoka.org`), render the pack list with per-artifact sizes and
   release-page links. This much needs no CORS.
2. **Load from file:** a drag-drop / file-picker zone accepting one
   artifact `.json.gz` (or `.json`). Decompress client-side with
   `DecompressionStream("gzip")` (supported in all current browsers),
   sniff the payload kind from its fields (`categories` → poi,
   `category`+`features` → measuring, `index`+`polygons` → boundaries,
   `presets` → transit), transform with the same shared `lib/` transforms
   (delta decode via the existing `lib/deltaEncode.js` CJS copy), and
   render as layers. One artifact at a time; loading a new file replaces
   the previous layers. The catalog list doubles as the download menu:
   click an artifact → browser downloads it from the release → drop it on
   the viewer.
3. Show artifact provenance in a side panel: `schemaVersion`,
   `generatedAt`, feature/row counts, and for boundaries the per-level
   counts (the same numbers pack-lint prints — lets a human spot an N4/P4
   class problem from the hosted viewer).

Explicitly **not**: fetching release assets directly from the browser
(CORS-blocked, verified), mirroring artifact blobs into `site/` (defeats
the releases-for-blobs design and bloats Pages), or any server-side
component.

### Part 3 — Niceties (separate PR, optional)

- Boundaries **search playground**: a text box running the same
  normalize+rank logic as `searchBoundaries` against the loaded index, so
  offline search quality is inspectable per pack (CJK included).
- SHA-256 check of an uncompressed dropped file against the catalog entry
  (WebCrypto `crypto.subtle.digest`; skip md5 — not in WebCrypto and the
  sha256 is the content check anyway). Badge: verified / mismatch.
- Local-server parity for the drag-drop mode so `--pack` isn't required
  to inspect a single downloaded artifact.

## How to test

- `node --test` for the shared transforms in `tools/data-viewer/lib/`
  (columnar→GeoJSON on a small fixture incl. empty category; payload-kind
  sniffing on one fixture per artifact kind; transit pass-through asserts
  the post-N3 schema). The server routes themselves stay thin enough to
  not need route-level tests (matching the existing viewer's level of
  rigor).
- Manual, local: `pnpm data:pack -- --region europe-netherlands && node
tools/data-viewer/server.mjs --pack data/packs/dist` → pick
  `europe-netherlands` → coastline recognizable, provinces at level 4,
  POIs where Dutch cities are, stations along rail lines. Switch to
  `asia-taiwan` → previous layers gone, 臺北市 visible at level 4.
- Manual, hosted: after the next Pages deploy, open
  `/bundle-viewer/`, confirm the catalog lists both packs; download
  `europe-netherlands-boundaries.json.gz` from the release page, drop it
  in, see provinces + the per-level count panel.

## Out of scope

- Viewing _installed device_ packs (that's the app, not the viewer).
- Multi-pack overlay/compare. One pack (local mode) / one artifact
  (hosted mode) at a time, by design.
- Any change to pack formats or the publish flow.

## Done when

- Local: every artifact kind of a dist pack is viewable behind the pack
  picker, lazily, one pack at a time.
- Hosted: catalog browse + drag-drop inspection of a downloaded artifact
  work on the live Pages site.
- `pnpm test` + `pnpm check` green.
