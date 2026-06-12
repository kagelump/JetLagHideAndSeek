/**
 * Tests for extractOsmRoutes.
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractRouteRelationsFromPbf } from "./extractOsmRoutes.mjs";

describe("extractRouteRelationsFromPbf", () => {
    /** @type {string} */
    let tmpDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "extractOsmRoutes-test-"));
    });

    after(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("parses route relations, tags, members, and node coordinates", async () => {
        // Pre-create dummy cached PBF so osmium tags-filter is skipped.
        writeFileSync(join(tmpDir, "test-region-routes.osm.pbf"), "dummy");

        const osmXml = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="101" lat="35.0" lon="139.0"/>
  <node id="102" lat="35.1" lon="139.1"/>
  <relation id="1001">
    <tag k="route_master" v="train"/>
    <tag k="name" v="Test Line"/>
    <tag k="colour" v="#ff0000"/>
    <member type="relation" ref="1002" role="route"/>
    <member type="relation" ref="1003" role="route"/>
  </relation>
  <relation id="1002">
    <tag k="route" v="train"/>
    <tag k="name" v="Test Line (Inbound)"/>
    <member type="node" ref="101" role="stop"/>
    <member type="node" ref="102" role="stop"/>
  </relation>
  <relation id="1003">
    <tag k="route" v="train"/>
    <tag k="name" v="Test Line (Outbound)"/>
    <member type="node" ref="102" role="stop"/>
    <member type="node" ref="101" role="stop"/>
  </relation>
</osm>`;
        writeFileSync(join(tmpDir, "test-region-routes.osm"), osmXml);

        const { relations, nodeCoords } = await extractRouteRelationsFromPbf({
            pbfPath: join(tmpDir, "dummy.osm.pbf"),
            cacheDir: tmpDir,
            regionId: "test-region",
        });

        assert.equal(relations.length, 3);

        const master = relations.find((r) => r.id === 1001);
        assert.ok(master, "route_master relation parsed");
        assert.equal(master.properties.tags.route_master, "train");
        assert.equal(master.properties.tags.name, "Test Line");
        assert.equal(master.properties.tags.colour, "#ff0000");
        assert.equal(master.properties.members.length, 2);

        const route = relations.find((r) => r.id === 1002);
        assert.ok(route, "route relation parsed");
        assert.equal(route.properties.tags.route, "train");
        assert.equal(route.properties.members.length, 2);
        assert.deepEqual(route.properties.members[0], {
            type: "node",
            ref: 101,
            role: "stop",
        });

        assert.equal(nodeCoords.size, 2);
        assert.deepEqual(nodeCoords.get(101), { lat: 35.0, lon: 139.0 });
        assert.deepEqual(nodeCoords.get(102), { lat: 35.1, lon: 139.1 });
    });

    it("returns empty collections when no PBF source is available", async () => {
        const { relations, nodeCoords } = await extractRouteRelationsFromPbf({
            pbfPath: join(tmpDir, "does-not-exist.osm.pbf"),
            cacheDir: tmpDir,
            regionId: "missing",
        });

        assert.equal(relations.length, 0);
        assert.equal(nodeCoords.size, 0);
    });
});
