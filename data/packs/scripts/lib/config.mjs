/**
 * Pack pipeline config loader and validator.
 *
 * @module config
 */

import { readFile } from "node:fs/promises";

import YAML from "yaml";

/** Regex pack ids must match (same as regionPacks.ts VALID_PACK_ID). */
const VALID_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Load and validate the pack pipeline config.
 *
 * @param {string} configPath - path to regions.yaml
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
 * Validate a parsed regions config. Returns an array of error messages.
 *
 * @param {object} cfg - parsed config
 * @param {string} configPath - path for error messages
 * @returns {string[]} error messages (empty = valid)
 */
export function validateConfig(cfg, configPath = "regions.yaml") {
    const errors = [];

    if (!cfg || typeof cfg !== "object") {
        return [`${configPath}: config must be a YAML mapping`];
    }

    if (!cfg.regions || !Array.isArray(cfg.regions)) {
        errors.push(`${configPath}: "regions" must be a non-empty array`);
        return errors;
    }
    if (cfg.regions.length === 0) {
        errors.push(`${configPath}: "regions" must have at least one entry`);
        return errors;
    }

    const regionIds = new Set();
    for (let ri = 0; ri < cfg.regions.length; ri++) {
        const region = cfg.regions[ri];
        const prefix = `${configPath}: regions[${ri}]`;

        // id
        if (
            !region.id ||
            typeof region.id !== "string" ||
            region.id.trim() === ""
        ) {
            errors.push(`${prefix}: "id" must be a non-empty string`);
        } else if (!VALID_ID_RE.test(region.id)) {
            errors.push(
                `${prefix}: "id" "${region.id}" must match ${VALID_ID_RE}`,
            );
        } else if (regionIds.has(region.id)) {
            errors.push(`${prefix}: duplicate region id "${region.id}"`);
        } else {
            regionIds.add(region.id);
        }

        // label
        if (
            !region.label ||
            typeof region.label !== "string" ||
            region.label.trim() === ""
        ) {
            errors.push(`${prefix}: "label" must be a non-empty string`);
        }

        // regionPath
        if (!region.regionPath || !Array.isArray(region.regionPath)) {
            errors.push(`${prefix}: "regionPath" must be a non-empty array`);
        } else if (region.regionPath.length === 0) {
            errors.push(
                `${prefix}: "regionPath" must have at least one element`,
            );
        } else if (
            region.regionPath.some(
                (p) => typeof p !== "string" || p.trim() === "",
            )
        ) {
            errors.push(
                `${prefix}: every "regionPath" element must be a non-empty string`,
            );
        }

        // pbfUrl
        if (
            !region.pbfUrl ||
            typeof region.pbfUrl !== "string" ||
            region.pbfUrl.trim() === ""
        ) {
            errors.push(`${prefix}: "pbfUrl" must be a non-empty string`);
        }

        // adminLevels
        if (!region.adminLevels || typeof region.adminLevels !== "object") {
            errors.push(
                `${prefix}: "adminLevels" must be an object with "matching" and "extract" arrays`,
            );
        } else {
            const matching = region.adminLevels.matching;
            const extract = region.adminLevels.extract;

            if (!matching || !Array.isArray(matching)) {
                errors.push(
                    `${prefix}: "adminLevels.matching" must be an array`,
                );
            } else {
                if (matching.length !== 4) {
                    errors.push(
                        `${prefix}: "adminLevels.matching" must have exactly 4 levels (got ${matching.length})`,
                    );
                }
                for (let mi = 1; mi < matching.length; mi++) {
                    if (matching[mi] <= matching[mi - 1]) {
                        errors.push(
                            `${prefix}: "adminLevels.matching" must be ascending, got ${JSON.stringify(matching)}`,
                        );
                        break;
                    }
                }
            }

            if (!extract || !Array.isArray(extract)) {
                errors.push(
                    `${prefix}: "adminLevels.extract" must be an array`,
                );
            } else {
                if (extract.length === 0) {
                    errors.push(
                        `${prefix}: "adminLevels.extract" must be non-empty`,
                    );
                }
                if (matching && Array.isArray(matching)) {
                    const extractSet = new Set(extract);
                    for (const lv of matching) {
                        if (!extractSet.has(lv)) {
                            errors.push(
                                `${prefix}: "adminLevels.extract" must include every matching level (missing ${lv})`,
                            );
                            break;
                        }
                    }
                }
            }
        }

        // artifacts
        if (!region.artifacts || !Array.isArray(region.artifacts)) {
            errors.push(`${prefix}: "artifacts" must be a non-empty array`);
        } else if (region.artifacts.length === 0) {
            errors.push(
                `${prefix}: "artifacts" must have at least one enabled kind`,
            );
        } else {
            const VALID_KINDS = new Set([
                "poi",
                "measuring",
                "boundaries",
                "transit",
            ]);
            for (const kind of region.artifacts) {
                if (!VALID_KINDS.has(kind)) {
                    errors.push(
                        `${prefix}: unknown artifact kind "${kind}" (allowed: ${[...VALID_KINDS].join(", ")})`,
                    );
                }
            }
        }

        // measuringOverrides (optional)
        if (region.measuringOverrides !== undefined) {
            if (
                typeof region.measuringOverrides !== "object" ||
                region.measuringOverrides === null ||
                Array.isArray(region.measuringOverrides)
            ) {
                errors.push(
                    `${prefix}: "measuringOverrides" must be an object when present`,
                );
            }
        }

        // transitOverrides (optional)
        if (region.transitOverrides !== undefined) {
            if (
                typeof region.transitOverrides !== "object" ||
                region.transitOverrides === null ||
                Array.isArray(region.transitOverrides)
            ) {
                errors.push(
                    `${prefix}: "transitOverrides" must be an object when present`,
                );
            } else {
                if (region.transitOverrides.wayGeometry !== undefined) {
                    if (
                        typeof region.transitOverrides.wayGeometry !== "boolean"
                    ) {
                        errors.push(
                            `${prefix}: "transitOverrides.wayGeometry" must be a boolean`,
                        );
                    }
                }
                if (region.transitOverrides.simplifyMeters !== undefined) {
                    if (
                        typeof region.transitOverrides.simplifyMeters !==
                            "number" ||
                        region.transitOverrides.simplifyMeters < 0
                    ) {
                        errors.push(
                            `${prefix}: "transitOverrides.simplifyMeters" must be a non-negative number`,
                        );
                    }
                }
                if (region.transitOverrides.excludeUsage !== undefined) {
                    if (
                        !Array.isArray(region.transitOverrides.excludeUsage) ||
                        region.transitOverrides.excludeUsage.some(
                            (u) => typeof u !== "string" || u.trim() === "",
                        )
                    ) {
                        errors.push(
                            `${prefix}: "transitOverrides.excludeUsage" must be an array of non-empty strings`,
                        );
                    }
                }
            }
        }
    }

    return errors;
}
