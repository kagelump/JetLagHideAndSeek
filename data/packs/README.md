# Offline Data Packs Pipeline

Builds downloadable per-region data packs for the JetLag Hide & Seek app.
Packs are built locally from Geofabrik PBF extracts and published to GitHub
Releases (see [design doc](../../docs/tasks/offline/design.md)).

## Quick start

```bash
# Build one region
pnpm data:pack -- --region europe-netherlands

# Build one region, sharding the polygon dissolve across CPU cores
# (each shard is its own process with an isolated, RAM-capped heap)
pnpm data:pack -- --region europe-netherlands --jobs auto

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

## Building in the cloud (fastest path)

Water-dense regions (e.g. `europe-netherlands`) need a lot of RAM — the
dissolve OOMs on a 16 GB machine. Builds are CPU- and memory-bound, not
network-bound, so the win from cloud is renting a bigger box for an hour, not
faster downloads.

**Sizing.** RAM is the binding constraint, not cores: a single region's dissolve
is sequential, so more cores only help when you build _multiple_ regions in
parallel. Rule of thumb:

- **32–64 GB RAM** (16 GB OOMs on the dense regions).
- **50–100 GB disk** — PBF cache plus the large parent PBFs that
  `boundarySources` pull (e.g. `north-america` for US-state boundaries).
- For "build everything fast": run several regions as parallel processes on one
  big box, or fan out across a matrix of smaller boxes — don't expect one
  region to go faster on more cores.

Cost is trivial on any provider — single-digit to ~$15 of compute for the whole
catalog. Optimize for setup time, not dollars.

### Recommended — one command (`data:pack:cloud`)

`data/packs/scripts/cloud-build.sh` does the whole thing from your laptop:
provision (or use a box you bring), bootstrap the toolchain, clone master +
overlay your **uncommitted** local changes (so a `regions.yaml` edit you haven't
pushed still builds), build with the heap auto-sized to the box's RAM, publish,
and destroy the box.

```bash
# Bring your own box (any provider / local VM) — zero cloud-specific code:
GH_TOKEN=<fine-grained-PAT> \
  pnpm data:pack:cloud -- --region europe-netherlands --host root@1.2.3.4

# Auto-provision + auto-destroy a Linode (needs linode-cli configured + jq):
GH_TOKEN=<fine-grained-PAT> \
  pnpm data:pack:cloud -- --region europe-netherlands --provider linode

# Build everything on a bigger box:
GH_TOKEN=<fine-grained-PAT> \
  pnpm data:pack:cloud -- --all --provider linode --type g6-dedicated-32

# Build only, leave the box up to inspect (no token needed):
pnpm data:pack:cloud -- --region asia-taiwan --host root@1.2.3.4 --no-publish --keep
```

Flags: `--region <id>` / `--all`, `--host user@ip` or `--provider linode`,
`--ssh-key <path>` (default `~/.ssh/id_ed25519`), `--type` / `--linode-region`,
`--jobs <N|auto>` (dissolve shards; default `auto`), `--tag`, `--no-publish`,
`--keep`. Run with `--help` for the full list.

**Parallelism (two-level dissolve).** `--jobs` splits the polygon-dissolve
tiles into contiguous bands — one child process per band — and each child both
dissolves its tiles and **pre-merges** them into compact blobs, so the parent's
final cross-tile merge unions only ~N blobs instead of every tile (that final
merge is single-threaded and otherwise dominates water-dense regions). Each
shard is its own process with its own GEOS-wasm + V8 heap, capped so the shards
together stay under ~70% of RAM (a runaway tile can only OOM its own shard, and
the shard count is auto-reduced if RAM is tight). Contiguous bands keep each
shard's memory at ~1/N of the input and resolve seams locally; the trade-off is
that wall-clock is bound by the densest band. vCPU only helps the dissolve via
`--jobs`; the other phases stay single-threaded, so RAM, not cores, is usually
the limiter. `--jobs 1` restores the sequential path.

**Auth.** `GH_TOKEN` is forwarded to the box over the encrypted SSH channel as
`LC_GH_TOKEN` (SendEnv) — it never appears in argv, shell history, or on the
box's disk. A **fine-grained PAT scoped to this repo with `Contents: read &
write`** covers both the Release upload and the catalog push. The box's sshd
must `AcceptEnv LC_*` (the Ubuntu default). After a publish, run `git pull`
locally to pick up the committed `catalog.json`.

The build is cloud-agnostic — only provisioning is provider-specific, isolated
behind `--provider` adapters. `--host` works with any SSH-reachable Linux box;
adding Hetzner/EC2/etc. is a ~20-line adapter pair (create→IP, destroy).

If you'd rather drive it by hand, the manual paths below do the same steps.

### Option A — GitHub Codespaces (least setup)

The repo and Node/pnpm toolchain are already provisioned; you only add `osmium`.
Open a Codespace on a **16-core / 64 GB** machine type, then:

```bash
sudo apt-get update && sudo apt-get install -y osmium-tool
pnpm install --frozen-lockfile

# Heap = 75% of RAM so the OS/osmium/GEOS keep headroom (avoids OOM-kill).
NODE_OPTIONS=--max-old-space-size=$(( $(free -m | awk '/^Mem:/{print $2}') * 3 / 4 )) \
  pnpm data:pack -- --region europe-netherlands

pnpm data:pack:lint -- --region europe-netherlands
pnpm data:pack:publish -- --region europe-netherlands
```

Delete the Codespace when done.

### Option B — fresh Ubuntu cloud box (Hetzner / EC2 spot / Fargate / Fly)

One-shot bootstrap for a clean Ubuntu 22.04/24.04 box. Set `GH_TOKEN` to a
token with `repo` + release-write scope (publish uploads a Release and pushes
the catalog to `master`), pick a region, and paste:

```bash
export REGION=europe-netherlands
export GH_TOKEN=ghp_xxx   # repo + release write

set -euo pipefail
sudo apt-get update
sudo apt-get install -y osmium-tool git curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo corepack enable

git clone "https://x-access-token:${GH_TOKEN}@github.com/kagelump/JetLagHideAndSeek.git"
cd JetLagHideAndSeek
pnpm install --frozen-lockfile

NODE_OPTIONS=--max-old-space-size=$(( $(free -m | awk '/^Mem:/{print $2}') * 3 / 4 )) \
  pnpm data:pack -- --region "$REGION"
pnpm data:pack:lint -- --region "$REGION"
pnpm data:pack:publish -- --region "$REGION"
```

To build many regions in parallel on one large box, launch the build step per
region as background jobs (each `pnpm data:pack -- --region <id>`), wait for all,
then publish. Tune the per-process heap down so the sum stays under total RAM.

> Note: PBF downloads use `node:https` with `family: 4` (IPv4-only) to dodge a
> Node 22 / undici Happy-Eyeballs hang seen on some Linux hosts — keep that if
> you adapt the download path.

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

## E2E fixture pack

A tiny committed fixture pack lives in `assets/e2e-fixture/e2e-fixture/` and is
pre-installed when `EXPO_PUBLIC_E2E_HOOKS=1`. It supplies real Tokyo transit
stations to deep-link E2E scenarios without network.

### Clipping the source PBF

```bash
mkdir -p data/packs/cache/e2e-fixture
osmium extract --bbox 139.76,35.68,139.78,35.70 \
  data/packs/cache/asia-japan-kanto-latest.osm.pbf \
  -o data/packs/cache/e2e-fixture/e2e-tokyo.osm.pbf -O
```

### Building / refreshing the fixture

```bash
pnpm data:e2e-fixture
pnpm data:e2e-fixture:lint
```

Review the diff in `assets/e2e-fixture/e2e-fixture/` before committing; update
scenario expected bands if station counts shift.
