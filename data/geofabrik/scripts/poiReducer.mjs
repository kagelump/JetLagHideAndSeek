import { readFile } from "node:fs/promises";

const ID_PREFIX_TYPE = { n: 0, w: 1, r: 2 }; // osmium -u type_id prefixes

/**
 * Parses osmium's `type_id` feature id ("n57390915") → { osmId, osmType }.
 * Prefixes: n=node (0), w=way (1), r=relation (2).
 */
export function parseOsmId(featureId) {
    if (typeof featureId !== "string" || featureId.length < 2) {
        return { osmId: 0, osmType: 0 };
    }
    const osmType = ID_PREFIX_TYPE[featureId[0]] ?? 0;
    const osmId = Number(featureId.slice(1));
    return { osmId: Number.isFinite(osmId) ? osmId : 0, osmType };
}

/**
 * Centroid of any GeoJSON geometry (bounding-box center, matching Overpass
 * `out center`). Returns [lon, lat] per GeoJSON coordinate order.
 */
export function centroid(geometry) {
    if (geometry.type === "Point") return geometry.coordinates;
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity,
        n = 0;
    const walk = (c) => {
        if (typeof c[0] === "number") {
            if (c[0] < minX) minX = c[0];
            if (c[0] > maxX) maxX = c[0];
            if (c[1] < minY) minY = c[1];
            if (c[1] > maxY) maxY = c[1];
            n++;
        } else c.forEach(walk);
    };
    walk(geometry.coordinates);
    if (n === 0) return [NaN, NaN];
    return [(minX + maxX) / 2, (minY + maxY) / 2];
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * Reduces a GeoJSONSeq line (already 0x1e-stripped, JSON-parsed Feature) to a
 * compact record, or null if it has no name. `categoryOf(props)` maps a
 * feature's tags to one of the bundle categories (or null). For station
 * features, computes English name + length.
 */
export function reduceFeature(feature, categoryOf) {
    const props = feature.properties ?? {};
    const category = categoryOf(props);
    if (!category) return null;

    const isStation = category === "station-name-length";
    const name = isStation
        ? props["name:en"]?.trim() || props.name?.trim() || ""
        : props.name?.trim() || "";
    if (!name) return null;

    const [lon, lat] = centroid(feature.geometry);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

    const { osmId, osmType } = parseOsmId(feature.id);

    const record = {
        category,
        lon: round6(lon),
        lat: round6(lat),
        name,
        osmId,
        osmType,
    };
    if (isStation) record.nameLength = name.length;
    return record;
}

/**
 * Builds a categoryOf function from the poi-selectors.json registry.
 * Returns (props) => MatchingCategory | null.
 *
 * Categories are checked in the order they appear in selectors.json.
 * A feature is assigned to the FIRST matching category.
 *
 * Checks that a property satisfies all ANDed conditions in a selector:
 *   props[key] === value (case-sensitive exact match).
 * For the single-selector case (every Phase 1 category), this reduces to
 * one tag equality check.
 */
export function buildCategoryOf(selectorsJson) {
    const entries = Object.entries(selectorsJson.categories ?? {});
    return (props) => {
        for (const [category, spec] of entries) {
            for (const sel of spec.selectors ?? []) {
                let match = true;
                for (const cond of sel.match ?? []) {
                    if (props[cond.key] !== cond.value) {
                        match = false;
                        break;
                    }
                }
                if (match) return category;
            }
        }
        return null;
    };
}

/**
 * Builds the columnar per-region object from an array of reduced records.
 *
 * Features within each category are sorted by osmId for deterministic output.
 * Only categories with >=1 feature are included.
 * The `nameLength` parallel array is included only for station-name-length.
 */
export function buildColumnar(records, regionMeta) {
    const {
        id: region,
        label,
        bbox,
        generatedAt,
        sourceSequence,
        source,
        attribution,
    } = regionMeta;

    // Group by category.
    const byCategory = new Map();
    for (const rec of records) {
        const arr = byCategory.get(rec.category);
        if (arr) {
            arr.push(rec);
        } else {
            byCategory.set(rec.category, [rec]);
        }
    }

    const categories = {};
    let totalCount = 0;

    for (const [cat, arr] of [...byCategory.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
    )) {
        // Sort by osmId for deterministic output.
        arr.sort((a, b) => a.osmId - b.osmId);

        const count = arr.length;
        totalCount += count;

        const lon = new Array(count);
        const lat = new Array(count);
        const name = new Array(count);
        const osmId = new Array(count);
        const osmType = new Array(count);
        const nameLength =
            cat === "station-name-length" ? new Array(count) : undefined;

        for (let i = 0; i < count; i++) {
            lon[i] = arr[i].lon;
            lat[i] = arr[i].lat;
            name[i] = arr[i].name;
            osmId[i] = arr[i].osmId;
            osmType[i] = arr[i].osmType;
            if (nameLength !== undefined && arr[i].nameLength !== undefined) {
                nameLength[i] = arr[i].nameLength;
            }
        }

        const catData = { count, lon, lat, name, osmId, osmType };
        if (nameLength !== undefined) catData.nameLength = nameLength;
        categories[cat] = catData;
    }

    return {
        schemaVersion: 1,
        region,
        label,
        generatedAt,
        sourceSequence,
        source,
        bbox,
        attribution,
        totalCount,
        categories,
    };
}

/**
 * Loads the selectors JSON and returns a categoryOf function for it.
 */
export async function loadCategoryOf(selectorsPath) {
    const raw = await readFile(selectorsPath, "utf8");
    const selectors = JSON.parse(raw);
    if (selectors.schemaVersion !== 1) {
        throw new Error(
            `Unsupported poi-selectors.json schemaVersion: ${selectors.schemaVersion}`,
        );
    }
    return buildCategoryOf(selectors);
}

/**
 * Computes per-category counts from the columnar artifact.
 */
export function computeStats(columnar, gzipSize) {
    const catCounts = {};
    for (const [cat, data] of Object.entries(columnar.categories)) {
        catCounts[cat] = data.count;
    }
    return {
        region: columnar.region,
        label: columnar.label,
        generatedAt: columnar.generatedAt,
        sourceSequence: columnar.sourceSequence,
        totalCount: columnar.totalCount,
        gzipSizeBytes: gzipSize,
        gzipSizeMb: +(gzipSize / 1024 / 1024).toFixed(2),
        categoryCounts: catCounts,
    };
}
