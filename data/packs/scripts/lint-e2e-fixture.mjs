#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import {
    metaPayloadSchema,
    transitPayloadSchema,
} from "@/features/offline/packSchemas";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(
    __dirname,
    "..",
    "..",
    "..",
    "assets",
    "e2e-fixture",
    "e2e-fixture",
);

async function lintArtifact(name, schema, filename) {
    const path = join(FIXTURE_DIR, filename);
    const text = await readFile(path, "utf8");
    const raw = JSON.parse(text);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        console.error(`${filename} validation failed:`);
        for (const issue of parsed.error.issues) {
            console.error(`  ${issue.path.join(".")}: ${issue.message}`);
        }
        throw new Error(`${filename} invalid`);
    }
    const hash = createHash("sha256").update(text).digest("hex");
    console.log(
        `${filename}: OK (${text.length} bytes, sha256 ${hash.slice(0, 16)}…)`,
    );
}

async function main() {
    await lintArtifact("transit", transitPayloadSchema, "transit.json");
    await lintArtifact("meta", metaPayloadSchema, "meta.json");
    console.log("E2E fixture lint passed.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
