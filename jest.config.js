module.exports = {
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
    },
    modulePaths: ["<rootDir>/../node_modules"],
    preset: "jest-expo",
    setupFiles: ["./jest.setup.ts"],
    setupFilesAfterEnv: ["./jest.framework.ts"],
    // React 18 scheduler may leave a heartbeat timer open after unmount —
    // this is a known framework limitation, not an application leak.
    forceExit: true,
    testMatch: ["**/__tests__/**/*.test.{ts,tsx}"],
    // Don't discover tests or modules inside git worktrees under .claude/
    // (e.g. agent worktrees) — they duplicate suites and cause haste collisions.
    // The geos-wasm suites need ESM dynamic import and run under their own
    // config + flag via `pnpm test:geos` (jest.config.geos.js) — skip them here
    // so the default run doesn't fail without --experimental-vm-modules.
    testPathIgnorePatterns: [
        "/node_modules/",
        "<rootDir>/.claude/",
        "geosWasmSmoke\\.test\\.",
        "geosParity\\.test\\.",
    ],
    modulePathIgnorePatterns: ["<rootDir>/.claude/"],
    transformIgnorePatterns: [
        "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|@maplibre/.*|@gorhom/.*|react-navigation|@react-navigation/.*|kdbush|geokdbush|tinyqueue|@turf)",
    ],
    collectCoverageFrom: [
        "src/**/*.{ts,tsx}",
        "!src/**/*.d.ts",
        "!src/**/*Types.ts",
        "!src/**/types.ts",
        "!src/theme/**",
        "!src/config/**",
    ],
    coverageReporters: ["text", "lcov"],
};
