/**
 * Runner for the on-host GEOS (geos-wasm) Jest suites.
 *
 * Why this exists: geos-wasm is ESM-only and is loaded through a runtime
 * `import()` that executes in Node's native realm (see `geosWasmNode.ts` — the
 * `new Function("specifier", "return import(specifier)")` trick that keeps
 * Jest's CJS transform from rewriting it to `require`). Because that import
 * escapes Jest's per-file VM realm, when a single Jest worker is reused for a
 * second geos suite the first suite's torn-down realm races the second's wasm
 * init and throws "Test environment has been torn down". The failure is
 * non-deterministic — it depends on how Jest packs files onto workers.
 *
 * The robust fix is to give every geos suite its own fresh process. This runner
 * enumerates the suites via `jest --listTests` and runs each in an isolated
 * `jest` invocation, so no worker is ever reused across two geos files.
 *
 *   pnpm test:geos              # all geos suites
 *   pnpm test:geos geosGolden   # filter by path substring
 */

import { spawnSync } from "node:child_process";

const NODE_OPTIONS = [process.env.NODE_OPTIONS, "--experimental-vm-modules"]
    .filter(Boolean)
    .join(" ");
const env = { ...process.env, NODE_OPTIONS };
const CONFIG = "jest.config.geos.js";
const filters = process.argv.slice(2);

const jest = (args, opts = {}) =>
    spawnSync("npx", ["jest", "--config", CONFIG, ...args], {
        env,
        encoding: "utf8",
        ...opts,
    });

// Enumerate the geos suites the config would run.
const list = jest(["--listTests"], { stdio: ["ignore", "pipe", "inherit"] });
if (list.status !== 0) {
    console.error("[test:geos] failed to list test files");
    process.exit(list.status ?? 1);
}
let files = list.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
if (filters.length > 0) {
    files = files.filter((f) => filters.some((needle) => f.includes(needle)));
}

if (files.length === 0) {
    console.error(`[test:geos] no suites matched ${JSON.stringify(filters)}`);
    process.exit(1);
}

console.log(`[test:geos] running ${files.length} suite(s), one process each`);

const failures = [];
for (const file of files) {
    const rel = file.replace(`${process.cwd()}/`, "");
    console.log(`\n[test:geos] ── ${rel}`);
    const res = jest(["--runTestsByPath", file], { stdio: "inherit" });
    if (res.status !== 0) failures.push(rel);
}

if (failures.length > 0) {
    console.error(
        `\n[test:geos] ${failures.length} suite(s) failed:\n  ${failures.join("\n  ")}`,
    );
    process.exit(1);
}
console.log(`\n[test:geos] all ${files.length} suite(s) passed`);
