import * as turf from "@turf/turf";
import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiLineString,
    MultiPolygon,
    Point,
    Polygon,
} from "geojson";
import _ from "lodash";
import osmtogeojson from "osmtogeojson";
import { toast } from "react-toastify";

import {
    additionalMapGeoLocations,
    mapGeoLocation,
    polyGeoJSON,
} from "@/lib/context";
import { expandFiltersForOperatorNetwork, safeUnion } from "@/maps/geo-utils";

import { cacheFetch, determineCache } from "./cache";
import {
    LOCATION_FIRST_TAG,
    OVERPASS_API,
    OVERPASS_API_FALLBACK,
} from "./constants";
import type {
    EncompassingTentacleQuestionSchema,
    HomeGameMatchingQuestions,
    HomeGameMeasuringQuestions,
    QuestionSpecificLocation,
} from "./types";
import { CacheType } from "./types";

export const getOverpassData = async (
    query: string,
    loadingText?: string,
    cacheType: CacheType = CacheType.CACHE,
) => {
    const encodedQuery = encodeURIComponent(query);
    const primaryUrl = `${OVERPASS_API}?data=${encodedQuery}`;
    let response = await cacheFetch(primaryUrl, loadingText, cacheType);

    if (!response.ok) {
        // Try the fallback, but store the result under the primary URL key so future requests are served from cache without needing to fail-over again.
        try {
            const fallbackResponse = await cacheFetch(
                `${OVERPASS_API_FALLBACK}?data=${encodedQuery}`,
                loadingText,
                cacheType,
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

const segmentClipInside = (
    line: Feature<LineString>,
    playableArea: Feature<Polygon | MultiPolygon>,
) => {
    const boundary = turf.polygonToLine(playableArea as any) as any;
    const segments: Array<Feature<LineString>> = [];
    const coords = line.geometry.coordinates;
    if (coords.length < 2) return segments;

    let currentCoords: number[][] = [];
    const finalizeCurrent = () => {
        if (currentCoords.length >= 2) {
            segments.push(turf.lineString(currentCoords, line.properties));
        }
        currentCoords = [];
    };

    for (let idx = 1; idx < coords.length; idx += 1) {
        const start = coords[idx - 1];
        const end = coords[idx];
        const segment = turf.lineString([start, end]);
        const mid = turf.midpoint(turf.point(start), turf.point(end));
        const midInside = turf.booleanPointInPolygon(mid, playableArea as any);
        const intersections = turf.lineIntersect(segment, boundary as any).features;
        const uniqueIntersections = _.uniqBy(
            intersections.map((feature) => feature.geometry.coordinates),
            (coord) => `${coord[0].toFixed(7)}_${coord[1].toFixed(7)}`,
        );

        if (uniqueIntersections.length === 0) {
            if (midInside) {
                if (currentCoords.length === 0) currentCoords.push(start);
                currentCoords.push(end);
            } else {
                finalizeCurrent();
            }
            continue;
        }

        const intersectionPoints = uniqueIntersections
            .map((coord) => turf.point(coord))
            .map((point) => ({
                point,
                distanceFromStart: turf.distance(turf.point(start), point, {
                    units: "kilometers",
                }),
            }))
            .sort((a, b) => a.distanceFromStart - b.distanceFromStart);

        let cursor = start;
        let cursorInside = turf.booleanPointInPolygon(
            turf.midpoint(turf.point(start), intersectionPoints[0].point),
            playableArea as any,
        );

        for (const intersect of intersectionPoints) {
            const cut = intersect.point.geometry.coordinates;
            if (cursorInside) {
                if (currentCoords.length === 0) currentCoords.push(cursor);
                currentCoords.push(cut);
                finalizeCurrent();
            } else {
                finalizeCurrent();
            }
            cursor = cut;
            cursorInside = !cursorInside;
        }

        if (cursorInside) {
            if (currentCoords.length === 0) currentCoords.push(cursor);
            currentCoords.push(end);
        } else {
            finalizeCurrent();
        }
    }

    finalizeCurrent();
    return segments;
};

const extendSegmentToOutsideStation = (
    fullLine: Feature<LineString>,
    segment: Feature<LineString>,
    stations: Array<Feature<Point>>,
    playableArea: Feature<Polygon | MultiPolygon>,
) => {
    const segmentCoords = segment.geometry.coordinates;
    if (segmentCoords.length < 2) return segment;

    const projectedStations = stations
        .map((station) => {
            const snapped = turf.nearestPointOnLine(fullLine, station, {
                units: "kilometers",
            });
            const stationDistanceToLineKm = turf.distance(station, snapped, {
                units: "kilometers",
            });
            return {
                station,
                location: (snapped.properties?.location ?? 0) as number,
                stationDistanceToLineKm,
                inside: turf.booleanPointInPolygon(station, playableArea as any),
            };
        })
        .filter((entry) => entry.stationDistanceToLineKm <= 1.5)
        .sort((a, b) => a.location - b.location);

    // Confidence heuristics: avoid risky extensions on sparse/ambiguous station mappings.
    if (projectedStations.length < 3) return segment;
    const monotonic = projectedStations.every((entry, idx) => {
        if (idx === 0) return true;
        return entry.location >= projectedStations[idx - 1].location;
    });
    if (!monotonic) return segment;

    const lengthKm = turf.length(fullLine, { units: "kilometers" });
    const startProjection = turf.nearestPointOnLine(
        fullLine,
        turf.point(segmentCoords[0]),
        { units: "kilometers" },
    );
    const endProjection = turf.nearestPointOnLine(
        fullLine,
        turf.point(segmentCoords[segmentCoords.length - 1]),
        { units: "kilometers" },
    );
    const startLoc = Math.max(
        0,
        Math.min(lengthKm, (startProjection.properties?.location ?? 0) as number),
    );
    const endLoc = Math.max(
        0,
        Math.min(lengthKm, (endProjection.properties?.location ?? 0) as number),
    );

    const MAX_EXTENSION_KM = 80;
    const startOutside = [...projectedStations]
        .reverse()
        .find((entry) => !entry.inside && entry.location < startLoc);
    const endOutside = projectedStations.find(
        (entry) => !entry.inside && entry.location > endLoc,
    );

    const merged = [...segmentCoords];
    if (
        startOutside &&
        startLoc - startOutside.location <= MAX_EXTENSION_KM &&
        startLoc > startOutside.location
    ) {
        const preSlice = turf.lineSliceAlong(fullLine, startOutside.location, startLoc, {
            units: "kilometers",
        });
        const preCoords = preSlice.geometry.coordinates;
        if (preCoords.length >= 2) {
            const withoutLast = preCoords.slice(0, -1);
            merged.splice(0, 0, ...withoutLast);
        }
    }

    if (
        endOutside &&
        endOutside.location - endLoc <= MAX_EXTENSION_KM &&
        endOutside.location > endLoc
    ) {
        const postSlice = turf.lineSliceAlong(fullLine, endLoc, endOutside.location, {
            units: "kilometers",
        });
        const postCoords = postSlice.geometry.coordinates;
        if (postCoords.length >= 2) {
            const withoutFirst = postCoords.slice(1);
            merged.push(...withoutFirst);
        }
    }

    const dedupedCoords = merged.filter((coord, idx) => {
        if (idx === 0) return true;
        const prev = merged[idx - 1];
        return coord[0] !== prev[0] || coord[1] !== prev[1];
    });
    if (dedupedCoords.length < 2) return segment;
    return turf.lineString(dedupedCoords, segment.properties);
};

const trimLineFeature = (
    line: Feature<LineString | MultiLineString>,
    stations: Array<Feature<Point>>,
    playableArea: Feature<Polygon | MultiPolygon>,
) => {
    const lineParts =
        line.geometry.type === "LineString"
            ? [line.geometry.coordinates]
            : line.geometry.coordinates;
    const outputSegments: Array<Feature<LineString>> = [];

    for (const coords of lineParts) {
        if (coords.length < 2) continue;
        const partLine = turf.lineString(coords, line.properties);
        const clippedSegments = segmentClipInside(partLine, playableArea);
        for (const segment of clippedSegments) {
            outputSegments.push(
                extendSegmentToOutsideStation(partLine, segment, stations, playableArea),
            );
        }
    }

    return outputSegments;
};

export const trimTrainLinesToPlayableArea = (
    lineFeatures: Array<Feature<LineString | MultiLineString>>,
    stationFeatures: Array<Feature<Point>>,
    playableArea: Feature<Polygon | MultiPolygon> | null,
) => {
    if (!playableArea) return lineFeatures;
    return lineFeatures.flatMap((line) =>
        trimLineFeature(line, stationFeatures, playableArea),
    );
};

export type TrainLinesData = {
    lineFeatures: Array<Feature<LineString | MultiLineString>>;
    stationFeatures: Array<Feature<Point>>;
};

export const fetchTrainLines = async (): Promise<TrainLinesData> => {
    const routeFilter = `["route"~"^(subway|light_rail|tram|train|monorail)$"]`;
    const stationFilter = `["railway"="station"]`;

    const buildScopedQueries = (
        relationTemplate: (scope: string) => string,
        stationTemplate: (scope: string) => string,
    ) => {
        const $polyGeoJSON = polyGeoJSON.get();
        if ($polyGeoJSON) {
            const polyQuoted = turf
                .getCoords($polyGeoJSON.features)
                .flatMap((polygon) => polygon.geometry.coordinates)
                .flat()
                .map((coord) => [coord[1], coord[0]].join(" "))
                .join(" ");
            return {
                relationToAreaBlocks: "",
                relationQueries: [relationTemplate(`poly:"${polyQuoted}"`)],
                stationQueries: [stationTemplate(`poly:"${polyQuoted}"`)],
            };
        }

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

        return {
            relationToAreaBlocks,
            relationQueries: allLocations.map((_, idx) =>
                relationTemplate(`area.region${idx}`),
            ),
            stationQueries: allLocations.map((_, idx) =>
                stationTemplate(`area.region${idx}`),
            ),
        };
    };

    let query = "";
    const { relationToAreaBlocks, relationQueries, stationQueries } =
        buildScopedQueries(
            (scope) => `relation${routeFilter}(${scope})->.rail;`,
            (scope) => `nwr${stationFilter}(${scope})->.stations;`,
        );
    query = `
[out:json][timeout:60];
${relationToAreaBlocks}
(
${relationQueries.join("\n")}
${stationQueries.join("\n")}
);
(.rail;);
out body;
way(r.rail);
out skel geom;
(.stations;);
out tags center;
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
