# T14 — Transit station + route quality implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve offline-pack transit artifact quality and the shared transit pipeline by filtering non-rail stations, attaching route IDs across operator presets, collapsing per-train route proliferation, and resolving line colors deterministically. Japan bundles must not regress.

**Architecture:** Make the shared transit library (`data/transit/scripts/lib/`) own station mapping/dedup, masterless-route collapse, color resolution, and route attachment. The pack builder (`data/packs/scripts/lib/buildTransit.mjs`) stops reimplementing these primitives and consumes the shared helpers with per-region `transitOverrides` from `regions.yaml`. `conflateStage.mjs` (Japan) reuses the same shared attachment helper.

**Tech Stack:** Node.js ESM, `node --test`, osmium CLI, GeoJSONSeq, `gzipSync`.

---

## File structure

| File                                                  | Responsibility                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `data/transit/scripts/lib/osmRoutes.mjs`              | Add `lineNameKey` heuristics, collapse masterless variants, deterministic color fallback.                                      |
| `data/transit/scripts/lib/attachRoutes.mjs`           | New shared helper: place route lines in operator presets and attach `routeId` to every member-station copy across all presets. |
| `data/packs/scripts/lib/buildTransit.mjs`             | Use `mapOsmNode`/`dedupeOsmStations`, call shared attach helper, consume `transitOverrides`.                                   |
| `data/transit/scripts/lib/conflateStage.mjs`          | Replace ad-hoc route attachment with shared helper.                                                                            |
| `data/packs/regions.yaml`                             | Add per-region `transitOverrides` (name suffixes, direction tokens, route colors).                                             |
| `data/packs/scripts/pack-lint.mjs`                    | Add transit checks: per-operator route-count bound and valid hex colors.                                                       |
| `data/transit/scripts/lib/osmRoutes.test.mjs`         | Tests for masterless collapse and color fallback.                                                                              |
| `data/transit/scripts/lib/attachRoutes.test.mjs`      | New tests for cross-operator routeId attachment.                                                                               |
| `data/packs/scripts/lib/buildTransit.routes.test.mjs` | Extend with non-rail drop and collapse assertions.                                                                             |

---

## Task 1: Add `lineNameKey` and default direction tokens to `osmRoutes.mjs`

**Files:**

- Modify: `data/transit/scripts/lib/osmRoutes.mjs`
- Test: `data/transit/scripts/lib/osmRoutes.test.mjs`

- [ ] **Step 1: Append helper functions at the bottom of `osmRoutes.mjs`**

Add the following after the existing `isMemberOfMaster` function:

```javascript
const DEFAULT_DIRECTION_TOKENS = [
    // CJK directional markers
    "順向",
    "逆向",
    "上り",
    "下り",
    "往程",
    "返程",
    "西向",
    "東向",
    "北向",
    "南向",
    "順行",
    "逆行",
    // English
    "inbound",
    "outbound",
];

/**
 * Strip direction tokens, parenthetical direction notes, trailing/embedded
 * train numbers, and arrow-delimited origin/destination from a route name
 * to produce a stable line key for grouping masterless variants.
 *
 * @param {string} name
 * @param {string[]} [tokens]
 * @returns {string}
 */
export function lineNameKey(name, tokens = DEFAULT_DIRECTION_TOKENS) {
    if (!name || typeof name !== "string") return "";

    // 1. NFKC + lowercase + collapse whitespace.
    let key = name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

    // 2. Remove Chinese/English parenthetical content: （…） or (…).
    key = key.replace(/[（(][^）)]+[）)]/gu, " ").trim();

    // 3. Remove arrow-delimited origin/destination and everything after.
    key = key.replace(/\s*[→\-].*$/u, "").trim();

    // 4. Remove configured direction tokens as whole words.
    for (const token of tokens) {
        if (!token) continue;
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        key = key.replace(new RegExp(`\\b${escaped}\\b`, "gu"), " ").trim();
    }

    // 5. Remove standalone numbers (train numbers like 603, 1112).
    key = key.replace(/\b\d+\b/gu, " ").trim();

    // 6. Collapse whitespace again.
    key = key.replace(/\s+/g, " ").trim();

    return key;
}

/**
 * Convert a hue (0-360) and saturation/lightness percentages to a hex color.
 */
function hslToHex(h, s, l) {
    const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100);
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l / 100 - c / 2;

    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) {
        [r, g, b] = [c, x, 0];
    } else if (h < 120) {
        [r, g, b] = [x, c, 0];
    } else if (h < 180) {
        [r, g, b] = [0, c, x];
    } else if (h < 240) {
        [r, g, b] = [0, x, c];
    } else if (h < 300) {
        [r, g, b] = [x, 0, c];
    } else {
        [r, g, b] = [c, 0, x];
    }

    const toHex = (v) =>
        Math.round((v + m) * 255)
            .toString(16)
            .padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Stable deterministic hue derived from a string.
 */
function hashHue(input) {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 360;
}

/**
 * Resolve a line's final color.
 * Order: OSM colour tag → transitOverrides.routeColors → deterministic hue fallback.
 *
 * @param {object} line
 * @param {Record<string,string>} [routeColors]
 * @returns {string}
 */
export function resolveLineColor(line, routeColors = {}) {
    if (line.color) return line.color;

    const key = lineNameKey(line.name);
    if (routeColors[key]) return routeColors[key];
    if (line.operator && routeColors[line.operator])
        return routeColors[line.operator];

    return hslToHex(hashHue(key || line.name || line.id || "x"), 65, 45);
}
```

- [ ] **Step 2: Add unit tests for `lineNameKey`**

Append to `data/transit/scripts/lib/osmRoutes.test.mjs`:

```javascript
import {
    processOsmRoutes,
    lineNameKey,
    resolveLineColor,
} from "./osmRoutes.mjs";

// ... existing imports ...

describe("lineNameKey", () => {
    it("strips train numbers and direction arrows", () => {
        assert.equal(lineNameKey("台灣高鐵 603 南港→左營"), "台灣高鐵");
    });

    it("strips parenthetical direction notes", () => {
        assert.equal(
            lineNameKey("臺北捷運環狀線（大坪林→新北產業園區）"),
            "臺北捷運環狀線",
        );
    });

    it("strips configured direction tokens", () => {
        assert.equal(
            lineNameKey("Red Line Inbound", ["inbound", "outbound"]),
            "red line",
        );
    });

    it("returns empty for missing names", () => {
        assert.equal(lineNameKey(""), "");
        assert.equal(lineNameKey(null), "");
    });
});

describe("resolveLineColor", () => {
    it("preserves OSM color when present", () => {
        assert.equal(
            resolveLineColor({ color: "#FF0000", name: "X" }),
            "#FF0000",
        );
    });

    it("uses transitOverrides routeColors", () => {
        assert.equal(
            resolveLineColor({ name: "台灣高鐵 603" }, { 台灣高鐵: "#C41230" }),
            "#C41230",
        );
    });

    it("falls back to a deterministic hue", () => {
        const a = resolveLineColor({ name: "Uncolored A" });
        const b = resolveLineColor({ name: "Uncolored B" });
        assert.match(a, /^#[0-9a-fA-F]{6}$/);
        assert.match(b, /^#[0-9a-fA-F]{6}$/);
        assert.notEqual(a.toLowerCase(), b.toLowerCase());
    });
});
```

- [ ] **Step 3: Run new tests to verify they fail**

```bash
pnpm test:data:transit -- data/transit/scripts/lib/osmRoutes.test.mjs
```

Expected: FAIL — `lineNameKey`/`resolveLineColor` not exported or not defined.

---

## Task 2: Collapse masterless route variants into logical lines in `osmRoutes.mjs`

**Files:**

- Modify: `data/transit/scripts/lib/osmRoutes.mjs`
- Test: `data/transit/scripts/lib/osmRoutes.test.mjs`

- [ ] **Step 1: Add `normalizeOp` import and apply it to masterless grouping**

At the top of `osmRoutes.mjs`, add:

```javascript
import { buildOperatorNormalizer } from "./normalizeOperator.mjs";
```

In `processOsmRoutes`, after the existing operator inference two-pass block (around line 275) and before `stats.linesKept = keptLines.length;`, add the masterless collapse step:

```javascript
// ─── Collapse masterless variants into logical lines ─────────────────
const operatorNames = localeConfig.operatorNames || {};
const normalizeOp = buildOperatorNormalizer(operatorNames);

const collapsed = [];
/** @type {Map<string, object[]>} */
const masterlessGroups = new Map();

for (const line of keptLines) {
    if (line.isMastered) {
        collapsed.push(line);
        continue;
    }
    const op = normalizeOp(line.operator) || line.operator || "_none";
    const key = `${op}|${lineNameKey(line.name)}`;
    if (!masterlessGroups.has(key)) masterlessGroups.set(key, []);
    masterlessGroups.get(key).push(line);
}

for (const [, group] of masterlessGroups) {
    if (group.length === 1) {
        collapsed.push(group[0]);
        continue;
    }

    // Pick the representative with the most resolved stations and, if
    // tied, the first OSM color present.
    const sorted = [...group].sort((a, b) => {
        const diff = b.memberStationIds.length - a.memberStationIds.length;
        if (diff !== 0) return diff;
        if (a.color && !b.color) return -1;
        if (!a.color && b.color) return 1;
        return 0;
    });
    const representative = sorted[0];

    // Union member station ids across all variants.
    const memberSet = new Set();
    for (const line of group) {
        for (const sid of line.memberStationIds) memberSet.add(sid);
    }

    collapsed.push({
        ...representative,
        name: lineNameKey(representative.name) || representative.name,
        memberStationIds: [...memberSet],
        collapsedVariantIds: group.map((l) => l.id),
    });
    stats.collapsedGroups = (stats.collapsedGroups || 0) + 1;
}

keptLines.length = 0;
keptLines.push(...collapsed);
```

- [ ] **Step 2: Mark mastered lines in `buildLine`**

The collapse step above reads `line.isMastered`. In the master loop of `processOsmRoutes`, after `if (line) { masterLines.push(line); }`, add:

```javascript
if (line) {
    line.isMastered = true;
    masterLines.push(line);
}
```

In the masterless loop, leave `isMastered` undefined/false.

- [ ] **Step 3: Add a test for masterless collapse**

Append to `osmRoutes.test.mjs`:

```javascript
it("collapses masterless per-train variants into one logical line", () => {
    const relations = [
        {
            id: 501,
            properties: {
                tags: {
                    route: "train",
                    name: "Express 101 Downtown → Uptown",
                    operator: "TestRail",
                },
            },
            members: [
                { ref: "40", role: "stop" },
                { ref: "41", role: "stop" },
            ],
        },
        {
            id: 502,
            properties: {
                tags: {
                    route: "train",
                    name: "Express 202 Uptown → Downtown",
                    operator: "TestRail",
                },
            },
            members: [
                { ref: "41", role: "stop" },
                { ref: "42", role: "stop" },
            ],
        },
    ];

    const stationRecords = [
        { id: "osm:node:40", name: "Downtown", lat: 35.0, lon: 139.0 },
        { id: "osm:node:41", name: "Midtown", lat: 35.1, lon: 139.1 },
        { id: "osm:node:42", name: "Uptown", lat: 35.2, lon: 139.2 },
    ];

    const { lines, stats } = processOsmRoutes(relations, stationRecords, {
        nameSuffixes: [],
        operators: [],
        directionTokens: [],
    });

    assert.equal(lines.length, 1);
    assert.equal(lines[0].name, "express");
    assert.deepEqual(
        new Set(lines[0].memberStationIds),
        new Set(["osm:node:40", "osm:node:41", "osm:node:42"]),
    );
    assert.ok(stats.collapsedGroups >= 1);
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm test:data:transit -- data/transit/scripts/lib/osmRoutes.test.mjs
```

Expected: PASS for the new collapse test (after implementation) and existing tests still pass.

---

## Task 3: Apply deterministic color resolution in `processOsmRoutes`

**Files:**

- Modify: `data/transit/scripts/lib/osmRoutes.mjs`

- [ ] **Step 1: Resolve color on every kept line before returning**

After the collapse step (or after operator inference if collapse is not run), add before `stats.linesKept = keptLines.length;`:

```javascript
const routeColors = localeConfig.routeColors || {};
for (const line of keptLines) {
    line.color = resolveLineColor(line, routeColors);
}
```

- [ ] **Step 2: Run tests**

```bash
pnpm test:data:transit -- data/transit/scripts/lib/osmRoutes.test.mjs
```

Expected: PASS.

---

## Task 4: Create shared `attachRoutes.mjs`

**Files:**

- Create: `data/transit/scripts/lib/attachRoutes.mjs`
- Test: `data/transit/scripts/lib/attachRoutes.test.mjs`

- [ ] **Step 1: Create `attachRoutes.mjs`**

```javascript
/**
 * Attach OSM route lines to presets.
 *
 * - Places each route line into the preset whose normalized operator matches
 *   the route's normalized operator.
 * - Adds the route's `routeId` to every member station copy in *every* preset
 *   that contains that station (by sourceId or mergeKey).
 *
 * @module attachRoutes
 */

/**
 * @typedef {object} TransitLine
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {string} sourceId
 * @property {string} [operator]
 * @property {string[]} memberStationIds
 * @property {object} geometry
 */

/**
 * @typedef {object} Preset
 * @property {string} id
 * @property {string} operator
 * @property {string} defaultColor
 * @property {object[]} routes
 * @property {object[]} stations
 */

/**
 * Attach lines to presets.
 *
 * @param {Preset[]} presets
 * @param {TransitLine[]} lines
 * @param {(raw: string|null|undefined) => string|null} normalizeOp
 * @param {object} [options]
 * @param {string} [options.sourceKind] - "osm-pack" or "osm"
 * @returns {Preset[]}
 */
export function attachRoutesToPresets(
    presets,
    lines,
    normalizeOp,
    options = {},
) {
    // Index every station copy by sourceId and mergeKey across all presets.
    /** @type {Map<string, { preset: Preset, station: object }[]>} */
    const stationsByKey = new Map();

    for (const preset of presets) {
        for (const station of preset.stations) {
            const keys = new Set(
                [station.sourceId, station.mergeKey, station.id].filter(
                    Boolean,
                ),
            );
            for (const key of keys) {
                if (!stationsByKey.has(key)) stationsByKey.set(key, []);
                stationsByKey.get(key).push({ preset, station });
            }
        }
    }

    // Index presets by normalized operator for line placement.
    /** @type {Map<string, Preset>} */
    const presetByOperator = new Map();
    for (const preset of presets) {
        const op = normalizeOp(preset.operator);
        if (op) presetByOperator.set(op, preset);
    }

    for (const line of lines) {
        const lineOp = normalizeOp(line.operator);
        const targetPreset = lineOp ? presetByOperator.get(lineOp) : null;

        if (targetPreset) {
            targetPreset.routes.push({
                id: line.id,
                name: line.name,
                color: line.color || targetPreset.defaultColor,
                sourceId: line.sourceId,
                geometry: line.geometry,
            });
        }

        // Attach routeId to every copy of every member station.
        for (const memberId of line.memberStationIds) {
            const entries = stationsByKey.get(memberId);
            if (!entries) continue;
            for (const { station } of entries) {
                if (!station.routeIds.includes(line.id)) {
                    station.routeIds.push(line.id);
                }
            }
        }
    }

    return presets;
}
```

- [ ] **Step 2: Create `attachRoutes.test.mjs`**

```javascript
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attachRoutesToPresets } from "./attachRoutes.mjs";

function makePreset(id, operator, stations) {
    return {
        id,
        operator,
        defaultColor: "#1f6f78",
        routes: [],
        stations: stations.map((s) => ({
            id: s.id,
            sourceId: s.id,
            mergeKey: s.mergeKey || s.id,
            name: s.name,
            routeIds: [],
        })),
    };
}

describe("attachRoutesToPresets", () => {
    it("places a route in its operator preset and colors member stations there", () => {
        const presets = [
            makePreset("p-a", "Operator A", [
                { id: "osm:node:1", name: "Hub" },
            ]),
        ];
        const lines = [
            {
                id: "osm:relation:10",
                name: "A Line",
                color: "#FF0000",
                sourceId: "10",
                operator: "Operator A",
                memberStationIds: ["osm:node:1"],
                geometry: { type: "MultiLineString", coordinates: [] },
            },
        ];

        attachRoutesToPresets(presets, lines, (op) => op);

        assert.equal(presets[0].routes.length, 1);
        assert.deepEqual(presets[0].stations[0].routeIds, ["osm:relation:10"]);
    });

    it("attaches routeId to member stations in other operator presets", () => {
        const presets = [
            makePreset("p-a", "Operator A", [
                { id: "osm:node:1", name: "Hub", mergeKey: "osm:node:1" },
            ]),
            makePreset("p-b", "Operator B", [
                { id: "osm:node:1", name: "Hub", mergeKey: "osm:node:1" },
            ]),
            makePreset("p-cov", "other", [
                { id: "osm:node:1", name: "Hub", mergeKey: "osm:node:1" },
            ]),
        ];
        const lines = [
            {
                id: "osm:relation:20",
                name: "Shared Line",
                color: "#00AA00",
                sourceId: "20",
                operator: "Operator A",
                memberStationIds: ["osm:node:1"],
                geometry: { type: "MultiLineString", coordinates: [] },
            },
        ];

        attachRoutesToPresets(presets, lines, (op) => op);

        assert.deepEqual(presets[0].stations[0].routeIds, ["osm:relation:20"]);
        assert.deepEqual(presets[1].stations[0].routeIds, ["osm:relation:20"]);
        assert.deepEqual(presets[2].stations[0].routeIds, ["osm:relation:20"]);
    });
});
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
pnpm test:data:transit -- data/transit/scripts/lib/attachRoutes.test.mjs
```

Expected: PASS.

---

## Task 5: Replace simplified station primitives in `buildTransit.mjs`

**Files:**

- Modify: `data/packs/scripts/lib/buildTransit.mjs`

- [ ] **Step 1: Update imports**

Replace the existing imports from shared transit modules with:

```javascript
import { processOsmRoutes } from "../../../transit/scripts/lib/osmRoutes.mjs";
import { buildOperatorNormalizer } from "../../../transit/scripts/lib/normalizeOperator.mjs";
import {
    createOsmElementId,
    mapOsmNode,
    dedupeOsmStations,
} from "../../../transit/scripts/lib/osmStations.mjs";
import { extractRouteRelationsFromPbf } from "../../../transit/scripts/lib/extractOsmRoutes.mjs";
import { attachRoutesToPresets } from "../../../transit/scripts/lib/attachRoutes.mjs";
```

- [ ] **Step 2: Replace streaming record mapping to use `mapOsmNode`**

Inside the GeoJSONSeq streaming loop, replace `const rec = mapStationRecord(feature);` with:

```javascript
const stats = {
    skippedNoName: 0,
    skippedNoId: 0,
    skippedNonRailway: 0,
};
```

Wait — the stats accumulator must be declared once, before the loop, not per record. Declare it before the loop:

```javascript
        const stats = {
            skippedNoName: 0,
            skippedNoId: 0,
            skippedNonRailway: 0,
        };
        const suffixes = region.transitOverrides?.nameSuffixes ?? [];

        for await (const line of rl) {
```

Then in the loop:

```javascript
const rec = mapOsmNode(feature, region.id, suffixes, stats);
if (rec) records.push(rec);
```

- [ ] **Step 3: Log non-railway skips**

After the loop, add:

```javascript
if (stats.skippedNonRailway > 0) {
    console.log(`  Skipped ${stats.skippedNonRailway} non-railway node(s)`);
}
```

- [ ] **Step 4: Replace dedup call**

Replace `const deduped = dedupeStations(records);` with:

```javascript
const maxClusterMeters = region.transitOverrides?.maxClusterMeters ?? 150;
const { kept: deduped, stats: dedupStats } = dedupeOsmStations(
    records,
    maxClusterMeters,
);
if (
    dedupStats.droppedById +
        dedupStats.droppedByWikidata +
        dedupStats.droppedByNameDist >
    0
) {
    console.log(
        `  Dedup dropped: ${dedupStats.droppedById} by id, ` +
            `${dedupStats.droppedByWikidata} by wikidata, ` +
            `${dedupStats.droppedByNameDist} by name+dist`,
    );
}
```

- [ ] **Step 5: Adapt `stationRecords` construction for `processOsmRoutes`**

Replace the existing `stationRecords` mapping block with:

```javascript
const stationRecords = recordsInBbox.map((rec) => ({
    id: rec.id,
    name: rec.name,
    nameEn: rec.nameEn,
    lat: rec.lat,
    lon: rec.lon,
    tags: rec.tags,
}));
const localeConfig = {
    nameSuffixes: region.transitOverrides?.nameSuffixes ?? [],
    aliases: region.transitOverrides?.aliases ?? [],
    maxClusterMeters,
    routeColors: region.transitOverrides?.routeColors ?? {},
    operatorNames: region.transitOverrides?.operatorNames ?? {},
    directionTokens: region.transitOverrides?.directionTokens,
};
```

- [ ] **Step 6: Remove old local `mapStationRecord` and `dedupeStations` functions**

Delete the entire `mapStationRecord` function (lines 232–263) and `dedupeStations` function (lines 268–278). Keep helper geometry/bbox utilities.

- [ ] **Step 7: Run existing buildTransit tests to catch shape mismatches**

```bash
pnpm test:data:packs -- data/packs/scripts/lib/buildTransit.routes.test.mjs
```

Expected: PASS or clear failures from missing functions.

---

## Task 6: Use shared attachment + color resolution in `buildTransit.mjs`

**Files:**

- Modify: `data/packs/scripts/lib/buildTransit.mjs`

- [ ] **Step 1: Rewrite `buildPresets` to create station contributions and attach via helper**

Replace the entire `buildPresets` function with:

```javascript
function buildPresets(records, regionId, lines, normalizeOp) {
    // Group records by normalized operator.
    const byOperator = new Map();
    for (const rec of records) {
        const ops = rec.operator
            ? splitOperators(rec.operator, normalizeOp)
            : [];
        const primaryOp = ops[0] || "other";
        if (!byOperator.has(primaryOp)) byOperator.set(primaryOp, []);
        byOperator.get(primaryOp).push(rec);
    }

    const presets = [];

    // Per-operator presets.
    for (const [operator, opRecords] of byOperator) {
        if (opRecords.length === 0) continue;

        const stations = opRecords.map(toStationContribution);
        const bbox = computeRecordsBbox(opRecords);

        presets.push({
            id: `osm-${regionId}-${slugify(operator)}`,
            label: operator,
            operator,
            kind: "operator",
            bbox,
            defaultColor: "#1f6f78",
            source: {
                kind: "osm-pack",
                namespace: `pack:${regionId}`,
            },
            routes: [],
            stations,
        });
    }

    // Coverage preset (all stations, no operator filter).
    if (records.length > 0) {
        presets.push({
            id: `osm-${regionId}-coverage`,
            label: `Other stations (${regionId})`,
            operator: "other",
            kind: "coverage",
            bbox: computeRecordsBbox(records),
            defaultColor: "#1f6f78",
            source: {
                kind: "osm-pack",
                namespace: `pack:${regionId}`,
            },
            routes: [],
            stations: records.map(toStationContribution),
        });
    }

    // Attach routes globally across presets.
    attachRoutesToPresets(presets, lines, normalizeOp, {
        sourceKind: "osm-pack",
    });

    return presets;
}

function toStationContribution(rec) {
    const sourceId = rec.id;
    return {
        id: sourceId,
        lat: rec.lat,
        lon: rec.lon,
        mergeKey: sourceId,
        name: rec.name,
        routeIds: [],
        sourceId,
    };
}
```

- [ ] **Step 2: Add `splitOperators` import**

At the top of `buildTransit.mjs`, add:

```javascript
import { splitOperators } from "../../../transit/scripts/lib/normalizeOperator.mjs";
```

- [ ] **Step 3: Remove unused `operatorColor` and `createOsmElementId` station mapping**

Delete the `operatorColor` function (lines 417–420). `createOsmElementId` is still imported but only used for the removed mapping; if no longer used elsewhere, remove the import too.

- [ ] **Step 4: Run buildTransit tests**

```bash
pnpm test:data:packs -- data/packs/scripts/lib/buildTransit.routes.test.mjs
```

Expected: PASS.

---

## Task 7: Use shared attachment in `conflateStage.mjs`

**Files:**

- Modify: `data/transit/scripts/lib/conflateStage.mjs`

- [ ] **Step 1: Add import**

At the top, add:

```javascript
import { attachRoutesToPresets } from "./attachRoutes.mjs";
```

- [ ] **Step 2: Replace the per-operator route attachment loop**

Find the block `// -- Match osmRouteLines to presets.` (lines 232–270) and replace it with:

```javascript
// -- Match osmRouteLines to presets.
attachRoutesToPresets(
    [...mainOperatorPresets, otherPreset],
    ctx.osmRouteLines || [],
    normalizeOp,
    { sourceKind: "osm" },
);

// Add main presets and Other preset to the final list.
for (const preset of mainOperatorPresets) {
    if (!seenIds.has(preset.id)) {
        seenIds.add(preset.id);
        osmBaselinePresets.push(preset);
    }
}
if (otherPreset.stations.length > 0) {
    osmBaselinePresets.push(otherPreset);
}
```

- [ ] **Step 3: Remove duplicate preset push logic below**

The existing code pushes `mainOperatorPresets` at lines 274–283 and logs counts. Remove that block and move the push into the replacement above. Keep the log.

The final ordering should be:

1. Build mainOperatorPresets and otherPreset.
2. Attach routes.
3. Push main presets (deduping ids) and other preset.
4. Log counts.

- [ ] **Step 4: Run Japan transit tests**

```bash
pnpm test:data:transit
```

Expected: PASS (Japan route counts may shift; capture diff in Task 13).

---

## Task 8: Add `transitOverrides` to `data/packs/regions.yaml`

**Files:**

- Modify: `data/packs/regions.yaml`
- Test: `data/packs/scripts/lib/config.test.mjs`

- [ ] **Step 1: Update the Netherlands region entry**

```yaml
- id: europe-netherlands
  label: Netherlands
  regionPath: [Europe, Netherlands]
  pbfUrl: https://download.geofabrik.de/europe/netherlands-latest.osm.pbf
  adminLevels:
      matching: [4, 8, 9, 10]
      extract: [4, 7, 8, 9, 10]
  artifacts: [poi, measuring, boundaries, transit]
  transitOverrides:
      nameSuffixes: []
      maxClusterMeters: 150
      routeColors: {}
```

- [ ] **Step 2: Update the Taiwan region entry**

```yaml
- id: asia-taiwan
  label: Taiwan
  regionPath: [Asia, Taiwan]
  pbfUrl: https://download.geofabrik.de/asia/taiwan-latest.osm.pbf
  adminLevels:
      matching: [4, 7, 8, 9]
      extract: [4, 7, 8, 9, 10]
  artifacts: [poi, measuring, boundaries, transit]
  transitOverrides:
      nameSuffixes: ["站", "車站"]
      maxClusterMeters: 150
      routeColors:
          "台灣高鐵": "#E4002B"
          "臺灣高鐵": "#E4002B"
          "區間": "#0070BD"
          "自強": "#0033A0"
          "莒光": "#F58B1F"
          "復興": "#C48C31"
      operatorNames: {}
```

- [ ] **Step 3: Ensure config loader accepts the new fields**

If `data/packs/scripts/lib/loadConfig.mjs` validates `transitOverrides`, confirm `routeColors` and `directionTokens` are allowed. Add them if validation rejects unknown keys.

- [ ] **Step 4: Run config tests**

```bash
pnpm test:data:packs -- data/packs/scripts/lib/config.test.mjs
```

Expected: PASS.

---

## Task 9: Strengthen `pack-lint.mjs` transit checks

**Files:**

- Modify: `data/packs/scripts/pack-lint.mjs`

- [ ] **Step 1: Add per-operator route-count sanity bound**

Inside `lintTransit`, after iterating routes, add:

```javascript
const maxRoutesPerOperator = 200; // sane upper bound for any real operator
for (const preset of artifact.presets) {
    if (
        preset.kind === "operator" &&
        preset.routes.length > maxRoutesPerOperator
    ) {
        errors.push(
            `transit.json.gz: operator preset "${preset.id}" has ${preset.routes.length} routes (> ${maxRoutesPerOperator}) — possible per-train proliferation`,
        );
    }
}
```

- [ ] **Step 2: Ensure hex check is already present**

The existing `hexColorRe` test at lines 397–405 already validates route colors. Confirm it remains.

- [ ] **Step 3: Run lint on a built region (requires build first)**

Skipped until packs are regenerated.

---

## Task 10: Add tests for non-rail filtering and cross-operator coloring in pack builder

**Files:**

- Modify: `data/packs/scripts/lib/buildTransit.routes.test.mjs`

- [ ] **Step 1: Extend the OSM XML fixture with a non-rail node and a cross-operator station**

Add inside the `<osm>` block, before the relations:

```xml
  <node id="5" lat="52.4" lon="4.4">
    <tag k="public_transport" v="station"/>
    <tag k="name" v="Ferry Terminal"/>
    <tag k="operator" v="Test Operator"/>
  </node>
```

Add a second operator preset source:

```xml
  <node id="6" lat="52.0" lon="4.0">
    <tag k="railway" v="station"/>
    <tag k="name" v="Station A"/>
    <tag k="operator" v="Other Operator"/>
  </node>
```

Wait — node 1 already exists at the same coordinates with `operator="Test Operator"`. If we add node 6 with same name/location but different operator, dedup may merge them (same normalized name within 150 m). That's actually the desired cross-operator merge test. Add node 6 and a route for Other Operator that stops at node 6.

Add relation:

```xml
  <relation id="104">
    <tag k="route" v="train"/>
    <tag k="name" v="Other Line"/>
    <tag k="colour" v="#0000FF"/>
    <tag k="operator" v="Other Operator"/>
    <member type="node" ref="6" role="stop"/>
    <member type="node" ref="2" role="stop"/>
  </relation>
```

- [ ] **Step 2: Add assertions for non-rail skip and cross-operator routeIds**

Append inside the existing test:

```javascript
// Non-rail public_transport=station node should not appear.
const allStationIds = bundle.presets.flatMap((p) =>
    p.stations.map((s) => s.id),
);
assert.ok(
    !allStationIds.includes("osm:node:5"),
    "non-rail ferry terminal is filtered out",
);

// A station in one operator preset should still receive routeIds from
// routes whose members resolve to it via the shared station id.
const otherPreset = bundle.presets.find((p) => p.operator === "Other Operator");
if (otherPreset) {
    const crossStation = otherPreset.stations.find(
        (s) => s.id === "osm:node:6",
    );
    // Depending on dedup, node 6 may merge with node 1; assert at least
    // one copy in any preset carries the route.
    const anyWithRoute = bundle.presets.some((p) =>
        p.stations.some((s) => s.routeIds.includes("osm:relation:104")),
    );
    assert.ok(anyWithRoute, "cross-operator routeId is attached somewhere");
}
```

- [ ] **Step 3: Run pack route tests**

```bash
pnpm test:data:packs -- data/packs/scripts/lib/buildTransit.routes.test.mjs
```

Expected: PASS.

---

## Task 11: Add tests for Taiwan/NL suffix behavior in `osmStations.test.mjs`

**Files:**

- Modify: `data/transit/scripts/lib/osmStations.test.mjs`

- [ ] **Step 1: Add over-merge guard tests**

Append:

```javascript
it("Taiwan suffixes strip 站/車站 for normalization", () => {
    const feature = {
        id: 10,
        geometry: { type: "Point", coordinates: [121.5, 25.05] },
        properties: {
            tags: {
                name: "中山站",
                railway: "station",
            },
        },
    };
    const st = { skippedNoName: 0, skippedNoId: 0, skippedNonRailway: 0 };
    const rec = mapOsmNode(feature, "asia-taiwan", ["站", "車站"], st);
    assert.equal(rec.normalizedName, "中山");
});

it("does not merge different stations with shared suffix", () => {
    const records = [
        {
            id: "osm:node:100",
            name: "中山",
            lat: 25.05,
            lon: 121.5,
            normalizedName: "中山",
        },
        {
            id: "osm:node:101",
            name: "中山路",
            lat: 25.05,
            lon: 121.5,
            normalizedName: "中山路",
        },
    ];
    const { kept } = dedupeOsmStations(records);
    assert.equal(kept.length, 2);
});
```

- [ ] **Step 2: Run station tests**

```bash
pnpm test:data:transit -- data/transit/scripts/lib/osmStations.test.mjs
```

Expected: PASS.

---

## Task 12: Add tests for non-rail drop and cross-operator attach in `buildTransit.routes.test.mjs`

This is already covered in Task 10. Mark complete when Task 10 passes.

---

## Task 13: Japan regression — capture route counts and run full transit test suite

**Files:**

- Run commands only.

- [ ] **Step 1: Run Japan transit tests**

```bash
pnpm test:data:transit
```

Expected: PASS.

- [ ] **Step 2: Regenerate Japan bundles and capture per-operator route counts**

```bash
cp -r assets/transit assets/transit.before
pnpm data:transit -- --cache-only
diff -r assets/transit.before assets/transit > assets/transit.regression.diff || true
```

Expected: `pnpm test:data:transit` green. The diff should be reviewed; route counts per operator should not drop materially for distinct lines (JR East may improve by collapsing per-departure variants).

- [ ] **Step 3: Inspect the diff**

```bash
cat assets/transit.regression.diff | head -200
```

Expected: If changes are large, eyeball key files like `japan-kanto.json` to ensure lines are not over-merged.

---

## Task 14: Regenerate and publish Taiwan + Netherlands packs

**Files:**

- Generated: `data/packs/dist/asia-taiwan/*`, `data/packs/dist/europe-netherlands/*`
- Modified: `site/packs/catalog.json`

- [ ] **Step 1: Build Taiwan pack**

```bash
pnpm data:pack -- --region asia-taiwan
```

Expected: completes and emits `data/packs/dist/asia-taiwan/transit.json.gz`.

- [ ] **Step 2: Build Netherlands pack**

```bash
pnpm data:pack -- --region europe-netherlands
```

Expected: completes and emits `data/packs/dist/europe-netherlands/transit.json.gz`.

- [ ] **Step 3: Lint both packs**

```bash
pnpm data:pack:lint -- --region asia-taiwan
pnpm data:pack:lint -- --region europe-netherlands
```

Expected: both PASS.

- [ ] **Step 4: Eyeball in the data viewer**

```bash
node tools/data-viewer/server.mjs
```

Open the printed URL and verify:

- Taiwan station count dropped ~28% and no bus/ferry orphan names appear.
- 新北產業園區 shows yellow + purple rings.
- THSR appears as one logical line.
- Uncolored lines show distinct hues.

- [ ] **Step 5: Publish packs to GitHub Release and recommit catalog**

```bash
pnpm data:pack:publish -- --region asia-taiwan
pnpm data:pack:publish -- --region europe-netherlands
```

Expected: blobs upload, `site/packs/catalog.json` updates with new hashes/URLs.

---

## Task 15: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
pnpm check
pnpm test:data:transit
pnpm test:data:packs
```

Expected: all green.

- [ ] **Step 2: Commit changes**

```bash
git add \
  data/transit/scripts/lib/osmRoutes.mjs \
  data/transit/scripts/lib/attachRoutes.mjs \
  data/transit/scripts/lib/conflateStage.mjs \
  data/packs/scripts/lib/buildTransit.mjs \
  data/packs/regions.yaml \
  data/packs/scripts/pack-lint.mjs \
  data/transit/scripts/lib/osmRoutes.test.mjs \
  data/transit/scripts/lib/attachRoutes.test.mjs \
  data/packs/scripts/lib/buildTransit.routes.test.mjs \
  data/transit/scripts/lib/osmStations.test.mjs \
  site/packs/catalog.json \
  docs/superpowers/specs/2026-06-12-transit-station-route-quality-design.md \
  docs/superpowers/plans/2026-06-12-transit-station-route-quality-plan.md

git commit -m "feat(packs): T14 transit station + route quality improvements"
```

Expected: commit succeeds.

---

## Self-review checklist

- **Spec coverage:** §1 station ingestion → Tasks 5, 10, 11. §2 global attach → Tasks 4, 6, 7. §3 masterless collapse → Tasks 1, 2. §4 color resolution → Tasks 1, 3, 8. §5 tests/lint → Tasks 9, 10, 11, 13. §6 regenerate → Task 14.
- **Placeholder scan:** No TBD/TODO in steps. `routeColors` hexes are approximate and to be validated in viewer, not placeholders.
- **Type consistency:** `lineNameKey`, `resolveLineColor`, `attachRoutesToPresets` names are consistent. `mapOsmNode` record shape (`id` as `osm:node:…`) is used in `buildTransit.mjs`.
