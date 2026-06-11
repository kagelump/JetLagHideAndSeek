# T8 — Admin-division integration (pack-backed matching + country defaults)

## Context

Two consumers of admin boundaries remain online-or-Japan-only after T7:

1. The **admin-division matching categories** (`admin-1st`…`admin-4th`)
   resolve through `adminBoundaryLoader.ts`, which `require()`s the bundled
   Japan `assets/measuring/admin-boundaries.json` and falls back to Overpass
   outside its bbox.
2. The **admin level mapping** is a manual setting; the buglist wants it to
   default from the play area's country.

Both are solved by the installed pack: its boundaries artifact has the
polygons, and its `meta.adminLevels.matching` says which OSM levels mean
`admin-1st`…`admin-4th` there (default 4/7/9/10, per-region overrides).

Read first: `adminBoundaryLoader.ts` (especially `setAdminBoundaryBundle` —
there is already an injection seam), `adminDivisionConfig.ts`
(`AdminDivisionNamePack`, `ADMIN_CATEGORY_INDEX`), `AdminDivisionScreen.tsx`,
and how `findMatchingFeaturesWithIndex` routes admin categories
(`osmMatchingCache.ts`).

## What to build

### 1. Pack-backed admin boundary queries

Extend `adminBoundaryLoader.ts` to accept additional boundary sources
beyond the bundled Japan bundle:

```ts
export function registerAdminBoundarySource(
    packId: string,
    source: AdminBoundarySource, // backed by T7's boundaryStore (index + lazy polygons)
): void;
export function unregisterAdminBoundarySource(packId: string): void;
```

`queryAdminBoundary(lon, lat, adminLevel)` checks, in order: bundled Japan
bundle (when the point is inside its bbox) → registered pack sources (point
inside pack bbox) → `null` (caller falls back to Overpass, unchanged).

Point-in-polygon: reuse the loader's existing containment approach for
consistency; the candidate set per query is tiny (index rows filtered by
level + bbox before any polygon decode). Decode through T7's LRU — don't
add a second polygon cache.

Wire registration into T5's installer switch (the `boundaries` TODO calls
both T7's boundaryStore and this) and into `removePack`.

### 2. Country-default admin levels

When the play area changes, derive the active `AdminDivisionNamePack`:

- If the play-area bbox falls inside an installed pack → build the name
  pack from `meta.adminLevels.matching` (labels: use the generic
  `genericLabel(ordinal, osmLevel)` naming; localized labels stay a Japan
  nicety for now).
- Else → current behavior (Japan default / manual selection).
- Manual override in `AdminDivisionScreen` stays sticky: only apply the
  pack default when the user hasn't explicitly overridden **for this play
  area**, keyed by the play area's OSM relation id. The edge cases, spelled
  out:
    - Switch play areas and come back → the override for that relation id
      is remembered and re-applied.
    - Remove/reinstall the pack → the override survives (it's keyed by play
      area, not pack).
    - Switch to a _different_ relation inside the same pack → no override
      exists for it yet → the pack default applies.
    - Persist alongside the existing admin-division setting (check how that
      setting is stored in the state stores before adding anything new —
      extend, don't duplicate).

Surface in the UI: `AdminDivisionScreen` shows "(from <pack label>)" next
to a defaulted selection.

### 3. Buglist bookkeeping

`docs/buglist1.md` → tick/annotate "Admin level should default to country of
play area" as resolved-for-pack-regions by this task (leave a note that
non-pack regions still default to 4/7/9/10).

## How to test

Jest:

- `queryAdminBoundary` with a registered fixture source: point inside a
  level-4 polygon returns that candidate; point outside all pack bboxes
  returns null (and the Overpass fallback path in
  `findMatchingFeaturesWithIndex` is exercised by existing tests — extend
  one to assert pack-first ordering).
- Level filtering: a level-8 query never decodes level-4 polygons (assert
  via a decode-spy on the boundaryStore mock).
- Default derivation: play area inside pack → name pack built from meta
  with 4 ordinals; user override survives play-area reload; pack removal
  reverts to the generic default.
- Unregister on `removePack` (extend T5's suite).

Manual: Taiwan pack installed, airplane mode, play area = Taipei (set
offline via T7): run an `admin-2nd` matching question — candidates resolve
from the pack with no Overpass call (watch the metro logs for the
`[adminBoundary]` source line); Admin Divisions screen shows the pack
default.

## Out of scope

- Localized admin labels per country, romanized search, coverage UX (T10).

## Done when

- Admin matching works offline inside pack coverage; defaults derive from
  `meta.adminLevels` with sticky manual override.
- Buglist updated.
- `pnpm test` + `pnpm check` green.
