/* global console, process */

import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./lib/config.mjs";
import { loadEnv, fetchToCache } from "./lib/cache.mjs";
import { processGtfsFeed } from "./lib/gtfs.mjs";
import { generateNotice } from "./lib/notice.mjs";
import { emitStage } from "./lib/emit.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const transitDir = resolve(scriptDir, "..");

/**
 * Parse CLI arguments into a flat options object.
 * Supported: --locale <id>, --cache-only, --region <id>
 * Stops parsing at the first "--" (end-of-options marker).
 */
function parseArgs(argv) {
    const opts = { locale: "japan", cacheOnly: false, region: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--") continue; // skip pnpm arg separator
        if (argv[i] === "--locale" && argv[i + 1]) {
            opts.locale = argv[++i];
        } else if (argv[i] === "--cache-only") {
            opts.cacheOnly = true;
        } else if (argv[i] === "--region" && argv[i + 1]) {
            opts.region = argv[++i];
        }
    }
    return opts;
}

/**
 * Stage definition: { name, run(ctx) => Promise<void> }.
 * Stages run in order; a stage may be a no-op placeholder.
 */
const STAGES = [
    {
        name: "gtfs",
        async run(ctx) {
            const feeds = ctx.locale.gtfs;
            if (!feeds || feeds.length === 0) {
                console.log("[gtfs] No GTFS feeds configured.");
                ctx.gtfsPresets = [];
                return;
            }

            const cacheDir = resolve(
                ctx.transitDir,
                ctx.config.cacheDir ?? "cache",
            );
            const presets = [];
            const allStats = [];

            for (const feed of feeds) {
                const cacheFile = resolve(cacheDir, `${feed.id}.zip`);
                console.log(`[gtfs] Processing ${feed.id}...`);

                // Try to use cached zips from data/odpt/cache/ as a fallback
                // (ODPT regression — the old pipeline stored them there).
                let zipBytes;
                try {
                    zipBytes = await fetchToCache(feed.url, cacheFile, {
                        requiresKey: feed.requiresKey,
                        cacheOnly: ctx.cacheOnly,
                        env: ctx.env,
                    });
                } catch (err) {
                    // Fallback: check the old ODPT cache location.
                    const odptCacheFile = resolve(
                        ctx.transitDir,
                        "..",
                        "odpt",
                        "cache",
                        `${feed.id}.zip`,
                    );
                    if (feed.requiresKey && !ctx.env.ODPT_KEY) {
                        console.warn(
                            `  Skipping ${feed.id}: ODPT_KEY not set and feed not cached.`,
                        );
                        continue;
                    }
                    if (ctx.cacheOnly) {
                        try {
                            zipBytes = new Uint8Array(
                                await (
                                    await import("node:fs/promises")
                                ).readFile(odptCacheFile),
                            );
                            console.log(`  Using ODPT cache: ${odptCacheFile}`);
                        } catch {
                            throw err;
                        }
                    } else {
                        throw err;
                    }
                }

                if (!zipBytes) {
                    console.warn(
                        `  Skipping ${feed.id}: could not obtain feed data.`,
                    );
                    continue;
                }

                const { presets: feedPresets, stats } = processGtfsFeed(
                    feed,
                    zipBytes,
                );

                console.log(
                    `  ${feed.id}: ${stats.stationsWithLines} stations, ${feedPresets[0]?.routes.length ?? 0} routes ` +
                        `(filtered ${stats.routesFiltered ?? 0} of ${stats.routesRaw ?? 0} routes, ` +
                        `${stats.stationStops ?? 0} station-level stops from ${stats.stopsRaw ?? 0} raw stops)`,
                );

                presets.push(...feedPresets);
                allStats.push({ feedId: feed.id, ...stats });
            }

            ctx.gtfsPresets = presets;
            ctx.gtfsStats = allStats;
        },
    },
    {
        name: "emit",
        async run(ctx) {
            console.log("[emit] Writing bundles and manifest...");
            await emitStage(ctx);
        },
    },
    {
        name: "notice",
        async run(ctx) {
            console.log("[notice] Generating NOTICE.md...");
            await generateNotice(ctx.config, ctx.transitDir);
            console.log(`  Wrote ${resolve(ctx.transitDir, "NOTICE.md")}`);
        },
    },
];

async function main() {
    // Load ~/.env for ODPT_KEY and other credentials (process.env wins).
    const env = await loadEnv();

    const opts = parseArgs(process.argv.slice(2));

    // Resolve config path.
    const configPath = resolve(transitDir, "config.yaml");
    console.log(`Loading config: ${configPath}`);

    const config = await loadConfig(configPath);

    // Select locale.
    const locale = config.locales.find((l) => l.id === opts.locale);
    if (!locale) {
        throw new Error(
            `Unknown locale "${opts.locale}". Available: ${config.locales.map((l) => l.id).join(", ")}`,
        );
    }

    // Resolve output directory.
    const outputDir = resolve(
        transitDir,
        config.outputDir ?? "../../assets/transit",
    );
    await mkdir(outputDir, { recursive: true });

    // Build context.
    const ctx = {
        config,
        locale,
        transitDir,
        outputDir,
        cacheOnly: opts.cacheOnly,
        region: opts.region,
        env,
    };

    // Run stages.
    for (const stage of STAGES) {
        console.log(`\n=== ${stage.name} ===`);
        await stage.run(ctx);
    }

    console.log("\nDone.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}
