# Train overlay perf fixtures

- `blob`: Overpass JSON response used by the train overlay pipeline.
- `playable-area-tokyo.fixture.json`: Deterministic playable area for the isolated trim perf test.

To refresh the playable area from a real session:

1. Load a Tokyo session with train overlay enabled.
2. In DevTools, capture the exact polygon passed to trim logic.
3. Replace `playable-area-tokyo.fixture.json` with that captured GeoJSON.

## Browser trim tuning (localStorage)

Defaults: simplify preset `fast`, station extension `off`. Override after reload:

- `localStorage.setItem("trainOverlayDebugPerf", "1")` — worker returns a `perf` snapshot and logs phase timings (`trim complete` / worker `finish`).
- `localStorage.setItem("trainOverlaySimplifyPreset", "balanced")` — `balanced` | `fast` | `veryFast`
- `localStorage.setItem("trainOverlayExtensionMode", "boundaryOnly")` — `off` | `boundaryOnly` | `full`

Run corridor stats on the checked-in blob:

`pnpm analyze:train-blob`
