#!/usr/bin/env node
/* global Buffer, process, console */

/**
 * Build a test-only deep link from a scenario JSON file:
 *
 *   node scripts/e2e/build-scenario-link.mjs e2e/scenarios/smoke-seed.json
 *   → jetlag-hide-seek-v2://e2e?d=eyJraW5kIjoi...
 *
 * Encoding mirrors `src/testing/e2e/parseE2eLink.ts`:
 * `base64url(utf8(JSON.stringify(scenario)))`, no gzip. Node's `base64url`
 * Buffer encoding is byte-compatible with the app's `base64UrlToBytes`
 * decoder (RFC 4648 §5, no padding) — see the parity case in
 * `parseE2eLink.test.ts`.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SCHEME = "jetlag-hide-seek-v2";

/** Encode a scenario object into a `jetlag-hide-seek-v2://e2e?d=...` link. */
export function buildScenarioLink(scenario) {
    const d = Buffer.from(JSON.stringify(scenario), "utf8").toString(
        "base64url",
    );
    return `${SCHEME}://e2e?d=${d}`;
}

function main() {
    const file = process.argv[2];
    if (!file) {
        console.error(
            "usage: node scripts/e2e/build-scenario-link.mjs <scenario.json>",
        );
        process.exit(1);
    }
    const scenario = JSON.parse(readFileSync(file, "utf8"));
    process.stdout.write(`${buildScenarioLink(scenario)}\n`);
}

// Run as a CLI only when invoked directly (not when imported by the stack
// script or tests).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    main();
}
