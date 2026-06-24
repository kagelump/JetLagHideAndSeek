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
    // single transformed module (returns in ~0s and warms nothing), whereas the
    // dev client requests `entry.bundle` — the full-graph compile of ~2200
    // modules (≈30s Android / ≈100s iOS cold). Warming `.bundle` forces that
    // graph transform now, so the first flow's launch hits a warm cache instead
    // of racing the cold compile past bootstrap's app-mounted gate.
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
