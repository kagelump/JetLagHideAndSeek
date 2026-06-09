# PLAN — GEOS backend availability robustness

_2026-06-09. Follow-up to the G5 overlay-ops landing. Status: **planned, not started.**_

## Why

G5 tightened [`modules/native-geometry/src/index.ts`](../../modules/native-geometry/src/index.ts)
`isAvailable()` from "expose `bufferWKB`" to "expose **all five** WKB functions
(`bufferWKB`, `differenceWKB`, `unionWKB`, `intersectionWKB`, `unaryUnionWKB`)".

Because [`getGeometryBackend()`](../../src/shared/geometry/geometryBackend.ts) gates
the **entire** backend on `isAvailable()`, this made GEOS all-or-nothing. The new
overlay functions don't exist in the native binary until an `expo prebuild` +
native rebuild. Until then — i.e. on any Metro / Fast-Refresh reload after pulling
the G5 JS but before rebuilding the dev client (the everyday dev loop) —
`isAvailable()` returns **false** and the whole app silently falls back to the JS
backend. Observed symptom:

- **Radar** still works (JS buffer + JS difference — slower, but correct).
- **Body-of-water measuring** breaks: the JS backend hits the dissolve guard
  `if (backend.name !== "geos") return merged` in
  [`lineMeasuringGeometry.ts`](../../src/features/questions/measuring/lineMeasuringGeometry.ts),
  returns the **un-dissolved ~40-ribbon merge**, and polyclip-ts differences it
  against the real Tokyo boundary → the ~25 s hard-lock the dissolve exists to
  prevent.

This is a **silent, surprising** failure: a JS-only change in capability probing
disabled GEOS for buffer too, and there is no log loud enough to notice.

### Can this be caught at link/build time?

No. The JS bundle (Metro) and the native binary (Xcode/Gradle) are independently
built artifacts, and Expo Modules dispatches `Function("…")` **by name at runtime
over JSI** — the JS side holds no static symbol the linker could fail on, so a
newer JS bundle silently runs against an older dev-client binary. Within a single
EAS/prebuild build they cannot drift; the mismatch is purely dev-client staleness.
The closest safety is a **runtime ABI handshake** (W4 below): turn silent feature
drift into one loud, intentional "rebuild your dev client" signal.

## Goal

GEOS is never silently disabled. Specifically:

1. A missing **overlay** op never disables the **buffer** fast path.
2. Every fallback (whole-backend or per-op) is **loud** and **diagnosable**.
3. A stale dev-client binary produces a clear "rebuild" message, not a mystery hang.

## Ordered work items

### W1 — Gate `isAvailable()` on the core capability only

Revert [`index.ts`](../../modules/native-geometry/src/index.ts) `isAvailable()` to
probe **`bufferWKB` only**:

```ts
export function isAvailable(): boolean {
    try {
        return typeof Native?.bufferWKB === "function";
    } catch {
        return false;
    }
}
```

Rationale: `bufferWKB` is the core capability and the one that must stay native
(line-buffer hot path). Overlay availability is handled per-op (W2), so requiring
all five here only causes the all-or-nothing regression.

### W2 — Confirm + harden per-op fallback (already present)

The `geosGeometryBackend` overlay methods already do per-op fallback via
`nativeOpAvailable(fn)` →
[`jsGeometryBackend`](../../src/shared/geometry/jsGeometryBackend.ts). Keep this,
and make each fallback emit a **one-time** `console.warn` (deduped by op name) such
as:

```
[geometryBackend] native differenceWKB missing — using JS fallback.
Rebuild the dev client (expo prebuild + run:ios/android) to enable GEOS overlay ops.
```

Use a module-level `Set<string>` so it logs once per op per session, not per call.

> **Note on body-of-water:** with W1, a stale binary keeps GEOS for `bufferMeters`
> but `unaryUnion` per-op-falls-back to JS, which still chokes on the 40-ribbon
> dissolve. There is no pure-JS path that survives that input. W2 makes the cause
> obvious; the genuine remedy is the rebuild (W4 surfaces it). Do **not** try to
> make the JS dissolve "fast" — that's the problem G5 moved to native.

### W3 — Make the whole-backend selection loud

[`getGeometryBackend()`](../../src/shared/geometry/geometryBackend.ts) already
`console.log`s its decision. Elevate the `reason=fallback` / `reason=unavailable`
branches (config asked for GEOS but native missing) to `console.warn` with the same
"rebuild the dev client" hint, so a JS fallback is never quiet.

### W4 — (Recommended) Native ABI/capability handshake

Add a native integer constant and a JS-side expected value:

- Native (`NativeGeometryModule.swift` / `.kt`): expose
  `Function("nativeAbiVersion") { () -> Int in NATIVE_GEOMETRY_ABI_VERSION }`
  (bump it whenever the WKB function surface changes; G5 overlay ops = version 2).
- JS (`index.ts`): `export const EXPECTED_NATIVE_ABI = 2;` and a
  `nativeAbiVersion()` wrapper.
- `getGeometryBackend()`: when native is present but
  `nativeAbiVersion() < EXPECTED_NATIVE_ABI`, `console.warn` **once**, prominently:
  `native-geometry binary is stale (abi N < expected M) — rebuild the dev client`.
  Still select GEOS for whatever ops exist (W1/W2 keep buffer native); the message
  is the value.

This is the closest thing to "link-time detection" available in a CNG/Expo project
(see "Can this be caught at link/build time?" above).

### W5 — Document the rebuild requirement

Add a one-liner to [`docs/implementation_notes.md`](../implementation_notes.md) and
the AGENTS.md "Native Build Rules" section: **after pulling native-geometry changes,
rebuild the dev client; a stale binary degrades GEOS to JS (loud warning) and
body-of-water measuring will hard-lock.**

## Files to modify

1. `modules/native-geometry/src/index.ts` — W1, W2 wrappers, W4 constant/wrapper
2. `src/shared/geometry/geometryBackend.ts` — W3 loud selection, W4 ABI check
3. `src/shared/geometry/geosGeometryBackend.ts` — W2 one-time per-op warn
4. `modules/native-geometry/ios/NativeGeometryModule.swift` — W4 `nativeAbiVersion`
5. `modules/native-geometry/android/.../NativeGeometryModule.kt` — W4 `nativeAbiVersion`
6. `docs/implementation_notes.md`, `AGENTS.md` — W5

## Acceptance

- A binary with `bufferWKB` but no overlay ops → GEOS stays selected for buffer; each
  overlay op logs one warn and uses JS. No silent whole-app fallback.
- Forcing `APP_CONFIG.geometry.backend = "geos"` with a stale binary → loud warn, no
  mystery hang attributed to "GEOS is slow".
- `pnpm check && pnpm test` green; backend-selection unit tests (see
  [PLAN-geos-overlay-parity-test.md](./PLAN-geos-overlay-parity-test.md) W4) cover
  the missing-op fallback path.
