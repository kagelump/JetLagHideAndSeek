# CRASH — MapLibre RN nil subview during mount

**Observed:** 2026-06-09 on iOS (iPhone 16 Pro simulator, dev build).  
**Branch:** `master` (G2 GEOS backend active, `backend=auto`).  
**Reproducible:** intermittently, during question-detail navigation / seeker-tap
state transitions. Also reproduces with `backend=js` (not GEOS-specific).

## Symptom

```
*** Terminating app due to uncaught exception
'NSInvalidArgumentException', reason:
'*** -[__NSArrayM insertObject:atIndex:]: object cannot be nil'

Last Exception Backtrace:
0   CoreFoundation        __exceptionPreprocess
1   libobjc.A.dylib       objc_exception_throw
2   CoreFoundation        -[__NSArrayM insertObject:atIndex:]
3   MLRNMapView.m:207     -[MLRNMapView insertReactSubview:atIndex:]
4   React                 -[RCTLegacyViewManagerInteropComponentView
                              finalizeUpdates:]
5   React                 RCTPerformMountInstructions(...)
```

The crash is inside MapLibre React Native's native view manager during React's
shadow-tree commit (mount phase). No GEOS / WKB / geometry code appears in the
call stack.

## Root cause

MapLibre React Native's `MLRNMapView` maintains an `NSMutableArray` of React
subviews (children like `ShapeSource`, `PointAnnotation`, etc.). During React's
mount phase, `RCTPerformMountInstructions` calls `finalizeUpdates:` on each
affected component view, which calls `insertReactSubview:atIndex:` to add the
new child to the parent.

If a React child of the `MapView` evaluates to `nil` or `undefined` during a
state transition — e.g., a `ShapeSource` whose `shape` prop briefly becomes
`undefined` while the buffer geometry is recomputing, or a conditional render
that removes the `ShapeSource` from the tree at the wrong point in the commit
cycle — the MapLibre native code receives `nil` and crashes inside
`insertObject:atIndex:`.

This is a **pre-existing MapLibre RN bug**, not caused by the G2 GEOS backend.
The GEOS backend makes buffer computation ~2000× faster (~5 ms vs ~10 s), which
changes the timing of state updates and can shift the window in which the race
occurs, but the underlying nil-subview bug is in the rendering layer.

## Likely trigger sites

In `NativeMap.tsx`, the MapView renders several `ShapeSource`-backed layer
components conditionally based on `visible` and the contents of
`questionMapRenderState`:

- `RadarLayers` (line ~108–109)
- `OsmMatchingLayers` (line ~120)
- `MeasuringLayers` (line ~239–242) ← crash observed during body-of-water
- `ThermometerPreviewLayer` (line ~243)
- `TentaclesRadiusLayer` (line ~247)

If any of these produces a `ShapeSource` with a shape that flickers to
`undefined`/`null` between React commits — or if a state update removes the
`ShapeSource` child while the mount transaction is in flight — the native
MapLibre view manager crashes.

## Reproduction

1. Set a `body-of-water` measuring question in the Tokyo 23 Wards play area.
2. Tap the seeker around the map to trigger recomputation.
3. Navigate in/out of the question detail sheet.
4. The crash is intermittent — depends on React commit timing aligning with the
   nil-child window.

## Mitigation / fix direction

- **Defense in each layer component:** ensure the `shape` prop passed to
  `ShapeSource` is never `undefined` or `null`. Use an empty
  `FeatureCollection` (`{ type: "FeatureCollection", features: [] }`) as a
  stable fallback instead of conditionally not rendering the `ShapeSource`.

- **Defense in `NativeMap.tsx`:** wrap layer children so a nullish child is
  replaced with an empty placeholder `View` rather than omitted — MapLibre RN
  needs every child to be non-nil at mount time.

- **MapLibre RN upstream:** the `insertReactSubview:atIndex:` implementation
  should guard against a nil `subview` parameter and no-op instead of crashing.
  A patch or fork would fix this for all layer types at once.

## Related

- `docs/native-geometry/g2-plan.md` — G2 GEOS backend (not causative; changes
  buffer timing, which can shift the race window)
- `src/features/map/NativeMap.tsx` — MapView + child layer composition
