import { canonicalize } from "@/sharing/wire/canonicalize";
import {
    COORD_FACTOR,
    compactCoord,
    compactPolyline,
    FIELD_MAP,
    minifyEnvelope as minifyEnvelopeRaw,
    uncompactCoord,
    uncompactPolyline,
    unminifyEnvelope as unminifyEnvelopeRaw,
} from "@/sharing/wire/minified";
import type { AppStateEnvelopeMinified } from "@/sharing/wire/minified";
import type { AppStateEnvelopeV1 } from "@/sharing/wire/schema";

// These tests cover app-state round-trips; narrow the widened WireEnvelope
// union back to the app-state members so existing assertions stay valid.
function minifyEnvelope(
    envelope: Parameters<typeof minifyEnvelopeRaw>[0],
): AppStateEnvelopeMinified {
    return minifyEnvelopeRaw(envelope) as AppStateEnvelopeMinified;
}

function unminifyEnvelope(
    mini: Parameters<typeof unminifyEnvelopeRaw>[0],
): AppStateEnvelopeV1 {
    const restored = unminifyEnvelopeRaw(mini);
    if (restored.kind !== "app-state") {
        throw new Error(`Expected app-state envelope, got ${restored.kind}`);
    }
    return restored;
}

function makeEnvelope(
    overrides?: Partial<AppStateEnvelopeV1["payload"]>,
): AppStateEnvelopeV1 {
    return {
        kind: "app-state",
        payload: {
            gameId: "test-game-1",
            hidingZones: {
                radiusMeters: 600,
                radiusUnit: "m",
                selectedPresetIds: ["preset-a", "preset-b"],
            },
            metadata: {
                createdAt: "2026-05-17T00:00:00.000Z",
                updatedAt: "2026-05-17T00:00:00.000Z",
            },
            playArea: {
                bbox: [139.5, 35.5, 139.9, 35.9],
                boundary: { features: [], type: "FeatureCollection" },
                center: [139.7, 35.7],
                label: "Test Area",
                osmId: 12345,
                osmType: "R",
            },
            ...overrides,
        },
        version: 1,
    };
}

describe("FIELD_MAP", () => {
    it("has no duplicate minified values", () => {
        const values = Object.values(FIELD_MAP);
        const unique = new Set(values);
        expect(unique.size).toBe(values.length);
    });

    it("covers all keys used in round-trip", () => {
        const envelope = makeEnvelope();
        const mini = minifyEnvelope(envelope);
        const restored = unminifyEnvelope(mini);

        expect(restored.kind).toBe(envelope.kind);
        expect(restored.version).toBe(envelope.version);
        expect(restored.payload.gameId).toBe(envelope.payload.gameId);
    });
});

describe("compactCoord", () => {
    it("round-trips within 0.5 / COORD_FACTOR degrees", () => {
        const [lon, lat] = [139.6917064, 35.6894875];
        const compacted = compactCoord(lon, lat);
        const [restoredLon, restoredLat] = uncompactCoord(
            compacted[0],
            compacted[1],
        );

        expect(Math.abs(restoredLon - lon)).toBeLessThan(0.5 / COORD_FACTOR);
        expect(Math.abs(restoredLat - lat)).toBeLessThan(0.5 / COORD_FACTOR);
    });

    it("handles zero coordinates", () => {
        expect(compactCoord(0, 0)).toEqual([0, 0]);
        expect(uncompactCoord(0, 0)).toEqual([0, 0]);
    });

    it("handles extreme coordinates", () => {
        const [lon, lat] = [-180, -90];
        const compacted = compactCoord(lon, lat);
        const [restoredLon, restoredLat] = uncompactCoord(
            compacted[0],
            compacted[1],
        );

        expect(restoredLon).toBeCloseTo(lon, 5);
        expect(restoredLat).toBeCloseTo(lat, 5);
    });

    it("handles positive extreme coordinates", () => {
        const [lon, lat] = [180, 90];
        const compacted = compactCoord(lon, lat);
        const [restoredLon, restoredLat] = uncompactCoord(
            compacted[0],
            compacted[1],
        );

        expect(restoredLon).toBeCloseTo(lon, 5);
        expect(restoredLat).toBeCloseTo(lat, 5);
    });

    it("produces integers that fit in safe integer range", () => {
        const compacted = compactCoord(180, 90);
        expect(Number.isSafeInteger(compacted[0])).toBe(true);
        expect(Number.isSafeInteger(compacted[1])).toBe(true);
    });
});

describe("compactPolyline", () => {
    it("round-trips a multi-point polyline", () => {
        const coords: [number, number][] = [
            [139.7, 35.7],
            [139.71, 35.71],
            [139.72, 35.72],
            [139.7, 35.7],
        ];
        const encoded = compactPolyline(coords);
        const decoded = uncompactPolyline(encoded);

        expect(decoded.length).toBe(coords.length);
        for (let i = 0; i < coords.length; i++) {
            expect(decoded[i][0]).toBeCloseTo(coords[i][0], 4);
            expect(decoded[i][1]).toBeCloseTo(coords[i][1], 4);
        }
    });

    it("round-trips a single-point polyline", () => {
        const coords: [number, number][] = [[139.7, 35.7]];
        const encoded = compactPolyline(coords);
        const decoded = uncompactPolyline(encoded);

        expect(decoded.length).toBe(1);
        expect(decoded[0][0]).toBeCloseTo(coords[0][0], 4);
        expect(decoded[0][1]).toBeCloseTo(coords[0][1], 4);
    });

    it("returns empty array for empty input", () => {
        expect(uncompactPolyline(compactPolyline([]))).toEqual([]);
    });

    it("returns empty array for invalid encoded data", () => {
        expect(uncompactPolyline([])).toEqual([]);
        expect(uncompactPolyline([0, 0, 0])).toEqual([]);
    });

    it("produces small delta values for adjacent points", () => {
        const coords: [number, number][] = [
            [139.7, 35.7],
            [139.7001, 35.7001],
            [139.7002, 35.7002],
        ];
        const encoded = compactPolyline(coords);
        expect(encoded[POLYLINE_HEADER_INDEX]).toBeGreaterThan(0);
        expect(encoded[POLYLINE_HEADER_INDEX]).toBeLessThan(200);
    });
});

const POLYLINE_HEADER_INDEX = 3;

describe("minifyEnvelope", () => {
    it("drops radiusUnit from hidingZones", () => {
        const envelope = makeEnvelope();
        const mini = minifyEnvelope(envelope);
        const json = JSON.parse(canonicalize(mini));

        expect(
            json[FIELD_MAP.payload][FIELD_MAP.hidingZones].radiusUnit,
        ).toBeUndefined();
        expect(
            json[FIELD_MAP.payload][FIELD_MAP.hidingZones][
                FIELD_MAP.radiusMeters
            ],
        ).toBe(600);
    });

    it("drops updatedAt from metadata", () => {
        const envelope = makeEnvelope();
        const mini = minifyEnvelope(envelope);
        const json = JSON.parse(canonicalize(mini));

        expect(
            json[FIELD_MAP.payload][FIELD_MAP.metadata].updatedAt,
        ).toBeUndefined();
        expect(
            json[FIELD_MAP.payload][FIELD_MAP.metadata][FIELD_MAP.createdAt],
        ).toBe("2026-05-17T00:00:00.000Z");
    });

    it("drops bbox, boundary, and osmType from playArea", () => {
        const envelope = makeEnvelope();
        const mini = minifyEnvelope(envelope);
        const json = JSON.parse(canonicalize(mini));

        const pa = json[FIELD_MAP.payload][FIELD_MAP.playArea];
        expect(pa.bbox).toBeUndefined();
        expect(pa.boundary).toBeUndefined();
        expect(pa.osmType).toBeUndefined();
    });

    it("converts center to compact integer coordinates", () => {
        const envelope = makeEnvelope();
        const mini = minifyEnvelope(envelope);
        const json = JSON.parse(canonicalize(mini));

        const center =
            json[FIELD_MAP.payload][FIELD_MAP.playArea][FIELD_MAP.center];
        expect(center).toEqual([
            Math.round(139.7 * COORD_FACTOR),
            Math.round(35.7 * COORD_FACTOR),
        ]);
        expect(Number.isInteger(center[0])).toBe(true);
        expect(Number.isInteger(center[1])).toBe(true);
    });

    it("handles missing hidingZones", () => {
        const envelope = makeEnvelope({ hidingZones: undefined });
        const mini = minifyEnvelope(envelope);
        const json = JSON.parse(canonicalize(mini));

        expect(json[FIELD_MAP.payload][FIELD_MAP.hidingZones]).toBeUndefined();
    });

    it("handles missing playArea", () => {
        const envelope = makeEnvelope({ playArea: undefined });
        const mini = minifyEnvelope(envelope);
        const json = JSON.parse(canonicalize(mini));

        expect(json[FIELD_MAP.payload][FIELD_MAP.playArea]).toBeUndefined();
    });

    it("uses short keys in the output", () => {
        const envelope = makeEnvelope();
        const mini = minifyEnvelope(envelope);
        const json = JSON.parse(canonicalize(mini));

        expect(json.k).toBe("app-state");
        expect(json.v).toBe(1);
        expect(json.p.g).toBe("test-game-1");
        expect(json.p.h.r).toBe(600);
        expect(json.p.h.s).toEqual(["preset-a", "preset-b"]);
        expect(json.p.m.c).toBe("2026-05-17T00:00:00.000Z");
        expect(json.p.a.n).toBeDefined();
        expect(json.p.a.l).toBe("Test Area");
        expect(json.p.a.o).toBe(12345);

        expect(json.kind).toBeUndefined();
        expect(json.version).toBeUndefined();
        expect(json.payload).toBeUndefined();
    });

    it("handles empty selectedPresetIds", () => {
        const envelope = makeEnvelope({
            hidingZones: {
                radiusMeters: 300,
                radiusUnit: "km",
                selectedPresetIds: [],
            },
        });
        const mini = minifyEnvelope(envelope);
        const json = JSON.parse(canonicalize(mini));

        expect(
            json[FIELD_MAP.payload][FIELD_MAP.hidingZones][
                FIELD_MAP.selectedPresetIds
            ],
        ).toEqual([]);
    });

    it("writes radar questions with compact distance fields", () => {
        const envelope = makeEnvelope({
            questions: [
                {
                    answer: "positive",
                    center: [139.7, 35.7],
                    createdAt: "2026-05-17T00:00:00.000Z",
                    distanceMeters: 15000,
                    distanceOption: "15km",
                    distanceUnit: "m",
                    id: "q-1",
                    isLocked: false,
                    type: "radar",
                    updatedAt: "2026-05-17T00:00:00.000Z",
                },
            ],
        });
        const mini = minifyEnvelope(envelope);
        const json = JSON.parse(canonicalize(mini));

        expect(json.p.q[0].i).toBe("q-1");
        expect(json.p.q[0].r).toBe(15000);
        expect(json.p.q[0].d).toBe("15km");
        expect(json.p.q[0].e).toBe("p");
    });

    it("round-trips an imperial radar distance option", () => {
        const envelope = makeEnvelope({
            questions: [
                {
                    answer: "positive",
                    center: [139.7, 35.7],
                    createdAt: "2026-05-17T00:00:00.000Z",
                    distanceMeters: 0.5 * 1609.344,
                    distanceOption: "0.5mi",
                    distanceUnit: "mi",
                    id: "q-1",
                    isLocked: false,
                    type: "radar",
                    updatedAt: "2026-05-17T00:00:00.000Z",
                },
            ],
        });
        const mini = minifyEnvelope(envelope);
        expect(JSON.parse(canonicalize(mini)).p.q[0].d).toBe("0.5mi");

        const restored = unminifyEnvelope(mini);
        const question = restored.payload.questions?.[0];
        expect(question?.type).toBe("radar");
        if (question?.type === "radar") {
            expect(question.distanceOption).toBe("0.5mi");
            expect(question.distanceUnit).toBe("mi");
        }
    });

    it("omits unanswered radar answers from compact questions", () => {
        const envelope = makeEnvelope({
            questions: [
                {
                    answer: "unanswered",
                    center: [139.7, 35.7],
                    createdAt: "2026-05-17T00:00:00.000Z",
                    distanceMeters: 15000,
                    distanceOption: "15km",
                    distanceUnit: "m",
                    id: "q-1",
                    isLocked: false,
                    type: "radar",
                    updatedAt: "2026-05-17T00:00:00.000Z",
                },
            ],
        });
        const mini = minifyEnvelope(envelope);
        const json = JSON.parse(canonicalize(mini));

        expect(json.p.q[0].e).toBeUndefined();
    });
});

it("writes matching questions in compact format", () => {
    const envelope = makeEnvelope({
        questions: [
            {
                answer: "negative",
                candidates: [],
                category: "transit-line",
                center: [139.7, 35.7],
                createdAt: "2026-05-17T00:00:00.000Z",
                id: "matching-1",
                isLocked: false,
                lineId: "gtfs:test:route:line-1",
                lineName: "Line 1",
                selectedOsmId: null,
                selectedOsmType: null,
                targetName: null,
                targetOsmId: null,
                targetOsmType: null,
                type: "matching",
                updatedAt: "2026-05-17T00:00:00.000Z",
            },
        ],
    });
    const mini = minifyEnvelope(envelope);
    const json = JSON.parse(canonicalize(mini));

    expect(json.p.q[0].t).toBe("m");
    expect(json.p.q[0].n).toEqual([139700000, 35700000]);
    expect(json.p.q[0].x).toBe("gtfs:test:route:line-1");
    expect(json.p.q[0].y).toBe("Line 1");
    expect(json.p.q[0].e).toBe("n");
});
describe("unminifyEnvelope", () => {
    it("restores matching questions", () => {
        const envelope = makeEnvelope({
            questions: [
                {
                    answer: "positive",
                    candidates: [],
                    category: "transit-line",
                    center: [139.7, 35.7],
                    createdAt: "2026-05-17T00:00:00.000Z",
                    id: "matching-1",
                    isLocked: false,
                    lineId: "gtfs:test:route:line-1",
                    lineName: "Line 1",
                    selectedOsmId: null,
                    selectedOsmType: null,
                    targetName: null,
                    targetOsmId: null,
                    targetOsmType: null,
                    type: "matching",
                    updatedAt: "2026-05-17T00:00:00.000Z",
                },
            ],
        });
        const restored = unminifyEnvelope(minifyEnvelope(envelope));
        expect(restored.payload.questions?.[0]).toEqual({
            answer: "positive",
            candidates: [],
            category: "transit-line",
            center: [139.7, 35.7],
            createdAt: "2026-05-17T00:00:00.000Z",
            id: "matching-1",
            isLocked: false,
            lineId: "gtfs:test:route:line-1",
            lineName: "Line 1",
            selectedOsmId: null,
            selectedOsmType: null,
            targetName: null,
            targetOsmId: null,
            targetOsmType: null,
            type: "matching",
            updatedAt: "2026-05-17T00:00:00.000Z",
        });
    });

    it("clears legacy matching line selections instead of guessing", () => {
        const envelope = makeEnvelope({
            questions: [
                {
                    answer: "positive",
                    candidates: [],
                    category: "transit-line",
                    center: [139.7, 35.7],
                    createdAt: "2026-05-17T00:00:00.000Z",
                    id: "matching-1",
                    isLocked: false,
                    lineId: "tokyo-metro:3",
                    lineName: "Hibiya Line",
                    selectedOsmId: null,
                    selectedOsmType: null,
                    targetName: null,
                    targetOsmId: null,
                    targetOsmType: null,
                    type: "matching",
                    updatedAt: "2026-05-17T00:00:00.000Z",
                },
            ],
        });

        expect(
            unminifyEnvelope(minifyEnvelope(envelope)).payload.questions,
        ).toEqual([
            {
                answer: "unanswered",
                candidates: [],
                category: "transit-line",
                center: [139.7, 35.7],
                createdAt: "2026-05-17T00:00:00.000Z",
                id: "matching-1",
                isLocked: false,
                lineId: null,
                lineName: null,
                selectedOsmId: null,
                selectedOsmType: null,
                targetName: null,
                targetOsmId: null,
                targetOsmType: null,
                type: "matching",
                updatedAt: "2026-05-17T00:00:00.000Z",
            },
        ]);
    });

    it("defaults legacy matching question centers to the play-area center", () => {
        const envelope = makeEnvelope({
            questions: [
                {
                    answer: "positive",
                    candidates: [],
                    category: "transit-line",
                    center: [139.7, 35.7],
                    createdAt: "2026-05-17T00:00:00.000Z",
                    id: "matching-1",
                    isLocked: false,
                    lineId: "gtfs:test:route:line-1",
                    lineName: "Line 1",
                    selectedOsmId: null,
                    selectedOsmType: null,
                    targetName: null,
                    targetOsmId: null,
                    targetOsmType: null,
                    type: "matching",
                    updatedAt: "2026-05-17T00:00:00.000Z",
                },
            ],
        });
        const mini = minifyEnvelope(envelope);
        const questions = mini.p.q as
            | Array<Record<string, unknown>>
            | undefined;
        delete questions?.[0]?.n;

        const restored = unminifyEnvelope(mini);

        expect(restored.payload.questions?.[0]).toMatchObject({
            center: envelope.payload.playArea?.center,
            type: "matching",
        });
    });

    it("reconstructs omitted fields with defaults", () => {
        const envelope = makeEnvelope();
        const mini = minifyEnvelope(envelope);
        const restored = unminifyEnvelope(mini);

        expect(restored.payload.hidingZones?.radiusUnit).toBe("m");
        expect(restored.payload.metadata.updatedAt).toBe(
            restored.payload.metadata.createdAt,
        );
        expect(restored.payload.playArea?.osmType).toBe("R");
        expect(restored.payload.playArea?.bbox).toEqual([0, 0, 0, 0]);
        expect(restored.payload.playArea?.boundary).toBeUndefined();
    });

    it("uncompacts center back to float coordinates", () => {
        const envelope = makeEnvelope();
        const mini = minifyEnvelope(envelope);
        const restored = unminifyEnvelope(mini);

        const center = restored.payload.playArea!.center;
        expect(center[0]).toBeCloseTo(139.7, 4);
        expect(center[1]).toBeCloseTo(35.7, 4);
    });

    it("restores minified questions as radar questions", () => {
        const restored = unminifyEnvelope(
            minifyEnvelope(
                makeEnvelope({
                    questions: [
                        {
                            answer: "negative",
                            center: [139.7, 35.7],
                            createdAt: "2026-05-17T00:00:00.000Z",
                            distanceMeters: 40000,
                            distanceOption: "40km",
                            distanceUnit: "m",
                            id: "q-1",
                            isLocked: false,
                            type: "radar",
                            updatedAt: "2026-05-17T00:00:00.000Z",
                        },
                    ],
                }),
            ),
        );

        expect(restored.payload.questions?.[0]).toMatchObject({
            answer: "negative",
            distanceMeters: 40000,
            distanceOption: "40km",
            distanceUnit: "m",
            id: "q-1",
            isLocked: false,
            type: "radar",
        });
    });

    it("round-trips matching question with non-default category and target fields", () => {
        const envelope = makeEnvelope({
            questions: [
                {
                    answer: "positive",
                    candidates: [],
                    category: "park",
                    center: [139.7, 35.7],
                    createdAt: "2026-05-17T00:00:00.000Z",
                    id: "matching-park",
                    isLocked: false,
                    lineId: null,
                    lineName: null,
                    selectedOsmId: null,
                    selectedOsmType: null,
                    targetName: "Ueno Park",
                    targetOsmId: 123456,
                    targetOsmType: "way",
                    type: "matching",
                    updatedAt: "2026-05-17T00:00:00.000Z",
                },
            ],
        });
        const restored = unminifyEnvelope(minifyEnvelope(envelope));
        const question = restored.payload.questions?.[0];
        expect(question).toMatchObject({
            category: "park",
            targetName: "Ueno Park",
            targetOsmId: 123456,
            targetOsmType: "way",
        });
    });

    it("round-trips OSM matching questions with candidates", () => {
        const envelope = makeEnvelope({
            questions: [
                {
                    answer: "positive",
                    candidates: [
                        {
                            lat: 35.681,
                            lon: 139.761,
                            name: "Nearest Park",
                            osmId: 1,
                            osmType: "node",
                            tags: {},
                        },
                        {
                            lat: 35.685,
                            lon: 139.765,
                            name: "Farther Park",
                            osmId: 2,
                            osmType: "way",
                            tags: {},
                        },
                    ],
                    category: "park",
                    center: [139.7, 35.7],
                    createdAt: "2026-05-17T00:00:00.000Z",
                    id: "matching-park",
                    isLocked: false,
                    lineId: null,
                    lineName: null,
                    selectedOsmId: 1,
                    selectedOsmType: "node",
                    targetName: "Nearest Park",
                    targetOsmId: 1,
                    targetOsmType: "node",
                    type: "matching",
                    updatedAt: "2026-05-17T00:00:00.000Z",
                },
            ],
        });
        const restored = unminifyEnvelope(minifyEnvelope(envelope));
        const question = restored.payload.questions?.[0];
        expect(question).toMatchObject({
            category: "park",
            targetName: "Nearest Park",
            candidates: [
                {
                    lat: 35.681,
                    lon: 139.761,
                    name: "Nearest Park",
                    osmId: 1,
                    osmType: "node",
                    tags: {},
                },
                {
                    lat: 35.685,
                    lon: 139.765,
                    name: "Farther Park",
                    osmId: 2,
                    osmType: "way",
                    tags: {},
                },
            ],
        });
    });
});

describe("minify → unminify round-trip", () => {
    it("preserves full envelope fields through wire format", () => {
        const envelope = makeEnvelope();
        const restored = unminifyEnvelope(minifyEnvelope(envelope));

        expect(restored.kind).toBe(envelope.kind);
        expect(restored.version).toBe(envelope.version);
        expect(restored.payload.gameId).toBe(envelope.payload.gameId);
        expect(restored.payload.hidingZones?.radiusMeters).toBe(
            envelope.payload.hidingZones!.radiusMeters,
        );
        expect(restored.payload.hidingZones?.selectedPresetIds).toEqual(
            envelope.payload.hidingZones!.selectedPresetIds,
        );
        expect(restored.payload.metadata.createdAt).toBe(
            envelope.payload.metadata.createdAt,
        );
        expect(restored.payload.playArea?.center[0]).toBeCloseTo(
            envelope.payload.playArea!.center[0],
            4,
        );
        expect(restored.payload.playArea?.center[1]).toBeCloseTo(
            envelope.payload.playArea!.center[1],
            4,
        );
        expect(restored.payload.playArea?.label).toBe(
            envelope.payload.playArea!.label,
        );
        expect(restored.payload.playArea?.osmId).toBe(
            envelope.payload.playArea!.osmId,
        );
    });

    it("handles envelope without hidingZones", () => {
        const envelope = makeEnvelope({ hidingZones: undefined });
        const restored = unminifyEnvelope(minifyEnvelope(envelope));

        expect(restored.payload.hidingZones).toBeUndefined();
    });

    it("handles envelope without playArea", () => {
        const envelope = makeEnvelope({ playArea: undefined });
        const restored = unminifyEnvelope(minifyEnvelope(envelope));

        expect(restored.payload.playArea).toBeUndefined();
    });

    it("minified JSON is measurably smaller than full JSON", () => {
        const envelope = makeEnvelope();
        const fullJson = canonicalize(envelope);
        const miniJson = canonicalize(minifyEnvelope(envelope));

        expect(miniJson.length).toBeLessThan(fullJson.length);

        const diff = fullJson.length - miniJson.length;
        expect(diff).toBeGreaterThan(0);
    });

    it("center precision is preserved within 1e-5 degrees", () => {
        const envelope = makeEnvelope();
        const restored = unminifyEnvelope(minifyEnvelope(envelope));

        const origCenter = envelope.payload.playArea!.center;
        const restoredCenter = restored.payload.playArea!.center;
        expect(Math.abs(restoredCenter[0] - origCenter[0])).toBeLessThan(1e-5);
        expect(Math.abs(restoredCenter[1] - origCenter[1])).toBeLessThan(1e-5);
    });

    it("round-trips envelope with zero coordinates", () => {
        const envelope = makeEnvelope({
            playArea: {
                bbox: [0, 0, 0, 0],
                boundary: { features: [], type: "FeatureCollection" },
                center: [0, 0],
                label: "Null Island",
                osmId: 0,
                osmType: "R",
            },
        });
        const restored = unminifyEnvelope(minifyEnvelope(envelope));

        expect(restored.payload.playArea?.center).toEqual([0, 0]);
        expect(restored.payload.playArea?.label).toBe("Null Island");
    });

    it("round-trips negative coordinates", () => {
        const envelope = makeEnvelope({
            playArea: {
                bbox: [-75, -35, -70, -30],
                boundary: { features: [], type: "FeatureCollection" },
                center: [-73, -33],
                label: "South Atlantic",
                osmId: 3,
                osmType: "R",
            },
        });
        const restored = unminifyEnvelope(minifyEnvelope(envelope));

        expect(restored.payload.playArea?.center[0]).toBeCloseTo(-73, 4);
        expect(restored.payload.playArea?.center[1]).toBeCloseTo(-33, 4);
    });
});

// ---------------------------------------------------------------------------
// Task 03: measuring, thermometer, tentacles round-trips
// ---------------------------------------------------------------------------

describe("minify → unminify round-trip for new question types", () => {
    it("round-trips measuring question with all fields", () => {
        const envelope = makeEnvelope({
            questions: [
                {
                    answer: "positive" as const,
                    category: "rail-station" as const,
                    center: [139.7, 35.68] as [number, number],
                    createdAt: "2026-06-01T00:00:00.000Z",
                    id: "measuring-1",
                    isLocked: false,
                    nearestPoiName: null,
                    seekerDistanceMeters: null,
                    seekerDistanceUnit: "km" as const,
                    type: "measuring" as const,
                    updatedAt: "2026-06-01T00:00:00.000Z",
                },
            ],
        });
        const restored = unminifyEnvelope(minifyEnvelope(envelope));
        const question = restored.payload.questions?.[0];
        expect(question).toMatchObject({
            answer: "positive",
            category: "rail-station",
            seekerDistanceUnit: "km",
            type: "measuring",
        });
        if (question && question.type === "measuring") {
            expect(question.center[0]).toBeCloseTo(139.7, 4);
            expect(question.center[1]).toBeCloseTo(35.68, 4);
        }
    });

    it("round-trips measuring question with default/null fields", () => {
        const envelope = makeEnvelope({
            questions: [
                {
                    answer: "unanswered" as const,
                    category: "park" as const,
                    center: [139.7, 35.7] as [number, number],
                    createdAt: "2026-06-01T00:00:00.000Z",
                    id: "measuring-2",
                    isLocked: false,
                    nearestPoiName: null,
                    seekerDistanceMeters: null,
                    seekerDistanceUnit: "m" as const,
                    type: "measuring" as const,
                    updatedAt: "2026-06-01T00:00:00.000Z",
                },
            ],
        });
        const restored = unminifyEnvelope(minifyEnvelope(envelope));
        const question = restored.payload.questions?.[0];
        expect(question).toMatchObject({
            answer: "unanswered",
            category: "park",
            seekerDistanceUnit: "m",
            type: "measuring",
        });
    });

    it("round-trips thermometer question with positions", () => {
        const envelope = makeEnvelope({
            questions: [
                {
                    answer: "positive" as const,
                    createdAt: "2026-06-01T00:00:00.000Z",
                    previousPosition: [139.7, 35.66] as [number, number],
                    currentPosition: [139.71, 35.67] as [number, number],
                    previousStation: null,
                    currentStation: null,
                    id: "thermo-1",
                    isLocked: false,
                    type: "thermometer" as const,
                    updatedAt: "2026-06-01T00:00:00.000Z",
                },
            ],
        });
        const restored = unminifyEnvelope(minifyEnvelope(envelope));
        const question = restored.payload.questions?.[0];
        expect(question).toMatchObject({
            answer: "positive",
            type: "thermometer",
        });
        if (question && question.type === "thermometer") {
            expect(question.previousPosition?.[0]).toBeCloseTo(139.7, 4);
            expect(question.previousPosition?.[1]).toBeCloseTo(35.66, 4);
            expect(question.currentPosition?.[0]).toBeCloseTo(139.71, 4);
            expect(question.currentPosition?.[1]).toBeCloseTo(35.67, 4);
        }
    });

    it("round-trips thermometer question with null positions", () => {
        const envelope = makeEnvelope({
            questions: [
                {
                    answer: "unanswered" as const,
                    createdAt: "2026-06-01T00:00:00.000Z",
                    previousPosition: null,
                    currentPosition: null,
                    previousStation: null,
                    currentStation: null,
                    id: "thermo-2",
                    isLocked: false,
                    type: "thermometer" as const,
                    updatedAt: "2026-06-01T00:00:00.000Z",
                },
            ],
        });
        const restored = unminifyEnvelope(minifyEnvelope(envelope));
        const question = restored.payload.questions?.[0];
        expect(question).toMatchObject({
            answer: "unanswered",
            type: "thermometer",
        });
        if (question && question.type === "thermometer") {
            expect(question.previousPosition).toBeNull();
            expect(question.currentPosition).toBeNull();
        }
    });

    it("round-trips tentacles question answered with POI", () => {
        const envelope = makeEnvelope({
            questions: [
                {
                    answer: "positive" as const,
                    candidates: [
                        {
                            lat: 35.68,
                            lon: 139.76,
                            name: "Tokyo National Museum",
                            osmId: 1,
                            osmType: "node" as const,
                            tags: {},
                        },
                    ],
                    category: "museum" as const,
                    center: [139.7, 35.68] as [number, number],
                    createdAt: "2026-06-01T00:00:00.000Z",
                    distanceMeters: 2000,
                    distanceOption: "2km" as const,
                    id: "tentacles-1",
                    isLocked: false,
                    selectedOsmId: 1,
                    selectedOsmType: "node" as const,
                    selectedName: "Tokyo National Museum",
                    type: "tentacles" as const,
                    updatedAt: "2026-06-01T00:00:00.000Z",
                },
            ],
        });
        const restored = unminifyEnvelope(minifyEnvelope(envelope));
        const question = restored.payload.questions?.[0];
        expect(question).toMatchObject({
            answer: "positive",
            category: "museum",
            distanceMeters: 2000,
            distanceOption: "2km",
            selectedOsmId: 1,
            selectedOsmType: "node",
            selectedName: "Tokyo National Museum",
            type: "tentacles",
        });
        if (question && question.type === "tentacles") {
            expect(question.candidates).toHaveLength(1);
            expect(question.center[0]).toBeCloseTo(139.7, 4);
            expect(question.center[1]).toBeCloseTo(35.68, 4);
        }
    });

    it("round-trips tentacles question unanswered", () => {
        const envelope = makeEnvelope({
            questions: [
                {
                    answer: "unanswered" as const,
                    candidates: [],
                    category: "zoo" as const,
                    center: [139.7, 35.7] as [number, number],
                    createdAt: "2026-06-01T00:00:00.000Z",
                    distanceMeters: 25000,
                    distanceOption: "25km" as const,
                    id: "tentacles-2",
                    isLocked: false,
                    selectedOsmId: null,
                    selectedOsmType: null,
                    selectedName: null,
                    type: "tentacles" as const,
                    updatedAt: "2026-06-01T00:00:00.000Z",
                },
            ],
        });
        const restored = unminifyEnvelope(minifyEnvelope(envelope));
        const question = restored.payload.questions?.[0];
        expect(question).toMatchObject({
            answer: "unanswered",
            category: "zoo",
            distanceMeters: 25000,
            distanceOption: "25km",
            type: "tentacles",
        });
    });

    it("round-trips mixed payload with all five question types", () => {
        const envelope = makeEnvelope({
            questions: [
                {
                    answer: "positive" as const,
                    center: [139.7, 35.7] as [number, number],
                    createdAt: "2026-06-01T00:00:00.000Z",
                    distanceMeters: 1000,
                    distanceOption: "1km" as const,
                    distanceUnit: "m" as const,
                    id: "radar-1",
                    isLocked: false,
                    type: "radar" as const,
                    updatedAt: "2026-06-01T00:00:00.000Z",
                },
                {
                    answer: "unanswered" as const,
                    candidates: [],
                    category: "park" as const,
                    center: [139.7, 35.7] as [number, number],
                    createdAt: "2026-06-01T00:00:00.000Z",
                    id: "matching-1",
                    isLocked: false,
                    lineId: null,
                    lineName: null,
                    selectedOsmId: null,
                    selectedOsmType: null,
                    targetName: null,
                    targetOsmId: null,
                    targetOsmType: null,
                    type: "matching" as const,
                    updatedAt: "2026-06-01T00:00:00.000Z",
                },
                {
                    answer: "positive" as const,
                    category: "rail-station" as const,
                    center: [139.7, 35.7] as [number, number],
                    createdAt: "2026-06-01T00:00:00.000Z",
                    id: "measuring-1",
                    isLocked: false,
                    nearestPoiName: null,
                    seekerDistanceMeters: null,
                    seekerDistanceUnit: "m" as const,
                    type: "measuring" as const,
                    updatedAt: "2026-06-01T00:00:00.000Z",
                },
                {
                    answer: "negative" as const,
                    createdAt: "2026-06-01T00:00:00.000Z",
                    previousPosition: [139.7, 35.66] as [number, number],
                    currentPosition: [139.71, 35.67] as [number, number],
                    previousStation: null,
                    currentStation: null,
                    id: "thermo-1",
                    isLocked: false,
                    type: "thermometer" as const,
                    updatedAt: "2026-06-01T00:00:00.000Z",
                },
                {
                    answer: "unanswered" as const,
                    candidates: [],
                    category: "museum" as const,
                    center: [139.7, 35.7] as [number, number],
                    createdAt: "2026-06-01T00:00:00.000Z",
                    distanceMeters: 25000,
                    distanceOption: "25km" as const,
                    id: "tentacles-1",
                    isLocked: false,
                    selectedOsmId: null,
                    selectedOsmType: null,
                    selectedName: null,
                    type: "tentacles" as const,
                    updatedAt: "2026-06-01T00:00:00.000Z",
                },
            ],
        });
        const restored = unminifyEnvelope(minifyEnvelope(envelope));
        expect(restored.payload.questions).toHaveLength(5);
        const types = restored.payload.questions?.map((q) => q.type).sort();
        expect(types).toEqual(
            [
                "matching",
                "measuring",
                "radar",
                "tentacles",
                "thermometer",
            ].sort(),
        );
    });
});
