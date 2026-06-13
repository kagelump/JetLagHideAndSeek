/**
 * Publish script — upload pack artifacts to GitHub Releases and update catalog.
 *
 * Usage:
 *   pnpm data:pack:publish -- --region europe-netherlands [--tag packs-2026-06-12] [--repo org/repo]
 *
 * Steps:
 *   1. Preflight: dist exists + lint passes; gh auth status; warn if dirty tree.
 *   2. Create release if tag doesn't exist.
 *   3. Upload artifacts.
 *   4. Rebuild catalog.json (fetch published catalog from Pages as --base).
 *   5. Write catalog.json + NOTICE + index.html to site/packs/ and commit
 *      to master. The pages.yml workflow deploys site/ atomically via
 *      GitHub Actions (single deploy path for splash, deep links, viewer,
 *      and catalog).
 *   6. Print catalog URL.
 *
 * @module publish
 */

/* global console, process */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packsDir = resolve(scriptDir, "..");
const root = resolve(packsDir, "..", "..");
const distBase = resolve(packsDir, "dist");

/**
 * Thin exec wrapper — replaced in tests.
 *
 * Accepts either a command string (run through the shell for proper
 * quoting) or an args array ([file, ...args]).
 *
 * @param {string | string[]} cmd - command line or args array
 * @param {object} [options]
 * @param {boolean} [options.silent] - suppress stdout
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
export async function exec(cmd, options = {}) {
    const { execFile } = await import("node:child_process");

    /** @type {[string, string[]]} */
    let file, args;
    if (Array.isArray(cmd)) {
        [file, ...args] = cmd;
    } else {
        // Match shell tokens: handles quoted strings and bare words.
        const tokens = [];
        const tokenRe = /"([^"]*)"|'([^']*)'|(\S+)/g;
        let m;
        while ((m = tokenRe.exec(cmd)) !== null) {
            tokens.push(m[1] ?? m[2] ?? m[3]);
        }
        if (tokens.length === 0) {
            throw new Error(`Empty command: ${JSON.stringify(cmd)}`);
        }
        [file, ...args] = tokens;
    }

    return new Promise((resolvePromise) => {
        execFile(
            file,
            args,
            {
                maxBuffer: 10 * 1024 * 1024,
            },
            (error, stdout, stderr) => {
                const exitCode = error ? (error.code ?? 1) : 0;
                if (!options.silent && stdout) {
                    console.log(stdout);
                }
                resolvePromise({
                    stdout: (stdout ?? "").toString().trim(),
                    stderr: (stderr ?? "").toString().trim(),
                    exitCode,
                });
            },
        );
    });
}

/**
 * Fetch URL content with plain http/https. Returns null on 404.
 *
 * @param {string} url
 * @returns {Promise<object|null>} parsed JSON, or null on 404
 */
export async function fetchJson(url) {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? "https" : "http";
    const httpMod = await import(mod);
    return new Promise((resolvePromise) => {
        const req = httpMod.get(url, { timeout: 15000 }, (res) => {
            if (res.statusCode === 404) {
                resolvePromise(null);
                return;
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
                resolvePromise(null);
                return;
            }
            let data = "";
            res.on("data", (chunk) => {
                data += chunk;
            });
            res.on("end", () => {
                try {
                    resolvePromise(JSON.parse(data));
                } catch {
                    resolvePromise(null);
                }
            });
        });
        req.on("error", () => {
            resolvePromise(null);
        });
        req.on("timeout", () => {
            req.destroy();
            resolvePromise(null);
        });
    });
}

/**
 * Format today as YYYY-MM-DD.
 * @returns {string}
 */
function today() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Determine which dist files to upload for a region.
 *
 * Returns a map of assetName -> localPath.
 *
 * @param {string} regionId
 * @param {string} [baseDistDir] - override dist base directory (for testing)
 * @returns {Promise<Map<string, string>>}
 */
async function collectUploads(regionId, baseDistDir) {
    const distRoot = baseDistDir ?? distBase;
    const regionDistDir = resolve(distRoot, regionId);
    const files = new Map();

    if (!existsSync(regionDistDir)) {
        throw new Error(`dist/${regionId}/ does not exist`);
    }

    // Read hashes.json to know what artifacts exist.
    const hashesPath = resolve(regionDistDir, "hashes.json");
    if (!existsSync(hashesPath)) {
        throw new Error(`dist/${regionId}/hashes.json not found`);
    }
    const hashes = JSON.parse(await readFile(hashesPath, "utf8"));

    for (const key of Object.keys(hashes)) {
        let assetName;
        if (key.startsWith("measuring-")) {
            const category = key.slice("measuring-".length);
            assetName = `${regionId}-measuring-${category}.json.gz`;
        } else {
            assetName = `${regionId}-${key}.json.gz`;
        }
        files.set(assetName, resolve(regionDistDir, `${key}.json.gz`));
    }

    // Upload meta.json.gz (gzipped — matches catalog expectation).
    const metaGzPath = resolve(regionDistDir, "meta.json.gz");
    if (existsSync(metaGzPath)) {
        files.set(`${regionId}-meta.json.gz`, metaGzPath);
    }

    return files;
}

/**
 * The main publish flow, factored so tests can inject dependencies.
 *
 * @param {object} options
 * @param {string} options.regionId
 * @param {string} [options.tag] - release tag (default packs-YYYY-MM-DD)
 * @param {string} [options.repo] - GitHub repo slug
 * @param {string} [options.pagesUrl] - Pages base URL for catalog fetch
 * @param {string} [options.distDir] - override dist directory (for testing)
 * @param {Function} [options.execFn] - exec wrapper (for tests)
 * @param {Function} [options.fetchFn] - fetch wrapper (for tests)
 * @param {boolean} [options.skipLint] - skip lint preflight (for testing)
 * @param {string} [options.siteDir] - override site/ root directory (for testing)
 * @returns {Promise<{tag: string, catalogUrl: string}>}
 */
export async function publish({
    regionId,
    tag,
    repo,
    pagesUrl,
    distDir,
    execFn,
    fetchFn,
    skipLint,
    siteDir,
}) {
    const resolvedTag = tag ?? `packs-${today()}`;
    const resolvedRepo = repo ?? "kagelump/JetLagHideAndSeek";
    const resolvedExec = execFn ?? exec;
    const resolvedFetch = fetchFn ?? fetchJson;
    const resolvedDistDir = distDir ?? distBase;

    const resolvedPagesUrl = pagesUrl ?? `https://jetlag.hinoka.org`;
    const catalogUrl = `${resolvedPagesUrl}/packs/catalog.json`;
    const noticeUrl = `${resolvedPagesUrl}/packs/NOTICE`;

    console.log(`\n=== Publishing ${regionId} to ${resolvedTag} ===`);

    // Step 1: Preflight.
    console.log("\n[1/5] Preflight...");

    // Check dist exists.
    const regionDist = resolve(resolvedDistDir, regionId);
    if (!existsSync(regionDist)) {
        console.error(
            `ERROR: dist/${regionId}/ does not exist. Build the pack first.`,
        );
        process.exitCode = 1;
        return;
    }

    // Run lint (skip if explicitly disabled, e.g. in tests).
    if (skipLint) {
        console.log("  Lint skipped (test mode).");
    } else {
        const { lintRegion } = await import("./pack-lint.mjs");
        const lintErrors = await lintRegion(regionId);
        if (lintErrors.length > 0) {
            console.error("Lint FAILED:");
            for (const err of lintErrors) {
                console.error(`  ${err}`);
            }
            process.exitCode = 1;
            return;
        }
        console.log("  Lint passed.");
    }

    // Check gh auth.
    const authResult = await resolvedExec("gh auth status");
    if (authResult.exitCode !== 0) {
        console.error(
            "ERROR: `gh auth status` failed — not authenticated with GitHub CLI.",
        );
        console.error(authResult.stderr);
        process.exitCode = 1;
        return;
    }
    console.log("  GitHub CLI authenticated.");

    // Warn if working tree is dirty.
    const statusResult = await resolvedExec("git status --porcelain", {
        silent: true,
    });
    if (statusResult.stdout.length > 0) {
        console.warn(
            "  WARNING: working tree is dirty. Uncommitted changes won't be included.",
        );
    } else {
        console.log("  Working tree clean.");
    }

    // Step 2: Create release if needed.
    console.log("\n[2/5] Release check...");
    const tagResult = await resolvedExec(
        `gh release view ${resolvedTag} --json id`,
        { silent: true },
    );
    if (tagResult.exitCode === 0) {
        console.log(`  Release ${resolvedTag} already exists.`);
    } else {
        console.log(`  Creating release ${resolvedTag}...`);
        const createResult = await resolvedExec(
            `gh release create ${resolvedTag} --prerelease --title "Data packs ${today()}" --notes "Offline data packs for JetLag Hide & Seek. See ${noticeUrl}"`,
        );
        if (createResult.exitCode !== 0) {
            console.error(`  Failed to create release: ${createResult.stderr}`);
            process.exitCode = 1;
            return;
        }
        console.log(`  Created release ${resolvedTag}.`);
    }

    // Step 3: Upload artifacts.
    console.log("\n[3/5] Uploading artifacts...");
    const uploads = await collectUploads(regionId, resolvedDistDir);

    if (uploads.size === 0) {
        console.error("  No artifacts found to upload.");
        process.exitCode = 1;
        return;
    }

    for (const [assetName, localPath] of uploads) {
        console.log(`  Uploading ${assetName}...`);
        const result = await resolvedExec(
            `gh release upload ${resolvedTag} "${localPath}" --clobber`,
        );
        if (result.exitCode !== 0) {
            console.error(`  Failed to upload ${assetName}: ${result.stderr}`);
            process.exitCode = 1;
            return;
        }
    }
    console.log(`  Uploaded ${uploads.size} artifact(s).`);

    // Step 4: Rebuild catalog.json.
    console.log("\n[4/5] Rebuilding catalog...");

    // Fetch currently published catalog.
    let baseCatalog = undefined;
    try {
        const published = await resolvedFetch(catalogUrl);
        if (published === null) {
            console.log(
                "  No published catalog found (first publish or 404). Starting fresh.",
            );
        } else {
            baseCatalog = published;
            console.log("  Fetched published catalog as base.");
        }
    } catch (err) {
        console.error(`  ERROR fetching published catalog: ${err.message}`);
        console.error("  Aborting — don't risk clobbering published packs.");
        process.exitCode = 1;
        return;
    }

    const { buildCatalog: build } = await import("./build-catalog.mjs");
    const catalog = await build({
        regionIds: [regionId],
        tag: resolvedTag,
        repo: resolvedRepo,
        baseCatalog,
        distDir: resolvedDistDir,
    });

    const catalogOutPath = resolve(resolvedDistDir, "catalog.json");
    await mkdir(resolvedDistDir, { recursive: true });
    await writeFile(catalogOutPath, JSON.stringify(catalog, null, 2) + "\n");
    console.log(`  Wrote ${catalogOutPath}`);

    // Step 5: Write catalog files to site/packs/ and commit to master.
    // The site/ directory is deployed by pages.yml via GitHub Actions —
    // a single deploy path for splash, deep links, viewer, and catalog.
    console.log("\n[5/5] Committing catalog to site/packs/...");

    const sitePacksDir = siteDir
        ? resolve(siteDir, "packs")
        : resolve(root, "site", "packs");
    await mkdir(sitePacksDir, { recursive: true });

    // catalog.json
    await writeFile(
        resolve(sitePacksDir, "catalog.json"),
        JSON.stringify(catalog, null, 2) + "\n",
    );
    console.log(`  Wrote site/packs/catalog.json`);

    // NOTICE
    const noticeContent = [
        "JetLag Hide & Seek — Offline Data Packs",
        "",
        "This data is derived from OpenStreetMap, © OpenStreetMap contributors.",
        "Licensed under the Open Database License (ODbL).",
        "",
        "Source: Geofabrik GmbH (download.geofabrik.de)",
        "See https://www.openstreetmap.org/copyright for details.",
        "",
        `Generated: ${today()}`,
        `Repository: https://github.com/${resolvedRepo}`,
        "",
    ].join("\n");
    await writeFile(resolve(sitePacksDir, "NOTICE"), noticeContent);

    // index.html (human-readable pack table).
    const html = buildIndexHtml(catalog);
    await writeFile(resolve(sitePacksDir, "index.html"), html);

    // Commit and push master.
    await resolvedExec(`git -C ${root} add site/packs/`);
    const commitResult = await resolvedExec(
        `git -C ${root} commit -m "Update packs catalog for ${regionId} [skip ci]"`,
    );
    if (commitResult.exitCode === 0) {
        await resolvedExec(`git -C ${root} push origin master`);
        console.log("  Pushed catalog to master (pages.yml will deploy).");
    } else if (
        commitResult.stderr.includes("nothing to commit") ||
        commitResult.stdout.includes("nothing to commit")
    ) {
        console.log("  No changes to commit (catalog unchanged).");
    } else {
        console.error(`  Commit failed: ${commitResult.stderr}`);
        process.exitCode = 1;
        return;
    }

    // Step 6: Print catalog URL.
    console.log("\n=== Done ===");
    console.log(`Catalog URL: ${catalogUrl}`);
    console.log(`\nSanity check:`);
    console.log(`  curl ${catalogUrl}`);
    console.log(`  curl -s ${catalogUrl} | jq '.packs | length'`);

    return { tag: resolvedTag, catalogUrl };
}

/**
 * Build a minimal human-readable index.html from the catalog.
 *
 * @param {object} catalog
 * @returns {string}
 */
export function buildIndexHtml(catalog) {
    const packRows = catalog.packs
        .map(
            (p) => `
        <tr>
          <td><strong>${p.id}</strong></td>
          <td>${p.label}</td>
          <td>${p.regionPath.join(" / ")}</td>
          <td>${(p.totalBytes / 1024 / 1024).toFixed(1)} MB</td>
          <td>${p.artifacts.length}</td>
          <td>${p.osmSnapshot}</td>
        </tr>`,
        )
        .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JetLag Hide &amp; Seek — Offline Data Packs</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; font-weight: 600; }
    a { color: #0366d6; }
    .meta { color: #666; font-size: 0.875rem; margin-top: 2rem; }
  </style>
</head>
<body>
  <h1>JetLag Hide &amp; Seek — Offline Data Packs</h1>
  <p>Download these packs from the app to play without network dependencies.</p>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Region</th>
        <th>Path</th>
        <th>Size</th>
        <th>Artifacts</th>
        <th>OSM Snapshot</th>
      </tr>
    </thead>
    <tbody>
      ${packRows}
    </tbody>
  </table>
  <div class="meta">
    <p>Catalog generated: ${catalog.generatedAt}</p>
    <p><a href="NOTICE">Attribution &amp; License (NOTICE)</a></p>
  </div>
</body>
</html>`;
}

async function main() {
    const args = process.argv.slice(2);
    let regionId = null;
    let tag = undefined;
    let repo = undefined;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--region" && i + 1 < args.length) {
            regionId = args[++i];
        } else if (args[i] === "--tag" && i + 1 < args.length) {
            tag = args[++i];
        } else if (args[i] === "--repo" && i + 1 < args.length) {
            repo = args[++i];
        }
    }

    if (!regionId) {
        console.error(
            "Usage: pnpm data:pack:publish -- --region <id> [--tag packs-YYYY-MM-DD] [--repo org/repo]",
        );
        process.exitCode = 2;
        return;
    }

    await publish({ regionId, tag, repo });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}
