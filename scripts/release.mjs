#!/usr/bin/env node
// One-command release cutter.
//
// Bumps the app version, runs the full check + test gate, commits, tags `vX.Y.Z`,
// and pushes — which triggers the "EAS Release Build" workflow (it fires on `v*`
// tags and validates the tag against app.json's expo.version).
//
// Usage:
//   pnpm release              # patch bump  (0.1.3 -> 0.1.4)
//   pnpm release minor        # minor bump  (0.1.3 -> 0.2.0)
//   pnpm release major        # major bump  (0.1.3 -> 1.0.0)
//   pnpm release 0.5.0        # explicit version
//
// Flags:
//   --dry-run            # show what would happen; touch nothing
//   --yes, -y            # skip the confirmation prompt
//   --remote <name>      # git remote to push to (default: origin)
//   --branch <name>      # branch that releases must be cut from (default: master)
//   --allow-any-branch   # don't enforce the release branch
//   --skip-gate          # skip `pnpm check` + `pnpm test` (NOT recommended)

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import semver from "semver";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_JSON = resolve(repoRoot, "app.json");
const PKG_JSON = resolve(repoRoot, "package.json");

const RELEASES = new Set(["patch", "minor", "major"]);

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
        bump: "patch",
        explicit: null,
        dryRun: false,
        yes: false,
        remote: "origin",
        branch: "master",
        allowAnyBranch: false,
        skipGate: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dry-run") opts.dryRun = true;
        else if (a === "--yes" || a === "-y") opts.yes = true;
        else if (a === "--allow-any-branch") opts.allowAnyBranch = true;
        else if (a === "--skip-gate") opts.skipGate = true;
        else if (a === "--remote") opts.remote = argv[++i];
        else if (a === "--branch") opts.branch = argv[++i];
        else if (RELEASES.has(a)) opts.bump = a;
        else if (semver.valid(a)) opts.explicit = a;
        else fail(`Unrecognized argument: ${a}`);
    }
    return opts;
}

function readVersion(file) {
    const json = JSON.parse(readFileSync(file, "utf8"));
    // app.json nests version under expo; package.json keeps it top-level.
    return file === APP_JSON ? json.expo.version : json.version;
}

// Replace the exact current version string to preserve file formatting.
function writeVersion(file, current, next) {
    const text = readFileSync(file, "utf8");
    const needle = `"version": "${current}"`;
    if (!text.includes(needle)) {
        fail(`Could not find ${needle} in ${file}`);
    }
    writeFileSync(file, text.replace(needle, `"version": "${next}"`));
}

async function confirm(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    rl.close();
    return answer === "y" || answer === "yes";
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));

    // ---- Preflight -------------------------------------------------------
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (!opts.allowAnyBranch && branch !== opts.branch) {
        fail(
            `On branch "${branch}", expected "${opts.branch}". ` +
                `Switch branches or pass --allow-any-branch.`,
        );
    }

    // Tracked modifications block a release; stray untracked files don't.
    if (git(["status", "--porcelain", "--untracked-files=no"]) !== "") {
        fail(
            "Working tree has uncommitted changes to tracked files. Commit or stash them before cutting a release.",
        );
    }

    const appVersion = readVersion(APP_JSON);
    if (!semver.valid(appVersion)) {
        fail(`app.json expo.version "${appVersion}" is not valid semver.`);
    }

    const next = opts.explicit ?? semver.inc(appVersion, opts.bump);
    if (!next) fail(`Could not compute next version from ${appVersion}.`);
    if (!semver.gt(next, appVersion)) {
        fail(`Next version ${next} is not greater than current ${appVersion}.`);
    }
    const tag = `v${next}`;

    // Tag must not already exist locally or on the remote.
    if (git(["tag", "--list", tag]) === tag) {
        fail(`Tag ${tag} already exists locally.`);
    }
    git(["fetch", opts.remote, "--tags"], { allowFail: true });
    if (git(["ls-remote", "--tags", opts.remote, tag]) !== "") {
        fail(`Tag ${tag} already exists on ${opts.remote}.`);
    }

    // Branch must be up to date with its remote counterpart.
    const remoteRef = `${opts.remote}/${branch}`;
    const ahead = git(["rev-list", "--count", `${remoteRef}..HEAD`], {
        allowFail: true,
    });
    const behind = git(["rev-list", "--count", `HEAD..${remoteRef}`], {
        allowFail: true,
    });
    if (behind && behind !== "0") {
        fail(
            `Local ${branch} is ${behind} commit(s) behind ${remoteRef}. Pull first.`,
        );
    }

    const pkgVersion = readVersion(PKG_JSON);

    console.log("\nRelease plan");
    console.log("────────────");
    console.log(`  branch       ${branch}  →  ${opts.remote}`);
    console.log(`  app.json     ${appVersion}  →  ${next}`);
    console.log(
        `  package.json ${pkgVersion}  →  ${next}` +
            (pkgVersion !== appVersion ? "  (was out of sync)" : ""),
    );
    console.log(`  tag          ${tag}`);
    if (ahead && ahead !== "0") {
        console.log(`  note         ${ahead} local commit(s) will be pushed`);
    }
    console.log(`  gate         ${opts.skipGate ? "SKIPPED" : "pnpm check && pnpm test"}`);

    if (opts.dryRun) {
        console.log("\n✓ Dry run — nothing changed.\n");
        return;
    }

    if (!opts.yes && !(await confirm(`\nCut release ${tag}?`))) {
        console.log("Aborted.");
        return;
    }

    // ---- Gate ------------------------------------------------------------
    // Run before touching files so a failure leaves the tree pristine.
    if (!opts.skipGate) {
        run("pnpm check");
        run("pnpm test");
    }

    // ---- Bump ------------------------------------------------------------
    writeVersion(APP_JSON, appVersion, next);
    writeVersion(PKG_JSON, pkgVersion, next);
    run("pnpm exec prettier --write app.json package.json");

    // ---- Commit, tag, push ----------------------------------------------
    git(["add", "app.json", "package.json"]);
    git(["commit", "-m", `chore: cut release ${next}`]);
    git(["tag", "-a", tag, "-m", `Release ${tag}`]);
    run(`git push ${opts.remote} ${branch}`);
    run(`git push ${opts.remote} ${tag}`);

    console.log(`\n✓ Released ${tag}.`);
    console.log(
        "  EAS Release Build is now running. Watch it with:\n" +
            `    gh run watch --repo $(git remote get-url ${opts.remote} | sed -E 's#.*github.com[:/]([^/]+/[^/.]+).*#\\1#')\n` +
            "  or: gh run list --workflow=eas-release-build.yml\n",
    );
}

main().catch((err) => fail(err.stack || String(err)));
