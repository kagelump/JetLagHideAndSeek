import assert from "node:assert/strict";
import test from "node:test";

import {
    createMetroWarmUrl,
    resolveE2ePlatform,
    selectFlows,
} from "./e2e-maestro-stack-config.mjs";

const flows = [{ name: "smoke" }];

test("resolveE2ePlatform uses an explicit platform when provided", () => {
    assert.equal(resolveE2ePlatform("android", "darwin"), "android");
    assert.equal(resolveE2ePlatform("ios", "linux"), "ios");
});

test("resolveE2ePlatform defaults Linux to Android and other hosts to iOS", () => {
    assert.equal(resolveE2ePlatform(undefined, "linux"), "android");
    assert.equal(resolveE2ePlatform(undefined, "darwin"), "ios");
});

test("resolveE2ePlatform rejects unsupported values", () => {
    assert.throws(
        () => resolveE2ePlatform("web", "linux"),
        /Unknown E2E_PLATFORM "web"/,
    );
});

test("createMetroWarmUrl targets the selected platform", () => {
    assert.equal(
        createMetroWarmUrl(8081, "android"),
        "http://127.0.0.1:8081/node_modules/expo-router/entry.bundle?platform=android&dev=true&minify=false",
    );
});

test("selectFlows keeps the full list for all", () => {
    assert.deepEqual(selectFlows(flows, "all"), flows);
});

test("selectFlows returns smoke for smoke", () => {
    assert.deepEqual(selectFlows(flows, "smoke"), [{ name: "smoke" }]);
});

test("selectFlows rejects unknown flow names", () => {
    assert.throws(
        () => selectFlows(flows, "missing"),
        /Unknown E2E_FLOW "missing"/,
    );
});
