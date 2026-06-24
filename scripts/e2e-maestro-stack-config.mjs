export function resolveE2ePlatform(explicitPlatform, hostPlatform) {
    const resolved =
        explicitPlatform ?? (hostPlatform === "linux" ? "android" : "ios");

    if (resolved !== "android" && resolved !== "ios") {
        throw new Error(
            `Unknown E2E_PLATFORM "${resolved}". Expected android or ios.`,
        );
    }

    return resolved;
}

export function createMetroWarmUrl(metroPort, e2ePlatform) {
    // Request the `.bundle` endpoint, NOT `.js`. Metro serves `entry.js` as a
    // single transformed module (returns in ~0s and warms nothing), whereas a
    // `.bundle` request compiles the full ~2200-module graph, populating Metro's
    // transform cache and JITing the transformer worker pool.
    //
    // NOTE: this does NOT fully eliminate the dev client's own cold compile —
    // its bundle request carries extra options we don't replicate here (the warm
    // builds ~2216 modules, the device ~2199), so the per-module transform cache
    // only partially overlaps and the device still recompiles (~100–160s on iOS
    // cold). That in-flow compile is tolerated by bootstrap's iOS dismiss/mount
    // poll loop, not by this warm. Keep the warm anyway: it primes the worker
    // pool and the shared file cache, and it is what Android (fast compile)
    // relies on. Matching the device URL exactly is a future optimization.
    return `http://127.0.0.1:${metroPort}/node_modules/expo-router/entry.bundle?platform=${e2ePlatform}&dev=true&minify=false`;
}

export function selectFlows(flows, selectedFlow) {
    if (selectedFlow === "all") return flows;

    const selected = flows.find((flow) => flow.name === selectedFlow);
    if (!selected) {
        throw new Error(
            `Unknown E2E_FLOW "${selectedFlow}". Expected all or one of: ${flows
                .map((flow) => flow.name)
                .join(", ")}.`,
        );
    }

    return [selected];
}
