const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

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
