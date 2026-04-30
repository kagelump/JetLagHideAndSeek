# Train Overlay Issue

## Summary

The train line overlay changes in this branch improve query efficiency and first-load loading toasts, but the overlay can still fail to appear in the browser for some sessions.

## Repro

1. Start dev server.
2. Open:
   - `http://localhost:8787/JetLagHideAndSeek/?sid=AKtuR3xNGGAuycQ9DZzWqg`
3. Enable **Show train lines?** in Options.
4. Observe that train lines may still not be visible.

## What is confirmed

- The new train-line Overpass request is issued:
  - Query includes:
    - `out body;`
    - `way(r.rail);`
    - `out skel geom;`
- The optimized request returns HTTP `200` in the repro session.
- The previous `cacheFetch` fallback path (when `caches` is unavailable) now shows pending toasts via `toast.promise`.

## Why this remains open

The transport fetch itself is succeeding in the repro environment, so the remaining issue is likely in one of these phases:

1. **Feature conversion / clipping path**
   - `fetchTrainLines()` -> `osmtogeojson(...)` -> `trimTrainLinesToPlayableArea(...)`
2. **Overlay render lifecycle**
   - `TrainLinesOverlay` fetch effect populates `rawTrainLinesRef`
   - clip/render effect creates and adds `L.geoJSON(...)`
3. **Visibility / z-order / style**
   - overlay might be added but still not visible due to map layer ordering or style behavior in specific state.

## Suggested next debugging steps

1. Add temporary debug counters in `TrainLinesOverlay`:
   - fetched line count
   - clipped line count
   - number of layers with `trainLineOverlay` after render
2. Temporarily increase style contrast:
   - weight 5, opacity 1, fixed color for quick visibility test
3. Add one-shot toast/log after render:
   - `"Rendered N train features"`
4. Capture a deterministic failing session by logging:
   - zone signature
   - map bounds
   - fetch generation IDs

## Files involved

- `src/components/TrainLinesOverlay.tsx`
- `src/maps/api/overpass.ts`
- `src/maps/api/cache.ts`
- `src/components/OptionDrawers.tsx`
- `src/components/Map.tsx`
- `src/lib/context.ts`
