# Train Route Pipeline — Tasks 1, 2, 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement stop-order detection + repair (Task 1), per-relation exception config (Task 2), and stop-position resolution audit (Task 3) in the transit pipeline.

**Architecture:** A new `stopOrderRepair.mjs` module provides `detectImplausibleJumps` and `repairStopOrder` utilities. `osmRoutes.mjs` calls repair after per-variant stop resolution; `gtfs.mjs` runs detection as warn-only. Config overrides are validated in `config.mjs` and applied in `osmRoutes.mjs`. Spatial-fallback ambiguity logging is added to `osmRoutes.mjs` and surfaced in the build report.

**Tech Stack:** Node.js 20+, native `node:test`/`node:assert/strict`, ES modules (`.mjs`), haversine distance from `grid.mjs`.

---

## File Structure

| File                                                | Action     | Responsibility                                                                                                |
| --------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `data/transit/scripts/lib/stopOrderRepair.mjs`      | **Create** | `detectImplausibleJumps`, `repairStopOrder`, `totalPathLengthM`                                               |
| `data/transit/scripts/lib/stopOrderRepair.test.mjs` | **Create** | Node --test suite with 5 fixtures                                                                             |
| `data/transit/scripts/lib/osmRoutes.mjs`            | **Modify** | Call repair after variant resolution; apply overrides; log ambiguous/weak spatial fallbacks; new stats fields |
| `data/transit/scripts/lib/gtfs.mjs`                 | **Modify** | Warn-only jump detection on GTFS-derived sequences                                                            |
| `data/transit/scripts/lib/config.mjs`               | **Modify** | Validate `overrides.relations` structure                                                                      |
| `data/transit/scripts/lib/config.test.mjs`          | **Modify** | Add override validation tests                                                                                 |
| `data/transit/scripts/lib/osmStage.mjs`             | **Modify** | Store `osmRouteStats` on `ctx`                                                                                |
| `data/transit/scripts/lib/conflateStage.mjs`        | **Modify** | Surface new stats in build report                                                                             |
| `data/transit/config.yaml`                          | **Modify** | Add empty `overrides:` scaffold                                                                               |
| `data/transit/PLAYBOOK.md`                          | **Modify** | Document override workflow                                                                                    |

---

## Shared geometry helpers

All distance calculations use the existing `haversineM` from `grid.mjs`:

```js
import { haversineM } from "./grid.mjs";
```

A stop object for the repair module is `{ id: string, lat: number, lon: number }`.
A gap is "implausible" when `gap > max(20_000, 4 * medianGap)`.

---

## Task 1: Stop-order detection + repair

### Task 1.1: Create `stopOrderRepair.mjs`

**File:** `data/transit/scripts/lib/stopOrderRepair.mjs`

- [ ] **Step 1.1.1: Write the module**

```js
import { haversineM } from "./grid.mjs";

const ABS_THRESHOLD_M = 20_000; // 20 km
const RELATIVE_MULTIPLIER = 4;
const DEFAULT_MAX_REPAIRS = 3;

function totalPathLengthM(stops) {
    let total = 0;
    for (let i = 1; i < stops.length; i++) {
        total += haversineM(
            stops[i - 1].lat,
            stops[i - 1].lon,
            stops[i].lat,
            stops[i].lon,
        );
    }
    return total;
}

/**
 * Detect indices of implausible gaps in a stop sequence.
 * A gap at index i is between stops[i] and stops[i+1].
 *
 * @param {{lat:number, lon:number}[]} stops
 * @returns {number[]} indices of gaps that exceed the threshold
 */
export function detectImplausibleJumps(stops) {
    if (stops.length < 3) return [];

    const gaps = [];
    for (let i = 0; i < stops.length - 1; i++) {
        gaps.push(
            haversineM(
                stops[i].lat,
                stops[i].lon,
                stops[i + 1].lat,
                stops[i + 1].lon,
            ),
        );
    }

    const sorted = [...gaps].sort((a, b) => a - b);
    const median =
        sorted.length % 2 === 1
            ? sorted[Math.floor(sorted.length / 2)]
            : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

    const threshold = Math.max(ABS_THRESHOLD_M, RELATIVE_MULTIPLIER * median);

    const flagged = [];
    for (let i = 0; i < gaps.length; i++) {
        if (gaps[i] > threshold) {
            flagged.push(i);
        }
    }
    return flagged;
}

/**
 * Repair a stop sequence by minimally reinserting outlier stops.
 *
 * @param {{id:string, lat:number, lon:number}[]} stops
 * @param {{maxRepairs?:number}} opts
 * @returns {{stops:{id:string, lat:number, lon:number}[], repaired:boolean, warnings:string[]}}
 */
export function repairStopOrder(
    stops,
    { maxRepairs = DEFAULT_MAX_REPAIRS } = {},
) {
    const warnings = [];
    if (stops.length < 3) {
        return { stops: [...stops], repaired: false, warnings };
    }

    let working = [...stops];
    let repairsDone = 0;
    let anyRepaired = false;

    while (repairsDone < maxRepairs) {
        const flagged = detectImplausibleJumps(working);
        if (flagged.length === 0) break;

        // Pick the largest flagged gap to repair first.
        let bestGapIndex = flagged[0];
        let bestGapDist = -1;
        for (const idx of flagged) {
            const d = haversineM(
                working[idx].lat,
                working[idx].lon,
                working[idx + 1].lat,
                working[idx + 1].lon,
            );
            if (d > bestGapDist) {
                bestGapDist = d;
                bestGapIndex = idx;
            }
        }

        const originalLength = totalPathLengthM(working);

        // Candidates: the stop before the gap, or the stop after the gap.
        const candidates = [];
        if (bestGapIndex >= 0) {
            candidates.push(bestGapIndex);
        }
        if (bestGapIndex + 1 < working.length) {
            candidates.push(bestGapIndex + 1);
        }

        let bestRepair = null;

        for (const idx of candidates) {
            const removed = working[idx];
            const otherStop =
                working[bestGapIndex === idx ? bestGapIndex + 1 : bestGapIndex];
            const remainder = working.filter((_, i) => i !== idx);

            for (let pos = 0; pos <= remainder.length; pos++) {
                const trial = [
                    ...remainder.slice(0, pos),
                    removed,
                    ...remainder.slice(pos),
                ];
                const trialLength = totalPathLengthM(trial);

                // The original flagged gap is eliminated if the two stops are no longer adjacent.
                const removedIdx = trial.findIndex((s) => s.id === removed.id);
                const otherIdx = trial.findIndex((s) => s.id === otherStop.id);
                const gapGone = Math.abs(removedIdx - otherIdx) !== 1;

                if (!gapGone) continue;
                if (trialLength >= originalLength) continue;

                if (!bestRepair || trialLength < bestRepair.newLength) {
                    bestRepair = {
                        indexToRemove: idx,
                        insertAt: pos,
                        newLength: trialLength,
                    };
                }
            }
        }

        if (!bestRepair) {
            warnings.push(
                `Gap at index ${bestGapIndex} (${(bestGapDist / 1000).toFixed(1)} km) could not be repaired.`,
            );
            break;
        }

        const removed = working[bestRepair.indexToRemove];
        const remainder = working.filter(
            (_, i) => i !== bestRepair.indexToRemove,
        );
        working = [
            ...remainder.slice(0, bestRepair.insertAt),
            removed,
            ...remainder.slice(bestRepair.insertAt),
        ];

        repairsDone++;
        anyRepaired = true;
    }

    const remaining = detectImplausibleJumps(working);
    if (remaining.length > 0 && repairsDone >= maxRepairs) {
        warnings.push(
            `Unrepairable: ${remaining.length} implausible gap(s) remain after ${repairsDone} repair(s).`,
        );
    }

    return { stops: working, repaired: anyRepaired, warnings };
}
```

- [ ] **Step 1.1.2: Verify the module loads**

Run: `node --input-type=module -e "import { detectImplausibleJumps, repairStopOrder } from './data/transit/scripts/lib/stopOrderRepair.mjs'; console.log('ok')"`
Expected: `ok`

### Task 1.2: Create `stopOrderRepair.test.mjs`

**File:** `data/transit/scripts/lib/stopOrderRepair.test.mjs`

- [ ] **Step 1.2.1: Write the test suite**

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectImplausibleJumps, repairStopOrder } from "./stopOrderRepair.mjs";

describe("detectImplausibleJumps", () => {
    it("flags an outlier appended at the end of a route", () => {
        const stops = [];
        for (let i = 0; i < 20; i++) {
            stops.push({ id: `s${i}`, lat: 35.0 + i * 0.009, lon: 139.0 });
        }
        stops.push({ id: "outlier", lat: 35.0 + 19 * 0.009 + 0.6, lon: 139.0 });

        const flagged = detectImplausibleJumps(stops);
        assert.deepEqual(flagged, [19], "Should flag the final gap");
    });

    it("does not flag a loop route with consistent spacing", () => {
        const stops = [];
        for (let i = 0; i < 30; i++) {
            const angle = (i / 30) * 2 * Math.PI;
            const r = 0.16;
            stops.push({
                id: `s${i}`,
                lat: 35.0 + r * Math.sin(angle),
                lon: 139.0 + r * Math.cos(angle),
            });
        }
        const flagged = detectImplausibleJumps(stops);
        assert.equal(
            flagged.length,
            0,
            "Loop route should have no flagged gaps",
        );
    });

    it("does not flag a limited-express variant with uniformly long gaps", () => {
        const stops = [];
        for (let i = 0; i < 10; i++) {
            stops.push({ id: `s${i}`, lat: 35.0 + i * 0.072, lon: 139.0 });
        }
        const flagged = detectImplausibleJumps(stops);
        assert.equal(
            flagged.length,
            0,
            "Uniform long gaps should not be flagged",
        );
    });
});

describe("repairStopOrder", () => {
    it("repairs an outlier appended at the end (春日部-like case)", () => {
        const stops = [];
        for (let i = 0; i < 20; i++) {
            stops.push({ id: `s${i}`, lat: 35.0 + i * 0.009, lon: 139.0 });
        }
        const outlier = {
            id: "kasukabe",
            lat: 35.0 + 9 * 0.009 + 0.005,
            lon: 139.0,
        };
        stops.push(outlier);

        const {
            stops: repaired,
            repaired: wasRepaired,
            warnings,
        } = repairStopOrder(stops);
        assert.equal(wasRepaired, true);
        assert.equal(repaired.length, stops.length);
        assert.notEqual(repaired[repaired.length - 1].id, "kasukabe");
        assert.equal(detectImplausibleJumps(repaired).length, 0);
    });

    it("rejects repair for a reversed mid-route block", () => {
        const a = { id: "a", lat: 35.0, lon: 139.0 };
        const b = { id: "b", lat: 35.01, lon: 139.0 };
        const c = { id: "c", lat: 35.02, lon: 139.0 };
        const d = { id: "d", lat: 35.03, lon: 139.0 };
        const e = { id: "e", lat: 35.04, lon: 139.0 };
        const f = { id: "f", lat: 35.05, lon: 139.0 };
        const stops = [a, b, e, d, c, f];

        const { stops: result, repaired, warnings } = repairStopOrder(stops);
        assert.equal(repaired, false, "Reversed block should not be repaired");
        assert.deepEqual(
            result.map((s) => s.id),
            ["a", "b", "e", "d", "c", "f"],
        );
        assert.ok(warnings.length > 0, "Should emit a warning");
    });

    it("leaves an already-correct route unchanged", () => {
        const stops = [];
        for (let i = 0; i < 15; i++) {
            stops.push({ id: `s${i}`, lat: 35.0 + i * 0.009, lon: 139.0 });
        }
        const { stops: result, repaired, warnings } = repairStopOrder(stops);
        assert.equal(repaired, false);
        assert.deepEqual(
            result.map((s) => s.id),
            stops.map((s) => s.id),
        );
        assert.equal(warnings.length, 0);
    });

    it("caps repairs at maxRepairs and marks unrepairable", () => {
        const stops = [];
        for (let i = 0; i < 10; i++) {
            stops.push({ id: `s${i}`, lat: 35.0 + i * 0.009, lon: 139.0 });
        }
        stops.push({ id: "bad1", lat: 35.0 + 3 * 0.009 + 0.005, lon: 139.0 });
        stops.push({ id: "bad2", lat: 35.0 + 5 * 0.009 + 0.005, lon: 139.0 });

        const {
            stops: result,
            repaired,
            warnings,
        } = repairStopOrder(stops, { maxRepairs: 1 });
        assert.equal(repaired, true, "Should repair at least one");
        assert.ok(
            warnings.some((w) => w.includes("Unrepairable")),
            "Should warn about unrepairable remainder",
        );
    });
});
```

- [ ] **Step 1.2.2: Run tests**

Run: `node --test data/transit/scripts/lib/stopOrderRepair.test.mjs`
Expected: All 6 tests pass.

### Task 1.3: Wire repair into `osmRoutes.mjs`

**File:** `data/transit/scripts/lib/osmRoutes.mjs`

- [ ] **Step 1.3.1: Add import**

After line 11 (`import { haversineM } from "./grid.mjs";`), add:

```js
import { detectImplausibleJumps, repairStopOrder } from "./stopOrderRepair.mjs";
```

- [ ] **Step 1.3.2: Extend stats object**

In `processOsmRoutes`, replace the `stats` object (lines 29–37) with:

```js
const stats = {
    totalRelations: 0,
    masterCount: 0,
    masterlessCount: 0,
    linesKept: 0,
    linesDroppedGtfs: 0,
    unresolvedStops: 0,
    linesTooFewStations: 0,
    detectedJumps: 0,
    repairedStops: 0,
    unrepairableVariants: 0,
    ambiguousMatches: 0,
    weakMatches: 0,
};
```

- [ ] **Step 1.3.3: Pass `relationOverrides` through to `buildLine`**

Modify the first `buildLine` call (lines 96–104):

```js
const line = buildLine(
    master,
    allRouteRels,
    stationById,
    stationByName,
    localeConfig,
    stats,
    nodeCoords,
    localeConfig.overrides?.relations,
);
```

Modify the second `buildLine` call (lines 117–125):

```js
const line = buildLine(
    route,
    [route],
    stationById,
    stationByName,
    localeConfig,
    stats,
    nodeCoords,
    localeConfig.overrides?.relations,
);
```

- [ ] **Step 1.3.4: Update `buildLine` signature**

Replace the `buildLine` function signature (line 274) with:

```js
function buildLine(
    primaryRel,
    variants,
    stationById,
    stationByName,
    localeConfig,
    stats,
    nodeCoords,
    relationOverrides = {},
) {
```

- [ ] **Step 1.3.5: Add override application + repair logic**

After the variant member-resolution loop (after line 402, before `// Build one LineString`), insert:

```js
// Apply explicit stop-order override if present.
const relId = rel.id ?? rel.properties?.["@id"];
const relOverride = relId ? relationOverrides[String(relId)] : undefined;
if (relOverride?.stopOrder) {
    const ordered = [];
    for (const sid of relOverride.stopOrder) {
        if (variantStationIds.includes(sid)) {
            ordered.push(sid);
        }
    }
    for (const sid of variantStationIds) {
        if (!ordered.includes(sid)) ordered.push(sid);
    }
    variantStationIds.length = 0;
    variantStationIds.push(...ordered);

    // Warn if the override doesn't match any resolved stops (stale).
    if (ordered.length === 0) {
        console.warn(
            `  [osmRoutes] Stale stopOrder override for relation ${relId}: ` +
                `none of the ${relOverride.stopOrder.length} specified IDs matched resolved stops`,
        );
    }
}

// Stop-order detection and repair.
const variantStops = variantStationIds
    .map((sid) => {
        const s = stationById.get(sid);
        return s ? { id: sid, lat: s.lat, lon: s.lon } : null;
    })
    .filter(Boolean);

if (variantStops.length >= 3) {
    const flagged = detectImplausibleJumps(variantStops);
    if (flagged.length > 0) {
        stats.detectedJumps += flagged.length;

        if (relOverride?.suppressJumpWarning) {
            // Silently skip repair and warning.
        } else {
            const repairResult = repairStopOrder(variantStops, {
                maxRepairs: 3,
            });
            if (repairResult.repaired) {
                let movedCount = 0;
                for (let i = 0; i < variantStops.length; i++) {
                    if (variantStops[i].id !== repairResult.stops[i].id)
                        movedCount++;
                }
                stats.repairedStops += movedCount;
                variantStationIds.length = 0;
                variantStationIds.push(...repairResult.stops.map((s) => s.id));
                console.warn(
                    `  [osmRoutes] Repaired stop order for relation ${relId || "?"} ` +
                        `(${movedCount} stop(s) reordered)`,
                );
            } else {
                stats.unrepairableVariants++;
                for (const w of repairResult.warnings) {
                    console.warn(
                        `  [osmRoutes] Stop-order warning for relation ${relId || "?"}: ${w}`,
                    );
                }
            }
        }
    }
}
```

- [ ] **Step 1.3.6: Run OSM route tests**

Run: `node --test data/transit/scripts/lib/osmRoutes.test.mjs`
Expected: Existing 4 tests pass.

### Task 1.4: Wire warn-only detection into `gtfs.mjs`

**File:** `data/transit/scripts/lib/gtfs.mjs`

- [ ] **Step 1.4.1: Add import**

After the existing imports (after line 12), add:

```js
import { detectImplausibleJumps } from "./stopOrderRepair.mjs";
```

- [ ] **Step 1.4.2: Add detection in `buildRouteCoordsFromStops`**

After the `linesBySignature.set(...)` block (around line 567–573), before the `if (stopTimes.length < 2) continue;` check, insert:

```js
// Warn-only jump detection on GTFS-derived sequences.
const stopObjects = stopTimes.map((st) => {
    const stop = stopsById.get(st.stopId);
    return { lat: Number(stop.stop_lat), lon: Number(stop.stop_lon) };
});
const flagged = detectImplausibleJumps(stopObjects);
if (flagged.length > 0) {
    console.warn(
        `  [gtfs] Route ${routeId} trip ${trip.trip_id}: ` +
            `${flagged.length} implausible gap(s) at position(s) ${flagged.join(", ")}`,
    );
}
```

- [ ] **Step 1.4.3: Run GTFS tests**

Run: `node --test data/transit/scripts/lib/gtfs.test.mjs`
Expected: All existing tests pass.

### Task 1.5: Surface stats in build report

**File:** `data/transit/scripts/lib/osmStage.mjs`

- [ ] **Step 1.5.1: Store OSM route stats on `ctx`**

Replace lines 474–485:

```js
const result = processOsmRoutes(
    allRelations,
    allStationRecords,
    ctx.locale,
    allNodeCoords,
);
ctx.osmRouteLines = result.lines;
ctx.osmRouteStats = result.stats;
console.log(
    `[osm/routes] ${result.stats.totalRelations} relations → ${result.stats.linesKept} lines ` +
        `(${result.stats.linesDroppedGtfs} dropped via operator gating, ` +
        `${result.stats.linesTooFewStations} too few stations)` +
        (result.stats.detectedJumps > 0
            ? `, ${result.stats.detectedJumps} jump(s) detected, ${result.stats.repairedStops} repaired, ${result.stats.unrepairableVariants} unrepairable`
            : ""),
);
```

**File:** `data/transit/scripts/lib/conflateStage.mjs`

- [ ] **Step 1.5.2: Pass OSM stats to `writeBuildReport`**

Replace the `writeBuildReport` call (line 319) with:

```js
await writeBuildReport(ctx, {
    seeds: seeds.length,
    looseRecords: allLoose.length,
    attachments: attachments.length,
    standalone: standaloneStations.length,
    nearMisses,
    enrichedSeeds,
    osmBaselinePresets,
    osmRouteStats: ctx.osmRouteStats,
});
```

- [ ] **Step 1.5.3: Update `writeBuildReport` to include stop-order stats**

Replace the `writeBuildReport` function (lines 499–545) with:

```js
async function writeBuildReport(ctx, data) {
    const reportDir = resolve(ctx.transitDir, "report");
    await mkdir(reportDir, { recursive: true });

    const lines = [];
    lines.push(`# Build Report — ${ctx.locale.id}`);
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");
    lines.push("## Summary");
    lines.push("");
    lines.push(`- Seeds (GTFS stations): ${data.seeds}`);
    lines.push(`- OSM records: ${data.looseRecords}`);
    lines.push(`- Attachments: ${data.attachments}`);
    lines.push(`- Standalone stations: ${data.standalone}`);
    lines.push(`- Near-misses: ${data.nearMisses.length}`);
    lines.push(`- OSM baseline presets: ${data.osmBaselinePresets.length}`);
    lines.push("");

    if (data.osmRouteStats) {
        lines.push("## OSM route stats");
        lines.push("");
        lines.push(`- Total relations: ${data.osmRouteStats.totalRelations}`);
        lines.push(`- Lines kept: ${data.osmRouteStats.linesKept}`);
        lines.push(
            `- Lines dropped (GTFS-sourced): ${data.osmRouteStats.linesDroppedGtfs}`,
        );
        lines.push(
            `- Lines too few stations: ${data.osmRouteStats.linesTooFewStations}`,
        );
        lines.push(`- Unresolved stops: ${data.osmRouteStats.unresolvedStops}`);
        lines.push(`- Detected jumps: ${data.osmRouteStats.detectedJumps}`);
        lines.push(`- Repaired stops: ${data.osmRouteStats.repairedStops}`);
        lines.push(
            `- Unrepairable variants: ${data.osmRouteStats.unrepairableVariants}`,
        );
        lines.push(
            `- Ambiguous spatial matches: ${data.osmRouteStats.ambiguousMatches}`,
        );
        lines.push(`- Weak spatial matches: ${data.osmRouteStats.weakMatches}`);
        lines.push("");
    }

    if (data.nearMisses.length > 0) {
        lines.push("## Near-misses (aliases review queue)");
        lines.push("");
        const sorted = [...data.nearMisses].sort((a, b) => a.distM - b.distM);
        for (const nm of sorted.slice(0, 50)) {
            lines.push(
                `- \`${nm.looseName}\` ↔ \`${nm.seedName}\` — ${nm.distM}m ` +
                    `(loose=${nm.looseId}, seed=${nm.seedId})`,
            );
        }
        if (sorted.length > 50) {
            lines.push(`- ... and ${sorted.length - 50} more`);
        }
        lines.push("");
    }

    lines.push("## Per-preset counts");
    lines.push("");
    for (const preset of data.osmBaselinePresets) {
        lines.push(`- **${preset.id}**: ${preset.stations.length} stations`);
    }
    lines.push("");

    await writeFile(join(reportDir, `${ctx.locale.id}.md`), lines.join("\n"));
    console.log(
        `  [conflate] Build report: ${join(reportDir, `${ctx.locale.id}.md`)}`,
    );
}
```

---

## Task 2: Per-relation exception config

### Task 2.1: Add overrides scaffold to config.yaml

**File:** `data/transit/config.yaml`

- [ ] **Step 2.1.1: Add empty overrides section**

After line 12 (`maxClusterMeters: 150`), add:

```yaml
overrides:
    relations: {}
```

The final block should look like:

```yaml
locales:
    - id: japan
      nameSuffixes: ["駅"]
      maxClusterMeters: 150
      overrides:
          relations: {}
```

### Task 2.2: Validate overrides in `config.mjs`

**File:** `data/transit/scripts/lib/config.mjs`

- [ ] **Step 2.2.1: Add override validation**

After the operators validation block (after line 176), before `return errors;`, add:

```js
// Validate overrides.
if (loc.overrides !== undefined) {
    if (
        typeof loc.overrides !== "object" ||
        loc.overrides === null ||
        Array.isArray(loc.overrides)
    ) {
        errors.push(`${prefix}: "overrides" must be an object when present`);
    } else {
        if (loc.overrides.relations !== undefined) {
            if (
                typeof loc.overrides.relations !== "object" ||
                loc.overrides.relations === null ||
                Array.isArray(loc.overrides.relations)
            ) {
                errors.push(
                    `${prefix}: "overrides.relations" must be an object`,
                );
            } else {
                for (const [relId, relOverride] of Object.entries(
                    loc.overrides.relations,
                )) {
                    if (!/^\d+$/.test(String(relId))) {
                        errors.push(
                            `${prefix}: overrides.relations key "${relId}" must be a numeric relation ID`,
                        );
                    }
                    if (
                        relOverride.stopOrder !== undefined &&
                        !Array.isArray(relOverride.stopOrder)
                    ) {
                        errors.push(
                            `${prefix}: overrides.relations[${relId}].stopOrder must be an array`,
                        );
                    }
                    if (
                        relOverride.suppressJumpWarning !== undefined &&
                        typeof relOverride.suppressJumpWarning !== "boolean"
                    ) {
                        errors.push(
                            `${prefix}: overrides.relations[${relId}].suppressJumpWarning must be a boolean`,
                        );
                    }
                }
            }
        }
    }
}
```

### Task 2.3: Add override validation tests

**File:** `data/transit/scripts/lib/config.test.mjs`

- [ ] **Step 2.3.1: Add tests**

After the last test in the `validateConfig` describe block (after line 268), add:

```js
it("accepts valid overrides", () => {
    const cfg = {
        locales: [
            {
                id: "jp",
                maxClusterMeters: 150,
                overrides: {
                    relations: {
                        12345: { suppressJumpWarning: true },
                        67890: { stopOrder: ["osm:node:1", "osm:node:2"] },
                    },
                },
            },
        ],
    };
    assert.deepEqual(validateConfig(cfg), []);
});

it("rejects non-numeric relation override keys", () => {
    const cfg = {
        locales: [
            {
                id: "jp",
                maxClusterMeters: 150,
                overrides: {
                    relations: {
                        "not-a-number": { suppressJumpWarning: true },
                    },
                },
            },
        ],
    };
    const errors = validateConfig(cfg);
    assert.ok(errors.some((e) => e.includes("numeric relation ID")));
});

it("rejects non-array stopOrder", () => {
    const cfg = {
        locales: [
            {
                id: "jp",
                maxClusterMeters: 150,
                overrides: {
                    relations: { 123: { stopOrder: "not-an-array" } },
                },
            },
        ],
    };
    const errors = validateConfig(cfg);
    assert.ok(errors.some((e) => e.includes("stopOrder must be an array")));
});

it("rejects non-boolean suppressJumpWarning", () => {
    const cfg = {
        locales: [
            {
                id: "jp",
                maxClusterMeters: 150,
                overrides: {
                    relations: { 123: { suppressJumpWarning: "yes" } },
                },
            },
        ],
    };
    const errors = validateConfig(cfg);
    assert.ok(
        errors.some((e) => e.includes("suppressJumpWarning must be a boolean")),
    );
});
```

- [ ] **Step 2.3.2: Run config tests**

Run: `node --test data/transit/scripts/lib/config.test.mjs`
Expected: All tests pass (including new ones).

### Task 2.4: Document override workflow in PLAYBOOK.md

**File:** `data/transit/PLAYBOOK.md`

- [ ] **Step 2.4.1: Add override documentation**

Append to the end of the file:

````markdown
## Overriding OSM relation data

When a relation has data issues that the pipeline repair can't fix and upstream
OSM edits haven't propagated, add an explicit override instead of editing the
pipeline code.

### When to override vs fix upstream

- **Fix upstream in OSM** for: wrong stop order, missing stations, incorrect
  colors, outdated route geometry. These benefit all OSM consumers.
- **Override in config** for: persistent upstream issues that haven't been
  fixed after a reasonable time, or cases where the "correct" data is disputed.

### Override types

In `data/transit/config.yaml`, under `locales[<locale>].overrides.relations`:

```yaml
overrides:
    relations:
        "12185878":
            suppressJumpWarning: true
        "12345678":
            stopOrder: ["osm:node:123", "osm:node:456", "osm:node:789"]
```
````

- `suppressJumpWarning: true` — Skip the implausible-jump check for this
  relation. Use when the large gap is legitimate (e.g. a ferry connection,
  limited express with very sparse stops).
- `stopOrder: [...]` — Explicit ordered list of station IDs. Resolved stops
  not in this list are appended at the end. Use when member order is wrong and
  the correct order is known.

### Stale override detection

The pipeline warns when a `stopOrder` override no longer matches any resolved
stops (e.g. after an upstream node ID change). Review and update or remove
the override.

````

---

## Task 3: Stop-position resolution audit

### Task 3.1: Log ambiguous/weak spatial fallbacks

**File:** `data/transit/scripts/lib/osmRoutes.mjs`

- [ ] **Step 3.1.1: Enhance spatial fallback logging**

Replace the spatial fallback block in `buildLine()` (lines 337–378) with:

```js
            } else if (
                nodeCoords &&
                nodeCoords.has(
                    typeof ref === "number" ? ref : parseInt(ref, 10),
                )
            ) {
                const nid = typeof ref === "number" ? ref : parseInt(ref, 10);
                const nc = nodeCoords.get(nid);
                const maxDist = (localeConfig.maxClusterMeters ?? 150) * 2;
                let bestEffectiveDist = Infinity;
                let bestStationId = null;
                let secondBestEffectiveDist = Infinity;
                const candidates = [];

                for (const station of stationById.values()) {
                    if (!station.name) continue;
                    const dist = haversineM(
                        nc.lat,
                        nc.lon,
                        station.lat,
                        station.lon,
                    );
                    if (dist >= maxDist) continue;
                    const railway = station.tags?.railway;
                    const penalty =
                        railway === "station"
                            ? 0
                            : railway === "halt"
                              ? 25
                              : 50;
                    const effectiveDist = dist + penalty;
                    candidates.push({ stationId: station.id, effectiveDist, dist });
                    if (effectiveDist < bestEffectiveDist) {
                        secondBestEffectiveDist = bestEffectiveDist;
                        bestEffectiveDist = effectiveDist;
                        bestStationId = station.id;
                    } else if (effectiveDist < secondBestEffectiveDist) {
                        secondBestEffectiveDist = effectiveDist;
                    }
                }

                if (bestStationId) {
                    resolvedId = bestStationId;

                    // Ambiguous: second-best is within 10% of best.
                    if (secondBestEffectiveDist !== Infinity &&
                        secondBestEffectiveDist <= bestEffectiveDist * 1.1) {
                        stats.ambiguousMatches++;
                        console.warn(
                            `  [osmRoutes] Ambiguous spatial match for relation ${relId || "?"} ` +
                                `stop node ${nid}: best=${bestStationId} (${bestEffectiveDist.toFixed(0)}m), ` +
                                `second=${candidates.find((c) => c.effectiveDist === secondBestEffectiveDist)?.stationId || "?"} ` +
                                `(${secondBestEffectiveDist.toFixed(0)}m)`
                        );
                    }

                    // Weak: best is near the max distance threshold (>80%).
                    if (bestEffectiveDist > maxDist * 0.8) {
                        stats.weakMatches++;
                        console.warn(
                            `  [osmRoutes] Weak spatial match for relation ${relId || "?"} ` +
                                `stop node ${nid}: ${bestStationId} at ${bestEffectiveDist.toFixed(0)}m ` +
                                `(threshold ${maxDist}m)`
                        );
                    }
                } else {
                    stats.unresolvedStops++;
                }
````

Note: `relId` is already computed earlier in the variant loop (from Step 1.3.5). If `relId` is not in scope here, add `const relId = rel.id ?? rel.properties?.["@id"];` at the top of the `for (const rel of variants)` loop (before the members loop).

- [ ] **Step 3.1.2: Run OSM route tests**

Run: `node --test data/transit/scripts/lib/osmRoutes.test.mjs`
Expected: All tests pass.

---

## Integration verification

- [ ] **Step I.1: Run full pipeline test suite**

Run: `pnpm test:data:transit`
Expected: All tests pass.

- [ ] **Step I.2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step I.3: Run lint**

Run: `pnpm lint`
Expected: No errors.

- [ ] **Step I.4: Regenerate bundles (cache-only)**

Run: `pnpm data:transit -- --cache-only`
Expected: Completes successfully. Review console warnings for jump detections, repairs, ambiguous matches, and weak matches. Review the build report at `data/transit/report/japan.md`.

- [ ] **Step I.5: Review bundle diff in data viewer**

Run: `node tools/data-viewer/server.mjs`
Open the viewer and inspect the transit bundles for any visible improvements or regressions in route geometry.

---

## Spec coverage check

| Spec requirement                                                              | Task / Step                                              |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| `detectImplausibleJumps` — gap > max(20km, 4× median)                         | Task 1.1                                                 |
| `repairStopOrder` — cheapest reinsertion, acceptance gate, cap at 3           | Task 1.1                                                 |
| Repair wired into `osmRoutes.mjs` after variant resolution                    | Task 1.3                                                 |
| GTFS warn-only detection                                                      | Task 1.4                                                 |
| Build report stats (`detectedJumps`, `repairedStops`, `unrepairableVariants`) | Task 1.5                                                 |
| Config overrides (`suppressJumpWarning`, `stopOrder`)                         | Task 2.1, 2.2                                            |
| Override validation                                                           | Task 2.2, 2.3                                            |
| Override application in `osmRoutes.mjs`                                       | Task 1.3.5 (stopOrder), Task 1.3.5 (suppressJumpWarning) |
| Stale override warning                                                        | Task 1.3.5                                               |
| PLAYBOOK.md documentation                                                     | Task 2.4                                                 |
| Ambiguous spatial fallback logging                                            | Task 3.1                                                 |
| Weak spatial match logging                                                    | Task 3.1                                                 |
| Build report surfacing of ambiguity/weak counts                               | Task 1.5.3                                               |

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-11-train-route-tasks-1-2-3.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
