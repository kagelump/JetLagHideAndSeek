const pluginJs = require("@eslint/js");
const eslintConfigPrettier = require("eslint-config-prettier");
const pluginReact = require("eslint-plugin-react");
const globals = require("globals");
const tseslint = require("typescript-eslint");

module.exports = [
    { ignores: ["node_modules/**", ".expo/**", "dist/**"] },
    {
        settings: {
            react: {
                version: "19",
            },
        },
    },
    pluginJs.configs.recommended,
    ...tseslint.configs.recommended,
    pluginReact.configs.flat.recommended,
    {
        files: ["**/*.{js,ts,tsx}"],
        languageOptions: {
            globals: {
                ...globals.es2022,
                ...globals.node,
            },
        },
        rules: {
            "react/react-in-jsx-scope": "off",
            "react/display-name": "off",
            "react/prop-types": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-require-imports": "off",
        },
    },
    eslintConfigPrettier,
];
