/**
 * Catalog JSON schema and validation (schemaVersion: 2).
 *
 * Shared between the catalog generator and the CI check workflow.
 *
 * @module catalogSchema
 */

/** Current catalog schema version. */
export const CATALOG_SCHEMA_VERSION = 2;

/** Valid artifact kinds. */
const VALID_KINDS = new Set([
    "poi",
    "measuring",
    "boundaries",
    "transit",
    "meta",
]);

/**
 * Validate a catalog.json object. Returns an array of error messages.
 *
 * @param {object} catalog - parsed catalog.json
 * @param {string} [label] - context label for error messages
 * @returns {string[]} error messages (empty = valid)
 */
export function validateCatalog(catalog, label = "catalog.json") {
    const errors = [];

    if (!catalog || typeof catalog !== "object") {
        return [`${label}: must be a JSON object`];
    }

    // schemaVersion
    if (catalog.schemaVersion !== CATALOG_SCHEMA_VERSION) {
        errors.push(
            `${label}: "schemaVersion" must be ${CATALOG_SCHEMA_VERSION}, got ${JSON.stringify(catalog.schemaVersion)}`,
        );
    }

    // generatedAt
    if (!catalog.generatedAt || typeof catalog.generatedAt !== "string") {
        errors.push(
            `${label}: "generatedAt" must be a non-empty ISO 8601 string`,
        );
    } else {
        const ts = Date.parse(catalog.generatedAt);
        if (isNaN(ts)) {
            errors.push(`${label}: "generatedAt" is not a valid ISO 8601 date`);
        }
    }

    // attributionUrl
    if (
        !catalog.attributionUrl ||
        typeof catalog.attributionUrl !== "string" ||
        catalog.attributionUrl.trim() === ""
    ) {
        errors.push(`${label}: "attributionUrl" must be a non-empty string`);
    } else if (!isAbsoluteUrl(catalog.attributionUrl)) {
        errors.push(`${label}: "attributionUrl" must be an absolute URL`);
    }

    // packs
    if (!Array.isArray(catalog.packs)) {
        errors.push(`${label}: "packs" must be an array`);
        return errors;
    }

    for (let pi = 0; pi < catalog.packs.length; pi++) {
        const pack = catalog.packs[pi];
        const pLabel = `${label}: packs[${pi}]`;
        const packErrors = validatePackEntry(pack, pLabel);
        errors.push(...packErrors);
    }

    return errors;
}

/**
 * Validate a single pack entry.
 *
 * @param {object} pack
 * @param {string} label
 * @returns {string[]}
 */
function validatePackEntry(pack, label) {
    const errors = [];

    if (!pack || typeof pack !== "object") {
        return [`${label}: must be an object`];
    }

    // id
    if (!pack.id || typeof pack.id !== "string") {
        errors.push(`${label}: "id" must be a non-empty string`);
    }

    // label
    if (!pack.label || typeof pack.label !== "string") {
        errors.push(`${label}: "label" must be a non-empty string`);
    }

    // regionPath
    if (!Array.isArray(pack.regionPath) || pack.regionPath.length === 0) {
        errors.push(`${label}: "regionPath" must be a non-empty array`);
    } else if (
        pack.regionPath.some((p) => typeof p !== "string" || p.trim() === "")
    ) {
        errors.push(
            `${label}: every "regionPath" element must be a non-empty string`,
        );
    }

    // bbox
    if (!Array.isArray(pack.bbox) || pack.bbox.length !== 4) {
        errors.push(
            `${label}: "bbox" must be an array [west, south, east, north]`,
        );
    } else {
        const [w, s, e, n] = pack.bbox;
        if (!pack.bbox.every((v) => typeof v === "number")) {
            errors.push(`${label}: "bbox" values must be numbers`);
        } else if (w >= e) {
            errors.push(`${label}: bbox west (${w}) must be < east (${e})`);
        } else if (s >= n) {
            errors.push(`${label}: bbox south (${s}) must be < north (${n})`);
        } else if (w < -180 || e > 180 || s < -90 || n > 90) {
            errors.push(`${label}: bbox must be within [-180,180],[-90,90]`);
        }
    }

    // osmSnapshot
    if (!pack.osmSnapshot || typeof pack.osmSnapshot !== "string") {
        errors.push(`${label}: "osmSnapshot" must be a non-empty date string`);
    }

    // totalBytes
    if (typeof pack.totalBytes !== "number" || pack.totalBytes < 0) {
        errors.push(`${label}: "totalBytes" must be a non-negative number`);
    }

    // artifacts
    if (!Array.isArray(pack.artifacts) || pack.artifacts.length === 0) {
        errors.push(`${label}: "artifacts" must be a non-empty array`);
        return errors;
    }

    for (let ai = 0; ai < pack.artifacts.length; ai++) {
        const artifact = pack.artifacts[ai];
        const aLabel = `${label}: artifacts[${ai}]`;
        const artifactErrors = validateArtifactEntry(artifact, aLabel);
        errors.push(...artifactErrors);
    }

    return errors;
}

/**
 * Validate a single artifact entry.
 *
 * @param {object} artifact
 * @param {string} label
 * @returns {string[]}
 */
function validateArtifactEntry(artifact, label) {
    const errors = [];

    if (!artifact || typeof artifact !== "object") {
        return [`${label}: must be an object`];
    }

    // kind
    if (!artifact.kind || typeof artifact.kind !== "string") {
        errors.push(`${label}: "kind" must be a non-empty string`);
    } else if (!VALID_KINDS.has(artifact.kind)) {
        errors.push(
            `${label}: unknown artifact kind "${artifact.kind}" (allowed: ${[...VALID_KINDS].join(", ")})`,
        );
    }

    // category (optional, null is valid, used for measuring sub-categories)
    if (artifact.category !== undefined && artifact.category !== null) {
        if (
            typeof artifact.category !== "string" ||
            artifact.category.trim() === ""
        ) {
            errors.push(
                `${label}: "category" must be a non-empty string or null`,
            );
        }
    }

    // url
    if (!artifact.url || typeof artifact.url !== "string") {
        errors.push(`${label}: "url" must be a non-empty string`);
    } else if (!isAbsoluteUrl(artifact.url)) {
        errors.push(`${label}: "url" must be an absolute URL`);
    }
    // We check it starts with https://github.com/ for release assets specifically.
    // General absolute URL check above is sufficient; release URL pattern is not
    // enforced by the schema, but CI will verify 200 responses.

    // bytes
    if (typeof artifact.bytes !== "number" || artifact.bytes < 0) {
        errors.push(`${label}: "bytes" must be a non-negative number`);
    }

    // md5
    if (
        !artifact.md5 ||
        typeof artifact.md5 !== "string" ||
        artifact.md5.length !== 32
    ) {
        errors.push(`${label}: "md5" must be a 32-character hex string`);
    } else if (!/^[0-9a-f]{32}$/i.test(artifact.md5)) {
        errors.push(`${label}: "md5" must be a hex string`);
    }

    // sha256
    if (
        !artifact.sha256 ||
        typeof artifact.sha256 !== "string" ||
        artifact.sha256.length !== 64
    ) {
        errors.push(`${label}: "sha256" must be a 64-character hex string`);
    } else if (!/^[0-9a-f]{64}$/i.test(artifact.sha256)) {
        errors.push(`${label}: "sha256" must be a hex string`);
    }

    // schemaVersion
    if (
        typeof artifact.schemaVersion !== "number" ||
        artifact.schemaVersion < 1
    ) {
        errors.push(`${label}: "schemaVersion" must be a positive integer`);
    }

    return errors;
}

/**
 * Check if a string is an absolute URL (starts with http:// or https://).
 *
 * @param {string} url
 * @returns {boolean}
 */
function isAbsoluteUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}
