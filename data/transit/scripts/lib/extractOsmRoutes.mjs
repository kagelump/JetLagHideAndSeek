/**
 * Shared OSM route-relation extraction.
 *
 * Filters route/route_master relations from a PBF, converts them to OSM XML,
 * and parses the relations + member node coordinates needed by
 * processOsmRoutes.  Failures are non-fatal: they log a warning and return
 * empty collections so callers can continue without routes.
 *
 * @module extractOsmRoutes
 */

/* global console */

import { execFileSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";

/**
 * Decode XML entities in a string.
 *
 * Handles: &lt; &gt; &amp; &quot; &apos; &#NN; &#xHH;
 * Decodes &amp; **last** so double-encoded sequences resolve correctly.
 *
 * @param {string} s
 * @returns {string}
 */
export function decodeXmlEntities(s) {
    if (!s || typeof s !== "string") return s;
    let out = s;
    // fromCodePoint (not fromCharCode) so astral entities (e.g. &#x1F684;)
    // decode correctly instead of mangling into surrogate halves.
    out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
        String.fromCodePoint(parseInt(hex, 16)),
    );
    out = out.replace(/&#(\d+);/g, (_, dec) =>
        String.fromCodePoint(parseInt(dec, 10)),
    );
    out = out.replace(/&lt;/g, "<");
    out = out.replace(/&gt;/g, ">");
    out = out.replace(/&quot;/g, '"');
    out = out.replace(/&apos;/g, "'");
    out = out.replace(/&amp;/g, "&");
    return out;
}

/**
 * Default route modes for extraction.
 */
const DEFAULT_ROUTE_MODES = ["train", "subway", "light_rail", "monorail"];

/**
 * Extract route relations from a PBF.
 *
 * @param {object} opts
 * @param {string} opts.pbfPath - path to the source OSM PBF
 * @param {string} opts.cacheDir - directory to cache filtered PBF + OSM XML
 * @param {string} opts.regionId - region id (used for cache file names)
 * @param {string[]} [opts.routeModes] - route modes to extract (default: train/subway/light_rail/monorail)
 * @param {boolean} [opts.includeRailway] - include route=railway/track infrastructure (default: false)
 * @returns {Promise<{ relations: object[], nodeCoords: Map<number,{lat: number, lon: number}>, ways: Map<number, number[]> }>}
 */
export async function extractRouteRelationsFromPbf({
    pbfPath,
    cacheDir,
    regionId,
    routeModes,
    includeRailway,
}) {
    await mkdir(cacheDir, { recursive: true });

    const modes = routeModes ?? DEFAULT_ROUTE_MODES;
    const railway = includeRailway ?? false;

    // Cache-key: legacy filename for the default mode set; suffix for railway.
    const cacheSuffix = railway ? "-rail" : "";

    const relations = [];
    /** @type {Map<number, {lat: number, lon: number}>} */
    const nodeCoords = new Map();
    /** @type {Map<number, number[]>} */
    const ways = new Map();
    const stats = {
        parsed: 0,
        droppedNoTags: 0,
    };

    try {
        // Build tags-filter args from mode list.
        const filterArgs = [];
        for (const mode of modes) {
            filterArgs.push(`r/route=${mode}`);
            filterArgs.push(`r/route_master=${mode}`);
        }
        if (railway) {
            filterArgs.push("r/route=railway");
            filterArgs.push("r/route_master=railway");
            filterArgs.push("r/route=tracks");
            filterArgs.push("r/route_master=tracks");
        }

        const filteredRoutesPbf = join(
            cacheDir,
            `${regionId}-routes${cacheSuffix}.osm.pbf`,
        );
        if (!existsSync(filteredRoutesPbf)) {
            console.log(
                `  [extractOsmRoutes] Filtering route tags for ${regionId} (${modes.join(",")}${railway ? "+railway" : ""})...`,
            );
            execFileSync(
                "osmium",
                [
                    "tags-filter",
                    pbfPath,
                    ...filterArgs,
                    "-o",
                    filteredRoutesPbf,
                    "-O",
                ],
                { stdio: "inherit" },
            );
        } else {
            console.log(
                `  [extractOsmRoutes] Using cached filtered: ${filteredRoutesPbf}`,
            );
        }

        // Convert filtered PBF → OSM XML for relation parsing.
        const routesOsmPath = join(
            cacheDir,
            `${regionId}-routes${cacheSuffix}.osm`,
        );
        if (!existsSync(routesOsmPath)) {
            console.log(
                `  [extractOsmRoutes] Converting to OSM XML for ${regionId}...`,
            );
            execFileSync(
                "osmium",
                ["cat", filteredRoutesPbf, "-o", routesOsmPath, "-O"],
                { stdio: "inherit" },
            );
        } else {
            console.log(
                `  [extractOsmRoutes] Using cached XML: ${routesOsmPath}`,
            );
        }

        // Parse the OSM XML — extract relation elements using a streaming
        // line-based approach (avoids loading the full DOM into memory).
        console.log(
            `  [extractOsmRoutes] Parsing relations for ${regionId}...`,
        );
        const xmlRl = createInterface({
            input: createReadStream(routesOsmPath, { encoding: "utf8" }),
            crlfDelay: Infinity,
        });

        let currentRelation = null;
        let inRelation = false;
        let currentWay = null;
        let inWay = false;

        for await (const line of xmlRl) {
            const trimmed = line.trim();

            // <node id="12345" ... lat="35.6" lon="139.7" ... />
            // Collect coordinates for spatial matching later.
            if (trimmed.startsWith("<node ")) {
                const nidMatch = trimmed.match(/id="(\d+)"/);
                const nlatMatch = trimmed.match(/lat="([^"]+)"/);
                const nlonMatch = trimmed.match(/lon="([^"]+)"/);
                if (nidMatch && nlatMatch && nlonMatch) {
                    nodeCoords.set(parseInt(nidMatch[1], 10), {
                        lat: parseFloat(nlatMatch[1]),
                        lon: parseFloat(nlonMatch[1]),
                    });
                }
                continue;
            }

            // <way id="12345" ...>
            if (trimmed.startsWith("<way ")) {
                const widMatch = trimmed.match(/id="(\d+)"/);
                if (widMatch) {
                    currentWay = {
                        id: parseInt(widMatch[1], 10),
                        nodeRefs: [],
                    };
                }

                if (trimmed.endsWith("/>")) {
                    // Self-closing way with no nd refs.
                    if (currentWay) {
                        ways.set(currentWay.id, currentWay.nodeRefs);
                    }
                    currentWay = null;
                    continue;
                }

                inWay = true;
                continue;
            }

            if (trimmed === "</way>") {
                if (inWay && currentWay) {
                    ways.set(currentWay.id, currentWay.nodeRefs);
                }
                inWay = false;
                currentWay = null;
                continue;
            }

            // <nd ref="12345"/> inside a way.
            if (inWay && currentWay && trimmed.startsWith("<nd ")) {
                const ndMatch = trimmed.match(/ref="(\d+)"/);
                if (ndMatch) {
                    currentWay.nodeRefs.push(parseInt(ndMatch[1], 10));
                }
                continue;
            }

            // <relation id="12345" ...>
            if (trimmed.startsWith("<relation ")) {
                currentRelation = { tags: [], members: [] };

                // Extract the id attribute.
                const idMatch = trimmed.match(/id="(\d+)"/);
                if (idMatch) {
                    currentRelation.id = parseInt(idMatch[1], 10);
                }

                // Self-closing tag: <relation ... /> — treat as empty.
                if (trimmed.endsWith("/>")) {
                    currentRelation = null;
                    continue;
                }

                inRelation = true;
                continue;
            }

            // Close tag — handle before the !inRelation guard so it
            // fires even when we are inside a relation.
            if (trimmed === "</relation>") {
                if (inRelation && currentRelation) {
                    const tags = currentRelation.tags;
                    const hasRouteTag = tags.some(
                        (t) => t.k === "route" || t.k === "route_master",
                    );
                    if (hasRouteTag) {
                        // Convert to the format processOsmRoutes expects.
                        const tagObj = {};
                        for (const t of tags) {
                            tagObj[t.k] = t.v;
                        }

                        relations.push({
                            id: currentRelation.id,
                            properties: {
                                "@id": currentRelation.id,
                                tags: tagObj,
                                members: currentRelation.members,
                            },
                        });
                        stats.parsed++;
                    } else {
                        stats.droppedNoTags++;
                    }
                }
                inRelation = false;
                currentRelation = null;
                continue;
            }

            if (!inRelation || !currentRelation) {
                continue;
            }

            // <tag k="..." v="..."/>
            if (trimmed.startsWith("<tag ")) {
                const kMatch = trimmed.match(/k="([^"]*)"/);
                const vMatch = trimmed.match(/v="([^"]*)"/);
                if (kMatch && vMatch) {
                    currentRelation.tags.push({
                        k: kMatch[1],
                        v: decodeXmlEntities(vMatch[1]),
                    });
                }
                continue;
            }

            // <member type="..." ref="..." role="..."/>
            if (trimmed.startsWith("<member ")) {
                const typeMatch = trimmed.match(/type="([^"]*)"/);
                const refMatch = trimmed.match(/ref="(\d+)"/);
                const roleMatch = trimmed.match(/role="([^"]*)"/);
                if (typeMatch && refMatch) {
                    currentRelation.members.push({
                        type: typeMatch[1],
                        ref: parseInt(refMatch[1], 10),
                        role: roleMatch ? decodeXmlEntities(roleMatch[1]) : "",
                    });
                }
                continue;
            }
        }

        console.log(
            `  [extractOsmRoutes] ${stats.parsed} relations parsed for ${regionId} ` +
                `(${nodeCoords.size} node coords, ${ways.size} ways collected)` +
                (stats.droppedNoTags > 0
                    ? `, ${stats.droppedNoTags} dropped (no route tags)`
                    : ""),
        );
    } catch (err) {
        console.warn(
            `  [extractOsmRoutes] Route extraction failed for ${regionId}: ${err.message}`,
        );
        console.warn(
            "  [extractOsmRoutes] Routes are optional — continuing without them.",
        );
        return { relations: [], nodeCoords: new Map(), ways: new Map() };
    }

    return { relations, nodeCoords, ways };
}
