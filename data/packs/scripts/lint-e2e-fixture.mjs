#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import {
    boundariesPayloadSchema,
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

const PAYLOAD_SCHEMAS = {
    "transit.json": transitPayloadSchema,
    "meta.json": metaPayloadSchema,
    "boundaries.json": boundariesPayloadSchema,
};

async function readArtifact(filename) {
    const path = join(FIXTURE_DIR, filename);
    const text = await readFile(path, "utf8");
    const bytes = Buffer.byteLength(text, "utf8");
    const hash = createHash("sha256").update(text).digest("hex");
    return { path, text, bytes, hash };
}

async function lintArtifact(filename) {
    const { text, bytes, hash } = await readArtifact(filename);
    const raw = JSON.parse(text);

    const schema = PAYLOAD_SCHEMAS[filename];
    if (schema) {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            console.error(`${filename} validation failed:`);
            for (const issue of parsed.error.issues) {
                console.error(`  ${issue.path.join(".")}: ${issue.message}`);
            }
            throw new Error(`${filename} invalid`);
        }
    } else if (filename.startsWith("measuring-")) {
        // Structural check for measuring artifacts (no dedicated Zod schema yet).
        if (!raw.category || typeof raw.category !== "string") {
            throw new Error(`${filename}: missing or invalid "category"`);
        }
        if (!Array.isArray(raw.features)) {
            throw new Error(`${filename}: missing or invalid "features" array`);
        }
    } else if (filename === "poi.json") {
        // Columnar POI format — check totalCount and categories object.
        if (typeof raw.totalCount !== "number" || raw.totalCount < 0) {
            throw new Error(`${filename}: missing or invalid "totalCount"`);
        }
        if (typeof raw.categories !== "object" || raw.categories === null) {
            throw new Error(`${filename}: missing or invalid "categories"`);
        }
    } else {
        console.log(`${filename}: skipping (no schema, no structural check)`);
        return;
    }

    console.log(
        `${filename}: OK (${bytes} bytes, sha256 ${hash.slice(0, 16)}…)`,
    );
}

async function lintManifest() {
    const manifestFile = await readArtifact("manifest.json");
    const manifest = JSON.parse(manifestFile.text);

    // Cross-check every artifact entry in the manifest.
    for (const [filename, expected] of Object.entries(manifest.artifacts)) {
        let artifact;
        try {
            artifact = await readArtifact(filename);
        } catch {
            throw new Error(
                `manifest lists "${filename}" but file is missing on disk`,
            );
        }

        if (artifact.hash !== expected.sha256) {
            throw new Error(
                `manifest ${filename} sha256 mismatch: manifest=${expected.sha256}, actual=${artifact.hash}`,
            );
        }
        if (artifact.bytes !== expected.bytes) {
            throw new Error(
                `manifest ${filename} byte count mismatch: manifest=${expected.bytes}, actual=${artifact.bytes}`,
            );
        }
    }

    const meta = await readArtifact("meta.json");
    const metaExpected = manifest.meta;
    if (!metaExpected) {
        throw new Error("manifest.json missing meta entry");
    }
    if (meta.hash !== metaExpected.sha256) {
        throw new Error(
            `manifest meta.json sha256 mismatch: manifest=${metaExpected.sha256}, actual=${meta.hash}`,
        );
    }
    if (meta.bytes !== metaExpected.bytes) {
        throw new Error(
            `manifest meta.json byte count mismatch: manifest=${metaExpected.bytes}, actual=${meta.bytes}`,
        );
    }

    console.log(
        `manifest.json: OK (${manifestFile.bytes} bytes, sha256 ${manifestFile.hash.slice(0, 16)}…)`,
    );
}

async function main() {
    // Validate each artifact on disk with its schema.
    const manifest = JSON.parse((await readArtifact("manifest.json")).text);
    for (const filename of Object.keys(manifest.artifacts)) {
        await lintArtifact(filename);
    }
    await lintArtifact("meta.json");
    await lintManifest();
    console.log("E2E fixture lint passed.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
