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

async function readArtifact(filename) {
    const path = join(FIXTURE_DIR, filename);
    const text = await readFile(path, "utf8");
    const bytes = Buffer.byteLength(text, "utf8");
    const hash = createHash("sha256").update(text).digest("hex");
    return { path, text, bytes, hash };
}

async function lintArtifact(name, schema, filename) {
    const { text, bytes, hash } = await readArtifact(filename);
    const raw = JSON.parse(text);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        console.error(`${filename} validation failed:`);
        for (const issue of parsed.error.issues) {
            console.error(`  ${issue.path.join(".")}: ${issue.message}`);
        }
        throw new Error(`${filename} invalid`);
    }
    console.log(
        `${filename}: OK (${bytes} bytes, sha256 ${hash.slice(0, 16)}…)`,
    );
}

async function lintManifest() {
    const manifestFile = await readArtifact("manifest.json");
    const manifest = JSON.parse(manifestFile.text);

    const transit = await readArtifact("transit.json");
    const transitExpected = manifest.artifacts["transit.json"];
    if (!transitExpected) {
        throw new Error("manifest.json missing transit.json artifact entry");
    }
    if (transit.hash !== transitExpected.sha256) {
        throw new Error(
            `manifest transit.json sha256 mismatch: manifest=${transitExpected.sha256}, actual=${transit.hash}`,
        );
    }
    if (transit.bytes !== transitExpected.bytes) {
        throw new Error(
            `manifest transit.json byte count mismatch: manifest=${transitExpected.bytes}, actual=${transit.bytes}`,
        );
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
    await lintArtifact("transit", transitPayloadSchema, "transit.json");
    await lintArtifact("meta", metaPayloadSchema, "meta.json");
    await lintManifest();
    console.log("E2E fixture lint passed.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
