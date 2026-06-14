# RQ-C3 — Body-of-water fixture + measure the heavy overlay on device

- Owner: Claude (pairing w/ Ryan) Date: 2026-06-14 Time spent: ~0.5 day
- Result: **GREEN**
- One-line answer: The marquee case is real and GEOS crushes it. On the actual
  body-of-water window, device GEOS 3.14.1 dissolves the 216k-coord
  self-overlapping MultiPolygon in **530 ms** (polyclip-JS: **5,644 ms**, ~10.6×)
  and differences it against the play area in **29 ms** — both non-null and well
  under the 3 s ceiling. Gate 3 holds.

## What we did

The expensive op is `backend.unaryUnion(merged)` at
`lineMeasuringGeometry.ts:788-804` (dissolve of water polygons + river-line
buffers over the 50 km window), followed by the mask
`difference(playArea, eligible)` in `buildCombinedEligibilityMask`.

**Path A (faithful capture).** Because the app pipeline imports
`native-geometry`/RN (throws under plain tsx), we minted the fixture inside Jest
(`pnpm test:geos`, which has the mocks) via a throwaway capture test
`spikes/RQ-A1-ios-geos/__tests__/captureBow.geos.test.ts`:

1. Wired geos-wasm into `native-geometry` and **monkeypatched
   `unaryUnionWKB`/`differenceWKB` to record their largest input WKB** before
   delegating.
2. Ran the real pipeline (`computeLineCategory` → `computeLineBuffer` →
   `buildCombinedEligibilityMask`) over the genuine 15 MB body-of-water asset
   (7012 features), `CENTER=[139.658499,35.68783]`, `PLAY_AREA_BBOX=[139,35,140,36]`.
3. Also timed `jsGeometryBackend.unaryUnion` (polyclip-ts) on the captured input
   for the headline contrast.
4. Dumped `bow-fixtures.json` (the committed fixture).

Then `BodyOfWaterTimingTests.swift` runs the captured WKB through device GEOS
3.14.1 (`GEOSUnaryUnion_r`, `GEOSDifference_r`), asserting non-null, non-empty,
and < 3000 ms.

## Evidence

Capture (Jest, geos-wasm wired):

```
[lineCategory] selectWindowFeatures: 2875 features in window (margin=50000m)
[lineBuffer] budget escalation exhausted (6 rounds), enforcing hard cap: 1307 → 400 segs
[C3] distance=130.4m windowFeatures=2875 unaryCoords=216251 diffA=5 diffB=176927 jsPolyclipMs=5644 jsOk=true
```

Device GEOS 3.14.1 (iPhone 16 Pro sim):

```
[C3] unaryUnion: 216251 coords in → 176927 coords out in 529.7 ms (polyclip-JS: 5644 ms)
[C3] difference: A=5 B=176927 → 44787 coords in 28.7 ms
** TEST SUCCEEDED **
```

| op                    | input          | device GEOS 3.14.1 | polyclip-JS                       | speedup |
| --------------------- | -------------- | ------------------ | --------------------------------- | ------- |
| unaryUnion (dissolve) | 216,251 coords | **529.7 ms**       | 5,644 ms                          | ~10.6×  |
| difference (mask)     | 177k vs 5      | **28.7 ms**        | — (explodes on undissolved merge) | —       |

## Recommendation

- **Keep this as the native suite's timing/correctness anchor.** Assert non-null
    - non-empty + a generous wall-clock ceiling (e.g. < 2 s for unaryUnion, < 300 ms
      for difference on the sim; devices are comparable). Don't assert a tight ms
      bound — CI hardware varies.
- **Trim the fixture before committing to the real suite.** `bow-fixtures.json`
  is **12.7 MB** (7 MB of unaryUnion hex + 5.7 MB difference hex). Options:
  gzip it (WKB hex compresses ~4×), or capture a smaller-but-still-pathological
  window (e.g. a 20 km margin) that keeps the overlap stress without 216k coords.
  The dissolve stays the headline; difference can reuse the dissolve output.
- The headline "JS hard-locks ~25 s" nuance: the **dissolve alone** is 5.6 s here
  (post hard-cap budgeting to 400 segs); the historical ~25 s figure was the full
  render including polyclip `difference` on the _undissolved_ overlapping merge.
  Either way the device GEOS path is sub-second end-to-end — the value prop holds.

## Follow-ups / new risks

- **Capture artifact:** `geosWasmVersion()` returned `"unknown"` during the Jest
  capture (vs `3.13.0` from the standalone tsx emitter in C2). Cosmetic — the
  fixture inputs are version-independent and the device side reports 3.14.1
  correctly — but worth a glance if the wasm version is ever asserted in-suite.
- Gate 3 retired. The body-of-water case is the strongest single argument for the
  native module; it should be a flagship test in the impl plan.
- Difference output (44,787 coords, non-null) also serves as a correctness
  fixture, not just timing.
