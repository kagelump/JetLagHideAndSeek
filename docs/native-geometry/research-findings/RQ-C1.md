# RQ-C1 — Is WKB-hex truly identical across JS, Swift, and Kotlin?

- Owner: Claude (pairing w/ Ryan) Date: 2026-06-14 Time spent: ~0.25 day
- Result: **PARTIAL → effectively GREEN** (JS↔Swift proven byte-for-byte;
  Kotlin axis pending RQ-B1, low risk — same reentrant GEOS C API, same
  static-lib source).
- One-line answer: The exact WKB-hex bytes emitted by the repo's `encodeWkb`
  parse in GEOS on iOS with identical geometry type, coordinate count, and
  envelope, and survive a GEOS WKB write→read round-trip. One shared hex fixture
  feeds both engines; no endianness/parse divergence.

## What we did

Reused the RQ-A1 harness (`spikes/RQ-A1-ios-geos/`). Two pieces:

1. **JS emitter** `emit-wkb-fixtures.mts` imports the repo's own
   `src/shared/geometry/wkb.ts#encodeWkb` and emits 4 fixtures to
   `wkb-fixtures.json`, each with its lowercase WKB-hex plus the JS-side ground
   truth (coordinate count + bbox):
    - `tokyo_ward_polygon` (Polygon), `tokyo_rail_linestring` (LineString),
      `osaka_stations_multipoint` (MultiPoint), `two_wards_multipolygon`
      (MultiPolygon) — the same shapes used in `geosParity.test.ts`.
    ```bash
    node --import tsx spikes/RQ-A1-ios-geos/emit-wkb-fixtures.mts > .../wkb-fixtures.json
    ```
2. **Swift verifier** `WkbParityTests.swift` reads that JSON, hex-decodes each
   fixture, parses with `GEOSWKBReader_read_r`, and asserts:
    - `GEOSGeomTypeId_r` matches the GeoJSON type,
    - `GEOSGetNumCoordinates_r` matches the JS coordinate count,
    - envelope (`GEOSGeom_get{X,Y}{Min,Max}_r`) matches the JS bbox (tol 1e-9),
    - a `GEOSWKBWriter_write_r` → re-read round-trip preserves the coord count.

## Evidence

```
tokyo_ward_polygon: type=3 coords=5 bbox=[139.74,35.66,139.79,35.7] OK
tokyo_rail_linestring: type=1 coords=4 bbox=[139.7006,35.6586,139.7966,35.7101] OK
osaka_stations_multipoint: type=4 coords=3 bbox=[135.4959,34.6464,135.5206,34.7024] OK
two_wards_multipolygon: type=6 coords=10 bbox=[139.6,35.6,139.79,35.7] OK
** TEST SUCCEEDED **
```

The repo encoder writes **little-endian** WKB (byte order `0x01`, confirmed in
`wkb.ts` `WKB_BYTE_ORDER`); GEOS reads it on arm64 (also little-endian) with no
swap. Coordinates are IEEE-754 float64 in both — bbox matches to 1e-9.

## Recommendation

- **One shared WKB-hex fixture per geometry is valid** — author the real native
  suite's fixtures as hex strings + JS-computed invariants (type, coord count,
  bbox), exactly as here. No per-engine encoders needed.
- Compare **invariants, not raw re-serialized bytes**: GEOS's own WKB writer may
  reorder rings / normalize, so assert type+count+bbox (and area/relate for ops),
  not byte equality of the round-trip. (Goal condition explicitly allows this.)
- When RQ-B1 lands, drop the **identical** `probeWkbHex` logic into a Kotlin
  instrumented test reading the same `wkb-fixtures.json` to close the Kotlin axis.
  Risk is low: same `GEOSWKBReader_read_r` from the same GEOS source, just a
  different host language.

## Follow-ups / new risks

- Kotlin axis is the only open item — fold it into RQ-B1's first instrumented
  test rather than a separate spike.
- Gate 2 ("are fixtures truly cross-engine?") can be marked **retired for
  JS↔Swift now**, fully retired once B1 confirms Kotlin.
- These fixtures are inputs only. Op-output parity (buffer/difference area
  ratios across geos-wasm 3.13 vs device 3.14.1) is RQ-C2 — now unblocked by the
  A1 harness.
