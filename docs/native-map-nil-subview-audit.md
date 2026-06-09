# Audit — MapLibre RN nil-subview crash, similar-issue sweep

**Date:** 2026-06-09
**Trigger:** [`docs/tasks/CRASH-mlrn-nil-subview.md`](tasks/CRASH-mlrn-nil-subview.md) + `crash.log`
**Scope:** every native child of `MLMapView` in `src/features/map/`.

## TL;DR

`crash.log` confirms the documented backtrace exactly: MapLibre RN's
`-[MLRNMapView insertReactSubview:atIndex:]` (`MLRNMapView.m:207`) calls
`-[__NSArrayM insertObject:atIndex:]` with a **nil subview**, thrown from
`RCTLegacyViewManagerInteropComponentView finalizeUpdates:` during a Fabric mount
transaction. MapView is a paper/legacy view manager wrapped in the new-arch
interop; when the **set or order of its native children changes mid-transaction**,
the interop can hand `insertObject:` a nil entry and abort.

The codebase already enforces a hard-won invariant against exactly this:

> **Never conditionally mount/unmount a native child of `MLMapView`. Keep every
> child permanently mounted and toggle it via an empty `FeatureCollection` shape
> or a `visible` flag.**

That invariant is established by two prior fixes —
`fa308ef "keep MapLibre shape sources mounted to prevent POI disappearance"` and
`dcb5a03 …QuestionPinLayer…` (which replaced `PointAnnotation` markers with a
`ShapeSource`/`SymbolLayer`, enforced by the "movable pin regression" test in
[`NativeMap.test.tsx:434`](../src/features/map/__tests__/NativeMap.test.tsx)).

**The sweep found two live places that still violate this invariant** — i.e. two
remaining nil-subview hazards — plus one lower-risk case. Everything else in the
layer stack is already correctly defended.

The crash doc's leading hypothesis ("a `ShapeSource` whose `shape` prop briefly
becomes `undefined`") is **not** the most likely mechanism: every `shape` prop in
the stack is fed a guaranteed-non-null `FeatureCollection`. The actual mechanism
is **structural** — children appearing/disappearing/remounting — which is what
the two findings below do.

---

## Confirmed crash mechanism (from `crash.log`)

```
2  CoreFoundation   -[__NSArrayM insertObject:atIndex:] + 1232      ← nil arg → NSInvalidArgumentException
3  HideSeekMapper   -[MLRNMapView insertReactSubview:atIndex:]  (MLRNMapView.m:207)
4  React            -[RCTLegacyViewManagerInteropComponentView finalizeUpdates:]
5  React            RCTPerformMountInstructions(...)
14 React            -[RCTMountingManager performTransaction:]
   … main-thread dispatch → CFRunLoop
```

`MLRNMapView` keeps an `NSMutableArray` of React subviews. On the new
architecture, MapView runs through `RCTLegacyViewManagerInteropComponentView`,
which replays child add/remove/reorder mutations as `insertReactSubview:` /
`removeReactSubview:` calls during `finalizeUpdates:`. If a mount transaction
inserts a child whose interop view resolves to nil at that instant — which
happens when the child list is being reshuffled (mount, unmount, or keyed
remount) in the same commit — `insertObject:atIndex:` receives nil and the app
aborts. No app geometry/GEOS frames are on the stack; this is purely the
RN↔MapLibre view-manager seam, consistent with the crash doc.

---

## Findings

### F1 — `MLUserLocation` is conditionally mounted/unmounted (HIGH)

[`src/features/map/NativeMap.tsx:252`](../src/features/map/NativeMap.tsx#L252)

```tsx
{
    hasLocationPermission ? (
        <MLUserLocation
            minDisplacement={5}
            onUpdate={handleLocationUpdate}
            visible
        />
    ) : null;
}
```

This is the **only `: null` conditional child in the entire MapView subtree**
(verified: `grep ": null}" src/features/map/` returns this one line). Every other
layer is permanently mounted.

`hasLocationPermission` starts `false`
([`useUserLocation.ts:12`](../src/features/map/useUserLocation.ts#L12)) and flips
to `true` the first time the user taps the locate-me control and grants
permission (`useUserLocation.ts:23`). That flip **inserts a brand-new native
`UserLocation` child into `MLMapView`'s subview array** — landing on precisely the
`insertReactSubview:atIndex:` path that crashes. It fires mid-interaction (button
tap → async permission resolve → state update → commit), matching the doc's
"intermittent, during state transitions" and "not GEOS-specific" notes. Because
`UserLocation` is appended after all the `ShapeSource` layers and the
`QuestionPinLayer`, its insertion index sits at the end of a child list that other
question-state commits are simultaneously mutating — the worst case for an
index/child desync in the legacy interop.

This is the clearest structural outlier and the most likely primary trigger.

**Fix direction:** keep `MLUserLocation` permanently mounted and drive it with a
prop instead of conditional existence — e.g. always render it and gate via
`visible={hasLocationPermission}` (and/or render it from the start). This matches
the established invariant and the doc's "wrap layer children so a nullish child is
replaced with a placeholder" guidance. Add it to the order-stable bottom of the
child list so its presence never changes the child count.

### F2 — `MeasuringLayers` forces `ShapeSource` remounts via dynamic `key` (HIGH)

[`src/features/map/MeasuringLayers.tsx:87`](../src/features/map/MeasuringLayers.tsx#L87)
and [`:104`](../src/features/map/MeasuringLayers.tsx#L104)

```tsx
<MLShapeSource id="measuring-connectors" key={`conn:${connectorsKey}`} … />
…
<MLShapeSource id="measuring-markers"    key={`markers:${markersKey}`} … />
```

These are the **only dynamic `key`s on any MapView descendant**
(`HidingZoneLayers.tsx:78`'s `key={ringIndex}` is over a constant-length array, so
it never remounts). `connectorsKey`/`markersKey` are derived from the connector
and marker **coordinates**, so they change **on every seeker tap / my-location
update** while a line- or polygon-category measuring question is open. A changed
`key` forces React to **unmount the old `ShapeSource` and mount a new one in the
same transaction** — a remove+insert of a native MapView child, i.e. the same
`insertReactSubview:atIndex:` path as F1, but fired repeatedly during gestures.

This is an exact match for the doc's reproduction — "set a `body-of-water`
measuring question … tap the seeker around the map … crash observed during
body-of-water measuring" — and explains why it reproduces with `backend=js` too:
the remount happens regardless of how fast the buffer is computed.

Note this is also self-inflicted: a `ShapeSource` already updates its geometry
through the `shape` prop, so the remount is a workaround (the comment cites
"prevents stale GeoJSON from persisting"). It trades a stale-geometry bug for a
nil-subview crash.

**Fix direction:** drop the dynamic `key`s and let the `shape` prop update the
source in place (the connectors/markers `ShapeSource`s already receive fresh
`FeatureCollection`s every render). If a genuine stale-source problem resurfaces,
prefer a stable `key` plus a forced shape refresh over remounting the native
child. Keep these `ShapeSource`s permanently mounted with empty-collection
fallbacks (the `lineFeatures` one at `:73` already does this; the connectors/
markers ones should pass `EMPTY_FEATURES` when not `visible` rather than relying
on remount).

### F3 — `osmId`-suffixed source ids on play-area change (LOW)

[`PlayAreaBoundaryLayer.tsx:15`](../src/features/map/PlayAreaBoundaryLayer.tsx#L15),
[`PlayAreaMaskLayers.tsx:15`](../src/features/map/PlayAreaMaskLayers.tsx#L15) &
[`:45`](../src/features/map/PlayAreaMaskLayers.tsx#L45)

The `id` prop embeds `playArea.osmId` (`id={\`play-area-boundary-${osmId}\`}`).
Changing `id` is a prop change (reconciled in place, **not** a remount), so this is
_not_ the same hazard as F1/F2. It is listed only because switching play areas
swaps several native source ids inside one commit while the question layers may
also be re-deriving — a lower-frequency, lower-risk version of the same child-
mutation pressure. No action required unless crashes are observed specifically on
play-area switch; if so, consider stable ids with the osmId carried as a feature
property instead of in the id.

---

## Already-defended (no action) — the pattern the rest of the stack follows

Every other native MapView child is permanently mounted and toggles via an empty
`FeatureCollection`/`visible` flag — exactly the invariant. For reference:

| Component                                  | MapView child(ren)       | Mount discipline                         | Empty fallback          |
| ------------------------------------------ | ------------------------ | ---------------------------------------- | ----------------------- |
| `PlayAreaOutsideMaskLayer`                 | 1 ShapeSource            | always mounted                           | shape always defined    |
| `HidingZoneLayers`                         | 3 ShapeSource            | always mounted                           | static `key`s only      |
| `CombinedInsideMaskLayer`                  | 1 ShapeSource            | always mounted                           | builder returns FC      |
| `RadarQuestionLayers`                      | 2 ShapeSource            | always mounted                           | render-state FC         |
| `OsmMatchingLayers`                        | 1 ShapeSource            | always mounted                           | `EMPTY_POI_FEATURES`    |
| `VoronoiOutlineLayers`                     | 1 ShapeSource            | always mounted                           | `EMPTY_FEATURES`        |
| `PlayAreaBoundaryLayer`                    | 1 ShapeSource            | always mounted                           | boundary always defined |
| `MeasuringLayers` (line-ref)               | 1 ShapeSource            | always mounted                           | `EMPTY_FEATURES`        |
| `ThermometerPreviewLayer`                  | 1 ShapeSource            | always mounted                           | `EMPTY_FEATURES`        |
| `TentaclesRadiusLayer`                     | 1 ShapeSource            | always mounted                           | `EMPTY_FEATURES`        |
| `QuestionPinLayer`                         | `Images` + 1 ShapeSource | always mounted                           | feature FC always built |
| **`MeasuringLayers` (connectors/markers)** | 2 ShapeSource            | **remounted via dynamic `key`** → **F2** | partial                 |
| **`MLUserLocation`**                       | 1 UserLocation           | **conditionally mounted** → **F1**       | n/a                     |

The `visible` flag everywhere is implemented as "swap to empty FeatureCollection,"
never "return `null`" — confirming the team's intent is to keep children mounted.
F1 and F2 are the two spots that drifted from that intent.

---

## Recommended remediation (in priority order)

1. **F1:** make `MLUserLocation` permanently mounted, gated by `visible`, not by
   conditional existence.
2. **F2:** remove the dynamic `key`s on the connector/marker `ShapeSource`s; update
   geometry through the `shape` prop and pass `EMPTY_FEATURES` when not visible.
3. **Regression guard (cheap, high value):** extend the existing "movable pin
   regression" test in
   [`NativeMap.test.tsx:434`](../src/features/map/__tests__/NativeMap.test.tsx)
   with a source-level assertion that `NativeMap.tsx` contains **no `: null`/`&&`
   conditional direct child of `MLMapView`**, and that map layer components carry
   **no dynamic `key` on `ML*` primitives**. This encodes the invariant the team
   already relies on so it can't silently drift again (the same way the
   no-`PointAnnotation` rule is enforced).
4. **Optional upstream hardening:** patch `MLRNMapView.m:207` (via
   `patch-package`/fork) to no-op when `subview == nil`. This neutralizes the
   entire bug class for all child types at once, independent of JS-side care.

Items 1–2 are JS-only changes that pass `pnpm typecheck` + `pnpm test`; validate
the actual crash window with the Maestro iOS stack (`pnpm test:e2e:ios:stack`) or
the `Maestro E2E` workflow with `platform=ios`, since this is a native-mount race
that Jest cannot exercise. The repro is: body-of-water measuring question in Tokyo
23 Wards → repeatedly tap the seeker → toggle locate-me → navigate in/out of the
question detail sheet.

## Related

- [`docs/tasks/CRASH-mlrn-nil-subview.md`](tasks/CRASH-mlrn-nil-subview.md) — original crash writeup (this audit refines its root-cause from "undefined shape" to "structural child mount/unmount/remount")
- `src/features/map/NativeMap.tsx` — MapView + child composition (F1)
- `src/features/map/MeasuringLayers.tsx` — keyed `ShapeSource` remounts (F2)
- Prior fixes in the same bug class: `fa308ef` (keep sources mounted), `dcb5a03` (drop `PointAnnotation`)
