/* global Buffer */
import assert from "node:assert/strict";
import test from "node:test";

import { buildScenarioLink } from "./build-scenario-link.mjs";

const scenario = {
    kind: "e2e-scenario",
    name: "smoke-seed",
    controls: { geometryBackend: "js", showReadout: true },
    state: {
        playArea: {
            bbox: [139.5, 35.5, 140.0, 35.9],
            center: [139.75, 35.7],
            label: "Tokyo 23 Wards",
            osmId: 19631009,
            osmType: "R",
        },
    },
};

test("builds a well-formed custom-scheme link", () => {
    const link = buildScenarioLink(scenario);
    assert.match(link, /^jetlag-hide-seek-v2:\/\/e2e\?d=[A-Za-z0-9_-]+$/);
});

test("round-trips the scenario through the encoded payload", () => {
    const link = buildScenarioLink(scenario);
    const d = new URL(link).searchParams.get("d");
    assert.ok(d, "payload present");
    const decoded = JSON.parse(Buffer.from(d, "base64url").toString("utf8"));
    assert.deepEqual(decoded, scenario);
});

test("emits a url-safe payload (no +, /, or = padding)", () => {
    const d = new URL(buildScenarioLink(scenario)).searchParams.get("d");
    assert.doesNotMatch(d, /[+/=]/);
});
