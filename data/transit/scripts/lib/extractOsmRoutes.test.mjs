/**
 * Tests for extractOsmRoutes.
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    extractRouteRelationsFromPbf,
    decodeXmlEntities,
} from "./extractOsmRoutes.mjs";

describe("decodeXmlEntities", () => {
    it("decodes &gt; and &lt;", () => {
        assert.equal(decodeXmlEntities("新竹-&gt;基隆"), "新竹->基隆");
        assert.equal(decodeXmlEntities("A&lt;B"), "A<B");
    });

    it("decodes &amp; last (after other entities)", () => {
        assert.equal(decodeXmlEntities("a&amp;b"), "a&b");
        assert.equal(decodeXmlEntities("a&amp;amp;b"), "a&amp;b");
    });

    it("decodes &quot; and &apos;", () => {
        assert.equal(decodeXmlEntities("a&quot;b"), 'a"b');
        assert.equal(decodeXmlEntities("a&apos;b"), "a'b");
    });

    it("decodes numeric character references", () => {
        assert.equal(decodeXmlEntities("&#65;"), "A");
        assert.equal(decodeXmlEntities("&#x41;"), "A");
    });

    it("returns non-string input unchanged", () => {
        assert.equal(decodeXmlEntities(null), null);
        assert.equal(decodeXmlEntities(undefined), undefined);
        assert.equal(decodeXmlEntities(42), 42);
    });

    it("handles empty string", () => {
        assert.equal(decodeXmlEntities(""), "");
    });
});

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

    it("parses <way> elements and returns ways map", async () => {
        // Use a fresh cache dir to avoid collisions.
        const wayDir = mkdtempSync(join(tmpdir(), "extractOsmRoutes-way-"));
        writeFileSync(join(wayDir, "way-region-routes.osm.pbf"), "dummy");

        const osmXml = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="201" lat="35.0" lon="139.0"/>
  <node id="202" lat="35.1" lon="139.1"/>
  <node id="203" lat="35.2" lon="139.2"/>
  <way id="301">
    <nd ref="201"/>
    <nd ref="202"/>
  </way>
  <way id="302">
    <nd ref="202"/>
    <nd ref="203"/>
  </way>
  <relation id="401">
    <tag k="route" v="railway"/>
    <tag k="name" v="Test Railway"/>
    <member type="way" ref="301" role=""/>
    <member type="way" ref="302" role=""/>
    <member type="node" ref="201" role="stop"/>
    <member type="node" ref="203" role="stop"/>
  </relation>
</osm>`;
        writeFileSync(join(wayDir, "way-region-routes.osm"), osmXml);

        const { relations, ways } = await extractRouteRelationsFromPbf({
            pbfPath: join(wayDir, "dummy.osm.pbf"),
            cacheDir: wayDir,
            regionId: "way-region",
        });

        assert.equal(relations.length, 1);
        assert.equal(ways.size, 2);
        assert.deepEqual(ways.get(301), [201, 202]);
        assert.deepEqual(ways.get(302), [202, 203]);

        rmSync(wayDir, { recursive: true, force: true });
    });

    it("decodes XML entities in tag values and member roles", async () => {
        const entityDir = mkdtempSync(
            join(tmpdir(), "extractOsmRoutes-entity-"),
        );
        writeFileSync(join(entityDir, "entity-region-routes.osm.pbf"), "dummy");

        const osmXml = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <relation id="501">
    <tag k="route" v="train"/>
    <tag k="name" v="區間 1112 新竹-&gt;基隆"/>
    <member type="node" ref="1" role="stop"/>
  </relation>
</osm>`;
        writeFileSync(join(entityDir, "entity-region-routes.osm"), osmXml);

        const { relations } = await extractRouteRelationsFromPbf({
            pbfPath: join(entityDir, "dummy.osm.pbf"),
            cacheDir: entityDir,
            regionId: "entity-region",
        });

        assert.equal(relations.length, 1);
        assert.equal(relations[0].properties.tags.name, "區間 1112 新竹->基隆");

        rmSync(entityDir, { recursive: true, force: true });
    });

    it("adds railway/tracks filters only when includeRailway is true", async () => {
        const osmXmlTrainOnly = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="601" lat="35.0" lon="139.0"/>
  <relation id="701">
    <tag k="route" v="train"/>
    <tag k="name" v="Train Line"/>
    <member type="node" ref="601" role="stop"/>
  </relation>
</osm>`;

        const osmXmlBoth = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="601" lat="35.0" lon="139.0"/>
  <relation id="701">
    <tag k="route" v="train"/>
    <tag k="name" v="Train Line"/>
    <member type="node" ref="601" role="stop"/>
  </relation>
  <relation id="702">
    <tag k="route" v="railway"/>
    <tag k="name" v="Railway Line"/>
    <member type="node" ref="601" role="stop"/>
  </relation>
</osm>`;

        // Without includeRailway: only train relations (simulating what
        // osmium tags-filter would produce with the default mode set).
        const railDir = mkdtempSync(join(tmpdir(), "extractOsmRoutes-rail-"));
        writeFileSync(join(railDir, "rail-only-routes.osm.pbf"), "dummy");
        writeFileSync(join(railDir, "rail-only-routes.osm"), osmXmlTrainOnly);
        const withoutRail = await extractRouteRelationsFromPbf({
            pbfPath: join(railDir, "dummy.osm.pbf"),
            cacheDir: railDir,
            regionId: "rail-only",
        });
        assert.equal(withoutRail.relations.length, 1);
        assert.equal(withoutRail.relations[0].properties.tags.route, "train");

        // With includeRailway: both relations (simulating what
        // osmium tags-filter would produce with the railway mode set).
        const railDir2 = mkdtempSync(join(tmpdir(), "extractOsmRoutes-rail2-"));
        writeFileSync(join(railDir2, "rail-both-routes-rail.osm.pbf"), "dummy");
        writeFileSync(join(railDir2, "rail-both-routes-rail.osm"), osmXmlBoth);
        const withRail = await extractRouteRelationsFromPbf({
            pbfPath: join(railDir2, "dummy.osm.pbf"),
            cacheDir: railDir2,
            regionId: "rail-both",
            includeRailway: true,
        });
        assert.equal(withRail.relations.length, 2);

        rmSync(railDir, { recursive: true, force: true });
        rmSync(railDir2, { recursive: true, force: true });
    });
});
