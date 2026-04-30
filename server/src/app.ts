import { resolve } from "node:path";

import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import {
    blobExists,
    readBlob,
    readBlobInNamespace,
    writeBlob,
    writeBlobInNamespace,
} from "./blobStorage.js";
import { decompressDeflateBase64Url } from "./decompress.js";
import {
    deleteOverpassIndexEntry,
    readOverpassIndexEntry,
    upsertOverpassIndexEntry,
} from "./overpassIndexStore.js";
import { computeSidFromCanonicalUtf8, SID_PATTERN } from "./sid.js";
import {
    appendTeamSnapshotLine,
    readTeamSnapshots,
} from "./teamStore.js";
import {
    canonicalize,
    TEAM_ID_REGEX,
    wireV1SnapshotSchema,
} from "./wire.js";

export type CasServerOptions = {
    dataDir: string;
    maxCanonicalBytes: number;
    maxCompressedBodyBytes: number;
    maxTeamEntries: number;
    maxOverpassIndexEntries: number;
    corsOrigin: boolean | string | RegExp | (boolean | string | RegExp)[];
    /** Serve the Astro static export (same machine = same-origin CAS API). */
    staticSite?: {
        /** Absolute path to Astro `dist/` (contains `index.html`; URLs use `urlPrefix`). */
        root: string;
        /** Must match Astro `base`, e.g. `/JetLagHideAndSeek/`. */
        urlPrefix: string;
    } | null;
};

const CAS_VERSION = "1";

function normalizeStaticPrefix(raw: string): string {
    let p = raw.trim();
    if (!p.startsWith("/")) p = `/${p}`;
    if (!p.endsWith("/")) p = `${p}/`;
    return p;
}

export async function buildApp(opts: CasServerOptions): Promise<FastifyInstance> {
    const fastify = Fastify({
        logger: true,
        bodyLimit: opts.maxCompressedBodyBytes,
    });

    await fastify.register(cors, {
        origin: opts.corsOrigin,
        methods: ["GET", "PUT", "POST", "HEAD", "OPTIONS"],
        allowedHeaders: ["Content-Type"],
        maxAge: 86400,
    });

    fastify.addContentTypeParser(
        "text/plain",
        { parseAs: "string" },
        (_req, body, done) => {
            done(null, body as string);
        },
    );

    fastify.get("/api/cas/health", async () => ({
        ok: true,
        version: CAS_VERSION,
        maxBlobBytes: opts.maxCanonicalBytes,
    }));

    fastify.put<{
        Params: { sid: string };
        Body: string;
    }>("/api/cas/blobs/:sid", async (request, reply) => {
        const { sid } = request.params;
        if (!SID_PATTERN.test(sid)) {
            return reply.code(400).send({ error: "Invalid sid" });
        }
        const rawBody = request.body;
        if (
            Buffer.byteLength(rawBody ?? "", "utf8") >
            opts.maxCompressedBodyBytes
        ) {
            return reply.code(413).send({ error: "Payload too large" });
        }
        let canonicalUtf8: string;
        try {
            canonicalUtf8 = decompressDeflateBase64Url(rawBody);
        } catch {
            return reply.code(400).send({ error: "Invalid compressed payload" });
        }
        if (
            Buffer.byteLength(canonicalUtf8, "utf8") > opts.maxCanonicalBytes
        ) {
            return reply.code(413).send({ error: "Canonical snapshot too large" });
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(canonicalUtf8);
        } catch {
            return reply.code(400).send({ error: "Invalid JSON after decompress" });
        }
        const snapResult = wireV1SnapshotSchema.safeParse(parsed);
        if (!snapResult.success) {
            return reply.code(400).send({ error: "Invalid wire snapshot" });
        }
        const recomputed = computeSidFromCanonicalUtf8(
            canonicalize(snapResult.data),
        );
        if (recomputed !== sid) {
            return reply.code(400).send({ error: "sid mismatch" });
        }
        await writeBlob(opts.dataDir, sid, rawBody);
        return { sid };
    });

    fastify.get<{ Params: { sid: string } }>(
        "/api/cas/blobs/:sid",
        async (request, reply) => {
            const { sid } = request.params;
            if (!SID_PATTERN.test(sid)) {
                return reply.code(400).send({ error: "Invalid sid" });
            }
            const blob = await readBlob(opts.dataDir, sid);
            if (blob === null) {
                return reply.code(404).send({ error: "Not found" });
            }
            reply.header("Content-Type", "text/plain; charset=utf-8");
            return blob;
        },
    );

    fastify.put<{
        Params: { sid: string };
        Body: string;
    }>("/api/cas/blobs/overpass/:sid", async (request, reply) => {
        const { sid } = request.params;
        if (!SID_PATTERN.test(sid)) {
            return reply.code(400).send({ error: "Invalid sid" });
        }
        const rawBody = request.body;
        if (
            Buffer.byteLength(rawBody ?? "", "utf8") >
            opts.maxCompressedBodyBytes
        ) {
            return reply.code(413).send({ error: "Payload too large" });
        }
        let canonicalUtf8: string;
        try {
            canonicalUtf8 = decompressDeflateBase64Url(rawBody);
        } catch {
            return reply.code(400).send({ error: "Invalid compressed payload" });
        }
        if (
            Buffer.byteLength(canonicalUtf8, "utf8") > opts.maxCanonicalBytes
        ) {
            return reply.code(413).send({ error: "Canonical payload too large" });
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(canonicalUtf8);
        } catch {
            return reply.code(400).send({ error: "Invalid JSON after decompress" });
        }
        const recomputed = computeSidFromCanonicalUtf8(canonicalize(parsed));
        if (recomputed !== sid) {
            return reply.code(400).send({ error: "sid mismatch" });
        }
        await writeBlobInNamespace(opts.dataDir, "overpass", sid, rawBody);
        return { sid };
    });

    fastify.get<{ Params: { sid: string } }>(
        "/api/cas/blobs/overpass/:sid",
        async (request, reply) => {
            const { sid } = request.params;
            if (!SID_PATTERN.test(sid)) {
                return reply.code(400).send({ error: "Invalid sid" });
            }
            const blob = await readBlobInNamespace(opts.dataDir, "overpass", sid);
            if (blob === null) {
                return reply.code(404).send({ error: "Not found" });
            }
            reply.header("Content-Type", "text/plain; charset=utf-8");
            return blob;
        },
    );

    fastify.get<{ Params: { requestHash: string } }>(
        "/api/cas/index/overpass/:requestHash",
        async (request, reply) => {
            const { requestHash } = request.params;
            if (!requestHash || requestHash.length < 8 || requestHash.length > 128) {
                return reply.code(400).send({ error: "Invalid request hash" });
            }
            const entry = await readOverpassIndexEntry(
                opts.dataDir,
                requestHash,
                Date.now(),
                opts.maxOverpassIndexEntries,
            );
            if (!entry) {
                return reply.code(404).send({ error: "Not found" });
            }
            return entry;
        },
    );

    fastify.put<{
        Params: { requestHash: string };
        Body: { sid?: string; cachedAt?: number; expiresAt?: number };
    }>("/api/cas/index/overpass/:requestHash", async (request, reply) => {
        const { requestHash } = request.params;
        if (!requestHash || requestHash.length < 8 || requestHash.length > 128) {
            return reply.code(400).send({ error: "Invalid request hash" });
        }
        const { sid, cachedAt, expiresAt } = request.body ?? {};
        if (!sid || typeof sid !== "string" || !SID_PATTERN.test(sid)) {
            return reply.code(400).send({ error: "Invalid sid" });
        }
        if (
            typeof cachedAt !== "number" ||
            typeof expiresAt !== "number" ||
            !Number.isFinite(cachedAt) ||
            !Number.isFinite(expiresAt) ||
            expiresAt <= cachedAt
        ) {
            return reply.code(400).send({ error: "Invalid cache metadata" });
        }
        await upsertOverpassIndexEntry(
            opts.dataDir,
            requestHash,
            { sid, cachedAt, expiresAt },
            opts.maxOverpassIndexEntries,
        );
        return reply.code(204).send();
    });

    fastify.delete<{ Params: { requestHash: string } }>(
        "/api/cas/index/overpass/:requestHash",
        async (request, reply) => {
            const { requestHash } = request.params;
            if (!requestHash || requestHash.length < 8 || requestHash.length > 128) {
                return reply.code(400).send({ error: "Invalid request hash" });
            }
            await deleteOverpassIndexEntry(opts.dataDir, requestHash);
            return reply.code(204).send();
        },
    );

    fastify.post<{
        Params: { teamId: string };
        Body: { sid?: string };
    }>("/api/teams/:teamId/snapshots", async (request, reply) => {
        const { teamId } = request.params;
        if (!TEAM_ID_REGEX.test(teamId)) {
            return reply.code(400).send({ error: "Invalid team id" });
        }
        const sid = request.body?.sid;
        if (!sid || typeof sid !== "string" || !SID_PATTERN.test(sid)) {
            return reply.code(400).send({ error: "Invalid sid" });
        }
        const exists = await blobExists(opts.dataDir, sid);
        if (!exists) {
            return reply.code(404).send({ error: "Blob not found" });
        }
        await appendTeamSnapshotLine(
            opts.dataDir,
            teamId,
            { sid, ts: Date.now() },
            opts.maxTeamEntries,
        );
        return reply.code(204).send();
    });

    fastify.get<{ Params: { teamId: string } }>(
        "/api/teams/:teamId/snapshots",
        async (request, reply) => {
            const { teamId } = request.params;
            if (!TEAM_ID_REGEX.test(teamId)) {
                return reply.code(400).send({ error: "Invalid team id" });
            }
            const snapshots = await readTeamSnapshots(opts.dataDir, teamId);
            return { teamId, snapshots };
        },
    );

    if (opts.staticSite?.root) {
        const prefix = normalizeStaticPrefix(opts.staticSite.urlPrefix);
        const rootResolved = resolve(opts.staticSite.root);
        await fastify.register(fastifyStatic, {
            root: rootResolved,
            prefix,
            decorateReply: false,
        });
        const baseNoTrailingSlash = prefix.replace(/\/$/, "") || "/";

        fastify.get("/", async (_req, reply) => reply.redirect(prefix, 302));

        if (baseNoTrailingSlash !== "/") {
            fastify.get(baseNoTrailingSlash, async (_req, reply) =>
                reply.redirect(prefix, 302),
            );
        }
    }

    return fastify;
}
