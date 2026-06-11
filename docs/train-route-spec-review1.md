# Review: train-route-spec.md implementation (round 1)

Reviewed: 2026-06-12, working tree on `master` (uncommitted).
Scope: Tasks 1–3 of the implementation plan in `docs/train-route-spec.md` —
`stopOrderRepair.mjs` + tests, the `osmRoutes.mjs` / `gtfs.mjs` wiring, the
override config (Task 2), the spatial-match audit logging (Task 3), report
stats, PLAYBOOK docs, and the regenerated `assets/transit/*.json` bundles.

## Verdict

The core works and is verifiably an improvement, but **two findings should
block commit**: partially-repaired routes ship in a state that is neither
original nor fixed (R1), and the stale-override warning can never fire (R2).
Everything else is fix-after or note-level.

## Verified working

- **The motivating case is fixed.** Relation `12185878` (半蔵門線–田園都市線–
  東武 through-service) in `japan-kanto.json`: max inter-stop gap 62.6 km →
  7.0 km; 春日部 is no longer terminal. Verified directly against the
  regenerated bundle.
- **Net effect across all 8 bundles** (HEAD vs working tree, comparing
  per-route geometry): 1743 routes total, 165 changed, **152 improved** their
  max gap, 12 worsened (2 unique relations — see R1), 1 changed with no
  max-gap effect.
- **Shinkansen / limited-express false-positive guard works.** Remaining gaps
  over 60 km are overwhelmingly Shinkansen-class routes with uniformly long
  spacing, which the relative threshold correctly leaves untouched.
- **Settled design decisions are honored**: trigger-gated repair,
  `max(20 km, 4 × median)` detection, cheapest reinsertion with
  gap-eliminated + strictly-shorter acceptance, cap of 3, GTFS warn-only
  (`gtfs.mjs:569-580`, correctly guarded — stop times are pre-filtered to
  known stops), warn-only visibility with no bundle-format change.
- **Report stats present** (`conflateStage.mjs`, run output:
  306 detected jumps / 1303 "repaired stops" / 74 unrepairable / 21 ambiguous /
  77 weak matches). Config validation for overrides + 4 new tests; PLAYBOOK
  override workflow documented with the correct `osm:node:<id>` id format.
- **All 97 pipeline tests pass** (`pnpm test:data:transit`).

## Findings

### R1 (blocker) — Partial repairs ship on variants that remain broken

`stopOrderRepair.mjs:79-163`: the repair loop applies repairs one at a time
and `break`s when a gap can't be repaired or the cap is hit — but keeps the
repairs already applied, returning `repaired: true`. Three consequences:

1. The shipped order is neither the original ("preserve data as-is") nor
   fixed — the worst state for auditability, and it violates the spec's
   "orders this repair cannot fix … are left as-is with a warning."
2. It can make geometry worse. Evidence from the regenerated bundles:
   のぞみ (`osm:relation:9802526`) max gap **355 → 384 km** and JR東海道本線
   (`osm:relation:11680904`) **389 → 398 km**, each duplicated across 5–6
   regional bundles. (Acceptance only requires _total_ length to decrease,
   so an accepted move can still grow the _max_ gap on a wholesale-broken
   relation.)
3. `osmRoutes.mjs:499-521`: when `repaired === true`, the
   `repairResult.warnings` (including "Gap … could not be repaired") are
   **silently dropped** — only the success log prints. And
   `unrepairableVariants` is not incremented, so these routes are invisible
   in the report.

**Fix**: make acceptance atomic at the variant level — after the repair loop,
re-run detection; if any flagged gap remains, revert to the original order,
return `repaired: false` with the warnings. A partially-fixable relation is
by definition one the method cannot fix. (Also always surface
`repairResult.warnings` in `osmRoutes.mjs` regardless of branch.)

The two relations above are wholesale-broken upstream and are exactly the
Task 2 use case: fix in OSM or add an override; either way they should ship
_unmodified_ until then.

### R2 (blocker) — Stale-override warning is unreachable

`osmRoutes.mjs:459-477`: `ordered` is built from the override's matched IDs,
then **all remaining resolved stops are appended to it**, then
`variantStationIds` is replaced — and only then is `ordered.length === 0`
checked. After the append, `ordered` can only be empty if the variant had no
resolved stops at all, so a fully-stale `stopOrder` override (zero IDs
matching) silently degrades to "no reordering" with no warning. This defeats
the stale-override detection that PLAYBOOK advertises.

**Fix**: count matches before appending the remainder:
`const matched = relOverride.stopOrder.filter((sid) => variantStationIds.includes(sid)).length`
and warn when `matched === 0` (arguably also when
`matched < relOverride.stopOrder.length`).

### R3 — Repair can silently re-reorder an explicit `stopOrder` override

`osmRoutes.mjs:459-521`: detection + repair run _after_ the override is
applied. If a human-specified order still trips the detector (entirely
possible — e.g. a legitimate long gap), the machine reorders the
human-specified sequence. An explicit `stopOrder` is the highest-authority
signal we have; repair should be skipped for that variant (running detection
warn-only there is fine and useful).

### R4 — `repairedStops` metric is inflated ~10×

`osmRoutes.mjs:500-505`: `movedCount` counts every index that shifted, but a
single mid-route reinsertion shifts every stop between the removal and
insertion points — the 春日部 repair alone counts ~40 "repaired stops". The
report's `Repaired stops: 1303` therefore reads as mass reordering when the
actual number of reinsertions is likely in the low hundreds. Return
`repairsDone` from `repairStopOrder` and report that; for auditability, log
"moved <id> from index i to j" per repair instead of a shifted-index count.

### R5 — Spec'd test fixtures missing from `stopOrderRepair.test.mjs`

The plan (Task 1, step 2) lists five fixtures; two aren't implemented:

- **Reversed mid-route block** — the key "repair must decline" case. The
  existing "rejects repair" test uses a far-away terminal stop instead, which
  exercises a different geometry. With R1's atomicity fix this fixture also
  pins the revert behavior.
- **Already-correct route force-fed to the repairer** — the existing test
  never reaches the reinsertion code because detection finds nothing. Call
  the reinsertion path directly (or use a sequence with a legitimate flagged
  gap) to pin "cheapest reinsertion of a correctly-placed stop finds no
  improvement".

Also missing given R1: a fixture where repair #1 succeeds and repair #2
fails, asserting the variant reverts wholesale.

### R6 — Duplicate station ids break the `gapGone` identity check

`stopOrderRepair.mjs:127-129` identifies positions via `findIndex` on
`s.id`. `osmRoutes.mjs:328` admits both `stop` and `station` roles, and both
can resolve to the same station record, so `variantStationIds` can contain
duplicates (consecutive-coordinate dedupe happens later, at coords build).
Loop routes (first == last stop) duplicate ids too. With duplicates,
`findIndex` returns the first occurrence and the adjacency check can be
wrong; zero-length duplicate gaps also drag the detection median down.
**Fix**: dedupe consecutive duplicate ids before repair, and/or use
index-based identity inside the trial loop.

### R7 — `suppressJumpWarning` semantics drift

- `osmRoutes.mjs:491` increments `stats.detectedJumps` _before_ the
  suppression check, so suppressed relations keep inflating the headline
  stat — defeating the point of acking a known-legitimate gap.
- The flag also suppresses _repair_, not just the warning (correct behavior
  for "this gap is legitimate", but the name and PLAYBOOK's "skip the
  implausible-jump check" don't match the stat behavior). Align: skip the
  stat increment when suppressed, or rename/document the flag as disabling
  detection for the relation.

### R8 — Detection blind spot on very short variants

`detectImplausibleJumps` with 3 stops: gaps `[1 km, 60 km]` → median 30.5 km
→ threshold 122 km → the 60 km jump is **not** flagged. Any 3-stop variant
with one bad gap escapes. Consider computing the median excluding the largest
gap (or requiring ≥4 gaps for the relative test and falling back to the
absolute floor below that).

### R9 — Repair loop gives up on first unrepairable gap

`stopOrderRepair.mjs:144-149`: if the _largest_ flagged gap can't be
repaired, the loop breaks without attempting smaller flagged gaps that might
be independently fixable. Low priority — and note the interaction with R1:
under atomic accept/revert, "fix some gaps but not all" still ends in a
revert, so this only matters if you adopt R1's revert and still want
best-effort diagnostics in the warnings.

### R10 — Minor issues in the Task 3 audit logging

- `osmRoutes.mjs` ambiguous-match second-place lookup matches by float
  equality (`Math.abs(effectiveDist - secondBest) < 0.001`) — track the
  station id alongside the distance instead.
- The weak-match check compares `bestEffectiveDist` (which includes the
  +25/+50 non-station penalty) against `maxDist * 0.8`, so a halt at a
  physically close distance can be reported "weak". Use the raw `dist` for
  the weak check; keep `effectiveDist` for ranking.

### R11 — Config validation gaps (minor)

`config.mjs` override validation: a null/non-object relation override value
(e.g. `"123": null` in YAML) throws inside validation instead of producing an
error message; `stopOrder` array _elements_ aren't validated as strings of
the `osm:node:<n>` form. Both are one-line guards.

## Docs / housekeeping

- The Implementation Plan status table in `docs/train-route-spec.md` still
  shows Tasks 1–3 as pending; update it (and mark Task 2/3 as shipped) once
  the blockers above are addressed.
- Console noise is acceptable for now (306 detections + per-repair lines +
  98 match warnings) but will drown the useful signal as locales grow;
  consider per-relation summarization later.
- **Don't commit the regenerated bundles until R1 is fixed** — the のぞみ /
  東海道本線 regressions are in the current `assets/transit/*.json` working
  tree.
- Out of scope but present in the same working tree: changes to
  `matchingSelectors.test.ts`, `lineMeasuringGeometry.test.ts`, and untracked
  `docs/offline-data-packs.md` / `docs/superpowers/` / `docs/tasks/offline/`.
  Keep them out of this commit.
