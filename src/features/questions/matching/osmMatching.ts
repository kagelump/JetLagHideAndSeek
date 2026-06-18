import { type Position, haversineDistanceMeters } from "@/shared/geojson";
import { MATCHING, NETWORK } from "@/config/appConfig";
import type { AdminDivisionNamePack } from "./adminDivisionConfig";
import type { MatchingCategory, OsmFeature } from "./matchingTypes";
import { getCategoryConfig } from "./matchingCategories";

const OVERPASS_API = "https://overpass-api.de/api/interpreter";
export const DEFAULT_SEARCH_RADIUS_METERS: number =
    MATCHING.defaultSearchRadiusM;

type OverpassElement = {
    center?: { lat: number; lon: number };
    id?: number;
    lat?: number;
    lon?: number;
    tags?: Record<string, string>;
    type?: string;
};

type OverpassResponse = {
    elements?: OverpassElement[];
};

export type OsmFeatureWithDistance = OsmFeature & {
    distanceMeters: number;
};

/**
 * Fetches and parses raw OSM features from Overpass without ranking them.
 * Returns an empty array for categories that have no Overpass query tags.
 */
export async function fetchAndParseOverpassFeatures(
    category: MatchingCategory,
    center: Position,
    radiusMeters: number,
    signal?: AbortSignal,
    adminDivisionPack?: AdminDivisionNamePack,
): Promise<OsmFeature[]> {
    const config = getCategoryConfig(category, adminDivisionPack);
    if (!config) return [];
    if (!config.osmQueryTags && category !== "station-name-length") return [];

    const [lon, lat] = center;
    const query =
        category === "station-name-length"
            ? buildStationQuery(lat, lon, radiusMeters)
            : buildOverpassQuery(config.osmQueryTags, lat, lon, radiusMeters);

    const response = await fetch(
        `${OVERPASS_API}?data=${encodeURIComponent(query)}`,
        { signal, headers: NETWORK.overpassHeaders },
    );

    if (!response.ok) {
        throw new Error(`Overpass API error ${response.status}`);
    }

    const data = (await response.json()) as OverpassResponse;
    return parseOverpassElements(data.elements ?? [], category);
}

export async function findMatchingFeatures(
    category: MatchingCategory,
    center: Position,
    options?: {
        maxCandidates?: number;
        searchRadiusMeters?: number;
        signal?: AbortSignal;
        adminDivisionPack?: AdminDivisionNamePack;
    },
): Promise<OsmFeatureWithDistance[]> {
    const searchRadiusMeters =
        options?.searchRadiusMeters ?? DEFAULT_SEARCH_RADIUS_METERS;
    const maxCandidates = options?.maxCandidates ?? 10;
    const features = await fetchAndParseOverpassFeatures(
        category,
        center,
        searchRadiusMeters,
        options?.signal,
        options?.adminDivisionPack,
    );
    return rankMatchingFeatures(features, center, maxCandidates);
}

export function rankMatchingFeatures(
    features: OsmFeature[],
    center: Position,
    maxCandidates = 10,
): OsmFeatureWithDistance[] {
    const [lon, lat] = center;

    // For small feature sets the overhead of a pre-filter is not worth it —
    // compute haversine directly.
    if (features.length <= 2000) {
        const withDistance = features.map((feature) => ({
            ...feature,
            distanceMeters: haversineDistanceMeters(
                lat,
                lon,
                feature.lat,
                feature.lon,
            ),
        }));

        withDistance.sort((a, b) => a.distanceMeters - b.distanceMeters);

        return withDistance.slice(0, maxCandidates);
    }

    // Large feature set (>2000): use a cheap equirectangular approximation
    // to pre-rank, then compute accurate haversine only for the top
    // candidates. Without this, dense categories like park (22k+ features
    // in Kantō) spend ~100ms in haversine trig for features the caller
    // will never use.
    //
    // The equirectangular approximation produces negligible ordering error
    // at mid-latitude distances (<0.5% at <100 km). A 2× overscan on the
    // pre-filter window makes it essentially impossible for a true top-N
    // feature to be excluded by the approximation.
    const METERS_PER_DEG_LAT = 111_320;
    const metersPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180);

    const approx = features.map((feature, index) => {
        const dLat = (feature.lat - lat) * METERS_PER_DEG_LAT;
        const dLon = (feature.lon - lon) * metersPerDegLon;
        return {
            feature,
            approxDist: Math.sqrt(dLat * dLat + dLon * dLon),
            index,
        };
    });

    approx.sort((a, b) => a.approxDist - b.approxDist);

    // 2× overscan ensures the pre-filter window is wide enough that true
    // top-N features cannot be excluded by the approximation's tiny
    // ordering error. Floor at 500 so small maxCandidates (e.g. the
    // default 10) still get enough headroom.
    const preFilterCount = Math.min(
        Math.max(maxCandidates * 2, 500),
        features.length,
    );

    const topApprox = approx.slice(0, preFilterCount);

    const withDistance = topApprox.map(({ feature }) => ({
        ...feature,
        distanceMeters: haversineDistanceMeters(
            lat,
            lon,
            feature.lat,
            feature.lon,
        ),
    }));

    withDistance.sort((a, b) => a.distanceMeters - b.distanceMeters);

    return withDistance.slice(0, maxCandidates);
}

export async function findNearestMatchingFeature(
    category: MatchingCategory,
    center: Position,
    searchRadiusMeters = DEFAULT_SEARCH_RADIUS_METERS,
): Promise<OsmFeature | null> {
    const results = await findMatchingFeatures(category, center, {
        maxCandidates: 1,
        searchRadiusMeters,
    });
    return results[0] ?? null;
}

export function buildOverpassQuery(
    tags: string,
    lat: number,
    lon: number,
    radiusMeters: number,
): string {
    return `[out:json][timeout:30];
(
  node${tags}(around:${radiusMeters},${lat},${lon});
  way${tags}(around:${radiusMeters},${lat},${lon});
  relation${tags}(around:${radiusMeters},${lat},${lon});
);
out center tags qt;`;
}

export function buildStationQuery(
    lat: number,
    lon: number,
    radiusMeters: number,
): string {
    // Query both railway stations and subway stations to cover transit broadly.
    const around = `(around:${radiusMeters},${lat},${lon})`;
    return `[out:json][timeout:30];
(
  node["railway"="station"]${around};
  way["railway"="station"]${around};
  node["station"="subway"]["railway"="station"]${around};
  way["station"="subway"]["railway"="station"]${around};
);
out center tags qt;`;
}

// ─── Bbox-based queries (for deterministic cell-grid cache) ────────────────

/**
 * Builds an Overpass QL query that searches for elements matching the given
 * tags within a bounding box defined by (south, west, north, east).
 */
export function buildOverpassBboxQuery(
    tags: string,
    south: number,
    west: number,
    north: number,
    east: number,
): string {
    return `[out:json][timeout:30];
(
  node${tags}(${south},${west},${north},${east});
  way${tags}(${south},${west},${north},${east});
  relation${tags}(${south},${west},${north},${east});
);
out center tags qt;`;
}

/**
 * Builds an Overpass QL query that searches for railway/subway stations
 * within a bounding box defined by (south, west, north, east).
 */
export function buildStationBboxQuery(
    south: number,
    west: number,
    north: number,
    east: number,
): string {
    const bbox = `(${south},${west},${north},${east})`;
    return `[out:json][timeout:30];
(
  node["railway"="station"]${bbox};
  way["railway"="station"]${bbox};
  node["station"="subway"]["railway"="station"]${bbox};
  way["station"="subway"]["railway"="station"]${bbox};
);
out center tags qt;`;
}

/**
 * Fetches and parses OSM features from Overpass using a bbox query instead
 * of a circle (around) query. Returns an empty array for categories that have
 * no Overpass query tags.
 */
export async function fetchAndParseOverpassBboxFeatures(
    category: MatchingCategory,
    south: number,
    west: number,
    north: number,
    east: number,
    signal?: AbortSignal,
    adminDivisionPack?: AdminDivisionNamePack,
): Promise<OsmFeature[]> {
    const config = getCategoryConfig(category, adminDivisionPack);
    if (!config) return [];
    if (!config.osmQueryTags && category !== "station-name-length") return [];

    const query =
        category === "station-name-length"
            ? buildStationBboxQuery(south, west, north, east)
            : buildOverpassBboxQuery(
                  config.osmQueryTags,
                  south,
                  west,
                  north,
                  east,
              );

    const response = await fetch(
        `${OVERPASS_API}?data=${encodeURIComponent(query)}`,
        { signal, headers: NETWORK.overpassHeaders },
    );

    if (!response.ok) {
        throw new Error(`Overpass API error ${response.status}`);
    }

    const data = (await response.json()) as OverpassResponse;
    return parseOverpassElements(data.elements ?? [], category);
}

export function parseOverpassElements(
    elements: OverpassElement[],
    category?: string,
): OsmFeature[] {
    const features: OsmFeature[] = [];

    for (const element of elements) {
        if (!isValidOverpassElement(element)) {
            continue;
        }

        const lat = element.type === "node" ? element.lat : element.center?.lat;
        const lon = element.type === "node" ? element.lon : element.center?.lon;

        if (lat == null || lon == null) {
            continue;
        }

        const name = element.tags?.name?.trim() ?? "";
        if (!name) {
            continue;
        }

        const feature: OsmFeature = {
            lat,
            lon,
            name,
            osmId: element.id,
            osmType: element.type,
            tags: element.tags ?? {},
        };

        // For station-name-length, use the English name (name:en) when
        // available, and record the character length for comparison.
        if (category === "station-name-length") {
            const englishName = element.tags?.["name:en"]?.trim();
            const displayName = englishName || name;
            feature.name = displayName;
            feature.nameLength = displayName.length;
        }

        // For commercial-airport, surface the IATA code for display.
        if (category === "commercial-airport" && element.tags?.iata) {
            feature.iata = element.tags.iata.trim();
        }

        features.push(feature);
    }

    return features;
}

function isValidOverpassElement(
    element: OverpassElement,
): element is OverpassElement & {
    id: number;
    tags: Record<string, string>;
    type: "node" | "way" | "relation";
} {
    return (
        element.type === "node" ||
        element.type === "way" ||
        element.type === "relation"
    );
}

export function findNearestFeature(
    center: Position,
    features: OsmFeature[],
): OsmFeature | null {
    if (features.length === 0) return null;

    let nearest: OsmFeature | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    const [lon, lat] = center;

    for (const feature of features) {
        const distance = haversineDistanceMeters(
            lat,
            lon,
            feature.lat,
            feature.lon,
        );
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = feature;
        }
    }

    return nearest;
}
