/* global console, process */

import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./lib/config.mjs";
import { loadEnv } from "./lib/cache.mjs";
import { generateNotice } from "./lib/notice.mjs";

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
        if (argv[i] === "--") break;
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
        async run(_ctx) {
            void _ctx; // Used by T2.
            // Placeholder — T2 adds GTFS extraction.
            console.log("[gtfs] (no-op — T2 adds GTFS extraction)");
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
