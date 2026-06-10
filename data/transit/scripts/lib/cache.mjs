/* global console, fetch, process */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Load environment variables from `~/.env`, merging into `process.env` only
 * for keys not already set. Matches the ODPT pipeline pattern.
 *
 * @returns {Promise<Record<string, string>>} merged env (process.env + ~/.env)
 */
export async function loadEnv() {
    const env = { ...process.env };
    const homeEnv = resolve(process.env.HOME ?? "", ".env");
    if (!existsSync(homeEnv)) return env;

    const text = await readFile(homeEnv, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (env[key]) continue; // process.env wins
        env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
    return env;
}

/**
 * Substitute `${VAR}` placeholders in a URL template.
 * Values are URI-encoded so keys containing special characters are safe.
 *
 * @param {string} template - URL template with `${VAR}` placeholders
 * @param {Record<string, string>} [env] - env object (defaults to process.env)
 * @returns {string} URL with substitutions applied
 */
export function applyEnv(template, env) {
    const vars = env ?? process.env;
    return template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => {
        return encodeURIComponent(vars[key] ?? "");
    });
}

/**
 * Download a file to cache, or read from cache if present.
 *
 * @param {string} urlTemplate - URL with optional `${ODPT_KEY}` placeholder
 * @param {string} cacheFile - absolute path to the cache file
 * @param {object} opts
 * @param {boolean} [opts.requiresKey=false] - if true, skip with warning when
 *   ODPT_KEY is missing and the file isn't cached
 * @param {boolean} [opts.cacheOnly=false] - if true, never fetch; throw if not
 *   cached
 * @param {Record<string, string>} [opts.env] - merged env for substitution
 *   (defaults to process.env)
 * @returns {Promise<Uint8Array>} file contents
 */
export async function fetchToCache(urlTemplate, cacheFile, opts = {}) {
    const { requiresKey = false, cacheOnly = false, env } = opts;
    const vars = env ?? process.env;
    const url = applyEnv(urlTemplate, vars);

    // Ensure cache directory exists.
    await mkdir(resolve(cacheFile, ".."), { recursive: true });

    // Return cached copy if available.
    if (existsSync(cacheFile)) {
        console.log(`  Using cached: ${cacheFile}`);
        return new Uint8Array(await readFile(cacheFile));
    }

    if (cacheOnly) {
        throw new Error(
            `${cacheFile} not cached and --cache-only is set. Run without --cache-only to download.`,
        );
    }

    // Check for required key only when we need to download.
    if (requiresKey && !vars.ODPT_KEY) {
        console.warn(
            `  Skipping: ${cacheFile} — ODPT_KEY not set and file not cached.`,
        );
        return null;
    }

    // Never log the resolved URL (it contains the key).
    console.log(`  Downloading (cache miss): ${cacheFile}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download: HTTP ${response.status}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(cacheFile, bytes);
    return bytes;
}
