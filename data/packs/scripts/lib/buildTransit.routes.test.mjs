/**
 * Tests for buildTransit route extraction.
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import {
    mkdtempSync,
    mkdirSync,
    writeFileSync,
    rmSync,
    existsSync,
    readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

import { buildTransitArtifact } from "./buildTransit.mjs";

function osmiumAvailable() {
    try {
        execFileSync("osmium", ["--version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

describe("buildTransit routes", { skip: !osmiumAvailable() }, () => {
    /** @type {string} */
    let tmpDir;
    /** @type {string} */
    let pbfPath;
    /** @type {string} */
    let distDir;
    /** @type {string} */
    let cacheDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "buildTransit-routes-test-"));
        distDir = join(tmpDir, "dist");
        cacheDir = join(tmpDir, "cache");
        mkdirSync(distDir, { recursive: true });

        const osmXml = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="1" lat="52.0" lon="4.0">
    <tag k="railway" v="station"/>
    <tag k="name" v="Station A"/>
    <tag k="operator" v="Test Operator"/>
  </node>
  <node id="2" lat="52.1" lon="4.1">
    <tag k="railway" v="station"/>
    <tag k="name" v="Station B"/>
    <tag k="operator" v="Test Operator"/>
  </node>
  <node id="3" lat="52.2" lon="4.2">
    <tag k="railway" v="station"/>
    <tag k="name" v="Station C"/>
    <tag k="operator" v="Test Operator"/>
  </node>
  <node id="4" lat="52.3" lon="4.3">
    <tag k="railway" v="station"/>
    <tag k="name" v="Orphan Station"/>
    <tag k="operator" v="Test Operator"/>
  </node>
  <node id="5" lat="52.4" lon="4.4">
    <tag k="public_transport" v="station"/>
    <tag k="name" v="Ferry Terminal"/>
    <tag k="operator" v="Test Operator"/>
  </node>
  <node id="6" lat="52.05" lon="4.05">
    <tag k="railway" v="station"/>
    <tag k="name" v="Station X"/>
    <tag k="operator" v="Other Operator"/>
  </node>

  <relation id="100">
    <tag k="route_master" v="train"/>
    <tag k="name" v="Test Line"/>
    <tag k="colour" v="#00AA00"/>
    <tag k="operator" v="Test Operator"/>
    <member type="relation" ref="101" role="route"/>
    <member type="relation" ref="102" role="route"/>
  </relation>
  <relation id="101">
    <tag k="route" v="train"/>
    <tag k="name" v="Test Line Inbound"/>
    <tag k="operator" v="Test Operator"/>
    <member type="node" ref="1" role="stop"/>
    <member type="node" ref="2" role="stop"/>
    <member type="node" ref="3" role="stop"/>
  </relation>
  <relation id="102">
    <tag k="route" v="train"/>
    <tag k="name" v="Test Line Outbound"/>
    <tag k="operator" v="Test Operator"/>
    <member type="node" ref="3" role="stop"/>
    <member type="node" ref="2" role="stop"/>
    <member type="node" ref="1" role="stop"/>
  </relation>
  <relation id="103">
    <tag k="route" v="train"/>
    <tag k="name" v="Ghost Line"/>
    <tag k="operator" v="Test Operator"/>
    <member type="node" ref="999" role="stop"/>
    <member type="node" ref="998" role="stop"/>
  </relation>
  <relation id="104">
    <tag k="route" v="train"/>
    <tag k="name" v="Other Line"/>
    <tag k="colour" v="#0000FF"/>
    <tag k="operator" v="Other Operator"/>
    <member type="node" ref="6" role="stop"/>
    <member type="node" ref="2" role="stop"/>
  </relation>
</osm>`;

        const osmPath = join(tmpDir, "test.osm");
        writeFileSync(osmPath, osmXml);
        pbfPath = join(tmpDir, "test.osm.pbf");
        execFileSync("osmium", ["cat", osmPath, "-o", pbfPath, "-O"], {
            stdio: "ignore",
        });
    });

    after(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("emits routes with OSM colors and links stations via routeIds", async () => {
        const result = await buildTransitArtifact({
            region: { id: "test-region" },
            pbfPath,
            distDir,
            cacheDir,
        });

        assert.ok(result, "artifact built");
        assert.ok(existsSync(result.gzPath), "transit.json.gz written");

        const bundle = JSON.parse(
            gunzipSync(readFileSync(result.gzPath)).toString("utf8"),
        );
        assert.ok(Array.isArray(bundle.presets));

        const operatorPreset = bundle.presets.find(
            (p) => p.operator === "Test Operator",
        );
        assert.ok(operatorPreset, "operator preset exists");
        assert.ok(
            operatorPreset.routes.length >= 1,
            "preset has at least one route",
        );

        const route = operatorPreset.routes.find((r) => r.name === "Test Line");
        assert.ok(route, "route_master-derived route exists");
        assert.equal(route.color.toLowerCase(), "#00aa00");
        assert.equal(route.geometry.type, "MultiLineString");
        assert.ok(route.geometry.coordinates.length >= 1);

        const stationsWithRoute = operatorPreset.stations.filter(
            (s) => s.routeIds.length > 0,
        );
        assert.ok(
            stationsWithRoute.length >= 1,
            "at least one station has routeIds",
        );

        // Station ids use the osm:node:<id> format.
        for (const station of operatorPreset.stations) {
            assert.match(station.id, /^osm:node:\d+$/);
            assert.equal(station.sourceId, station.id);
        }

        // Ghost line with no resolvable stops should be dropped.
        const ghostRoute = operatorPreset.routes.find((r) =>
            r.name.includes("Ghost"),
        );
        assert.ok(!ghostRoute, "route with no stops is dropped");

        // Non-rail public_transport=station node should not appear.
        const allStationIds = bundle.presets.flatMap((p) =>
            p.stations.map((s) => s.id),
        );
        assert.ok(
            !allStationIds.includes("osm:node:5"),
            "non-rail ferry terminal is filtered out",
        );

        // A route in one operator preset should still color stations in the
        // coverage preset when its resolved member station is present there.
        // "Other Operator" has only 1 station (< MIN_OPERATOR_STATIONS = 3),
        // so it's folded into the coverage preset.
        const coveragePreset = bundle.presets.find(
            (p) => p.kind === "coverage",
        );
        assert.ok(coveragePreset, "coverage preset exists");
        const otherRoute = coveragePreset.routes.find(
            (r) => r.name === "Other Line",
        );
        assert.ok(otherRoute, "other operator route exists in coverage preset");
        assert.equal(otherRoute.color.toLowerCase(), "#0000ff");

        const stationX = coveragePreset.stations.find(
            (s) => s.id === "osm:node:6",
        );
        assert.ok(stationX, "station X exists in coverage preset");
        assert.ok(
            stationX.routeIds.includes("osm:relation:104"),
            "cross-operator routeId attaches to member station",
        );
    });

    it("does not duplicate operator-preset stations into the coverage preset (Issue 1)", async () => {
        // "Test Operator" has 3 stations (≥ MIN_OPERATOR_STATIONS),
        // so it gets its own operator preset. Those 3 stations must NOT
        // also appear in the coverage preset.
        const result = await buildTransitArtifact({
            region: { id: "test-region" },
            pbfPath,
            distDir,
            cacheDir,
        });

        assert.ok(result, "artifact built");
        const bundle = JSON.parse(
            gunzipSync(readFileSync(result.gzPath)).toString("utf8"),
        );

        const operatorPreset = bundle.presets.find(
            (p) => p.operator === "Test Operator",
        );
        const coveragePreset = bundle.presets.find(
            (p) => p.kind === "coverage",
        );

        assert.ok(operatorPreset, "operator preset exists");

        if (coveragePreset) {
            // No station in the operator preset should also be in coverage.
            const operatorIds = new Set(
                operatorPreset.stations.map((s) => s.id),
            );
            for (const s of coveragePreset.stations) {
                assert.ok(
                    !operatorIds.has(s.id),
                    `station ${s.id} should not be in both operator and coverage presets`,
                );
            }
        }
    });
});
