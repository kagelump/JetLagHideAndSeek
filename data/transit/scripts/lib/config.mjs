import { readFile } from "node:fs/promises";

import YAML from "yaml";

/**
 * Load and validate the transit pipeline config.
 *
 * @param {string} configPath - path to config.yaml
 * @returns {Promise<object>} validated config object
 */
export async function loadConfig(configPath) {
    const raw = YAML.parse(await readFile(configPath, "utf8"));
    const errors = validateConfig(raw, configPath);
    if (errors.length > 0) {
        const msg = errors.map((e) => `  ${e}`).join("\n");
        throw new Error(`Invalid config (${configPath}):\n${msg}`);
    }
    return raw;
}

/**
 * Validate a parsed config object. Returns an array of error messages.
 *
 * @param {object} cfg - parsed config
 * @param {string} configPath - path for error messages
 * @returns {string[]} error messages (empty = valid)
 */
export function validateConfig(cfg, configPath = "config.yaml") {
    const errors = [];

    if (!cfg || typeof cfg !== "object") {
        return [`${configPath}: config must be a YAML mapping`];
    }

    // Top-level fields.
    if (!cfg.locales || !Array.isArray(cfg.locales)) {
        errors.push(`${configPath}: "locales" must be a non-empty array`);
        return errors;
    }
    if (cfg.locales.length === 0) {
        errors.push(`${configPath}: "locales" must have at least one entry`);
        return errors;
    }

    const localeIds = new Set();
    for (let li = 0; li < cfg.locales.length; li++) {
        const loc = cfg.locales[li];
        const prefix = `${configPath}: locales[${li}]`;

        if (!loc.id || typeof loc.id !== "string" || loc.id.trim() === "") {
            errors.push(`${prefix}: "id" must be a non-empty string`);
        } else if (localeIds.has(loc.id)) {
            errors.push(`${prefix}: duplicate locale id "${loc.id}"`);
        } else {
            localeIds.add(loc.id);
        }

        if (
            loc.maxClusterMeters == null ||
            typeof loc.maxClusterMeters !== "number" ||
            loc.maxClusterMeters <= 0
        ) {
            errors.push(
                `${prefix}: "maxClusterMeters" must be a positive number, got ${JSON.stringify(loc.maxClusterMeters)}`,
            );
        }

        if (loc.aliases && !Array.isArray(loc.aliases)) {
            errors.push(`${prefix}: "aliases" must be an array`);
        }

        // Validate GTFS feeds.
        if (loc.gtfs !== undefined && !Array.isArray(loc.gtfs)) {
            errors.push(`${prefix}: "gtfs" must be an array when present`);
        } else if (loc.gtfs && Array.isArray(loc.gtfs)) {
            const feedIds = new Set();
            const namespaces = new Set();

            for (let fi = 0; fi < loc.gtfs.length; fi++) {
                const feed = loc.gtfs[fi];
                const fprefix = `${prefix}: gtfs[${fi}]`;

                if (
                    !feed.id ||
                    typeof feed.id !== "string" ||
                    feed.id.trim() === ""
                ) {
                    errors.push(`${fprefix}: "id" must be a non-empty string`);
                } else if (feedIds.has(feed.id)) {
                    errors.push(`${fprefix}: duplicate feed id "${feed.id}"`);
                } else {
                    feedIds.add(feed.id);
                }

                if (
                    !feed.namespace ||
                    typeof feed.namespace !== "string" ||
                    feed.namespace.trim() === ""
                ) {
                    errors.push(
                        `${fprefix}: "namespace" must be a non-empty string`,
                    );
                } else if (namespaces.has(feed.namespace)) {
                    errors.push(
                        `${fprefix}: duplicate namespace "${feed.namespace}"`,
                    );
                } else {
                    namespaces.add(feed.namespace);
                }

                // Every GTFS feed needs a URL.
                if (
                    !feed.url ||
                    typeof feed.url !== "string" ||
                    feed.url.trim() === ""
                ) {
                    errors.push(`${fprefix}: "url" must be a non-empty string`);
                }

                // Every GTFS feed must have a license (design doc: Attribution).
                if (
                    !feed.license ||
                    typeof feed.license !== "string" ||
                    feed.license.trim() === ""
                ) {
                    errors.push(
                        `${fprefix}: "license" is required for every GTFS feed`,
                    );
                }

                if (
                    !feed.lineGrouping ||
                    !["route_id", "short_name"].includes(feed.lineGrouping)
                ) {
                    errors.push(
                        `${fprefix}: "lineGrouping" must be "route_id" or "short_name", got ${JSON.stringify(feed.lineGrouping)}`,
                    );
                }

                if (
                    feed.routeTypes &&
                    (!Array.isArray(feed.routeTypes) ||
                        feed.routeTypes.length === 0)
                ) {
                    errors.push(
                        `${fprefix}: "routeTypes" must be a non-empty array when present`,
                    );
                }

                if (
                    feed.defaultColor &&
                    typeof feed.defaultColor !== "string"
                ) {
                    errors.push(`${fprefix}: "defaultColor" must be a string`);
                }
            }
        }

        // Validate operators.
        if (loc.operators !== undefined && !Array.isArray(loc.operators)) {
            errors.push(`${prefix}: "operators" must be an array when present`);
        } else if (loc.operators && Array.isArray(loc.operators)) {
            for (let oi = 0; oi < loc.operators.length; oi++) {
                const op = loc.operators[oi];
                const oprefix = `${prefix}: operators[${oi}]`;

                if (
                    !op.routeSource ||
                    !["gtfs", "osm"].includes(op.routeSource)
                ) {
                    errors.push(
                        `${oprefix}: "routeSource" must be "gtfs" or "osm", got ${JSON.stringify(op.routeSource)}`,
                    );
                }
            }
        }
    }

    return errors;
}
