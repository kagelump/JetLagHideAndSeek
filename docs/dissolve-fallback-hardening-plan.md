# Harden the pack dissolve against build hangs — implementation plan

Status: **ready to implement**. Created 2026-06-20. For a follow-up agent.

## Why

Body-of-water is `enabled: false` for almost every region in
`data/packs/regions.yaml`. The stated reason
([regions.yaml:76-79](../data/packs/regions.yaml)):

> "the NL build showed the polygon dissolve can hit a GEOS TopologyException and
> **hard-lock on the polyclip-ts fallback**."

That single failure mode is the thing blocking "enable body-of-water on all
packs by default." If a bad tile can never hang the build, body-of-water becomes
safe to enable everywhere (subject to artifact-size/product calls, which are
separate). This plan makes the dissolve **provably non-hanging** so the gate can
be flipped with confidence on any region we add later.

This is the `#2` option from the body-of-water-default discussion; the runtime
notch and the build even-odd holes are already fixed (see
`water-bundle-notes-handoff2.md`).

## The failure mode, precisely

The dissolve unions overlapping water polygons. The fast path is GEOS
(`geosUnaryUnionCoords`); on GEOS failure it falls back to polyclip-ts
(`unionAllCoords`). polyclip-ts's variadic union is **synchronous and
CPU-bound**, and on a dense tile it doesn't crash — it runs for minutes. Its own
comment benchmarks **2,000 trivial squares at 123 s**
([polygonDissolve.mjs:363](../data/geofabrik/scripts/lib/polygonDissolve.mjs)).
`unionAllCoords` only guards against _throws_ (split-in-half on catch), not
against _slowness_, so a dense-but-valid tile wedges the build.

**Key constraint:** a synchronous polyclip call cannot be time-boxed from the
same thread — JS is single-threaded and non-preemptive. Bounding it requires
either (a) never handing polyclip a pathological input, or (b) running it in a
killable child/worker.

## Call-site inventory (every polyclip union/intersection that can hang)

| Site                               | File                                                            | What                                                                        |
| ---------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| GEOS-fail → `unionAllCoords`       | `polygonDissolve.mjs` `geosUnaryUnionCoords` (~:82-108)         | **dominant hang** — variadic polyclip union of all tile/band polygons       |
| no-GEOS path → `unionAllCoords`    | same                                                            | only when geos-wasm isn't loaded (tests / non-tsx); small input in practice |
| per-tile box clip                  | `dissolveTile` `intersection(merged, tileGeom)` (~:617)         | polyclip intersection, per union group                                      |
| band-rect clip                     | `clipCoordsToRect` `intersection(coords, rectGeom)` (~:408-426) | polyclip intersection of a band blob                                        |
| band pre-merge                     | `dissolveWorker.mjs` `geosUnaryUnionCoords(...)` (~:83)         | union inside each shard child process                                       |
| cross-tile merge (sequential only) | `buildMeasuring.mjs` (~:863)                                    | `geosUnaryUnionCoords` over all tile features                               |

Execution model:

- **Parallel** (`polygonDissolveParallel`, jobs>1): each band is a **child
  process** (`runShard`, ~:903) with a memory cap but **no wall-clock timeout** —
  if a shard hangs, the parent `await`s forever.
- **Sequential** (jobs===1): everything in-process.

## Design

Two layers. The first makes the common path bounded by construction; the second
is a catch-all so _nothing unforeseen_ can wedge a build.

### Layer 1 (primary) — skip-union instead of polyclip-union on GEOS failure

When the GEOS union fails, **do not** polyclip-union; return the inputs
**un-unioned** (each input polygon as its own group). This is safe **now**
because the rest of the pipeline tolerates overlapping members:

- The runtime unions the per-feature buffers itself (the binary-union fix in
  `computeLineBuffer`), so overlapping stored water is fine.
- The waterway-clip grid (`buildPolygonGrid` → `pointInGrid`) is a
  point-in-**any**-polygon test — overlap = still "inside water".
- The parallel cross-band assembly **concatenates** (already overlap-tolerant);
  the sequential cross-tile merge runs through the same `geosUnaryUnionCoords`
  (so it also skip-unions on failure).

Cost: a failed tile emits more (overlapping) polygons → locally larger artifact
and more runtime buffer pieces. Bounded by the tile's raw polygon count, and
only on tiles where GEOS actually fails (rare — and rarer since the
`validate:false` change removed the MakeValid throw source).

Make the remaining polyclip **intersections** bounded too: clip **per polygon**,
never a big overlapping concatenation. `dissolveTile` already clips per group, so
if skip-union returns individual polygons as individual groups, each tile-box
clip is one `polygon ∩ box` (fast, bounded). In `clipCoordsToRect`, clip each
member polygon of a MultiPolygon separately rather than the whole blob at once.

Concretely:

1. In `geosUnaryUnionCoords`, replace the **GEOS-failure** fallback
   (`return unionAllCoords(coordsList)`) with a `skipUnion(coordsList)` that
   returns each input polygon as its own coordinate group (no polyclip). Keep
   `unionAllCoords` **only** for the explicit no-GEOS path, and guard _that_ with
   a size cap (below) so even a non-tsx run can't hang.
2. Add a size cap: if `geosReady` but the input exceeds
   `dissolve.maxUnionPolygons` / `dissolve.maxUnionCoords`, **skip the union
   pre-emptively** (don't even try GEOS on absurd tiles) and pass through. This
   bounds worst-case op size regardless of engine.
3. Make `clipCoordsToRect` (and the `dissolveTile` tile-box clip) iterate member
   polygons, intersecting each with the rect independently, so no single polyclip
   intersection ever sees an overlapping pile.
4. Log every skip with tile bbox + polygon count (so degraded tiles are visible
   in build logs and can be spot-checked in `tools/data-viewer`).

### Layer 2 (safety net) — parent shard wall-clock timeout + bounded retry

Even with Layer 1, an unforeseen wedge (a GEOS-wasm hang, a pathological
intersection) shouldn't be able to hang a build forever. Add a per-shard
wall-clock budget in the **parallel** path:

1. In `runShard` (`polygonDissolve.mjs:903`), start a `setTimeout` that
   `child.kill("SIGKILL")` after `dissolve.shardTimeoutMs` (config; default e.g.
   15 min, or scaled by the shard's input size). Clear it on clean exit.
2. Make worker output **atomic**: write to `output-<s>.json.tmp` then rename, so a
   killed shard never leaves a half-written file the parent might read.
3. On timeout, `polygonDissolveParallel` **re-runs that band's spec once** with a
   `forceSkipUnion: true` flag threaded into the spec → `dissolveWorker` →
   `dissolveTile`/`geosUnaryUnionCoords`, forcing the Layer-1 bounded path (which
   cannot hang). If the retry also fails, fail the build loudly with the band
   bbox (a real bug, not a hang).
4. Sequential path: Layer 1 already bounds it (no child to kill); if extra safety
   is wanted, the same `forceSkipUnion` can be set when an env/CLI flag requests
   a "safe" build.

This keeps the fast GEOS path for the 99% case, bounds the 1%, and guarantees
termination.

## Config (data/geofabrik/config.yaml → `measuring.dissolve`)

```yaml
dissolve:
    # existing: tileDeg, overlapDeg, emitCellDeg, minWaterPolygonAreaM2
    maxUnionPolygons: 4000 # skip union (pass-through) above this per op
    maxUnionCoords: 400000 # …or this many total coords
    shardTimeoutMs: 900000 # 15 min parent kill budget per shard
```

Thread these through `buildMeasuring.mjs` (already reads `_m.dissolve?.*`) and
the `polygonDissolveParallel` opts (alongside `tileDeg`/`overlapDeg`/`jobs`).
Per-region overrides already exist (`measuringOverrides.<cat>.dissolve`), e.g.
NL's `tileDeg: 0.125` — keep that mechanism.

## Testing

Add `data/packs/scripts/lib/dissolveFallback.test.mjs` (node --test; runs the
**polyclip path**, since `node --test` has no tsx → `geosReady` is false — which
is exactly the fallback we're hardening):

1. **No-hang under density.** Build ~2,000 overlapping squares (the documented
   123 s case). With Layer 1, assert the dissolve returns within a hard time
   bound (e.g. < 5 s) and that the union region is **covered** (point-in-any
   output polygon for sample points across the squares). This is the regression
   that proves the hang is gone.
2. **Coverage preserved by skip-union.** For a small overlapping set, assert the
   skip-union output's covered area (by sampling) equals the true union's.
3. **Size cap triggers.** Feed > `maxUnionPolygons` and assert pass-through
   (group count == input count, no polyclip call — spy/stub `union`).
4. **Per-polygon clip.** `clipCoordsToRect` on a MultiPolygon with N members
   returns the same area as clipping each member, and never feeds polyclip a
   multi-member overlap.

Add `data/packs/scripts/lib/dissolveShardTimeout.test.mjs` for Layer 2:

5. **Shard timeout kills + retries.** Point `runShard` at a stub worker that
   sleeps forever; assert the parent kills it after `shardTimeoutMs` and the
   retry (forceSkipUnion) produces output. Use a tiny timeout in the test.

Also run the existing suites: `pnpm test:data:packs` (dissolveParallel,
bucketPolygons), `pnpm typecheck`. The GEOS-path correctness is already covered
by `buildDissolveUnion.geos.test.ts`.

## Validation (the real proof)

After implementation, build the **stress region** end-to-end with body-of-water
enabled and confirm it completes within budget on a 16 GB laptop:

```bash
# Netherlands — the documented worst case
NODE_OPTIONS=--max-old-space-size=16384 \
  pnpm data:pack -- --region europe-netherlands --jobs auto
pnpm data:pack:lint
```

Capture: wall-time, peak RSS, count of skip-union tiles (from logs), any shard
timeouts, and eyeball the water in `tools/data-viewer`. Then spot-check one more
currently-disabled region (e.g. `europe-greater-london`, `asia-south-korea`).
If all complete cleanly, flipping the default is safe.

## Flipping the default (the payoff — separate change)

Once validated: remove the `body-of-water: { enabled: false }` overrides from
`data/packs/regions.yaml` (the category is on by default in
`data/geofabrik/config.yaml`; regions only opt out). Consider keeping the NL
`tileDeg: 0.125` tuning. This is a **product/size** decision too — body-of-water
is the largest measuring artifact (~3.2 MB for Kantō); enabling it everywhere
grows every pack. Decide whether to ship it for all regions or a curated set.

## Risks & tradeoffs

- **Artifact size on degraded tiles.** Skip-union emits more polygons for failed
  tiles. Monitor via the skip-count log; if a region degrades heavily, lower its
  `tileDeg` (smaller tiles → smaller per-tile unions → GEOS succeeds more often).
- **SIGKILL mid-write.** Mitigated by atomic temp-file + rename; the parent must
  only read a shard's output on clean exit.
- **Retry determinism.** `forceSkipUnion` must be fully deterministic and
  polyclip-free so the retry cannot itself hang.
- **No-GEOS path.** Real builds always have GEOS (tsx); the `unionAllCoords`
  path is test-only, but the size cap (step 2) guards it regardless.

## Out of scope / future

- The **distance-field** representation (`distance-field-measuring-plan.md`)
  would remove the runtime buffer/union entirely and is the bigger structural
  win; this plan is the cheap, immediate unblock for enabling body-of-water
  everywhere.
- Replacing polyclip-ts with a GEOS-only build (no JS fallback) — not needed if
  skip-union + cap + timeout bound the failure.
