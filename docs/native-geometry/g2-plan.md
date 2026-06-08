# G2 Plan — Local Expo Module + WKB codec + native GEOS backend

_2026-06-09. Part of the [native-geometry implementation plan](./implementation-plan.md). Follows [G1](./g1-plan.md)._
_Status: **planned, not started.**_

## Goal

Turn the G1 smoke-test module into the real, production buffer path: a
synchronous `bufferWKB(wkb, distance, quadrantSegments)` native function, a JS
WKB codec + projection adapter, and a `geosGeometryBackend` wired behind the
existing G0 seam — so `APP_CONFIG.geometry.backend = "geos"` (and `"auto"` on a
device) routes every `bufferMeters` call through GEOS instead of `@turf/buffer`,
**with output indistinguishable from the JS oracle within a tight tolerance.**

G2 does **not** change any simplification constants (that's G4) and does **not**
touch overlay ops (union/difference — Phase B / G5). Its only job is a faithful,
fast, well-validated buffer swap. The whole point of G2 is that after it lands,
the only difference a user could observe is **speed** — fidelity changes come
later, deliberately, in G4.

## Where G1 left things (verified state)

- **Native modules** (`modules/native-geometry/`) expose `geosVersion()` and
  `smokeTest(wkb) -> wkb?` on both platforms. `smokeTest` hardcodes a 0.01°
  buffer with `quadrantSegments=8` — it proves linking, not the real API.
- **Both platforms** already create a reentrant GEOS context with notice/error
  handlers, and guard with `GEOSisValid_r` → `GEOSMakeValid_r`. Reuse all of it.
- **No JS entry exists yet** — `modules/native-geometry/package.json` points
  `main` at `src/index.ts`, which **does not exist**. Creating it is G2.
- **The G0 seam** (`src/shared/geometry/geometryBackend.ts`) already probes
  `require("native-geometry").isAvailable()` and has commented `TODO(G2)` hooks
  to install `geosGeometryBackend`. All five buffer call sites already route
  through `getGeometryBackend().bufferMeters(...)` (line buffer, polygon buffer,
  union-via-`buffer(fc,0)`, `getDilatedPlayArea`, and the point MultiPoint
  buffer). Jest force-mocks the module to `isAvailable: () => false`.

## P0 prerequisite — fix the `.gitignore` footgun (blocks everything)

The root `.gitignore` ignores `ios/` and `android/` **unanchored**, so they also
match `modules/native-geometry/ios/` and `.../android/`. Today **none of G1 is
trackable** — the Swift/Kotlin source, podspec, CMakeLists, JNI, and the
committed `libgeos.xcframework` + per-ABI `libgeos.a` are all silently excluded.
`git add -n modules/native-geometry` adds nothing under those dirs.

Fix before any G2 work, or EAS/CI will build without the module:

```diff
-ios/
-android/
+/ios/
+/android/
```

Anchoring to the repo root keeps the CNG-generated top-level `ios/`/`android/`
ignored while letting the module's platform dirs commit. The existing explicit
ignores already cover the build intermediates:

```
modules/native-geometry/ios/build/
modules/native-geometry/android/build/
modules/native-geometry/vendor/geos/
```

After fixing, verify the artifacts are tracked and note their size in the PR
(iOS arm64 `.a` ≈ 8 MB; Android `.a` ≈ 14 MB/ABI — these are pre-link static
archives; the linker dead-strips unused GEOS symbols so the **app-size** delta is
far smaller than the archive. Still ~44 MB of binaries enter history; decide
git-LFS vs plain commit consciously and record it in
`docs/implementation_notes.md`).

## The projection decision — resolved (this is the correctness crux)

The implementation-plan flagged "meters vs degrees" as the most dangerous silent
bug. Reading the installed `@turf/buffer@7.3.5` source settles it:

```js
function defineProjection(geojson) {
    var coords = center(geojson).geometry.coordinates; // feature centroid
    return geoAzimuthalEquidistant()
        .rotate([-coords[0], -coords[1]])
        .scale(earthRadius); // 6371008.8 m
}
// projects coords → planar METERS, reads into JSTS,
// buffers by radiansToLength(lengthToRadians(radius,'meters'),'meters') == radius,
// then unprojects with projection.invert.
```

So turf does **not** buffer in degree space and does **not** use a naive
`cos(lat)` equirectangular factor. It buffers in a **per-feature azimuthal-
equidistant projection centered on the feature's centroid, in meters**, with
`steps` passed straight through as JSTS `quadrantSegments`. GEOS's
`quadrantSegments` has the identical meaning, so arc fidelity matches for the
same number.

**Therefore the native module stays projection-agnostic** — it buffers in input
units — **and the JS `geosGeometryBackend` owns the projection, replicating
turf's exactly:**

1. Per feature, compute the centroid via the **same** `@turf/center` (bbox
   midpoint) algorithm.
2. Build the **same** projection: `geoAzimuthalEquidistant().rotate([-cx,-cy]).scale(earthRadius)` with `earthRadius = 6371008.8`.
3. Project all coordinates to planar meters; encode to WKB.
4. Call `bufferWKB(wkb, meters, quadrantSegments)` — GEOS buffers in those meter
   units; pass `meters` unchanged.
5. Decode the result WKB; unproject every coordinate with `projection.invert`;
   rebuild GeoJSON.

This makes parity with turf a question of **JSTS-vs-GEOS buffer internals + arc
generation only** — differences should be sub-meter — rather than a projection
mismatch. Reuse `d3-geo` and `@turf/center` (both already in the tree via
`@turf/buffer`); promote them to **direct dependencies** so the projection is
provably identical, not an approximation.

> **Scope guard:** turf's AEQD is geometrically correct (isotropic, true metric),
> so there is no fidelity to "fix" here. Any later move to a different projection
> is a separate, independently-validated change — not G2.

## Work items

### W1 — Native `bufferWKB` (both platforms)

Generalize the G1 smoke path into the real entry point. Keep `geosVersion()` for
diagnostics; replace `smokeTest` with:

```
bufferWKB(wkb: Uint8Array, distance: Double, quadrantSegments: Int) -> Uint8Array?
```

- iOS (`NativeGeometryModule.swift`): `Function("bufferWKB") { (wkb: Data, distance: Double, quadrantSegments: Int) -> Data? in … }`.
- Android (`NativeGeometryModule.kt` + `native-geometry-jni.cpp`): `Function("bufferWKB") { wkb: ByteArray, distance: Double, quadrantSegments: Int -> nativeBufferWKB(wkb, distance, quadrantSegments) }` with a matching JNI export.
- Reuse the existing context + `GEOSisValid_r`/`GEOSMakeValid_r` guard.
- **Match JSTS buffer defaults for parity:** on the `GEOSBufferParams`, set
  `quadrantSegments = quadrantSegments`, `endCapStyle = GEOSBUF_CAP_ROUND`,
  `joinStyle = GEOSBUF_JOIN_ROUND`, leave mitre limit at default. (JSTS
  `BufferOp.bufferOp(geom, distance, qs)` uses round cap + round join.)
- **Memory discipline (audit every path, including error returns):** destroy the
  input geom, the (possibly MakeValid'd) geom, the buffer params, the output
  geom, and `GEOSFree_r` the WKB buffer. A leaked free here compounds per
  closer/farther tap. Mirror the deferred-destroy pattern already in the smoke
  code.
- Keep it **synchronous** (`Function`, not `AsyncFunction`) — ~1–5 ms keeps
  `buildMeasuringRenderState` synchronous (decision #3 in the parent plan).

### W2 — Module JS entry `modules/native-geometry/src/index.ts`

```ts
import { requireNativeModule } from "expo-modules-core";
const Native = requireNativeModule("NativeGeometry");

/** True when the native module is linked and exposes bufferWKB. */
export function isAvailable(): boolean {
    try {
        return typeof Native?.bufferWKB === "function";
    } catch {
        return false;
    }
}
export function geosVersion(): string {
    return Native.geosVersion();
}

/** Buffer a WKB geometry by `distance` (input units) → WKB, or null on failure. */
export function bufferWKB(
    wkb: Uint8Array,
    distance: number,
    quadrantSegments: number,
): Uint8Array | null {
    const out = Native.bufferWKB(wkb, distance, quadrantSegments);
    return out ? new Uint8Array(out) : null;
}
```

`isAvailable()` is exactly what the G0 seam probes — keep the name aligned.

### W3 — WKB codec `src/shared/geometry/wkb.ts` (pure JS, no deps)

Little-endian (byte order `01`) ISO/OGC WKB over a `DataView`. Support only the
geometry types we encode/decode — no Z, no M, no SRID:

| Encode (inputs to buffer)                                                            | Decode (outputs from buffer)  |
| ------------------------------------------------------------------------------------ | ----------------------------- |
| LineString (2), MultiLineString (5), Polygon (3), MultiPolygon (6), MultiPoint (4)\* | Polygon (3), MultiPolygon (6) |

\*MultiPoint is needed for the point-measuring path
(`computePointUnionBuffer`).

- `encodeWkb(geometry): Uint8Array` and `decodeWkb(bytes): Geometry`.
- Layout per geometry: `byteOrder(1)` + `type(uint32)` + counts + `float64`
  coordinate pairs, nested per the WKB spec (Polygon = numRings → per ring
  numPoints → points; MultiPolygon = numPolygons → Polygon WKB each; etc.).
- Robustness: bounds-check every read against `bytes.length`; throw a typed
  `WkbError` on truncation / unknown type / zero rings rather than reading OOB.
- **No external dependency** — it's ~150 LOC and we want full control + golden
  tests.

### W4 — Projection `src/shared/geometry/bufferProjection.ts`

Thin wrapper that reproduces turf's projection so `geosGeometryBackend` matches
the oracle:

```ts
import { geoAzimuthalEquidistant } from "d3-geo";
import center from "@turf/center";
const EARTH_RADIUS = 6371008.8;
export function projectionFor(geom): { project; invert } { … } // AEQD on center, scale=EARTH_RADIUS
export function projectGeometry(geom, proj): Geometry;          // wgs84 → planar meters
export function unprojectGeometry(geom, proj): Geometry;        // planar meters → wgs84
```

Add `d3-geo` and `@turf/center` to `package.json` dependencies (already
transitive; pin to the versions `@turf/buffer` resolves).

### W5 — `src/shared/geometry/geosGeometryBackend.ts`

```ts
export const geosGeometryBackend: GeometryBackend = {
    name: "geos",
    bufferMeters(geom, meters, quadrantSegments, units = "meters") {
        try {
            // Mirror jsGeometryBackend's structure EXACTLY:
            //  - FeatureCollection → buffer each feature in its own projection,
            //    return features[0] (same observable behavior as the turf path).
            //  - Feature → one projection on the whole feature.
            // Per feature: project → encodeWkb → Native.bufferWKB(wkb, meters, qs)
            //   → decodeWkb → unproject → Feature<Polygon|MultiPolygon>.
            // Return null if native returns null.
        } catch (err) {
            console.warn(
                "[geosGeometryBackend] bufferMeters failed, falling back to JS:",
                err,
            );
            return jsGeometryBackend.bufferMeters(
                geom,
                meters,
                quadrantSegments,
                units,
            );
        }
    },
};
```

- **Bug-for-bug fidelity:** replicate `jsGeometryBackend`'s exact observable
  behavior, including the `FeatureCollection → features[0]` extraction and the
  `buffer(fc, 0)` "union" semantics (turf buffers each feature individually and
  the seam keeps only the first). **Do not "fix" these latent quirks in G2** —
  parity testing depends on the two backends agreeing, and any real union belongs
  in Phase B (`GEOSUnaryUnion`). Note them in code comments + a "Known
  differences" section here so they aren't mistaken for G2 bugs.
- **Two-tier failure handling:** a legitimate `null` from `bufferWKB` (bad/empty
  geometry) returns `null` (same as the JS path → caller skips that buffer). An
  _exception_ (native hiccup) falls back to `jsGeometryBackend` so the native
  path can never produce a worse result than today.

### W6 — Wire the seam (`geometryBackend.ts`)

Replace the three `TODO(G2)` blocks: when native is available and
`backend !== "js"`, set `_backend = geosGeometryBackend` and log
`backend=geos reason=…`. Leave the `"js"` force path and the Jest virtual mock
untouched. No call-site changes — they already go through the seam.

## Testing & validation (the core of G2)

Native code can't run in Jest, so correctness is proven by **layered defense**:
deterministic JS-only tests for everything that _can_ run in Jest (codec,
projection, plumbing), then an on-device parity harness as the gate for the GEOS
math itself. Each check below is numbered for the PR checklist.

### Layer 1 — WKB codec (Jest, deterministic) — `wkb.test.ts`

- **T1.1 Round-trip equality.** For LineString, MultiLineString, Polygon
  (with ≥1 hole), MultiPolygon (≥2 polygons), MultiPoint: `decodeWkb(encodeWkb(g))`
  deep-equals `g`. float64 round-trips exactly, so assert exact coordinate
  equality.
- **T1.2 Golden bytes.** Hand-encode a known 2-point LineString and a unit-square
  Polygon; assert `encodeWkb` produces the exact expected byte array (byte order
  `01`, correct type code, little-endian counts, IEEE-754 doubles). This is what
  catches endianness/offset/type-code bugs **without a device**.
- **T1.3 Decode GEOS-shaped output.** Decode a captured real buffer-output WKB
  (a Polygon-with-hole and a MultiPolygon) into the expected GeoJSON.
- **T1.4 Malformed input.** Truncated buffer, unknown type code, zero rings,
  zero points → `WkbError`, never an OOB read or `NaN` leak.
- **T1.5 Property test.** Random valid geometries (seeded) round-trip; fuzz byte
  truncation never crashes the decoder.

### Layer 2 — Projection (Jest, deterministic) — `bufferProjection.test.ts`

- **T2.1 Round-trip.** `unproject(project(coord))` within 1e-7° across a grid of
  Tokyo/Osaka latitudes; planar distances between adjacent projected points match
  haversine within < 0.1%.
- **T2.2 Turf-parity of the projection.** Project sample points through both our
  `projectionFor(geom)` and a directly-constructed
  `geoAzimuthalEquidistant().rotate([-cx,-cy]).scale(6371008.8)` (same params turf
  uses) and assert equality — guards against a future d3-geo/center drift.
- **T2.3 Center parity.** `projectionFor` uses the same centroid `@turf/center`
  computes for representative line/polygon features.

### Layer 3 — Adapter plumbing (Jest, GEOS mocked) — `geosGeometryBackend.test.ts`

GEOS can't run in Jest, but the _adapter_ can: mock `native-geometry`'s
`bufferWKB` and assert the project→encode→(call)→decode→unproject wiring.

- **T3.1 Echo round-trip.** Mock `bufferWKB` to **decode the WKB it's handed,
  treat it as the "buffer" (identity), and re-encode** as a degenerate polygon
  (or echo a fixed known polygon WKB). Assert `geosGeometryBackend` projects in,
  hands well-formed WKB to the native call (decode it inside the mock and
  assert the projected planar coords are what we expect), and unprojects the
  result back to WGS84 correctly.
- **T3.2 FeatureCollection structure.** Assert per-feature projection + that the
  return matches `jsGeometryBackend`'s `features[0]` behavior for a 2-feature FC.
- **T3.3 null vs throw.** `bufferWKB` returning `null` → backend returns `null`;
  `bufferWKB` throwing → backend falls back to `jsGeometryBackend` and returns a
  polygon (assert the fallback fired via a spy).
- **T3.4 Seam selection.** With the module mocked available, `getGeometryBackend()`
  returns `name: "geos"` under `backend: "auto"` and `"geos"`, and `"js"` under
  `backend: "js"`. (Reset memoization with `__setGeometryBackendForTest(null)`.)

### Layer 4 — Existing suites unchanged (Jest) — regression gate

- **T4.1** `lineMeasuringGeometry.test.ts`, `clipLineFeatures.perf.test.ts`, and
  the point-measuring tests pass **unchanged** — Jest still forces the JS backend
  (virtual mock `isAvailable: () => false`), proving G2 doesn't regress the JS
  path. Add one assertion that `getGeometryBackend().name === "js"` in Jest.
- **T4.2** `pnpm check && pnpm test` green (lint + format + typecheck +
  perf-typecheck + POI drift + jest).

### Layer 5 — On-device parity harness (the real correctness gate)

The only way to validate GEOS math. Build it as a **dev-only action** (gated by
`__DEV__`, surfaced in the Admin/Offline-data settings area) plus a shared,
backend-agnostic comparison function so it can also run from a Maestro flow.

- **T5.1 Harness.** Over the bundled Tokyo **and** Osaka fixtures, for every
  line + point category, sweep a deterministic grid of seeker centers across the
  play area × a representative radius set (`500 m, 2 km, 5 km, 15 km, 40 km`).
  For each case compute the buffer with **both** backends (force via
  `__setGeometryBackendForTest(jsGeometryBackend)` then `geosGeometryBackend`).
- **T5.2 Metrics per case** (computed in JS so both backends are comparable):
    - **Symmetric-difference area ratio** = `area(A△B) / area(A∪B)`. **Gate
      < 1%** (target < 0.3%).
    - **Hausdorff distance** between the two boundaries, reported in meters.
      **Gate** below the inherent finite-arc error
      `radius · (1 − cos(π / (2·quadrantSegments)))` (≈ tens of metres at these
      radii) — i.e. the two backends differ by no more than their shared arc
      discretization allows.
    - **Area ratio** `area(geos)/area(js) ∈ [0.99, 1.01]`.
- **T5.3 Report.** Aggregate max/percentile of each metric, list the worst N
  cases (category, center, radius), and print a single `PARITY PASS|FAIL` line.
  Optionally dump the full table to a JSON artifact via `expo-file-system` for
  offline inspection. Run on **both** iOS and Android — GEOS is identical, but the
  toolchains aren't.
- **T5.4 body-of-water specifically.** Include the historically-softlocking dense
  category; confirm it completes and stays within parity gates.

### Layer 6 — Robustness / crash boundary (on-device + Jest where possible)

- **T6.1 Degenerate WKB → null, no crash.** Feed `bufferWKB` (via the harness):
  empty bytes, truncated WKB, a 1-point "LineString", zero-length segments,
  NaN/Inf coords (pre-filtered upstream by `isValidCoord`, but defend in depth),
  and a self-intersecting polygon (exercises `GEOSMakeValid_r`). Each returns
  `null`; the app does not crash. (The truncated/garbage cases also have Jest
  coverage at the codec layer in T1.4.)
- **T6.2 Memory.** Run `bufferWKB` ~200× in a tight loop (simulating
  closer/farther taps over body-of-water) from a dev "stress" button; capture RSS
  with Instruments (iOS) / Android Studio profiler and assert no monotonic growth
  — catches a missed `GEOSFree_r`/`destroy` on any path.

### Layer 7 — Performance validation (on-device)

- **T7.1 Headline.** The admin-1st-border ~5.4 km case (the 10,679 ms baseline)
  drops to **< 16 ms** end-to-end (encode + native + decode). Log per category
  incl. body-of-water. This is the justification metric for the whole effort.
- **T7.2 Marshalling split.** Log encode, native, and decode separately; assert
  encode+decode < ~2 ms for ~1,600 coords (validates the WKB/typed-array path
  isn't a hidden cost).

### Layer 8 — E2E (Maestro, `platform=all`)

- **T8.1** A flow that places measuring questions for `admin-1st-border` **and**
  `body-of-water`, toggles positive/negative, and asserts the app stays
  responsive and the mask renders — with the backend forced to `geos` (via the
  dev toggle or a build-time `APP_CONFIG.geometry.backend = "geos"`) so the native
  path is actually exercised on device and in CI. Reuse the parity-harness dev
  action: a flow that triggers it and asserts the `PARITY PASS` text is the
  cheapest way to make parity a CI signal.

## Acceptance criteria

1. `.gitignore` fixed; `git status` shows the module + GEOS artifacts as tracked.
2. `pnpm check && pnpm test` green; existing measuring suites unchanged (Layer 4).
3. WKB codec + projection + adapter Jest suites pass (Layers 1–3).
4. On a device with `backend: "geos"`: parity harness prints `PARITY PASS` on
   **both** platforms within the Layer 5 gates, including body-of-water.
5. No crash across the Layer 6 degenerate inputs; no memory growth over 200 taps.
6. The 5.4 km admin-border buffer is < 16 ms (Layer 7); Maestro `platform=all`
   green with the GEOS backend active (Layer 8).
7. `docs/implementation_notes.md` updated: how to rebuild the module, the
   committed-artifact decision (LFS or not), and the parity-harness runbook.

## Known differences / non-goals (do not regress, do not "fix" in G2)

- The `FeatureCollection → features[0]` extraction and `buffer(fc, 0)` non-union
  behavior are preserved verbatim. A real N-ary union is **Phase B / G5**
  (`GEOSUnaryUnion`), not G2.
- No simplification constants change (G4). No overlay/clip migration (G5). No
  async render refactor (G6) — the sync design avoids needing it.

## Risks & mitigations

| Risk                                                                | Mitigation                                                                                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore` silently drops the module → EAS builds without GEOS    | **P0 fix above**, verified by `git status` showing tracked artifacts.                                                                             |
| WKB endianness/offset bug → garbage geometry that _looks_ plausible | Golden-byte tests (T1.2) + round-trip (T1.1) catch it deterministically in Jest, before any device run.                                           |
| Projection drift vs turf → subtly wrong distances                   | Replicate turf's exact AEQD (same `@turf/center` + `d3-geo` + `earthRadius`); T2.2/T2.3 guard it; parity harness (Layer 5) is the empirical gate. |
| Native memory leak per buffer call                                  | Audit every free/destroy incl. error paths (W1); T6.2 loop test.                                                                                  |
| GEOS crash on invalid geometry                                      | Reentrant error handler + `isValid`/`MakeValid` (already in G1); T6.1 fuzz; exception→JS fallback in W5.                                          |
| Native regression in the field                                      | `APP_CONFIG.geometry.backend` kill switch → instant revert to JS; G0 seam is the rollback boundary.                                               |
| Static-archive size in git history (~44 MB)                         | Conscious LFS-vs-commit decision recorded in implementation_notes; linker dead-strip bounds the app-size delta.                                   |

## Effort estimate

W1 native `bufferWKB` (both platforms, parity params, memory audit): ~1 day.
W2–W6 JS (index, WKB codec, projection, backend, seam wiring): ~1–1.5 days.
Testing — Layers 1–4 (Jest): ~1 day; Layer 5 parity harness: ~1–1.5 days; Layers
6–8 (robustness, perf, Maestro on device/CI): ~1 day. **Total ~5–6 days**, with
the parity harness (Layer 5) the highest-value and highest-effort piece.
