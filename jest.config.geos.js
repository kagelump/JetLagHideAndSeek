// Dedicated Jest config for the on-host GEOS suites (geos-wasm).
//
// geos-wasm is ESM-only and uses `import.meta`, so these suites must run under
// `--experimental-vm-modules` (set by the `test:geos` script). They are kept out
// of the default `pnpm test` run (see `testPathIgnorePatterns` in jest.config.js)
// because that flag is not enabled there.
//
//   pnpm test:geos
//
// Everything else (preset, setup, moduleNameMapper) is inherited from the base
// config; we only re-target which suites run.
const base = require("./jest.config");

module.exports = {
    ...base,
    // Run ONLY the geos-wasm suites, and don't inherit the base ignore that
    // hides them from the default run.
    testMatch: [
        "**/__tests__/**/geosWasmSmoke.test.{ts,tsx}",
        "**/__tests__/**/geosParity.test.{ts,tsx}",
        "**/__tests__/**/*.geos.test.{ts,tsx}",
    ],
    testPathIgnorePatterns: ["/node_modules/", "<rootDir>/.claude/"],
};
