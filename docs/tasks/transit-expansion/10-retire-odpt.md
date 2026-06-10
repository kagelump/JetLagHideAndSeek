# T10 — Retire the old ODPT pipeline

## Context

Run this only after T9's first feeds have shipped and soaked (no open
regressions against the new bundles). Until now `data/odpt/` and its
generated JSON have been left untouched as a fallback; this task removes the
duplication so there's exactly one transit pipeline.

**Pre-flight (all must be true):**

- App loads presets exclusively from `assets/transit/` (T3) — verify no
  remaining importer of `data/odpt/generated/hiding-zone-presets.json`
  (`grep -r "data/odpt" src/ app/`).
- The new pipeline reproduces Tokyo Metro + Toei with identical preset ids
  and route ids (T2's regression comparison).
- `--cache-only` regeneration works from cached GTFS zips (T1/T2) — this
  capability must survive, it's how the data regenerates without network or
  `ODPT_KEY`.

## Steps

1. **Move the GTFS zip cache.** Relocate cached ODPT zips from
   `data/odpt/cache/` to `data/transit/cache/` (or point the transit cache
   lookup at a single shared location — pick whichever the T2 implementation
   already leaned toward, don't support both).
2. **Attribution.** Confirm generated `data/transit/NOTICE.md` fully covers
   the content of `data/odpt/NOTICE.md`; carry anything missing into the
   notice generator (not by hand-editing output). Move the still-relevant
   parts of `data/odpt/sources.md` into `data/transit/sources.md`.
3. **Delete** `data/odpt/scripts/`, `data/odpt/config*`,
   `data/odpt/generated/`, and the now-empty directory.
4. **Scripts.** Remove `data:odpt` and `test:data:odpt` from `package.json`
   (and from `pretest` / any CI references — grep `.github/` too). Keep
   `data:transit` / `test:data:transit`.
5. **Docs.** Update AGENTS.md: the "Hiding-zone presets" snapshot line, the
   Commands block (`pnpm data:odpt` → `pnpm data:transit`), the Source
   Layout entry for `data/odpt/`, and the Hiding Zone Rules bullets that
   reference ODPT paths (the GTFS shapes-fallback rule still applies —
   reword it to point at the transit pipeline). Update
   `docs/implementation_notes.md` if it references ODPT paths.
6. **Tests.** Port any `fetch-odpt.test.mjs` cases not already covered by
   the transit pipeline suites (diff the test names before deleting); then
   delete the old suite.

## Acceptance checklist

- [ ] `grep -ri "data/odpt" src app data .github package.json docs/AGENTS* AGENTS.md` →
      only historical mentions in docs/tasks remain
- [ ] `pnpm data:transit -- --cache-only` regenerates byte-identical
      committed bundles from the moved cache
- [ ] `pnpm check` + `pnpm test` green; full Maestro workflow green on CI
      (app-start + hiding-zone surface — this deletion touches data loading,
      treat it as a broad change per AGENTS.md)
- [ ] AGENTS.md accurate for a fresh agent (no references to removed
      commands/paths)

## Gotchas

- This PR should contain **no behavior changes** — if a snapshot or bundle
  byte-diff appears, stop and find out why before merging.
- Don't delete the cached GTFS zips themselves; they're the only way to
  regenerate without `ODPT_KEY`.
