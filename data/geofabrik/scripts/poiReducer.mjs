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
 * Picks the shorter non-empty name between a primary tag (e.g. name) and an
 * alternative tag (e.g. alt_name). OSM alt_name is a semicolon-separated list
 * — the shortest entry is compared against the primary.
 */
function pickShorterName(primary, alt) {
    const p = primary?.trim() || "";
    const a = alt?.trim() || "";
    if (!p && !a) return "";
    if (!p) return a;
    if (!a) return p;

    const altEntries = a
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
    const bestAlt =
        altEntries.length > 0
            ? altEntries.reduce((x, y) => (x.length <= y.length ? x : y))
            : a;

    return bestAlt.length < p.length ? bestAlt : p;
}

/**
 * Reduces a GeoJSONSeq line (already 0x1e-stripped, JSON-parsed Feature) to a
 * compact record, or null if it has no name. `categoryOf(props)` maps a
 * feature's tags to one of the bundle categories (or null). For station
 * features, computes English name + length.
 *
 * For both the primary name and the stored English name, the shorter of
 * (name / alt_name) and (name:en / alt_name:en) is picked so that long
 * official names don't waste horizontal space in the UI.
 */
export function reduceFeature(feature, categoryOf) {
    const props = feature.properties ?? {};
    const category = categoryOf(props);
    if (!category) return null;

    const isStation = category === "station-name-length";

    // Pick the shortest non-empty name from (name / alt_name) or,
    // for stations, prefer English names.
    const nativeName = pickShorterName(props.name, props.alt_name);
    const englishName = pickShorterName(props["name:en"], props["alt_name:en"]);

    const name = isStation
        ? englishName || nativeName
        : nativeName;
    if (!name) return null;

    const [lon, lat] = centroid(feature.geometry);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

    // Prefer osmium's -a id,type attributes (real OSM IDs) over the
    // synthetic type_id prefix (which uses area IDs like a35729975 for
    // multipolygon relations, losing the original relation ID).
    const osmId =
        props["@id"] !== undefined
            ? Number(props["@id"])
            : parseOsmId(feature.id).osmId;
    const osmType =
        props["@type"] !== undefined
            ? ID_PREFIX_TYPE[props["@type"][0]] ?? 0
            : parseOsmId(feature.id).osmType;

    const record = {
        category,
        lon: round6(lon),
        lat: round6(lat),
        name,
        osmId,
        osmType,
    };
    if (isStation) record.nameLength = name.length;
    if (category === "commercial-airport") {
        record.iata = props.iata?.trim() || undefined;
    }
    // Capture the English name so the label-language toggle can surface it
    // at runtime even for bundle-sourced features (where tags is empty).
    if (englishName && englishName !== name) {
        record.nameEn = englishName;
    }
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
                    if (cond.value !== undefined) {
                        // Value-bearing condition: exact match required.
                        if (props[cond.key] !== cond.value) {
                            match = false;
                            break;
                        }
                    } else {
                        // Key-only condition: tag must be present.
                        if (!(cond.key in props)) {
                            match = false;
                            break;
                        }
                    }
                }
                if (match) return category;
            }
        }
        return null;
    };
}

/**
 * Deduplicates reduced records within each category.
 *
 * OSM often has both a node and a way (or multiple nodes) for the same POI.
 * For commercial-airport the primary dedup key is the IATA code (globally
 * unique); for all other categories the key is (category, name, lat@4dp,
 * lon@4dp) — ~11 m tolerance.  Keeps the record with the lowest osmId per
 * group (deterministic).
 *
 * Returns a new array (does not mutate the input).
 */
export function deduplicateRecords(records) {
    const round4 = (x) => Math.round(x * 1e4) / 1e4;
    const seen = new Map();
    const out = [];

    for (const r of records) {
        const key =
            r.category === "commercial-airport" && r.iata
                ? `${r.category}\x00iata:${r.iata}`
                : `${r.category}\x00${r.name}\x00${round4(r.lat)}\x00${round4(r.lon)}`;
        const prev = seen.get(key);
        if (prev === undefined) {
            seen.set(key, r);
            out.push(r);
        } else if (r.osmId < prev.osmId) {
            // Replace with the lower-osmId entry (more likely the original).
            const idx = out.indexOf(prev);
            out[idx] = r;
            seen.set(key, r);
        }
    }

    return out;
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
        const iata =
            cat === "commercial-airport" ? new Array(count) : undefined;
        // Include nameEn when at least one record in the category has it.
        const hasNameEn = arr.some((r) => r.nameEn !== undefined);
        const nameEn = hasNameEn ? new Array(count) : undefined;

        for (let i = 0; i < count; i++) {
            lon[i] = arr[i].lon;
            lat[i] = arr[i].lat;
            name[i] = arr[i].name;
            osmId[i] = arr[i].osmId;
            osmType[i] = arr[i].osmType;
            if (nameLength !== undefined && arr[i].nameLength !== undefined) {
                nameLength[i] = arr[i].nameLength;
            }
            if (iata !== undefined) {
                iata[i] = arr[i].iata ?? null;
            }
            if (nameEn !== undefined) {
                nameEn[i] = arr[i].nameEn ?? null;
            }
        }

        const catData = { count, lon, lat, name, osmId, osmType };
        if (nameLength !== undefined) catData.nameLength = nameLength;
        if (iata !== undefined) catData.iata = iata;
        if (nameEn !== undefined) catData.nameEn = nameEn;
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
