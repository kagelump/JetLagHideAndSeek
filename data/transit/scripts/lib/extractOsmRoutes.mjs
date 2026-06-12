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
 * Extract route relations from a PBF.
 *
 * @param {object} opts
 * @param {string} opts.pbfPath - path to the source OSM PBF
 * @param {string} opts.cacheDir - directory to cache filtered PBF + OSM XML
 * @param {string} opts.regionId - region id (used for cache file names)
 * @returns {Promise<{ relations: object[], nodeCoords: Map<number,{lat: number, lon: number}> }>}
 */
export async function extractRouteRelationsFromPbf({
    pbfPath,
    cacheDir,
    regionId,
}) {
    await mkdir(cacheDir, { recursive: true });

    const relations = [];
    /** @type {Map<number, {lat: number, lon: number}>} */
    const nodeCoords = new Map();
    const stats = {
        parsed: 0,
        droppedNoTags: 0,
    };

    try {
        // Tags-filter: route relations only.
        const filteredRoutesPbf = join(cacheDir, `${regionId}-routes.osm.pbf`);
        if (!existsSync(filteredRoutesPbf)) {
            console.log(
                `  [extractOsmRoutes] Filtering route tags for ${regionId}...`,
            );
            execFileSync(
                "osmium",
                [
                    "tags-filter",
                    pbfPath,
                    "r/route=train",
                    "r/route=subway",
                    "r/route=light_rail",
                    "r/route=monorail",
                    "r/route_master=train",
                    "r/route_master=subway",
                    "r/route_master=light_rail",
                    "r/route_master=monorail",
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
        const routesOsmPath = join(cacheDir, `${regionId}-routes.osm`);
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
                        v: vMatch[1],
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
                        role: roleMatch ? roleMatch[1] : "",
                    });
                }
                continue;
            }
        }

        console.log(
            `  [extractOsmRoutes] ${stats.parsed} relations parsed for ${regionId} ` +
                `(${nodeCoords.size} node coords collected)` +
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
        return { relations: [], nodeCoords: new Map() };
    }

    return { relations, nodeCoords };
}
