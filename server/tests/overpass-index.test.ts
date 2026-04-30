import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { computeSidFromCanonicalUtf8 } from "../src/sid.js";
import { canonicalize, wireV1SnapshotSchema } from "../src/wire.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function fixtureBlob(): { sid: string; compressed: string } {
    const raw = readFileSync(
        join(__dirname, "../../tests/fixtures/wire-v1.json"),
        "utf8",
    );
    const snap = wireV1SnapshotSchema.parse(JSON.parse(raw));
    const canonicalUtf8 = canonicalize(snap);
    const sid = computeSidFromCanonicalUtf8(canonicalUtf8);
    const deflated = zlib.deflateSync(Buffer.from(canonicalUtf8, "utf8"));
    const compressed = deflated
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    return { sid, compressed };
}

describe("overpass index API", () => {
    let dataDir: string;
    let app: Awaited<ReturnType<typeof buildApp>>;

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), "cas-overpass-"));
        app = await buildApp({
            dataDir,
            maxCanonicalBytes: 1024 * 1024,
            maxCompressedBodyBytes: 2 * 1024 * 1024,
            maxTeamEntries: 100,
            maxOverpassIndexEntries: 1000,
            corsOrigin: true,
        });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        await rm(dataDir, { recursive: true, force: true });
    });

    it("PUT then GET returns mapping", async () => {
        const { sid, compressed } = fixtureBlob();
        await app.inject({
            method: "PUT",
            url: `/api/cas/blobs/${sid}`,
            headers: { "content-type": "text/plain; charset=utf-8" },
            payload: compressed,
        });
        const requestHash = "abc12345_request_hash";
        const now = Date.now();
        const put = await app.inject({
            method: "PUT",
            url: `/api/cas/index/overpass/${requestHash}`,
            headers: { "content-type": "application/json" },
            payload: JSON.stringify({
                sid,
                cachedAt: now,
                expiresAt: now + 60_000,
            }),
        });
        expect(put.statusCode).toBe(204);

        const get = await app.inject({
            method: "GET",
            url: `/api/cas/index/overpass/${requestHash}`,
        });
        expect(get.statusCode).toBe(200);
        const body = JSON.parse(get.body) as { sid: string };
        expect(body.sid).toBe(sid);
    });

    it("stores and retrieves overpass namespaced blobs", async () => {
        const payload = {
            version: 0.6,
            generator: "Overpass API",
            osm3s: { timestamp_osm_base: "2026-04-30T00:00:00Z" },
            elements: [{ type: "node", id: 1, lat: 0, lon: 0 }],
        };
        const canonicalUtf8 = canonicalize(payload);
        const sid = computeSidFromCanonicalUtf8(canonicalUtf8);
        const deflated = zlib.deflateSync(Buffer.from(canonicalUtf8, "utf8"));
        const compressed = deflated
            .toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=/g, "");

        const put = await app.inject({
            method: "PUT",
            url: `/api/cas/blobs/overpass/${sid}`,
            headers: { "content-type": "text/plain; charset=utf-8" },
            payload: compressed,
        });
        expect(put.statusCode).toBe(200);

        const get = await app.inject({
            method: "GET",
            url: `/api/cas/blobs/overpass/${sid}`,
        });
        expect(get.statusCode).toBe(200);
        expect(get.body).toBe(compressed);
    });
});
