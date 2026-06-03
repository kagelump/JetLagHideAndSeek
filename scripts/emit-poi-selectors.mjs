import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(root, "data", "geofabrik", "poi-selectors.json");

// Dynamic import of the TS registry — tsx handles the transpilation.
const { CATEGORY_SELECTORS, toTagsFilterArgs } = await import(
    "../src/features/questions/matching/matchingSelectors.ts"
);

function buildSnapshot() {
    const categories = {};
    for (const [cat, selectors] of Object.entries(CATEGORY_SELECTORS)) {
        categories[cat] = { selectors };
    }

    return {
        schemaVersion: 1,
        generatedFrom: "src/features/questions/matching/matchingSelectors.ts",
        categories,
        tagsFilterArgs: toTagsFilterArgs(),
    };
}

const snapshot = buildSnapshot();
const serialized =
    (await format(JSON.stringify(snapshot), { parser: "json", tabWidth: 4 })) +
    "\n";

if (process.argv.includes("--check")) {
    let existing;
    try {
        existing = await readFile(outputPath, "utf8");
    } catch {
        throw new Error(
            `${outputPath} is missing. Run pnpm data:poi-selectors to generate it.`,
        );
    }
    if (existing !== serialized) {
        throw new Error(
            "poi-selectors.json is stale. Run pnpm data:poi-selectors to regenerate.",
        );
    }
} else {
    await writeFile(outputPath, serialized);
    console.log("Wrote %s", outputPath);
}
