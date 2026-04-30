import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

function blobPath(dataDir: string, sid: string, namespace = "wire"): string {
    const shard = sid.slice(0, 2);
    return join(dataDir, "blobs", namespace, shard, sid);
}

export async function writeBlob(
    dataDir: string,
    sid: string,
    payloadUtf8: string,
): Promise<void> {
    const path = blobPath(dataDir, sid);
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });
    await writeFile(path, payloadUtf8, "utf8");
}

export async function writeBlobInNamespace(
    dataDir: string,
    namespace: string,
    sid: string,
    payloadUtf8: string,
): Promise<void> {
    const path = blobPath(dataDir, sid, namespace);
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });
    await writeFile(path, payloadUtf8, "utf8");
}

export async function readBlob(
    dataDir: string,
    sid: string,
): Promise<string | null> {
    try {
        return await readFile(blobPath(dataDir, sid), "utf8");
    } catch {
        return null;
    }
}

export async function readBlobInNamespace(
    dataDir: string,
    namespace: string,
    sid: string,
): Promise<string | null> {
    try {
        return await readFile(blobPath(dataDir, sid, namespace), "utf8");
    } catch {
        return null;
    }
}

export async function blobExists(dataDir: string, sid: string): Promise<boolean> {
    try {
        await access(blobPath(dataDir, sid));
        return true;
    } catch {
        return false;
    }
}

export async function blobExistsInNamespace(
    dataDir: string,
    namespace: string,
    sid: string,
): Promise<boolean> {
    try {
        await access(blobPath(dataDir, sid, namespace));
        return true;
    } catch {
        return false;
    }
}
