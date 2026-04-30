import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type OverpassIndexRow = {
    sid: string;
    cachedAt: number;
    expiresAt: number;
};

type OverpassIndexMap = Record<string, OverpassIndexRow>;

let writeQueue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
    writeQueue = writeQueue.then(task, task);
    return writeQueue;
}

async function readIndex(dataDir: string): Promise<OverpassIndexMap> {
    const filePath = join(dataDir, "indexes", "overpass.json");
    try {
        return JSON.parse(await readFile(filePath, "utf8")) as OverpassIndexMap;
    } catch {
        return {};
    }
}

async function writeIndex(dataDir: string, value: OverpassIndexMap): Promise<void> {
    const dir = join(dataDir, "indexes");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "overpass.json"), JSON.stringify(value), "utf8");
}

function pruneIndex(
    index: OverpassIndexMap,
    now: number,
    maxEntries: number,
): OverpassIndexMap {
    const entries = Object.entries(index)
        .filter(([, row]) => row.expiresAt > now)
        .sort((a, b) => b[1].cachedAt - a[1].cachedAt);
    return Object.fromEntries(entries.slice(0, maxEntries));
}

export async function readOverpassIndexEntry(
    dataDir: string,
    requestHash: string,
    now = Date.now(),
    maxEntries = 20_000,
): Promise<OverpassIndexRow | null> {
    const index = await readIndex(dataDir);
    const entry = index[requestHash];
    if (!entry || entry.expiresAt <= now) {
        const pruned = pruneIndex(index, now, maxEntries);
        await writeIndex(dataDir, pruned);
        return null;
    }
    const pruned = pruneIndex(index, now, maxEntries);
    if (Object.keys(pruned).length !== Object.keys(index).length) {
        await writeIndex(dataDir, pruned);
    }
    return entry;
}

export async function upsertOverpassIndexEntry(
    dataDir: string,
    requestHash: string,
    entry: OverpassIndexRow,
    maxEntries: number,
): Promise<void> {
    await enqueue(async () => {
        const now = Date.now();
        const current = await readIndex(dataDir);
        const next = pruneIndex({ ...current, [requestHash]: entry }, now, maxEntries);
        await writeIndex(dataDir, next);
    });
}

export async function deleteOverpassIndexEntry(
    dataDir: string,
    requestHash: string,
): Promise<void> {
    await enqueue(async () => {
        const current = await readIndex(dataDir);
        if (!current[requestHash]) return;
        const next = { ...current };
        delete next[requestHash];
        await writeIndex(dataDir, next);
    });
}
