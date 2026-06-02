import {
    findMatchingFeatures,
    parseOverpassElements,
    rankMatchingFeatures,
} from "../../src/features/questions/matching/osmMatching.ts";
import {
    buildNameLengthMasks,
    buildOsmMatchingMissMask,
    clearVoronoiCache,
    computeVoronoiCells,
    makeOsmKey,
} from "../../src/features/questions/matching/matchingVoronoi.ts";
import { buildOsmMatchingRenderState } from "../../src/features/questions/matching/osmMatchingGeometry.ts";
import type {
    MatchingCategory,
    OsmFeature,
} from "../../src/features/questions/matching/matchingTypes.ts";
import type { Position } from "../../src/shared/geojson.ts";
import {
    loadCapture,
    perfPath,
    type CaptureEnvelope,
    type PerfScenario,
} from "../lib.mts";
import { MemoryCacheStorage, ReplayCache } from "../models/replay-cache.mts";
import {
    cellIndex,
    cellsForSearch,
} from "../../src/features/questions/matching/osmMatchingGrid.ts";
import {
    clearOsmMatchingCellMemoryCache,
    deduplicateFeatures,
    findMatchingFeaturesWithCellCache,
} from "../../src/features/questions/matching/osmMatchingCache.ts";

type OverpassPayload = { elements?: unknown[] };

const tokyoCenter: Position = [139.767125, 35.681236];
const movedTokyoCenter: Position = [139.777125, 35.681236];
const outsideTokyoCenter: Position = [139.95, 35.681236];
const tokyoBbox: [number, number, number, number] = [
    139.55, 35.5, 140.0, 35.85,
];

const stationCapture = capture("matching/tokyo-stations-5km.json");
const hospitalCapture = capture("matching/tokyo-hospitals-5km.json");
const museumCapture = capture("matching/tokyo-museums-5km.json");
const airportCapture = capture("matching/tokyo-airports-50km.json");
const emptyCapture = capture("matching/ocean-hospitals-empty.json");

const stations = parse(stationCapture, "station-name-length");
const hospitals = parse(hospitalCapture, "hospital");
const museums = parse(museumCapture, "museum");
const airports = parse(airportCapture, "commercial-airport");
const empty = parse(emptyCapture, "hospital");
const stationCandidates = rankMatchingFeatures(stations, tokyoCenter, 10);
const hospitalCandidates = rankMatchingFeatures(hospitals, tokyoCenter, 10);
const matchingQuestions = Array.from({ length: 10 }, (_, index) => ({
    answer: index === 0 ? ("negative" as const) : ("positive" as const),
    candidates: hospitalCandidates,
    category: "hospital" as const,
    center: tokyoCenter,
    createdAt: "2026-06-01T00:00:00.000Z",
    id: `hospital-${index}`,
    lineId: null,
    lineName: null,
    selectedOsmId: hospitalCandidates[0]?.osmId ?? null,
    selectedOsmType: hospitalCandidates[0]?.osmType ?? null,
    targetName: hospitalCandidates[0]?.name ?? null,
    targetOsmId: hospitalCandidates[0]?.osmId ?? null,
    targetOsmType: hospitalCandidates[0]?.osmType ?? null,
    type: "matching" as const,
    updatedAt: "2026-06-01T00:00:00.000Z",
}));

export const matchingScenarios: PerfScenario[] = [
    parseRankScenario(
        "matching/tokyo-stations-parse-rank",
        stationCapture,
        "station-name-length",
        tokyoCenter,
    ),
    parseRankScenario(
        "matching/tokyo-hospitals-parse-rank",
        hospitalCapture,
        "hospital",
        tokyoCenter,
    ),
    parseRankScenario(
        "matching/tokyo-museums-parse-rank",
        museumCapture,
        "museum",
        tokyoCenter,
    ),
    parseRankScenario(
        "matching/tokyo-airports-parse-rank",
        airportCapture,
        "commercial-airport",
        tokyoCenter,
    ),
    parseRankScenario(
        "matching/ocean-empty-parse-rank",
        emptyCapture,
        "hospital",
        [145, 35],
    ),
    {
        fixtureHash: fixtureHashFor(hospitalCapture),
        group: "matching-network",
        iterations: 10,
        name: "matching-network/hospital-repeat-current",
        run: async () => {
            const transport = installFixtureFetch(hospitalCapture);
            const first = await findMatchingFeatures("hospital", tokyoCenter, {
                searchRadiusMeters: 5000,
            });
            const second = await findMatchingFeatures("hospital", tokyoCenter, {
                searchRadiusMeters: 5000,
            });
            return {
                metrics: {
                    cacheHits: 0,
                    networkIntents: transport.calls(),
                },
                output: { first, second },
            };
        },
        warmups: 2,
    },
    {
        fixtureHash: fixtureHashFor(hospitalCapture),
        group: "matching-network",
        iterations: 20,
        name: "matching-network/containment-hit-rank",
        run: () => ({
            metrics: {
                cacheHits: Number(
                    containsSearchCircle(
                        tokyoCenter,
                        5000,
                        movedTokyoCenter,
                        3000,
                    ),
                ),
                networkIntents: 0,
            },
            output: rankMatchingFeatures(hospitals, movedTokyoCenter, 10),
        }),
        warmups: 3,
    },
    {
        group: "matching-network",
        iterations: 30,
        name: "matching-network/containment-miss-proof",
        run: () => ({
            metrics: {
                cacheMisses: Number(
                    !containsSearchCircle(
                        tokyoCenter,
                        5000,
                        outsideTokyoCenter,
                        3000,
                    ),
                ),
                networkIntents: 1,
            },
            output: containsSearchCircle(
                tokyoCenter,
                5000,
                outsideTokyoCenter,
                3000,
            ),
        }),
        warmups: 5,
    },
    {
        fixtureHash: fixtureHashFor(emptyCapture),
        group: "matching-network",
        iterations: 30,
        name: "matching-network/negative-result-rank",
        run: () => ({
            metrics: { candidates: empty.length },
            output: rankMatchingFeatures(empty, [145, 35], 10),
        }),
        warmups: 5,
    },
    {
        fixtureHash: fixtureHashFor(hospitalCapture),
        group: "matching-cache-prototype",
        iterations: 20,
        name: "matching-cache-prototype/persisted-hit",
        run: async () => {
            const storage = new MemoryCacheStorage();
            const cache = new ReplayCache<OsmFeature[]>(
                storage,
                () => 10_000,
                5000,
            );
            await cache.seed("hospital/tokyo", {
                cachedAt: 9000,
                value: hospitals,
            });
            let networkIntents = 0;
            const result = await cache.get("hospital/tokyo", async () => {
                networkIntents += 1;
                return hospitals;
            });
            return {
                metrics: { networkIntents, source: result.source },
                output: rankMatchingFeatures(result.value, tokyoCenter, 10),
            };
        },
        warmups: 3,
    },
    {
        fixtureHash: fixtureHashFor(hospitalCapture),
        group: "matching-cache-prototype",
        iterations: 20,
        name: "matching-cache-prototype/stale-hit-background-refresh",
        run: async () => {
            const storage = new MemoryCacheStorage();
            const cache = new ReplayCache<OsmFeature[]>(
                storage,
                () => 10_000,
                5000,
            );
            await cache.seed("hospital/tokyo", {
                cachedAt: 1000,
                value: hospitals,
            });
            let networkIntents = 0;
            const result = await cache.get("hospital/tokyo", async () => {
                networkIntents += 1;
                return hospitals;
            });
            await Promise.resolve();
            return {
                metrics: { networkIntents, source: result.source },
                output: rankMatchingFeatures(result.value, tokyoCenter, 10),
            };
        },
        warmups: 3,
    },
    {
        fixtureHash: fixtureHashFor(hospitalCapture),
        group: "matching-cache-prototype",
        iterations: 20,
        name: "matching-cache-prototype/inflight-dedupe",
        run: async () => {
            const storage = new MemoryCacheStorage();
            const cache = new ReplayCache<OsmFeature[]>(
                storage,
                () => 10_000,
                5000,
            );
            let networkIntents = 0;
            const load = async () => {
                networkIntents += 1;
                await Promise.resolve();
                return hospitals;
            };
            const [first, second] = await Promise.all([
                cache.get("hospital/tokyo", load),
                cache.get("hospital/tokyo", load),
            ]);
            return {
                metrics: { networkIntents },
                output: { first, second },
            };
        },
        warmups: 3,
    },
    {
        fixtureHash: fixtureHashFor(emptyCapture),
        group: "matching-cache-prototype",
        iterations: 20,
        name: "matching-cache-prototype/negative-persisted-hit",
        run: async () => {
            const storage = new MemoryCacheStorage();
            const cache = new ReplayCache<OsmFeature[]>(
                storage,
                () => 10_000,
                5000,
            );
            await cache.seed("hospital/ocean", { cachedAt: 9000, value: [] });
            let networkIntents = 0;
            const result = await cache.get("hospital/ocean", async () => {
                networkIntents += 1;
                return empty;
            });
            return {
                metrics: { networkIntents, source: result.source },
                output: result.value,
            };
        },
        warmups: 3,
    },
    {
        fixtureHash: fixtureHashFor(stationCapture),
        group: "matching-geometry",
        iterations: 8,
        name: "matching-geometry/station-voronoi-cold",
        run: () => ({
            metrics: { candidates: stationCandidates.length },
            output: computeVoronoiCells(stationCandidates, tokyoBbox),
        }),
        setup: clearVoronoiCache,
        warmups: 2,
    },
    {
        fixtureHash: fixtureHashFor(stationCapture),
        group: "matching-geometry",
        iterations: 20,
        name: "matching-geometry/station-voronoi-warm",
        setup: () => {
            clearVoronoiCache();
            computeVoronoiCells(stationCandidates, tokyoBbox);
        },
        run: () => ({
            metrics: { candidates: stationCandidates.length },
            output: computeVoronoiCells(stationCandidates, tokyoBbox),
        }),
        warmups: 3,
    },
    {
        fixtureHash: fixtureHashFor(stationCapture),
        group: "matching-geometry",
        iterations: 8,
        name: "matching-geometry/name-length-mask",
        setup: clearVoronoiCache,
        run: () => {
            const cells = computeVoronoiCells(stationCandidates, tokyoBbox);
            return {
                metrics: { candidates: stationCandidates.length },
                output: buildNameLengthMasks(
                    cells,
                    stationCandidates[0]?.nameLength ?? null,
                ),
            };
        },
        warmups: 2,
    },
    {
        fixtureHash: fixtureHashFor(stationCapture),
        group: "matching-geometry",
        iterations: 8,
        name: "matching-geometry/miss-mask",
        setup: clearVoronoiCache,
        run: () => {
            const cells = computeVoronoiCells(stationCandidates, tokyoBbox);
            return {
                metrics: { candidates: stationCandidates.length },
                output: buildOsmMatchingMissMask(
                    cells,
                    stationCandidates[0]
                        ? makeOsmKey(
                              stationCandidates[0].osmType,
                              stationCandidates[0].osmId,
                          )
                        : null,
                ),
            };
        },
        warmups: 2,
    },
    {
        fixtureHash: fixtureHashFor(hospitalCapture),
        group: "matching-geometry",
        iterations: 5,
        name: "matching-geometry/10-questions-render-state",
        setup: clearVoronoiCache,
        run: () => ({
            metrics: { questions: matchingQuestions.length },
            output: buildOsmMatchingRenderState(matchingQuestions, tokyoBbox),
        }),
        warmups: 1,
    },
    {
        fixtureHash: fixtureHashFor(hospitalCapture),
        group: "matching-geometry",
        iterations: 5,
        name: "matching-geometry/10-questions-one-answer-edit",
        setup: () => {
            clearVoronoiCache();
            buildOsmMatchingRenderState(matchingQuestions, tokyoBbox);
        },
        run: () => ({
            metrics: {
                editedQuestions: 1,
                questions: matchingQuestions.length,
            },
            output: buildOsmMatchingRenderState(
                matchingQuestions.map((question, index) =>
                    index === 5
                        ? { ...question, answer: "negative" as const }
                        : question,
                ),
                tokyoBbox,
            ),
        }),
        warmups: 1,
    },
    // ─── matching-bbox-cell scenarios ───────────────────────────────────────
    {
        fixtureHash: fixtureHashFor(hospitalCapture),
        group: "matching-bbox-cell",
        iterations: 30,
        name: "matching-bbox-cell/cells-for-search",
        setup: clearOsmMatchingCellMemoryCache,
        run: () => {
            const cells = cellsForSearch(35.68, 139.76, 50_000);
            return {
                metrics: { cells: cells.length },
                output: cells,
            };
        },
        warmups: 5,
    },
    {
        fixtureHash: fixtureHashFor(hospitalCapture),
        group: "matching-bbox-cell",
        iterations: 30,
        name: "matching-bbox-cell/cell-index",
        run: () => ({
            metrics: { index: 1 },
            output: cellIndex(35.681236, 139.767125),
        }),
        warmups: 5,
    },
    {
        fixtureHash: fixtureHashFor(hospitalCapture),
        group: "matching-bbox-cell",
        iterations: 15,
        name: "matching-bbox-cell/cache-hit-merge",
        setup: clearOsmMatchingCellMemoryCache,
        run: async () => {
            const realFetch = globalThis.fetch;
            const transport = installFixtureFetch(hospitalCapture);
            try {
                // Prime the cell cache.
                await findMatchingFeaturesWithCellCache(
                    "hospital",
                    tokyoCenter,
                    { requestedRadiusMeters: 5000 },
                );
                // Replace fetch with a noop so any unexpected network call
                // throws and fails the scenario loudly.
                globalThis.fetch = (() => {
                    throw new Error("unexpected network call");
                }) as unknown as typeof globalThis.fetch;
                // Cache-hit: all cells cached, measure merge+filter time.
                const result = await findMatchingFeaturesWithCellCache(
                    "hospital",
                    movedTokyoCenter,
                    { requestedRadiusMeters: 5000 },
                );
                return {
                    metrics: {
                        candidates: result.candidates.length,
                        networkIntents: transport.calls(),
                    },
                    output: result,
                };
            } finally {
                globalThis.fetch = realFetch;
            }
        },
        warmups: 3,
    },
    {
        fixtureHash: fixtureHashFor(hospitalCapture),
        group: "matching-bbox-cell",
        iterations: 15,
        name: "matching-bbox-cell/cache-partial-fetch",
        setup: async () => {
            clearOsmMatchingCellMemoryCache();
            installFixtureFetch(hospitalCapture);
            // Prime the cell cache with a small-radius search so that
            // each measured run starts from a partially-warm state.
            await findMatchingFeaturesWithCellCache("hospital", tokyoCenter, {
                requestedRadiusMeters: 1000,
            });
        },
        run: async () => {
            const transport = installFixtureFetch(hospitalCapture);
            // Perform a larger-radius search that needs extra cells.
            const result = await findMatchingFeaturesWithCellCache(
                "hospital",
                tokyoCenter,
                { requestedRadiusMeters: 50_000 },
            );
            return {
                metrics: {
                    candidates: result.candidates.length,
                    networkIntents: transport.calls(),
                    cachedCells: cellsForSearch(35.68, 139.76, 1000).length,
                    neededCells: cellsForSearch(35.68, 139.76, 50_000).length,
                },
                output: result,
            };
        },
        warmups: 3,
    },
    {
        fixtureHash: fixtureHashFor(hospitalCapture),
        group: "matching-bbox-cell",
        iterations: 15,
        name: "matching-bbox-cell/dedup-merge",
        run: () => {
            // Benchmark deduplication of overlapping cell results.
            const features = hospitals.concat(hospitals.slice(0, 5));
            const deduped = deduplicateFeatures(features);
            return {
                metrics: {
                    input: features.length,
                    output: deduped.length,
                },
                output: deduped,
            };
        },
        warmups: 3,
    },
];

function capture(relative: string): CaptureEnvelope<OverpassPayload> {
    return loadCapture(
        perfPath("fixtures/overpass", relative),
    ) as CaptureEnvelope<OverpassPayload>;
}

function parse(
    envelope: CaptureEnvelope<OverpassPayload>,
    category: MatchingCategory,
): OsmFeature[] {
    return parseOverpassElements(
        (envelope.payload.elements ?? []) as Parameters<
            typeof parseOverpassElements
        >[0],
        category,
    );
}

function parseRankScenario(
    name: string,
    envelope: CaptureEnvelope<OverpassPayload>,
    category: MatchingCategory,
    center: Position,
): PerfScenario {
    return {
        fixtureHash: fixtureHashFor(envelope),
        group: "matching",
        iterations: 15,
        name,
        run: () => {
            const features = parse(envelope, category);
            return {
                metrics: {
                    parsedCandidates: features.length,
                    rawElements: envelope.payload.elements?.length ?? 0,
                },
                output: rankMatchingFeatures(features, center, 10),
            };
        },
        warmups: 3,
    };
}

function fixtureHashFor(envelope: CaptureEnvelope): string {
    return envelope.responseSha256;
}

function installFixtureFetch(envelope: CaptureEnvelope<OverpassPayload>) {
    let callCount = 0;
    globalThis.fetch = async () => {
        callCount += 1;
        return {
            json: async () => envelope.payload,
            ok: true,
            status: 200,
        } as Response;
    };
    return { calls: () => callCount };
}

function containsSearchCircle(
    cachedCenter: Position,
    cachedRadiusMeters: number,
    requestedCenter: Position,
    requestedRadiusMeters: number,
): boolean {
    const latMeters = (requestedCenter[1] - cachedCenter[1]) * 111_320;
    const lonMeters =
        (requestedCenter[0] - cachedCenter[0]) *
        111_320 *
        Math.cos((cachedCenter[1] * Math.PI) / 180);
    return (
        Math.hypot(latMeters, lonMeters) + requestedRadiusMeters <=
        cachedRadiusMeters
    );
}

export const matchingFixtureSummary = {
    airports: airports.length,
    hospitals: hospitals.length,
    museums: museums.length,
    stations: stations.length,
};
