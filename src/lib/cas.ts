import { TEAM_ID_REGEX } from "@/lib/wire";

const PROBE_TIMEOUT_MS = 4000;

export { TEAM_ID_REGEX };

export class CasHttpError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

export function normalizeCasBaseUrl(url: string): string {
    return url.replace(/\/+$/, "");
}

export async function computeSidFromCanonicalUtf8(
    canonicalUtf8: string,
): Promise<string> {
    const enc = new TextEncoder().encode(canonicalUtf8);
    const digest = await crypto.subtle.digest("SHA-256", enc);
    const bytes = new Uint8Array(digest).slice(0, 16);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

/** 128-bit nonce, base64url ~22 chars; satisfies TEAM_ID_REGEX length. */
export function newTeamId(): string {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    let binary = "";
    for (let i = 0; i < buf.length; i++) {
        binary += String.fromCharCode(buf[i]);
    }
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

export async function probeHealth(baseUrl: string): Promise<boolean> {
    const root = normalizeCasBaseUrl(baseUrl);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
        const res = await fetch(`${root}/api/cas/health`, {
            method: "GET",
            signal: ctrl.signal,
        });
        return res.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(t);
    }
}

export async function putBlob(
    serverBaseUrl: string,
    compressedBase64UrlPayload: string,
    sid: string,
): Promise<void> {
    const root = normalizeCasBaseUrl(serverBaseUrl);
    const res = await fetch(`${root}/api/cas/blobs/${encodeURIComponent(sid)}`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: compressedBase64UrlPayload,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `PUT blob failed: ${res.status}`);
    }
}

export async function putBlobInNamespace(
    serverBaseUrl: string,
    namespace: "overpass",
    compressedBase64UrlPayload: string,
    sid: string,
): Promise<void> {
    const root = normalizeCasBaseUrl(serverBaseUrl);
    const res = await fetch(
        `${root}/api/cas/blobs/${encodeURIComponent(namespace)}/${encodeURIComponent(sid)}`,
        {
            method: "PUT",
            headers: { "Content-Type": "text/plain; charset=utf-8" },
            body: compressedBase64UrlPayload,
        },
    );
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `PUT blob failed: ${res.status}`);
    }
}

export async function getBlob(
    serverBaseUrl: string,
    sid: string,
): Promise<string> {
    const root = normalizeCasBaseUrl(serverBaseUrl);
    const res = await fetch(
        `${root}/api/cas/blobs/${encodeURIComponent(sid)}`,
        { method: "GET" },
    );
    if (!res.ok) {
        throw new CasHttpError(`GET blob failed: ${res.status}`, res.status);
    }
    return res.text();
}

export async function getBlobInNamespace(
    serverBaseUrl: string,
    namespace: "overpass",
    sid: string,
): Promise<string> {
    const root = normalizeCasBaseUrl(serverBaseUrl);
    const res = await fetch(
        `${root}/api/cas/blobs/${encodeURIComponent(namespace)}/${encodeURIComponent(sid)}`,
        { method: "GET" },
    );
    if (!res.ok) {
        throw new CasHttpError(`GET blob failed: ${res.status}`, res.status);
    }
    return res.text();
}

export async function appendTeamSnapshot(
    serverBaseUrl: string,
    teamId: string,
    sid: string,
): Promise<void> {
    if (!TEAM_ID_REGEX.test(teamId)) {
        throw new Error("Invalid team id");
    }
    const root = normalizeCasBaseUrl(serverBaseUrl);
    const res = await fetch(
        `${root}/api/teams/${encodeURIComponent(teamId)}/snapshots`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sid }),
        },
    );
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `POST team snapshot failed: ${res.status}`);
    }
}

export async function listTeamSnapshots(
    serverBaseUrl: string,
    teamId: string,
): Promise<{ sid: string; ts: number }[]> {
    if (!TEAM_ID_REGEX.test(teamId)) {
        throw new Error("Invalid team id");
    }
    const root = normalizeCasBaseUrl(serverBaseUrl);
    const res = await fetch(
        `${root}/api/teams/${encodeURIComponent(teamId)}/snapshots`,
        { method: "GET" },
    );
    if (!res.ok) {
        throw new Error(`GET team snapshots failed: ${res.status}`);
    }
    const data = (await res.json()) as {
        snapshots?: { sid: string; ts: number }[];
    };
    return data.snapshots ?? [];
}

export type OverpassIndexPayload = {
    sid: string;
    cachedAt: number;
    expiresAt: number;
};

export async function getOverpassIndexMapping(
    serverBaseUrl: string,
    requestHash: string,
): Promise<OverpassIndexPayload | null> {
    const root = normalizeCasBaseUrl(serverBaseUrl);
    const res = await fetch(
        `${root}/api/cas/index/overpass/${encodeURIComponent(requestHash)}`,
        { method: "GET" },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
        throw new Error(`GET overpass index failed: ${res.status}`);
    }
    const data = (await res.json()) as OverpassIndexPayload;
    if (!data?.sid) return null;
    return data;
}

export async function putOverpassIndexMapping(
    serverBaseUrl: string,
    requestHash: string,
    payload: OverpassIndexPayload,
): Promise<void> {
    const root = normalizeCasBaseUrl(serverBaseUrl);
    const res = await fetch(
        `${root}/api/cas/index/overpass/${encodeURIComponent(requestHash)}`,
        {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        },
    );
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `PUT overpass index failed: ${res.status}`);
    }
}

export async function deleteOverpassIndexMapping(
    serverBaseUrl: string,
    requestHash: string,
): Promise<void> {
    const root = normalizeCasBaseUrl(serverBaseUrl);
    const res = await fetch(
        `${root}/api/cas/index/overpass/${encodeURIComponent(requestHash)}`,
        { method: "DELETE" },
    );
    if (res.status === 404) return;
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `DELETE overpass index failed: ${res.status}`);
    }
}

