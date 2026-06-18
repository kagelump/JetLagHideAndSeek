#!/usr/bin/env node
// OTA update publisher.
//
// Publishes a JS-only bundle to an EAS Update branch. Clients running a native
// build with a matching runtime version (policy: "fingerprint") pull it on the
// next launch — no App Store / Play review. Use this for JS/asset-only changes;
// anything that touches native deps, Expo plugins, or app.json native config
// changes the fingerprint and needs a full `pnpm release` instead.
//
// Usage:
//   pnpm update:ota -m "fix radar drift"          # publish to production
//   pnpm update:ota --branch preview -m "..."     # publish to another branch
//
// Flags:
//   -m, --message <msg>   # required: the update message
//   --branch <name>       # update branch (default: production)
//   --skip-gate           # skip `pnpm check` + `pnpm test` (NOT recommended)
//   --dry-run             # show what would happen; publish nothing
//   --yes, -y             # skip the confirmation prompt

import { execSync, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
    console.error(`\n✖ ${msg}\n`);
    process.exit(1);
}

function git(args, opts = {}) {
    const res = spawnSync("git", args, {
        cwd: repoRoot,
        encoding: "utf8",
        ...opts,
    });
    if (res.status !== 0 && !opts.allowFail) {
        fail(`git ${args.join(" ")} failed:\n${res.stderr || res.stdout}`);
    }
    return (res.stdout || "").trim();
}

function run(cmd) {
    console.log(`\n$ ${cmd}`);
    execSync(cmd, { cwd: repoRoot, stdio: "inherit" });
}

function parseArgs(argv) {
    const opts = {
        branch: "production",
        message: null,
        skipGate: false,
        dryRun: false,
        yes: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dry-run") opts.dryRun = true;
        else if (a === "--yes" || a === "-y") opts.yes = true;
        else if (a === "--skip-gate") opts.skipGate = true;
        else if (a === "--branch") opts.branch = argv[++i];
        else if (a === "--message" || a === "-m") opts.message = argv[++i];
        else fail(`Unrecognized argument: ${a}`);
    }
    return opts;
}

async function confirm(question) {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const answer = (await rl.question(`${question} [y/N] `))
        .trim()
        .toLowerCase();
    rl.close();
    return answer === "y" || answer === "yes";
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));

    if (!opts.message) {
        fail('An update message is required. Pass -m "your message".');
    }

    // Surface an uncommitted tree so the published bundle is traceable to a
    // commit, but don't hard-block (OTA isn't a tagged release).
    const dirty = git(["status", "--porcelain", "--untracked-files=no"]) !== "";
    const sha = git(["rev-parse", "--short", "HEAD"]);
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);

    console.log("\nOTA update plan");
    console.log("───────────────");
    console.log(
        `  git          ${branch} @ ${sha}${dirty ? "  (UNCOMMITTED CHANGES)" : ""}`,
    );
    console.log(`  EAS branch   ${opts.branch}`);
    console.log(`  message      ${opts.message}`);
    console.log(
        `  gate         ${opts.skipGate ? "SKIPPED" : "pnpm check && pnpm test"}`,
    );

    if (opts.dryRun) {
        console.log("\n✓ Dry run — nothing published.\n");
        return;
    }

    if (
        !opts.yes &&
        !(await confirm(`\nPublish OTA update to "${opts.branch}"?`))
    ) {
        console.log("Aborted.");
        return;
    }

    if (!opts.skipGate) {
        run("pnpm check");
        run("pnpm test");
    }

    run(
        `eas update --branch ${opts.branch} --message ${JSON.stringify(opts.message)} --non-interactive`,
    );

    console.log(`\n✓ Published OTA update to "${opts.branch}".`);
}

main().catch((err) => fail(err.stack || String(err)));
