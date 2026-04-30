import * as turf from "@turf/turf";
import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiLineString,
    MultiPolygon,
    Point,
} from "geojson";
import _ from "lodash";
import osmtogeojson from "osmtogeojson";
import { toast } from "react-toastify";

import {
    computeSidFromCanonicalUtf8,
    putBlobInNamespace,
    putOverpassIndexMapping,
} from "@/lib/cas";
import {
    additionalMapGeoLocations,
    casServerEffectiveUrl,
    casServerStatus,
    getDefaultOverpassIndexTtlMs,
    mapGeoLocation,
    polyGeoJSON,
    upsertOverpassRequestIndex,
} from "@/lib/context";
import { compress } from "@/lib/utils";
import { canonicalize } from "@/lib/wire";
import { expandFiltersForOperatorNetwork, safeUnion } from "@/maps/geo-utils";

import {
    cacheFetch,
    determineCache,
    hybridOverpassFetch,
    OVERPASS_HYBRID_VERSION_TAG,
} from "./cache";
import {
    LOCATION_FIRST_TAG,
    OVERPASS_API,
    OVERPASS_API_FALLBACK,
} from "./constants";
import { trimTrainLinesToPlayableArea } from "./trainLineTrim";
import type {
    EncompassingTentacleQuestionSchema,
    HomeGameMatchingQuestions,
    HomeGameMeasuringQuestions,
    QuestionSpecificLocation,
} from "./types";
import { CacheType } from "./types";

const canonicalizeOverpassQuery = (query: string) =>
    query
        .trim()
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+\n/g, "\n");

export const computeOverpassRequestHash = async (
    query: string,
    endpoint = OVERPASS_API,
): Promise<string> => {
    const seed = `${canonicalizeOverpassQuery(query)}\n${endpoint}\n${OVERPASS_HYBRID_VERSION_TAG}`;
    return computeSidFromCanonicalUtf8(seed);
};

const writeOverpassResponseToCas = async (
    requestHash: string,
    data: unknown,
): Promise<void> => {
    const base = casServerEffectiveUrl.get();
    if (!base || casServerStatus.get() !== "available") return;
    try {
        const canonicalResponse = canonicalize(data);
        const sid = await computeSidFromCanonicalUtf8(canonicalResponse);
        const compressed = await compress(canonicalResponse);
        await putBlobInNamespace(base, "overpass", compressed, sid);
        const cachedAt = Date.now();
        const expiresAt = cachedAt + getDefaultOverpassIndexTtlMs();
        await putOverpassIndexMapping(base, requestHash, {
            sid,
            cachedAt,
            expiresAt,
        });
        upsertOverpassRequestIndex(requestHash, {
            sid,
            cachedAt,
            expiresAt,
            source: "network",
        });
    } catch (e) {
        console.warn("Overpass CAS write-through failed", e);
    }
};

export const getOverpassData = async (
    query: string,
    loadingText?: string,
    cacheType: CacheType = CacheType.CACHE,
) => {
    const encodedQuery = encodeURIComponent(query);
    const primaryUrl = `${OVERPASS_API}?data=${encodedQuery}`;
    const requestHash = await computeOverpassRequestHash(query);
    let response =
        (await hybridOverpassFetch({
            primaryUrl,
            requestHash,
            loadingText,
            cacheType,
            ttlMs: getDefaultOverpassIndexTtlMs(),
        })) ?? (await cacheFetch(primaryUrl, loadingText, cacheType));

    if (!response.ok) {
        // Try the fallback, but store the result under the primary URL key so future requests are served from cache without needing to fail-over again.
        try {
            const fallbackResponse = await cacheFetch(
                `${OVERPASS_API_FALLBACK}?data=${encodedQuery}`,
                loadingText,
                cacheType,
                {
                    cacheKeyUrl: primaryUrl,
                    skipCacheRead: true,
                },
            );
            if (fallbackResponse.ok) {
                const cache = await determineCache(cacheType);
                await cache.put(primaryUrl, fallbackResponse.clone());
            }
            response = fallbackResponse;
        } catch {
            toast.error(
                `Could not load data from Overpass: ${response.status} ${response.statusText}`,
                { toastId: "overpass-error" },
            );
            return { elements: [] };
        }
    }

    if (!response.ok) {
        toast.error(
            `Could not load data from Overpass: ${response.status} ${response.statusText}`,
            { toastId: "overpass-error" },
        );
        return { elements: [] };
    }

    const data = await response.json();
    void writeOverpassResponseToCas(requestHash, data);
    return data;
};

export const determineGeoJSON = async (
    osmId: string,
    osmTypeLetter: "W" | "R" | "N",
): Promise<any> => {
    const osmTypeMap: { [key: string]: string } = {
        W: "way",
        R: "relation",
        N: "node",
    };
    const osmType = osmTypeMap[osmTypeLetter];
    const query = `[out:json];${osmType}(${osmId});out geom;`;
    const data = await getOverpassData(
        query,
        "Loading map data...",
        CacheType.PERMANENT_CACHE,
    );
    const geo = osmtogeojson(data);
    return {
        ...geo,
        features: geo.features.filter(
            (feature: any) => feature.geometry.type !== "Point",
        ),
    };
};

export const findTentacleLocations = async (
    question: EncompassingTentacleQuestionSchema,
    text: string = "Determining tentacle locations...",
) => {
    const query = `
[out:json][timeout:25];
nwr["${LOCATION_FIRST_TAG[question.locationType]}"="${question.locationType}"](around:${turf.convertLength(
        question.radius,
        question.unit,
        "meters",
    )}, ${question.lat}, ${question.lng});
out center;
    `;
    const data = await getOverpassData(query, text);
    const elements = data.elements;
    const response = turf.points([]);
    elements.forEach((element: any) => {
        if (!element.tags["name"] && !element.tags["name:en"]) return;
        if (element.lat && element.lon) {
            const name = element.tags["name:en"] ?? element.tags["name"];
            if (
                response.features.find(
                    (feature: any) => feature.properties.name === name,
                )
            )
                return;
            response.features.push(
                turf.point([element.lon, element.lat], { name }),
            );
        }
        if (!element.center || !element.center.lon || !element.center.lat)
            return;
        const name = element.tags["name:en"] ?? element.tags["name"];
        if (
            response.features.find(
                (feature: any) => feature.properties.name === name,
            )
        )
            return;
        response.features.push(
            turf.point([element.center.lon, element.center.lat], { name }),
        );
    });
    return response;
};

export const findAdminBoundary = async (
    latitude: number,
    longitude: number,
    adminLevel: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
) => {
    const query = `
[out:json];
is_in(${latitude}, ${longitude})->.a;
rel(pivot.a)["admin_level"="${adminLevel}"];
out geom;
    `;
    const data = await getOverpassData(query, "Determining matching zone...");
    const geo = osmtogeojson(data);
    return geo.features?.[0];
};

export const fetchCoastline = async () => {
    const response = await cacheFetch(
        import.meta.env.BASE_URL + "/coastline50.geojson",
        "Fetching coastline data...",
        CacheType.PERMANENT_CACHE,
    );
    const data = await response.json();
    return data;
};

export const trainLineNodeFinder = async (node: string): Promise<number[]> => {
    const nodeId = node.split("/")[1];
    const tagQuery = `
[out:json];
node(${nodeId});
wr(bn);
out tags;
`;
    const tagData = await getOverpassData(tagQuery, "Finding train line...");
    const query = `
[out:json];
(
${tagData.elements
    .map((element: any) => {
        if (
            !element.tags.name &&
            !element.tags["name:en"] &&
            !element.tags.network
        )
            return "";
        let query = "";
        if (element.tags.name) query += `wr["name"="${element.tags.name}"];`;
        if (element.tags["name:en"])
            query += `wr["name:en"="${element.tags["name:en"]}"];`;
        if (element.tags["network"])
            query += `wr["network"="${element.tags["network"]}"];`;
        return query;
    })
    .join("\n")}
);
out geom;
`;
    const data = await getOverpassData(query, "Finding train lines...");
    const geoJSON = osmtogeojson(data);
    const nodes: number[] = [];
    geoJSON.features.forEach((feature: any) => {
        if (feature && feature.id && feature.id.startsWith("node")) {
            nodes.push(parseInt(feature.id.split("/")[1]));
        }
    });
    data.elements.forEach((element: any) => {
        if (element && element.type === "node") {
            nodes.push(element.id);
        } else if (element && element.type === "way") {
            nodes.push(...element.nodes);
        }
    });
    const uniqNodes = _.uniq(nodes);
    return uniqNodes;
};

const toStationFeatures = (
    elements: Array<{
        type: string;
        id: number;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
    }>,
) => {
    const stations: Array<Feature<Point>> = [];
    for (const element of elements) {
        const lon = element.center?.lon ?? element.lon;
        const lat = element.center?.lat ?? element.lat;
        if (typeof lon !== "number" || typeof lat !== "number") continue;
        stations.push(
            turf.point([lon, lat], {
                id: `${element.type}/${element.id}`,
                ...element.tags,
            }),
        );
    }
    return stations;
};

export { trimTrainLinesToPlayableArea };

export type TrainLinesData = {
    lineFeatures: Array<Feature<LineString | MultiLineString>>;
    stationFeatures: Array<Feature<Point>>;
};

export const fetchTrainLines = async (): Promise<TrainLinesData> => {
    const primaryLocation = mapGeoLocation.get();
    const additionalLocations = additionalMapGeoLocations
        .get()
        .filter((entry) => entry.added)
        .map((entry) => entry.location);
    const allLocations = [primaryLocation, ...additionalLocations];
    const relationToAreaBlocks = allLocations
        .map((loc, idx) => {
            const areaVar = `.searchArea${idx}`;
            return `relation(${loc.properties.osm_id});map_to_area->${areaVar};`;
        })
        .join("\n");
    const searchAreas =
        allLocations.length > 0
            ? allLocations.map((_, idx) => `.searchArea${idx};`).join("\n")
            : "";
    const areaSelector =
        allLocations.length > 0 ? "(area.searchArea)" : '(poly:"-90 -180 -90 180 90 180 90 -180 -90 -180")';

    const query = `
[out:json][timeout:30];
${relationToAreaBlocks}
(${searchAreas})->.searchArea;
(
way["railway"="subway"]["service"!~"."]${areaSelector};
way["railway"="light_rail"]["service"!~"."]${areaSelector};
way["railway"="tram"]["service"!~"."]${areaSelector};
way["railway"="rail"]["service"!~"."]${areaSelector};
);
out geom;
(
node["railway"="station"]${areaSelector};
);
out skel;
`;
    const data = await getOverpassData(
        query,
        "Loading train line overlay...",
        CacheType.ZONE_CACHE,
    );
    const geoJSON = osmtogeojson(data) as FeatureCollection;
    const stationFeatures = toStationFeatures(data.elements ?? []);
    const lineFeatures = geoJSON.features.filter((feature: any) => {
        const geometryType = feature?.geometry?.type;
        return geometryType === "LineString" || geometryType === "MultiLineString";
    }) as Array<Feature<LineString | MultiLineString>>;
    return { lineFeatures, stationFeatures };
};

export const findPlacesInZone = async (
    filter: string,
    loadingText?: string,
    searchType:
        | "node"
        | "way"
        | "relation"
        | "nwr"
        | "nw"
        | "wr"
        | "nr"
        | "area" = "nwr",
    outType: "center" | "geom" = "center",
    alternatives: string[] = [],
    timeoutDuration: number = 0,
    operatorFilter: string[] = [],
) => {
    const { primaryLines, alternativeLines } =
        expandFiltersForOperatorNetwork(filter, alternatives, operatorFilter);

    let query = "";
    const $polyGeoJSON = polyGeoJSON.get();
    if ($polyGeoJSON) {
        const polyQuoted = turf
            .getCoords($polyGeoJSON.features)
            .flatMap((polygon) => polygon.geometry.coordinates)
            .flat()
            .map((coord) => [coord[1], coord[0]].join(" "))
            .join(" ");
        const unionLines = [...primaryLines, ...alternativeLines]
            .map(
                (f) =>
                    `${searchType}${f}(poly:"${polyQuoted}");`,
            )
            .join("\n");
        query = `
[out:json]${timeoutDuration != 0 ? `[timeout:${timeoutDuration}]` : ""};
(
${unionLines}
);
out ${outType};
`;
    } else {
        const primaryLocation = mapGeoLocation.get();
        const additionalLocations = additionalMapGeoLocations
            .get()
            .filter((entry) => entry.added)
            .map((entry) => entry.location);
        const allLocations = [primaryLocation, ...additionalLocations];
        const relationToAreaBlocks = allLocations
            .map((loc, idx) => {
                const regionVar = `.region${idx}`;
                return `relation(${loc.properties.osm_id});map_to_area->${regionVar};`;
            })
            .join("\n");
        const allFilterLines = [...primaryLines, ...alternativeLines];
        const searchBlocks = allLocations
            .map((_, idx) => {
                const regionVar = `area.region${idx}`;
                return allFilterLines
                    .map((f) => `${searchType}${f}(${regionVar});`)
                    .join("\n");
            })
            .join("\n");
        query = `
        [out:json]${timeoutDuration !== 0 ? `[timeout:${timeoutDuration}]` : ""};
        ${relationToAreaBlocks}
        (
        ${searchBlocks}
        );
        out ${outType};
        `;
    }
    const data = await getOverpassData(
        query,
        loadingText,
        CacheType.ZONE_CACHE,
    );
    const subtractedEntries = additionalMapGeoLocations
        .get()
        .filter((e) => !e.added);
    const subtractedPolygons = subtractedEntries.map((entry) => entry.location);
    if (subtractedPolygons.length > 0 && data && data.elements) {
        const turfPolys = await Promise.all(
            subtractedPolygons.map(
                async (location) =>
                    turf.combine(
                        await determineGeoJSON(
                            location.properties.osm_id.toString(),
                            location.properties.osm_type,
                        ),
                    ).features[0],
            ),
        );
        data.elements = data.elements.filter((el: any) => {
            const lon = el.center ? el.center.lon : el.lon;
            const lat = el.center ? el.center.lat : el.lat;
            if (typeof lon !== "number" || typeof lat !== "number")
                return false;
            const pt = turf.point([lon, lat]);
            return !turfPolys.some((poly) =>
                turf.booleanPointInPolygon(pt, poly as any),
            );
        });
    }

    if (
        operatorFilter.length > 0 &&
        data &&
        Array.isArray(data.elements) &&
        data.elements.length > 0
    ) {
        const seen = new Set<string>();
        data.elements = data.elements.filter((el: any) => {
            const key = `${el.type}/${el.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    return data;
};

export const findPlacesSpecificInZone = async (
    location: `${QuestionSpecificLocation}`,
) => {
    const locations = (
        await findPlacesInZone(
            location,
            `Finding ${
                location === '["brand:wikidata"="Q38076"]'
                    ? "McDonald's"
                    : "7-Elevens"
            }...`,
        )
    ).elements;
    return turf.featureCollection(
        locations.map((x: any) =>
            turf.point([
                x.center ? x.center.lon : x.lon,
                x.center ? x.center.lat : x.lat,
            ]),
        ),
    );
};

export const nearestToQuestion = async (
    question: HomeGameMatchingQuestions | HomeGameMeasuringQuestions,
) => {
    let radius = 30;
    let instances: any = { features: [] };
    while (instances.features.length === 0) {
        instances = await findTentacleLocations(
            {
                lat: question.lat,
                lng: question.lng,
                radius: radius,
                unit: "miles",
                location: false,
                locationType: question.type,
                drag: false,
                color: "black",
                collapsed: false,
            },
            "Finding matching locations...",
        );
        radius += 30;
    }
    const questionPoint = turf.point([question.lng, question.lat]);
    return turf.nearestPoint(questionPoint, instances as any);
};

export const determineMapBoundaries = async () => {
    const mapGeoDatum = await Promise.all(
        [
            {
                location: mapGeoLocation.get(),
                added: true,
                base: true,
            },
            ...additionalMapGeoLocations.get(),
        ].map(async (location) => ({
            added: location.added,
            data: await determineGeoJSON(
                location.location.properties.osm_id.toString(),
                location.location.properties.osm_type,
            ),
        })),
    );

    let mapGeoData = turf.featureCollection([
        safeUnion(
            turf.featureCollection(
                mapGeoDatum
                    .filter((x) => x.added)
                    .flatMap((x) => x.data.features),
            ) as any,
        ),
    ]);

    const differences = mapGeoDatum.filter((x) => !x.added).map((x) => x.data);

    if (differences.length > 0) {
        mapGeoData = turf.featureCollection([
            turf.difference(
                turf.featureCollection([
                    mapGeoData.features[0],
                    ...differences.flatMap((x) => x.features),
                ]),
            )!,
        ]);
    }

    if (turf.coordAll(mapGeoData).length > 10000) {
        turf.simplify(mapGeoData, {
            tolerance: 0.0005,
            highQuality: true,
            mutate: true,
        });
    }

    return turf.combine(mapGeoData) as FeatureCollection<MultiPolygon>;
};
