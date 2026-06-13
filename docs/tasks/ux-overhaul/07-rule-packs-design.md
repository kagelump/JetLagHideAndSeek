# Phase 7 — Rule packs (design only)

Parent: `epic.md`. **No pipeline or client wiring this epic** — the Play Area
preset picker (Phase 5) is a stub listing bundled cities. This doc captures the
intended model so the stub is architected toward it.

## Intent

Curated **rule packs** are downloadable game setups, distributed like the
existing offline data packs (catalog directory the user browses, blobs fetched
on demand). They let an organizer start from a ready-made game instead of
building one from scratch. The long-term direction is to **remove built-in
bundles** (Tokyo/Osaka) in favor of rule packs — so bundled cities should be
treated as "the first rule packs," surfaced in the same picker.

Distinct from offline **data** packs:
- **Data pack** = region gameplay data (POI, measuring, boundaries, transit).
- **Rule pack** = a curated *game configuration* for an area.

## Proposed model (mirrors `data/packs/` + `site/packs/`)

- **Catalog** committed on Pages (e.g. `site/rules/catalog.json`), pointing at
  absolute Release blob URLs + content hashes. **Empty initially.**
- **Blobs** published to GitHub Releases; **not committed** (like data-pack
  blobs).
- **On-device installed index** mirroring the offline-pack installed index.
- **Payload (versioned game-setup envelope):**
  - play-area reference (relation id / boundary, or a reference to a data-pack
    region)
  - suggested hiding-zone presets + line subsets (per Phase 6 selection model)
  - optional rules (e.g. question budget) + metadata (name, blurb, difficulty)
- Reuse the existing share/wire envelope vocabulary where possible so a rule
  pack is "a shareable setup that happens to be hosted."

## Hard dependency on the region data pack (decided)

Applying a rule pack **requires its region's offline data pack to be
installed.** If missing, the flow prompts to download the data pack first and
blocks apply until it's present. This guarantees an offline-ready game and keeps
the "remove built-in bundles" path clean (bundled Tokyo/Osaka become a rule
pack + a data pack like any other region).

Implication for the picker (Phase 5): a rule-pack entry must surface its
data-pack requirement and download state, and route into Offline Data to
install when needed.

## This epic's deliverable

- Document the model (this file).
- Build the Phase 5 picker as a **stub** (bundled cities only) whose shape can
  accept a real catalog later **without layout churn**.
- Do **not** build: catalog/build/publish pipeline, installed index, download
  client, or the hard-dependency gate. Those are a future epic once there is
  content to ship.

## Cross-references

- Offline data packs: `docs/offline-data-packs.md`, `docs/tasks/offline/`.
- Selection model that rule packs serialize: Phase 6.
