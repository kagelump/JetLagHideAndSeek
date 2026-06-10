#!/usr/bin/env node
/**
 * Circular dependency check for CI.
 *
 * Guards against the require cycle that caused the all-NaN body-of-water
 * incident: geojson → geometryBackend → geosGeometryBackend → bufferProjection → geojson.
 *
 * Uses madge to detect circular dependencies in src/. Type-only import cycles
 * (import type { ... }) are false positives at runtime but still flagged by
 * madge — we whitelist the known geometry ↔ geosGeometryBackend type-import
 * cycle and fail on any NEW cycles.
 *
 * See docs/native-geometry/PLAN-regression-guards.md §W7.
 */

import { execSync } from "node:child_process";
import process from "node:process";

// Known false-positive cycles (type-only imports that madge flags but don't
// cause runtime issues). Each entry is a regex matching the cycle description.
const KNOWN_CYCLES = [
    // geometryBackend.ts ↔ geosGeometryBackend.ts: the GeometryBackend
    // interface is imported via `import type` (erased at compile time).
    /geometryBackend\.ts > geosGeometryBackend\.ts$/,
];

try {
    const output = execSync(
        "npx madge --circular --extensions ts,tsx --json src/",
        {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        },
    );

    const result = JSON.parse(output);
    const cycles = result.circular || [];

    if (cycles.length === 0) {
        console.log("✓ No circular dependencies found.");
        process.exit(0);
    }

    // Filter out known false positives.
    const newCycles = cycles.filter((cycle) => {
        const chain = cycle.join(" > ");
        return !KNOWN_CYCLES.some((pattern) => pattern.test(chain));
    });

    if (newCycles.length === 0) {
        console.log(
            `✓ No new circular dependencies (${cycles.length} known cycle(s) whitelisted).`,
        );
        process.exit(0);
    }

    console.error(
        `✖ Found ${newCycles.length} new circular dependency(ies):\n`,
    );
    newCycles.forEach((cycle, i) => {
        console.error(`  ${i + 1}) ${cycle.join(" > ")}`);
    });
    console.error(
        "\nCircular dependencies can cause undefined exports under Hermes' " +
            "module init order. Fix the cycle or add it to KNOWN_CYCLES in " +
            "scripts/check-circular-deps.mjs if it's a type-only import.",
    );
    process.exit(1);
} catch (err) {
    // madge exits non-zero when cycles are found; parse its stdout.
    if (err.stdout) {
        try {
            const result = JSON.parse(err.stdout);
            const cycles = result.circular || [];

            const newCycles = cycles.filter((cycle) => {
                const chain = cycle.join(" > ");
                return !KNOWN_CYCLES.some((pattern) => pattern.test(chain));
            });

            if (newCycles.length === 0) {
                console.log(
                    `✓ No new circular dependencies (${cycles.length} known cycle(s) whitelisted).`,
                );
                process.exit(0);
            }

            console.error(
                `✖ Found ${newCycles.length} new circular dependency(ies):\n`,
            );
            newCycles.forEach((cycle, i) => {
                console.error(`  ${i + 1}) ${cycle.join(" > ")}`);
            });
            console.error(
                "\nCircular dependencies can cause undefined exports under Hermes' " +
                    "module init order. Fix the cycle or add it to KNOWN_CYCLES in " +
                    "scripts/check-circular-deps.mjs if it's a type-only import.",
            );
            process.exit(1);
        } catch {
            // JSON parse failed; show raw output.
            console.error(err.stdout);
            process.exit(1);
        }
    }

    console.error("madge failed:", err.message);
    process.exit(1);
}
