# Wishlist — Native GEOS for measuring-mask geometry

_2026-06-08. Status: **idea / not scheduled.** Captures a perf investigation
into the measuring-question buffer cost and the option of pushing the hot
geometry path to native code. Sibling to `docs/measuring_perf_audit.md` and
`docs/measuring-perf/` (P0–P8), which cover the pure-JS optimizations that
should be exhausted **before** this is worth doing._

## TL;DR

The dominant cost in building a line-category measuring mask
(`admin-1st-border`, `coastline`, rail, …) is a single `@turf/buffer` (JSTS)
call. On a real device it was measured at **~10.7s** for ~1,600 coords across 8
border segments at a ~5.4 km radius. The algorithm is fine — the cost is the
runtime: **Hermes has no JIT**, so JSTS's hot interpreter loop runs ~20–50×
slower than it would under V8.

Swapping JS engines does **not** fix this on iOS (Apple forbids JIT in
third-party apps, so every engine interprets). The two durable levers are:

1. **Do less work in JS** — aggressive simplification + lower coord budget +
   non-blocking dispatch. Cheap, high-leverage, do this first.
2. **Push the hot path to native** — wrap **GEOS** (the C++ library JSTS is a
   port of) in a JSI module. Turns ~10s into ~1–5ms, but adds a permanent
   native-build/maintenance surface.

This doc is about option 2.

## Measured breakdown (device log, admin-1st-border, "positive")

| Step                                | Cost          | Notes                                   |
| ----------------------------------- | ------------- | --------------------------------------- |
| `lineBuffer` (turf/JSTS buffer)     | **10,679 ms** | 8 segments, 1587 coords, ~5.4 km radius |
| `clipLineFeatures` (reference line) | 535 ms        | first/unanswered pass only              |
| `maskBuilder difference`            | 635 ms        | play-area minus eligible-area           |
| `lineDistance` simplify + turf      | ~160 ms       | cached after first query                |

`buildMeasuringRenderState total: 10735ms` — i.e. the buffer **is** the problem.

Relevant code: `src/features/questions/measuring/lineMeasuringGeometry.ts`
(`computeLineBuffer`, simplify tolerance at `:666`, `MAX_BUFFER_COORDS` at
`:400`).

## Why the runtime, not the algorithm

- **Hermes** (RN default) is an ahead-of-time _bytecode interpreter_. Optimized
  for startup time, memory, and app size — not sustained compute. A tight
  numeric loop like JSTS buffer/noding is its worst case.
- The taibeled web app
  (`src/maps/questions/measuring.ts`) does essentially the same thing —
  `turf.simplify()` then `turf.buffer()`, with `turf.difference(bbox, buffer)`
  for coastlines. It feels fast only because it runs in **V8 with a JIT** on
  desktop. No algorithmic trick to copy.

### JS runtime landscape

| Engine         | JIT?              | Where                                         | Notes                                 |
| -------------- | ----------------- | --------------------------------------------- | ------------------------------------- |
| V8             | Yes (TurboFan)    | Node/Chrome; `react-native-v8` (Android only) | fastest peak compute                  |
| JavaScriptCore | Yes (multi-tier)  | Safari, Android                               | old RN default pre-Hermes             |
| Hermes         | **No** (bytecode) | RN default                                    | best startup/memory, worst compute    |
| Static Hermes  | AOT→native (exp.) | not production-default                        | dramatically faster, not shipping yet |

**iOS catch:** third-party apps cannot map executable+writable memory, so **no
JS engine JITs on iOS** — Hermes, JSC, and V8 all interpret. Switching engines
can help compute on **Android** (`react-native-v8`/JSC), but creates a
cross-platform perf cliff and does nothing for iOS. This is why "go native" is
the only engine-independent fix.

## Native GEOS — cost analysis

### Runtime cost (the cheap part)

- GEOS buffer of ~1,600 coords: **sub-ms to low-single-digit ms** on a phone.
  ~10,700 ms → ~1–5 ms.
- Identical speed on iOS and Android (compiled native, no JIT involved).
- Runs on a background thread → never blocks JS/UI regardless.

### Marshalling cost (don't reintroduce it)

- **Don't** pass JS arrays-of-arrays across the bridge — host-object conversion
  can dominate.
- **Do** flatten to a `Float64Array` / WKB `ArrayBuffer` over JSI (≈ zero-copy).
  For ~1,600 coords this is < 1ms each way.
- Clean design: JS → WKB `ArrayBuffer` → GEOS parses, buffers → WKB back → JS
  parses. GEOS speaks WKB natively; encode/decode is cheap vs. the saving.

### The costs you actually pay

| Cost                  | Reality                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App binary size       | ~1–3 MB per architecture. arm64 (iOS) + arm64-v8a (Android) is the common ship target; store thinning helps.                                                        |
| Build / vendoring     | The real work: build GEOS (C++17) for iOS (device + arm64 sim xcframework/pod) and Android (CMake/NDK `.so` per ABI). No turnkey Expo package — vendor it yourself. |
| Module glue           | JSI wrapper via Expo Modules API (C++ support) or Nitro Modules. A few hundred lines + a config plugin.                                                             |
| Expo workflow         | Each change → `expo prebuild` + dev-client rebuild; Expo Go unusable. (Already true here due to MapLibre, so no new loss.)                                          |
| Maintenance/debugging | Native crashes (bad geometry into GEOS) need boundary validation; CI needs NDK + iOS toolchain; GEOS upgrades = re-vendor.                                          |

### Lighter alternatives considered

- **Rust `geo` / `geo-buffer` via UniFFI/JSI** — easier cross-compile (cargo
  handles ABIs), smaller, but buffering/noding is **less battle-tested than
  GEOS** for messy real-world borders.
- **WASM build of GEOS** — Hermes can't run WASM, and WASM can't JIT on iOS
  either. No win. Skip.

## Recommendation

Treat native GEOS as the **fallback reached for only if the pure-JS path can't
get the first-paint buffer under ~1–2s.** Exhaust the cheap levers first:

1. **Simplify harder before buffering** — `lineMeasuringGeometry.ts:666` uses
   `simplifyTol = max(radiusMeters*0.05, 10)` (270 m here → 1587 coords). The
   output is rounded off by a ~5.4 km buffer, so sub-km detail is invisible. Try
   `radiusMeters * 0.15–0.25`. Expected: few-hundred coords, ~2–3s. Mirror the
   decision in the polygon path (`:537`, body-of-water) — coastlines are
   higher-detail, so maybe keep that tolerance tighter.
2. **Lower `MAX_BUFFER_COORDS`** (currently 4000 at `:400`; you're at 1587 so
   `applyBufferBudget` never fires). Drop to ~800–1000 as a worst-case guardrail.
3. **Non-blocking dispatch** — wrap `computeLineBufferCached` in
   `InteractionManager.runAfterInteractions` (or a microtask + mask loading
   state) so the map stays interactive while the buffer computes. Existing caches
   already make the second answer-toggle instant.

Native GEOS is a multi-day effort with a permanent maintenance surface; only
pull this lever once 1–3 above are proven insufficient.
