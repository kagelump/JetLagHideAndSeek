#!/usr/bin/env node
/**
 * Starts Astro dev server and CAS server watch mode together.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const children = [
    spawn("pnpm", ["dev"], {
        cwd: root,
        stdio: "inherit",
    }),
    spawn("pnpm", ["--dir", "server", "dev"], {
        cwd: root,
        stdio: "inherit",
    }),
];

let exiting = false;

const shutdown = (signal = "SIGTERM") => {
    if (exiting) return;
    exiting = true;
    for (const child of children) {
        if (!child.killed) child.kill(signal);
    }
};

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => shutdown(signal));
}

for (const child of children) {
    child.on("exit", (code, signal) => {
        shutdown();
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }
        process.exit(code ?? 1);
    });
}
