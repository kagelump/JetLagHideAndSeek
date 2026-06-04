module.exports = {
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
    },
    modulePaths: ["<rootDir>/../node_modules"],
    preset: "jest-expo",
    setupFiles: ["./jest.setup.ts"],
    setupFilesAfterEnv: ["./jest.framework.ts"],
    testMatch: ["**/__tests__/**/*.test.{ts,tsx}"],
    // Don't discover tests or modules inside git worktrees under .claude/
    // (e.g. agent worktrees) — they duplicate suites and cause haste collisions.
    testPathIgnorePatterns: ["/node_modules/", "<rootDir>/.claude/"],
    modulePathIgnorePatterns: ["<rootDir>/.claude/"],
    transformIgnorePatterns: [
        "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|@maplibre/.*|@gorhom/.*|react-navigation|@react-navigation/.*|kdbush|geokdbush|tinyqueue)",
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
