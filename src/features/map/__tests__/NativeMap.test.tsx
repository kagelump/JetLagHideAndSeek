import { fireEvent, render, waitFor } from "@testing-library/react-native";
import * as Location from "expo-location";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { defaultPlayArea } from "@/features/map/playArea";
import {
    HidingZoneProvider,
    useHidingZoneActions,
} from "@/state/hidingZoneStore";
import { PlayAreaProvider, usePlayArea } from "@/state/playAreaStore";
import { QuestionProvider, useQuestionActions } from "@/state/questionStore";

import { NativeMap } from "../NativeMap";

// Inject a tokyo-metro preset into the hidingZoneData mock so
// SelectTokyoMetroHidingZone can find it.
const mockHidingZoneData = require("@/features/hidingZone/hidingZoneData") as {
    __addPackPresetForTest: (preset: any) => void;
    __clearPackTransitSourcesForTest: () => void;
};

const TOKYO_METRO_PRESET = {
    id: "tokyo-metro",
    label: "Tokyo Metro",
    operator: "Tokyo Metro",
    kind: "operator",
    bbox: [139.6, 35.6, 140.0, 35.8] as [number, number, number, number],
    defaultColor: "#00a1e4",
    source: { kind: "gtfs", namespace: "jp-tokyo-metro" },
    routes: [
        {
            id: "gtfs:jp-tokyo-metro:G",
            shortName: "Ginza",
            color: "#f39800",
        },
    ],
    stations: [
        {
            id: "gtfs:jp-tokyo-metro:station-1",
            lat: 35.6855,
            lon: 139.6922,
            name: "Shibuya",
            routeIds: ["gtfs:jp-tokyo-metro:G"],
            sourceId: "gtfs:jp-tokyo-metro:station-1",
            mergeKey: "gtfs:jp-tokyo-metro:station-1",
        },
    ],
};

// Inject synthetic data for measuring mask tests.
import { __setLineBundleForTest as setLineBundle } from "@/features/questions/measuring/lineBundleLoader";
import {
    registerRegion as registerPoiRegion,
    clearBundledRegionCache,
} from "@/features/questions/matching/bundledPois";

beforeEach(() => {
    mockHidingZoneData.__clearPackTransitSourcesForTest();
    mockHidingZoneData.__addPackPresetForTest(TOKYO_METRO_PRESET);
    // Register a minimal POI region for measuring mask tests.
    clearBundledRegionCache();
    registerPoiRegion("test-japan", {
        schemaVersion: 1,
        region: "test-japan",
        label: "Test Japan",
        generatedAt: "2026-06-12",
        bbox: [139.5, 35.5, 139.9, 35.8],
        totalCount: 1,
        categories: {
            museum: {
                count: 1,
                lon: [139.761],
                lat: [35.681],
                name: ["Test Museum"],
                osmId: [100],
                osmType: [0],
            },
        },
    });
    // Provide a minimal coastline bundle for measuring mask tests.
    setLineBundle("coastline", {
        schemaVersion: 1,
        category: "coastline",
        generatedAt: "2026-06-12",
        source: "test",
        extractBbox: [139.5, 35.5, 139.9, 35.8] as [
            number,
            number,
            number,
            number,
        ],
        features: [
            {
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [139.6, 35.65],
                        [139.8, 35.7],
                    ],
                },
                properties: {},
            },
        ],
    });
});

const { __cameraMethods } = jest.requireMock(
    "@maplibre/maplibre-react-native",
) as {
    __cameraMethods: {
        fitBounds: jest.Mock;
        setCamera: jest.Mock;
    };
};

function renderWithSafeArea(ui: ReactElement) {
    return render(
        <SafeAreaProvider
            initialMetrics={{
                frame: { height: 844, width: 390, x: 0, y: 0 },
                insets: { bottom: 34, left: 0, right: 0, top: 47 },
            }}
        >
            <PlayAreaProvider>
                <SetDefaultPlayArea />
                <HidingZoneProvider>
                    <QuestionProvider>{ui as any}</QuestionProvider>
                </HidingZoneProvider>
            </PlayAreaProvider>
        </SafeAreaProvider>,
    );
}

function SelectTokyoMetroHidingZone() {
    const { addPreset } = useHidingZoneActions();

    useEffect(() => {
        addPreset("tokyo-metro");
    }, [addPreset]);

    return null;
}

function SetDefaultPlayArea() {
    const { importPlayArea } = usePlayArea();

    useEffect(() => {
        importPlayArea(defaultPlayArea);
    }, [importPlayArea]);

    return null;
}

function CreateTransitLineQuestion() {
    const { createQuestion } = useQuestionActions();

    useEffect(() => {
        createQuestion("matching", { center: defaultPlayArea.center });
    }, [createQuestion]);

    return null;
}

/**
 * Creates a measuring question with a selected POI and the given answer,
 * then verifies the combined inside mask receives those features.
 *
 * Uses a ref guard so strict-mode double-rendering doesn't create
 * duplicate questions.
 */
function CreateMeasuringQuestionWithAnswer({
    answer,
}: {
    answer: "positive" | "negative";
}) {
    const { createQuestion, updateQuestion } = useQuestionActions();
    const doneRef = useRef(false);

    useEffect(() => {
        if (doneRef.current) return;
        doneRef.current = true;

        const q = createQuestion("measuring", {
            center: [139.75, 35.675],
            category: "museum",
        });

        updateQuestion(q.id, (current) => {
            if (current.type !== "measuring") return current;
            return {
                ...current,
                candidates: [
                    {
                        lat: 35.681,
                        lon: 139.761,
                        name: "Test Museum",
                        osmId: 100,
                        osmType: "node" as const,
                        tags: {},
                        distanceMeters: 1200,
                    },
                ],
                selectedOsmId: 100,
                selectedOsmType: "node",
                seekerDistanceMeters: 1200,
                answer,
                updatedAt: new Date().toISOString(),
            };
        });
    }, [createQuestion, updateQuestion, answer]);

    return null;
}

function signedRingArea(ring: number[][]): number {
    let area = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
        const [x1, y1] = ring[index];
        const [x2, y2] = ring[index + 1];
        area += x1 * y2 - x2 * y1;
    }
    return area / 2;
}

describe("NativeMap", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("renders the map, Tokyo boundary, and controls", () => {
        const screen = renderWithSafeArea(
            <NativeMap
                canMove={false}
                isQuestionDetailRoute={false}
                onPinCommit={jest.fn()}
                pins={[]}
                questionId={null}
            />,
        );

        expect(screen.getByTestId("native-map")).toBeTruthy();
        expect(screen.getByText("Tokyo 23 Wards")).toBeTruthy();
        expect(screen.getByText("🗺️")).toBeTruthy();
        expect(screen.getByText("📍")).toBeTruthy();
        expect(
            screen
                .getAllByTestId("map-shape-source")
                .some(
                    (source) =>
                        source.props.id === "play-area-boundary-19631009",
                ),
        ).toBe(true);
        expect(
            screen
                .getAllByTestId("map-line-layer")
                .some(
                    (layer) =>
                        layer.props.id === "play-area-boundary-line-19631009",
                ),
        ).toBe(true);
        expect(
            screen
                .getAllByTestId("map-shape-source")
                .some(
                    (source) =>
                        source.props.id === "play-area-outside-mask-19631009",
                ),
        ).toBe(true);
        expect(
            screen
                .getAllByTestId("map-fill-layer")
                .some(
                    (layer) =>
                        layer.props.id ===
                            "play-area-outside-mask-fill-19631009" &&
                        layer.props.style.fillOpacity > 0.5,
                ),
        ).toBe(true);
        expect(
            screen
                .getAllByTestId("map-fill-layer")
                .some((layer) => layer.props.id === "hiding-zone-area-fill"),
        ).toBe(false);
    });

    it("renders a combined inside mask when hiding zones are set", async () => {
        const screen = renderWithSafeArea(
            <>
                <SelectTokyoMetroHidingZone />
                <NativeMap
                    canMove={false}
                    isQuestionDetailRoute={false}
                    onPinCommit={jest.fn()}
                    pins={[]}
                    questionId={null}
                />
            </>,
        );

        await waitFor(() => {
            expect(
                screen
                    .getAllByTestId("map-shape-source")
                    .some(
                        (source) =>
                            source.props.id === "combined-inside-mask-19631009",
                    ),
            ).toBe(true);
        });

        const playAreaMask = screen
            .getAllByTestId("map-fill-layer")
            .find(
                (layer) =>
                    layer.props.id === "play-area-outside-mask-fill-19631009",
            );
        const combinedMask = screen
            .getAllByTestId("map-fill-layer")
            .find(
                (layer) =>
                    layer.props.id === "combined-inside-mask-fill-19631009",
            );
        const combinedMaskShape = screen
            .getAllByTestId("map-shape-source")
            .find(
                (source) => source.props.id === "combined-inside-mask-19631009",
            )?.props.shape;
        const polygonWithCutout =
            combinedMaskShape.features[0].geometry.coordinates.find(
                (polygon: number[][][]) => polygon.length > 1,
            );
        const [outerRing, firstCutoutRing] = polygonWithCutout;

        expect(combinedMask).toBeTruthy();
        expect(combinedMask?.props.style.fillOpacity).toBeLessThan(
            playAreaMask?.props.style.fillOpacity,
        );
        expect(combinedMaskShape.features[0].geometry.type).toBe(
            "MultiPolygon",
        );
        expect(polygonWithCutout).toBeTruthy();
        expect(signedRingArea(outerRing)).toBeGreaterThan(0);
        expect(signedRingArea(firstCutoutRing)).toBeLessThan(0);
    });

    describe("measuring mask wiring regression", () => {
        it("includes measuring hit mask circle in the combined mask for 'closer'", async () => {
            const screen = renderWithSafeArea(
                <>
                    <CreateMeasuringQuestionWithAnswer answer="positive" />
                    <NativeMap
                        canMove={false}
                        isQuestionDetailRoute={false}
                        onPinCommit={jest.fn()}
                        pins={[]}
                        questionId={null}
                    />
                </>,
            );

            // The combined mask should render with the measuring circle as a
            // required constraint. Without any hiding zones, the only mask
            // feature is the measuring hit circle.
            await waitFor(() => {
                const shape = screen
                    .getAllByTestId("map-shape-source")
                    .find(
                        (source) =>
                            source.props.id === "combined-inside-mask-19631009",
                    )?.props.shape;
                expect(shape).toBeTruthy();
                expect(shape.features.length).toBeGreaterThan(0);
            });
        });

        it("includes measuring miss mask circle in the combined mask for 'farther'", async () => {
            const screen = renderWithSafeArea(
                <>
                    <CreateMeasuringQuestionWithAnswer answer="negative" />
                    <NativeMap
                        canMove={false}
                        isQuestionDetailRoute={false}
                        onPinCommit={jest.fn()}
                        pins={[]}
                        questionId={null}
                    />
                </>,
            );

            // The combined mask should render with the measuring circle as an
            // excluded area. Without any hiding zones, the miss circle is
            // subtracted from the play area.
            await waitFor(() => {
                const shape = screen
                    .getAllByTestId("map-shape-source")
                    .find(
                        (source) =>
                            source.props.id === "combined-inside-mask-19631009",
                    )?.props.shape;
                expect(shape).toBeTruthy();
                expect(shape.features.length).toBeGreaterThan(0);
            });
        });
    });

    it("fits the camera when the map finishes loading", () => {
        const screen = renderWithSafeArea(
            <NativeMap
                canMove={false}
                isQuestionDetailRoute={false}
                onPinCommit={jest.fn()}
                pins={[]}
                questionId={null}
            />,
        );

        fireEvent(screen.getByTestId("native-map"), "onDidFinishLoadingMap");

        expect(__cameraMethods.setCamera).toHaveBeenCalledWith({
            animationDuration: 700,
            animationMode: "easeTo",
            bounds: {
                ne: [139.9189004, 35.8174937],
                paddingBottom: 405,
                paddingLeft: 40,
                paddingRight: 40,
                paddingTop: 167,
                sw: [139.5628986, 35.4816556],
            },
        });
    });

    it("locates the user and flies the camera to the mocked coordinate", async () => {
        const screen = renderWithSafeArea(
            <NativeMap
                canMove={false}
                isQuestionDetailRoute={false}
                onPinCommit={jest.fn()}
                pins={[]}
                questionId={null}
            />,
        );

        fireEvent.press(screen.getByText("📍"));

        await waitFor(() => {
            expect(Location.getForegroundPermissionsAsync).toHaveBeenCalled();
            expect(__cameraMethods.setCamera).toHaveBeenCalledWith({
                animationDuration: 700,
                animationMode: "flyTo",
                centerCoordinate: [139.6503, 35.6762],
                zoomLevel: 13,
            });
        });
    });

    it("passes scrollEnabled to the map view", () => {
        const screen = renderWithSafeArea(
            <NativeMap
                canMove={false}
                isQuestionDetailRoute={false}
                onPinCommit={jest.fn()}
                pins={[]}
                questionId={null}
            />,
        );

        const mapView = screen.getByTestId("native-map");
        expect(mapView.props.scrollEnabled).toBe(true);
    });

    it("renders the movable pin as ShapeSource layers with stable ids", () => {
        const screen = renderWithSafeArea(
            <NativeMap
                canMove={false}
                isQuestionDetailRoute={false}
                onPinCommit={jest.fn()}
                pins={[]}
                questionId={null}
            />,
        );

        const pinSource = screen
            .getAllByTestId("map-shape-source")
            .find((s) => s.props.id === "question-pins");
        expect(pinSource).toBeTruthy();

        const baseGlow = screen
            .getAllByTestId("map-circle-layer")
            .find((l) => l.props.id === "question-pin-glow-base");
        expect(baseGlow).toBeTruthy();
        expect(baseGlow?.props.style.circleBlur).toBeGreaterThan(0);
        expect(baseGlow?.props.style.circleStrokeWidth).toBeUndefined();

        const images = screen
            .getAllByTestId("map-images")
            .find((l) => l.props.images["question-pin"]);
        expect(images).toBeTruthy();

        const iconLayer = screen
            .getAllByTestId("map-symbol-layer")
            .find((l) => l.props.id === "question-pin-icon");
        expect(iconLayer).toBeTruthy();
        expect(iconLayer?.props.style.iconImage).toBe("question-pin");
    });

    it("renders the active pin for transit line questions", async () => {
        const screen = renderWithSafeArea(
            <>
                <CreateTransitLineQuestion />
                <NativeMap
                    canMove={true}
                    isQuestionDetailRoute={true}
                    onPinCommit={jest.fn()}
                    pins={[{ key: "center", position: defaultPlayArea.center }]}
                    questionId="matching-1"
                />
            </>,
        );

        await waitFor(() => {
            expect(screen.getByTestId("native-map").props.scrollEnabled).toBe(
                true,
            );
            expect(
                screen
                    .getAllByTestId("map-shape-source")
                    .find((s) => s.props.id === "question-pins")?.props.shape
                    .features[0].geometry.coordinates,
            ).toEqual(defaultPlayArea.center);
        });
    });
});

describe("movable pin regression", () => {
    const excluded = [
        "PointAnnotation",
        "ViewAnnotation",
        "MarkerView",
        "Marker",
    ];

    it("does not import PointAnnotation, ViewAnnotation, MarkerView, or Marker in NativeMap", () => {
        const { readFileSync } = require("fs");
        const { resolve } = require("path");
        const source = readFileSync(
            resolve(process.cwd(), "src", "features", "map", "NativeMap.tsx"),
            "utf-8",
        );
        for (const name of excluded) {
            expect(source).not.toContain(name);
        }
    });
});

describe("nil-subview crash regression", () => {
    const { readFileSync, readdirSync } = require("fs");
    const { resolve, join } = require("path");

    const mapDir = resolve(process.cwd(), "src", "features", "map");

    it("contains no : null} conditional child in NativeMap", () => {
        const source = readFileSync(join(mapDir, "NativeMap.tsx"), "utf-8");
        // A `: null}` on a JSX line inside the MapView tree indicates a
        // conditional mount/unmount of a native child — the exact pattern that
        // triggers the nil-subview crash in
        // -[MLRNMapView insertReactSubview:atIndex:].
        // The invariant is: never conditionally mount/unmount a native child of
        // MLMapView. Keep every child permanently mounted and toggle it via an
        // empty FeatureCollection shape or a visible flag.
        expect(source).not.toContain(": null}");
    });

    it("contains no dynamic key on ML* primitives in map layer files", () => {
        const tsxFiles = readdirSync(mapDir, { recursive: true }).filter(
            (f: string) => f.endsWith(".tsx") && !f.includes("__tests__"),
        );

        const violations: string[] = [];
        for (const relPath of tsxFiles) {
            const source = readFileSync(join(mapDir, relPath), "utf-8");
            const lines = source.split("\n");
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                // A dynamic key (containing template interpolation) on an ML*
                // primitive causes React to unmount and remount the native
                // child when the interpolated value changes — a remove+insert
                // in the same transaction, triggering the same nil-subview
                // crash path. Geometry updates should flow through the shape
                // prop, not through remounting the native child.
                if (
                    /<ML\w+/.test(line) &&
                    /key=\{/.test(line) &&
                    /\$\{/.test(line)
                ) {
                    violations.push(`${relPath}:${i + 1}: ${line.trim()}`);
                }
            }
        }

        expect(violations).toEqual([]);
    });
});
