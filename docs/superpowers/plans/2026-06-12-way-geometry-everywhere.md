# Way-geometry everywhere + RDP simplification + Fix A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable stitched way geometry for every offline pack by adding RDP simplification, decouple the Taiwan-only railway-infrastructure switch from the way-geometry preference, and close the app-side cross-preset interchange-color gap.

**Architecture:** A small planar Douglas–Peucker simplifier in the transit pipeline reduces stitched MultiLineString segments before emit; a new `transitOverrides.wayGeometry` flag makes the preference explicit while keeping `useRailwayInfrastructure` as the Taiwan railway-layer switch; the hiding-zone store now passes the full loaded preset list into `getSelectedStations` so route colors can be resolved from unselected presets.

**Tech Stack:** Node.js ESM, `node --test`, TypeScript/React Native, pnpm.

---

### Task 1: Add RDP simplification helper and wire it into route geometry

**Files:**

- Create: `data/transit/scripts/lib/simplifyGeometry.mjs`
- Create: `data/transit/scripts/lib/simplifyGeometry.test.mjs`
- Modify: `data/transit/scripts/lib/osmRoutes.mjs` (`buildLine` around line 699-718)
- Modify: `data/packs/scripts/lib/buildTransit.mjs` (`localeConfig` around line 180-191)

- [ ] **Step 1: Write the failing simplification test**

Create `data/transit/scripts/lib/simplifyGeometry.test.mjs`:

```javascript
/**
 * Tests for simplifyGeometry.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simplifyGeometry } from "./simplifyGeometry.mjs";

function segmentLength([lon1, lat1], [lon2, lat2]) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

describe("simplifyGeometry", () => {
    it("reduces a dense straight polyline while keeping endpoints", () => {
        const coords = [];
        for (let i = 0; i <= 100; i++) {
            coords.push([139.0 + i * 0.0001, 35.0 + i * 0.0001]);
        }
        const geometry = {
            type: "MultiLineString",
            coordinates: [coords],
        };

        const simplified = simplifyGeometry(geometry, 11);
        assert.equal(simplified.type, "MultiLineString");
        assert.equal(simplified.coordinates.length, 1);
        assert.ok(
            simplified.coordinates[0].length < coords.length / 2,
            "expected significant reduction",
        );
        assert.deepEqual(simplified.coordinates[0][0], coords[0]);
        assert.deepEqual(
            simplified.coordinates[0][simplified.coordinates[0].length - 1],
            coords[coords.length - 1],
        );
    });

    it("drops segments that collapse to a single point", () => {
        const geometry = {
            type: "MultiLineString",
            coordinates: [
                [
                    [139.0, 35.0],
                    [139.00001, 35.00001],
                ], // collapses
                [
                    [139.1, 35.1],
                    [139.2, 35.2],
                ], // stays
            ],
        };
        const simplified = simplifyGeometry(geometry, 100);
        assert.equal(simplified.coordinates.length, 1);
        assert.deepEqual(simplified.coordinates[0], [
            [139.1, 35.1],
            [139.2, 35.2],
        ]);
    });

    it("preserves max deviation within tolerance for a curved line", () => {
        const coords = [];
        for (let i = 0; i <= 50; i++) {
            const t = i / 50;
            coords.push([
                139.0 + t * 0.01,
                35.0 + Math.sin(t * Math.PI) * 0.001,
            ]);
        }
        const geometry = {
            type: "MultiLineString",
            coordinates: [coords],
        };
        const tolerance = 25;
        const simplified = simplifyGeometry(geometry, tolerance);

        for (const originalPoint of coords) {
            let bestDist = Infinity;
            const segment = simplified.coordinates[0];
            for (let i = 0; i < segment.length - 1; i++) {
                const d = segmentLength(originalPoint, segment[i]);
                if (d < bestDist) bestDist = d;
            }
            assert.ok(
                bestDist <= tolerance * 1.5,
                `point deviated ${bestDist.toFixed(1)}m > ${tolerance}m`,
            );
        }
    });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test data/transit/scripts/lib/simplifyGeometry.test.mjs`
Expected: FAIL with `simplifyGeometry` not defined or import error.

- [ ] **Step 3: Implement the simplifier**

Create `data/transit/scripts/lib/simplifyGeometry.mjs`:

```javascript
/**
 * Planar Douglas–Peucker simplification for GeoJSON MultiLineString
 * geometries.  Tolerance is given in meters and converted to an
 * approximate degree value using the standard 111320 m/deg.
 */

const METERS_PER_DEGREE = 111320;

/**
 * Compute the perpendicular distance (in degrees) from point p to the
 * segment a-b in planar lon/lat space.
 *
 * @param {number[]} p - [lon, lat]
 * @param {number[]} a - [lon, lat]
 * @param {number[]} b - [lon, lat]
 * @returns {number}
 */
function perpendicularDistanceDegrees(p, a, b) {
    const [px, py] = p;
    const [ax, ay] = a;
    const [bx, by] = b;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    if (lenSq === 0) {
        const d0 = px - ax;
        const d1 = py - ay;
        return Math.sqrt(d0 * d0 + d1 * d1);
    }

    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const projX = ax + t * dx;
    const projY = ay + t * dy;

    const dx0 = px - projX;
    const dy0 = py - projY;
    return Math.sqrt(dx0 * dx0 + dy0 * dy0);
}

/**
 * Douglas–Peucker recursive simplification.
 *
 * @param {number[][]} coords - ordered [lon, lat] points
 * @param {number} toleranceDegrees
 * @returns {number[][]}
 */
function rdpSimplify(coords, toleranceDegrees) {
    if (coords.length <= 2) return coords;

    const first = coords[0];
    const last = coords[coords.length - 1];

    let maxDist = -1;
    let index = -1;
    for (let i = 1; i < coords.length - 1; i++) {
        const d = perpendicularDistanceDegrees(coords[i], first, last);
        if (d > maxDist) {
            maxDist = d;
            index = i;
        }
    }

    if (maxDist > toleranceDegrees) {
        const left = rdpSimplify(coords.slice(0, index + 1), toleranceDegrees);
        const right = rdpSimplify(coords.slice(index), toleranceDegrees);
        // Avoid duplicating the shared peak point.
        return [...left.slice(0, -1), ...right];
    }

    return [first, last];
}

/**
 * Simplify a GeoJSON MultiLineString geometry with a planar RDP pass.
 *
 * - Tolerance is supplied in meters.
 * - Each LineString segment is simplified independently.
 * - Segments that collapse to fewer than two points are dropped.
 *
 * @param {{type: "MultiLineString", coordinates: number[][][]}} geometry
 * @param {number} meters - tolerance in meters; <=0 returns the geometry unchanged
 * @returns {{type: "MultiLineString", coordinates: number[][][]}}
 */
export function simplifyGeometry(geometry, meters) {
    if (
        !geometry ||
        geometry.type !== "MultiLineString" ||
        !Array.isArray(geometry.coordinates)
    ) {
        return geometry;
    }
    if (!Number.isFinite(meters) || meters <= 0) {
        return geometry;
    }

    const toleranceDegrees = meters / METERS_PER_DEGREE;
    const simplified = [];
    for (const segment of geometry.coordinates) {
        if (!Array.isArray(segment) || segment.length < 2) continue;
        const reduced = rdpSimplify(segment, toleranceDegrees);
        if (reduced.length >= 2) {
            simplified.push(reduced);
        }
    }

    return { type: "MultiLineString", coordinates: simplified };
}
```

- [ ] **Step 4: Run the simplification test and verify it passes**

Run: `node --test data/transit/scripts/lib/simplifyGeometry.test.mjs`
Expected: PASS.

- [ ] **Step 5: Wire simplification into route building**

Modify `data/transit/scripts/lib/osmRoutes.mjs`:

1. Add the import near the top:

```javascript
import { simplifyGeometry } from "./simplifyGeometry.mjs";
```

2. In `buildLine`, inside the `if (ways && wayMembers.length > 0)` block, replace the block that assigns `geometry` with:

```javascript
if (ways && wayMembers.length > 0) {
    const stitched = stitchWays(wayMembers, ways, nodeCoords);
    if (stitched.coordinates.length > 0) {
        const simplifyMeters =
            localeConfig.simplifyMeters != null
                ? localeConfig.simplifyMeters
                : (localeConfig.transitOverrides?.simplifyMeters ?? 11);
        geometry =
            simplifyMeters > 0
                ? simplifyGeometry(stitched, simplifyMeters)
                : stitched;

        // Spatial attach: pull in stations near the stitched track that
        // aren't already resolved as stop members. This is what gives
        // 0-stop infrastructure lines (e.g. 縱貫線/宜蘭線) their stations.
        const attachMeters = localeConfig.railwayAttachMeters ?? 120;
        const spatialIds = attachStationsAlongLine(
            geometry,
            stationById,
            attachMeters,
            allStationIds,
        );
        for (const sid of spatialIds) {
            allStationIds.add(sid);
        }
    }
}
```

- [ ] **Step 6: Plumb simplifyMeters through the pack builder**

Modify `data/packs/scripts/lib/buildTransit.mjs`. In the `localeConfig` object (around line 180), add:

```javascript
const localeConfig = {
    nameSuffixes: region.transitOverrides?.nameSuffixes ?? [],
    aliases: region.transitOverrides?.aliases ?? [],
    maxClusterMeters,
    routeColors: region.transitOverrides?.routeColors ?? {},
    operatorNames: region.transitOverrides?.operatorNames ?? {},
    directionTokens: region.transitOverrides?.directionTokens,
    useRailwayInfrastructure:
        region.transitOverrides?.useRailwayInfrastructure ?? false,
    railwayAttachMeters: region.transitOverrides?.railwayAttachMeters ?? 120,
    simplifyMeters: region.transitOverrides?.simplifyMeters ?? 11,
};
```

- [ ] **Step 7: Run transit pipeline tests**

Run: `pnpm test:data:transit`
Expected: PASS (existing tests unaffected; new simplifier test passes).

- [ ] **Step 8: Commit**

```bash
git add data/transit/scripts/lib/simplifyGeometry.mjs \
        data/transit/scripts/lib/simplifyGeometry.test.mjs \
        data/transit/scripts/lib/osmRoutes.mjs \
        data/packs/scripts/lib/buildTransit.mjs
git commit -m "feat(packs): RDP simplification for stitched way geometry"
```

---

### Task 2: Decouple way-geometry preference from railway-infrastructure layer policy

**Files:**

- Modify: `data/transit/scripts/lib/osmRoutes.mjs` (`buildLine` way-stitch gate)
- Modify: `data/packs/scripts/lib/buildTransit.mjs` (`localeConfig`)
- Modify: `data/packs/scripts/lib/config.mjs` (validate `transitOverrides.wayGeometry`)
- Modify: `data/packs/scripts/lib/config.test.mjs` (add validation test)
- Modify: `data/transit/scripts/lib/osmRoutes.test.mjs` (add wayGeometry off test)

- [ ] **Step 1: Write the failing wayGeometry-off test**

Append to `data/transit/scripts/lib/osmRoutes.test.mjs` a new test. The test constructs a route whose variants carry way members and a `ways` map. With `wayGeometry: false`, the line must fall back to the stop-position polyline, producing different coordinates than the stitched ways.

```javascript
it("falls back to stop-position geometry when wayGeometry is false", () => {
    const master = {
        id: 900,
        properties: {
            "@id": 900,
            tags: { route_master: "subway", name: "Wayless Fallback Line" },
        },
    };
    const variant = {
        id: 901,
        properties: {
            "@id": 901,
            tags: { route: "subway", name: "Wayless Fallback Line Inbound" },
        },
        members: [
            { type: "node", ref: 10, role: "stop" },
            { type: "node", ref: 11, role: "stop" },
            { type: "way", ref: 500, role: "" },
        ],
    };
    const stationRecords = [
        {
            id: "osm:node:10",
            name: "Alpha",
            lat: 35.0,
            lon: 139.0,
            tags: { railway: "station" },
        },
        {
            id: "osm:node:11",
            name: "Beta",
            lat: 35.2,
            lon: 139.2,
            tags: { railway: "station" },
        },
    ];
    const nodeCoords = new Map([
        [10, { lat: 35.0, lon: 139.0 }],
        [11, { lat: 35.2, lon: 139.2 }],
        [100, { lat: 35.05, lon: 139.05 }],
        [101, { lat: 35.15, lon: 139.15 }],
    ]);
    const ways = new Map([[500, [100, 101]]]);

    const { lines } = processOsmRoutes(
        [master, variant],
        stationRecords,
        { maxClusterMeters: 150, wayGeometry: false },
        nodeCoords,
        ways,
    );
    assert.equal(lines.length, 1);
    const line = lines[0];
    assert.equal(line.geometry.type, "MultiLineString");
    assert.equal(line.geometry.coordinates.length, 1);
    // Stop-position fallback uses station coordinates, not way nodes.
    assert.deepEqual(line.geometry.coordinates[0][0], [139.0, 35.0]);
    assert.deepEqual(line.geometry.coordinates[0][1], [139.2, 35.2]);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test data/transit/scripts/lib/osmRoutes.test.mjs`
Expected: FAIL because `wayGeometry: false` is not yet honored.

- [ ] **Step 3: Implement the wayGeometry gate**

Modify `data/transit/scripts/lib/osmRoutes.mjs`. Change the condition that decides whether to stitch ways from:

```javascript
    if (ways && wayMembers.length > 0) {
```

to:

```javascript
    if (ways && wayMembers.length > 0 && localeConfig.wayGeometry !== false) {
```

- [ ] **Step 4: Default wayGeometry to true in pack builder**

Modify `data/packs/scripts/lib/buildTransit.mjs`. Add `wayGeometry` to `localeConfig`:

```javascript
const localeConfig = {
    nameSuffixes: region.transitOverrides?.nameSuffixes ?? [],
    aliases: region.transitOverrides?.aliases ?? [],
    maxClusterMeters,
    routeColors: region.transitOverrides?.routeColors ?? {},
    operatorNames: region.transitOverrides?.operatorNames ?? {},
    directionTokens: region.transitOverrides?.directionTokens,
    useRailwayInfrastructure:
        region.transitOverrides?.useRailwayInfrastructure ?? false,
    railwayAttachMeters: region.transitOverrides?.railwayAttachMeters ?? 120,
    simplifyMeters: region.transitOverrides?.simplifyMeters ?? 11,
    wayGeometry: region.transitOverrides?.wayGeometry ?? true,
};
```

- [ ] **Step 5: Validate wayGeometry in pack config**

Modify `data/packs/scripts/lib/config.mjs`. Inside the `transitOverrides` validation block (after the object-type check), add:

```javascript
if (region.transitOverrides.wayGeometry !== undefined) {
    if (typeof region.transitOverrides.wayGeometry !== "boolean") {
        errors.push(
            `${prefix}: "transitOverrides.wayGeometry" must be a boolean`,
        );
    }
}
if (region.transitOverrides.simplifyMeters !== undefined) {
    if (
        typeof region.transitOverrides.simplifyMeters !== "number" ||
        region.transitOverrides.simplifyMeters < 0
    ) {
        errors.push(
            `${prefix}: "transitOverrides.simplifyMeters" must be a non-negative number`,
        );
    }
}
```

- [ ] **Step 6: Add config validation test**

Append to `data/packs/scripts/lib/config.test.mjs` a test that rejects bad `transitOverrides.wayGeometry` and `simplifyMeters`:

```javascript
it("rejects invalid transitOverrides option types", () => {
    const errors = validateConfig({
        regions: [
            {
                id: "bad-overrides",
                label: "Bad Overrides",
                regionPath: ["X"],
                pbfUrl: "https://example.com/x.osm.pbf",
                adminLevels: { matching: [1, 2, 3, 4], extract: [1, 2, 3, 4] },
                artifacts: ["transit"],
                transitOverrides: {
                    wayGeometry: "yes",
                    simplifyMeters: -5,
                },
            },
        ],
    });
    assert.ok(
        errors.some((e) => e.includes("wayGeometry")),
        "errors include wayGeometry type",
    );
    assert.ok(
        errors.some((e) => e.includes("simplifyMeters")),
        "errors include simplifyMeters type",
    );
});
```

- [ ] **Step 7: Run tests**

Run: `pnpm test:data:transit` and `pnpm test:data:packs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add data/transit/scripts/lib/osmRoutes.mjs \
        data/transit/scripts/lib/osmRoutes.test.mjs \
        data/packs/scripts/lib/buildTransit.mjs \
        data/packs/scripts/lib/config.mjs \
        data/packs/scripts/lib/config.test.mjs
git commit -m "feat(packs): decouple wayGeometry preference from railway infrastructure"
```

---

### Task 3: Close Fix A — resolve interchange colors from the full bundle

**Files:**

- Modify: `src/features/hidingZone/hidingZone.ts` (`getSelectedStations`)
- Modify: `src/state/hidingZoneStore.tsx` (derived memo)
- Modify: `src/features/hidingZone/__tests__/hidingZone.test.ts` (add unselected-owner test)

- [ ] **Step 1: Write the failing cross-preset test**

Append to `src/features/hidingZone/__tests__/hidingZone.test.ts` after the existing `resolves cross-preset route colors at interchange stations` test:

```typescript
it("resolves cross-preset route colors even when the owner preset is unselected", () => {
    // Operator A owns line L with a real color. It is NOT selected.
    const operatorA: HidingZonePreset = {
        ...preset,
        id: "operator-a",
        defaultColor: "#009BBF",
        routes: [
            {
                color: "#FF0000",
                geometry: {
                    coordinates: [
                        [
                            [139.76, 35.68],
                            [139.77, 35.69],
                        ],
                    ],
                    type: "MultiLineString",
                },
                id: "cross-preset:route:line-l",
                name: "Line L",
                sourceId: "line-l",
            },
        ],
        stations: [],
    };

    // Operator B is selected and has a station that references line L.
    const operatorB: HidingZonePreset = {
        ...preset,
        id: "operator-b",
        defaultColor: "#40E0D0",
        routes: [
            {
                color: "#0000FF",
                geometry: {
                    coordinates: [
                        [
                            [139.76, 35.68],
                            [139.78, 35.7],
                        ],
                    ],
                    type: "MultiLineString",
                },
                id: "cross-preset:route:line-m",
                name: "Line M",
                sourceId: "line-m",
            },
        ],
        stations: [
            {
                id: "cross-preset:stop:interchange",
                lat: 35.68,
                lon: 139.76,
                mergeKey: "interchange-merge",
                name: "Interchange",
                routeIds: [
                    "cross-preset:route:line-l",
                    "cross-preset:route:line-m",
                ],
                sourceId: "interchange",
            },
        ],
    };

    const stations = getSelectedStations([operatorB], [operatorA, operatorB]);
    expect(stations).toHaveLength(1);
    expect(stations[0].routeColors).toEqual(
        expect.arrayContaining(["#FF0000", "#0000FF"]),
    );
    expect(stations[0].routeColors).not.toContain(operatorB.defaultColor);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm test -- hidingZone`
Expected: FAIL — the new test sees `operatorB.defaultColor` instead of `#FF0000`.

- [ ] **Step 3: Update getSelectedStations to accept the full bundle**

Modify `src/features/hidingZone/hidingZone.ts`:

```typescript
export function getSelectedStations(
    selectedPresets: HidingZonePreset[],
    allPresets?: HidingZonePreset[],
): TransitStation[] {
    // Sort by source priority so higher-priority (GTFS) presets win
    // name / coords when the same mergeKey appears in multiple presets.
    // Stable sort keeps config order within the same priority kind.
    const sorted = [...selectedPresets].sort(
        (a, b) => sourcePriority(a.source) - sourcePriority(b.source),
    );

    // Build a global routeId → color map across every preset in the bundle.
    // Route ids are globally unique, so a route owned by another operator's
    // preset still resolves to its real color at interchange stations.
    const colorSourcePresets = allPresets ?? selectedPresets;
    const routeColorById = new Map<string, string>();
    for (const preset of colorSourcePresets) {
        for (const route of preset.routes) {
            if (!routeColorById.has(route.id)) {
                routeColorById.set(
                    route.id,
                    route.color || preset.defaultColor,
                );
            } else if (route.color) {
                // Prefer a real route color over a preset defaultColor fallback.
                routeColorById.set(route.id, route.color);
            }
        }
    }

    // ...rest unchanged...
}
```

- [ ] **Step 4: Thread the full preset list from the store**

Modify `src/state/hidingZoneStore.tsx`. Change the `selectedStations` memo:

```typescript
const selectedStations = useMemo(
    () => getSelectedStations(selectedPresets, presets),
    [selectedPresets, presets],
);
```

- [ ] **Step 5: Run hiding-zone tests**

Run: `pnpm test -- hidingZone`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/hidingZone/hidingZone.ts \
        src/state/hidingZoneStore.tsx \
        src/features/hidingZone/__tests__/hidingZone.test.ts
git commit -m "fix(hiding-zone): resolve interchange colors from full bundle"
```

---

### Task 4: Build and validate the Taiwan and Netherlands packs

**Files:**

- Generated (not committed): `data/packs/dist/asia-taiwan/transit.json.gz`
- Generated (not committed): `data/packs/dist/europe-netherlands/transit.json.gz`

- [ ] **Step 1: Run the full test / typecheck suite**

Run:

```bash
pnpm typecheck && pnpm test
```

Expected: PASS.

- [ ] **Step 2: Build Taiwan pack**

Run:

```bash
pnpm data:pack -- --region asia-taiwan
```

Expected: completes without errors; transit blob size is close to stations-only size (the doc measured ~78 KB gz at ~11 m).

- [ ] **Step 3: Build Netherlands pack**

Run:

```bash
NODE_OPTIONS=--max-old-space-size=16384 pnpm data:pack -- --region europe-netherlands
```

Expected: completes without errors; transit blob stays well under the raw-way bloat.

- [ ] **Step 4: Lint built pack artifacts**

Run:

```bash
pnpm data:pack:lint
```

Expected: PASS.

- [ ] **Step 5: Verify geometry visually with the data viewer (optional but recommended)**

Run:

```bash
node tools/data-viewer/server.mjs
```

Open the transit layer for each region; route lines should follow actual track geometry, and the 紅樹林 interchange in Taiwan should show red + pink rings.

- [ ] **Step 6: Commit catalog updates if publishing**

If running `pnpm data:pack:publish -- --region asia-taiwan` and `pnpm data:pack:publish -- --region europe-netherlands`, the catalog in `site/packs/catalog.json` will be updated; commit only that file (do not commit `data/packs/dist/`).

```bash
# Only if publishing:
# pnpm data:pack:publish -- --region asia-taiwan
# pnpm data:pack:publish -- --region europe-netherlands
# git add site/packs/catalog.json
# git commit -m "chore(packs): republish taiwan + netherlands with way geometry"
```

- [ ] **Step 7: Final verification**

Run: `pnpm check`
Expected: PASS (lint + format + typecheck + perf-typecheck + POI-selector drift).

---

## Self-Review

1. **Spec coverage:**
    - RDP simplification → Task 1.
    - Prefer-ways policy / decouple `useRailwayInfrastructure` → Task 2.
    - Fix A cross-preset color gap → Task 3.
    - Bundle generation and validation → Task 4.
2. **Placeholder scan:** All steps contain concrete code and commands; no TBD/TODO.
3. **Type consistency:** `getSelectedStations(selectedPresets, allPresets?)` keeps the existing single-argument contract valid; `localeConfig.simplifyMeters` and `wayGeometry` are read as booleans/numbers throughout.
