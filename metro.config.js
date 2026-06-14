const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

// The `native-geometry` local module (modules/native-geometry) is autolinked
// for the native side via expo.autolinking.nativeModulesDir, but Metro resolves
// the bare `require("native-geometry")` specifier through node_modules. Locally
// that works via a dev/prebuild symlink; on EAS Build that symlink isn't
// recreated, so production bundling (EAGER_BUNDLE) fails to resolve it. Alias
// it explicitly so JS resolution is identical in every environment.
config.resolver.extraNodeModules = {
    ...config.resolver.extraNodeModules,
    "native-geometry": path.resolve(projectRoot, "modules/native-geometry"),
};

// @turf/* packages are dual CJS/ESM with "type": "module". Metro resolves
// them via the "main" field (CJS) by default, but their transitive
// dependencies may only be reachable through the "exports" map. Enable
// package exports so Metro can follow the full resolution graph.
config.resolver.unstable_enablePackageExports = true;
// Prefer CJS conditions so Metro picks up dist/cjs/index.cjs entries
// instead of the ESM source, avoiding transform errors on `import` /
// `export` syntax in node_modules.
config.resolver.unstable_conditionNames = ["require", "import"];

module.exports = config;
