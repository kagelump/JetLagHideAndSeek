# Train overlay perf fixtures

- `blob`: Overpass JSON response used by the train overlay pipeline.
- `playable-area-tokyo.fixture.json`: Deterministic playable area for the isolated trim perf test.

To refresh the playable area from a real session:

1. Load a Tokyo session with train overlay enabled.
2. In DevTools, capture the exact polygon passed to trim logic.
3. Replace `playable-area-tokyo.fixture.json` with that captured GeoJSON.
