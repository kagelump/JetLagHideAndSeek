# `encodeDeltaPolygon` stack overflow on large boundary polygons

**Filed:** 2026-06-21
**Status:** FIXED 2026-06-21 — root-caused + defense-in-depth (see "Fix" below).
**Severity:** Medium — blocked full-catalog `--all` rebuilds.
**Subsystem:** `data/packs/scripts/lib/deltaEncode.mjs`

## Fix (2026-06-21)

Root cause removed at source: `encodeDeltaRingInto(ring, out)` now encodes each
ring **directly into** the shared output buffer (back-filling the `ringLen`
prefix), so the per-point path never builds an intermediate `delta` array and
never spreads it as call arguments. `encodeDeltaRing` is kept as a thin wrapper
over it. `encodeDeltaPolygon` calls `encodeDeltaRingInto` — the `out.push(...delta)`
site is gone.

Defense in depth: added `pushAll(target, source)` (`arrayUtil.mjs`), a
loop-based bulk-append with no argument-count ceiling, and routed every
remaining large-array spread in the pipeline through it — the five
`features.push(...)` sites in `buildMeasuring.mjs` (water-dense regions emit
tens of thousands of features) and the `leftoverStations.push(...opRecords)`
site in `buildTransit.mjs`. Tiny bounded spreads (error lists in
`catalogSchema.mjs`) were left as-is.

Regression coverage: `deltaEncode.test.mjs` encodes a 60k-point ring without
throwing and asserts the in-place `ringLen` prefix; `arrayUtil.test.mjs` pushes
500k elements without overflow.

## Symptoms

Building a region whose assembled boundary relation has a very large ring (tens of
thousands of points) crashes with:

```
RangeError: Maximum call stack size exceeded
    at encodeDeltaPolygon (data/packs/scripts/lib/deltaEncode.mjs:128:17)
    at buildBoundaries (data/packs/scripts/lib/buildBoundaries.mjs:231:25)
```

Reproduces on `north-america-us-new-york` (and likely other complex-coast regions
like Alaska, Michigan). Also repros when run individually (not just `--all`), so
it is **not** an accumulated-build issue — it is deterministic per region.

## Root cause

`encodeDeltaPolygon` line 128:

```js
out.push(...delta);
```

`delta` is the flat array `[ringLen, x0, y0, dx1, dy1, …]` for a single ring.
When the ring has _N_ points, `delta` has `2N + 1` elements. JavaScript's
`Function.prototype.apply` / spread operator converts every element into a
separate argument on the call stack, which overflows the V8 stack limit
(roughly 10k–20k elements) for rings with ~5k+ points.

Large boundary polygons — especially coastal states/islands with complex
shorelines — routinely produce rings in this range after osmium `getid -r`
pulls in all member ways and the boundary assembler stitches them.

## Proposed fix

Replace the spread with a loop or `Array.prototype.push.apply`:

```js
// Option A — loop (clearest intent)
for (let i = 0; i < delta.length; i++) {
    out.push(delta[i]);
}

// Option B — apply (one call, no stack risk)
out.push.apply(out, delta);
```

Option A is preferred; V8's `push.apply` still has a limit (though much higher
than spread) and the loop is trivially optimised.

Another approach: refactor `encodeDeltaRing` to accept the output array and push
directly, avoiding the intermediate `delta` array altogether — saves an
allocation and removes the spread site entirely:

```js
// In encodeDeltaPolygon:
for (const ring of rings) {
    encodeDeltaRingInto(ring, out);
}

// New helper:
function encodeDeltaRingInto(ring, out) {
    // ... same logic as encodeDeltaRing but pushes into `out` directly
    const ringLenIdx = out.length;
    out.push(0); // placeholder for ringLen
    for (let i = 0; i < ring.length; i++) {
        const [x, y] = quantize(ring[i][0], ring[i][1]);
        if (i === 0) {
            out.push(x, y);
            px = x;
            py = y;
        } else {
            out.push(x - px, y - py);
            px = x;
            py = y;
        }
    }
    out[ringLenIdx] = out.length - ringLenIdx; // back-fill ringLen
}
```

This is the most memory-efficient option and removes the intermediate allocation,
but is a larger change. The loop fix (Option A) is a one-liner and sufficient.

## Discovery

Found during the admin-level unification epic (`docs/tasks/admin-unification/epic.md`)
when attempting a full `--all` rebuild to remove admin measuring artifacts
(Phase 1, T1.3). The crash is **pre-existing** and unrelated to that work —
it just surfaced because a full rebuild touched New York for the first time
since the boundary assembler added delta encoding.

## Temporarily affected regions

These regions failed or were already incomplete in `data/packs/dist/` and could
not be rebuilt because of this bug:

- `north-america-us-new-york` (crashes during boundaries build)
- `north-america-us-alaska` (incomplete previous build — no meta/hashes)
- `north-america-us-maine` (incomplete previous build)
- `north-america-us-michigan` (incomplete previous build)
- `north-america-us-new-hampshire` (incomplete previous build)
- `north-america-us-north-carolina` (incomplete previous build)
- `north-america-us-vermont` (incomplete previous build)

The incomplete-dist regions may have unrelated prior build failures; they need a
clean rebuild after this bug is fixed, not just a delta-encode patch.
