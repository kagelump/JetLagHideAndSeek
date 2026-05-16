const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "..");
const rootNodeModules = path.resolve(monorepoRoot, "node_modules");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, "node_modules"),
    rootNodeModules,
];

config.resolver.extraNodeModules = {
    "@gorhom/bottom-sheet": path.resolve(
        rootNodeModules,
        "@gorhom/bottom-sheet",
    ),
    "@maplibre/maplibre-react-native": path.resolve(
        rootNodeModules,
        "@maplibre/maplibre-react-native",
    ),
    "@react-native-async-storage/async-storage": path.resolve(
        rootNodeModules,
        "@react-native-async-storage/async-storage",
    ),
    react: path.resolve(rootNodeModules, "react"),
    "react-dom": path.resolve(rootNodeModules, "react-dom"),
    "react-native": path.resolve(rootNodeModules, "react-native"),
    "react-native-gesture-handler": path.resolve(
        rootNodeModules,
        "react-native-gesture-handler",
    ),
    "react-native-reanimated": path.resolve(
        rootNodeModules,
        "react-native-reanimated",
    ),
    "react-native-safe-area-context": path.resolve(
        rootNodeModules,
        "react-native-safe-area-context",
    ),
    "react-native-screens": path.resolve(
        rootNodeModules,
        "react-native-screens",
    ),
};

module.exports = config;
