import {
    Camera,
    MapView,
    setAccessToken,
    UserLocation,
} from "@maplibre/maplibre-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import {
    useSafeAreaFrame,
    useSafeAreaInsets,
} from "react-native-safe-area-context";

import { colors } from "@/theme/colors";

import { useHidingZoneDerived } from "@/state/hidingZoneStore";
import { useMarkAppMapReady } from "@/state/AppStateProviders";
import { usePlayArea } from "@/state/playAreaStore";
import { useQuestions } from "@/state/questionStore";
import { isPlayAreaSet } from "@/features/map/playArea";
import type { Position } from "@/shared/geojson";
import { useQuestionMapRenderState } from "@/features/questions/questionGeometry";
import {
    buildSingleThermometerRenderState,
    buildThermometerRenderState,
} from "@/features/questions/thermometer/thermometerGeometry";
import type { ThermometerQuestion } from "@/features/questions/thermometer/thermometerTypes";
import { EMPTY_THERMOMETER_RENDER_STATE } from "@/features/questions/thermometer/thermometerTypes";

import { QuestionPinLayer } from "./QuestionPinLayer";
import {
    type CameraHandle,
    fitCameraToBbox,
    getTopViewportFitPadding,
} from "./camera";
import type { MapPin } from "./getQuestionPins";
import { HidingZoneLayers } from "./HidingZoneLayers";
import { MapControls } from "./MapControls";
import { MapPoiCallout } from "./MapPoiCallout";
import { buildOsmRasterStyleJson } from "./mapStyle";
import {
    buildCombinedEligibilityMask,
    buildPlayAreaMask,
    buildPlayAreaMaskFromMetadata,
} from "./maskBuilder";
import { buildEligibilityConstraints } from "./eliminationMath";
import { OsmMatchingLayers } from "./OsmMatchingLayers";
import { PlayAreaBoundaryLayer } from "./PlayAreaBoundaryLayer";
import {
    CombinedInsideMaskLayer,
    PlayAreaOutsideMaskLayer,
} from "./PlayAreaMaskLayers";
import { MeasuringLayers } from "./MeasuringLayers";
import { RadarQuestionLayers } from "./RadarQuestionLayers";
import { TentaclesPoiLayer } from "./TentaclesPoiLayer";
import { TentaclesRadiusLayer } from "./TentaclesRadiusLayer";
import { ThermometerPreviewLayer } from "./ThermometerPreviewLayer";
import { useMapCallout } from "./useMapCallout";
import { usePinDrag } from "./usePinDrag";
import { useUserLocation } from "./useUserLocation";
import { VoronoiOutlineLayers } from "./VoronoiOutlineLayers";

setAccessToken(null);

const MLMapView = MapView as ComponentType<any>;
const MLCamera = Camera as ComponentType<any>;
const MLUserLocation = UserLocation as ComponentType<any>;

type ThermometerDragUpdate = {
    p1: Position;
    p2: Position;
};

type NativeMapProps = {
    canMove: boolean;
    isQuestionDetailRoute: boolean;
    onPinCommit: (
        questionId: string,
        pinKey: string,
        position: Position,
    ) => void;
    onPress?: (event?: unknown) => void;
    /** Called during thermometer pin drag with live P1/P2 coordinates. */
    onThermometerDragUpdate?: (update: ThermometerDragUpdate | null) => void;
    pins: MapPin[];
    questionId: string | null;
};

export function NativeMap({
    canMove,
    isQuestionDetailRoute,
    onPinCommit,
    onPress,
    onThermometerDragUpdate,
    pins,
    questionId,
}: NativeMapProps) {
    const cameraRef = useRef<CameraHandle | null>(null);
    const mapRef = useRef<any>(null);
    const { callout, dismissCallout, showCalloutFromPress } = useMapCallout();
    // Screen-space pixel point for the callout's coordinate. The bubble is a
    // plain overlay (see MapPoiCallout), so we project the coordinate via the
    // map and reproject on camera changes to keep it pinned to the POI.
    const [calloutPoint, setCalloutPoint] = useState<{
        x: number;
        y: number;
    } | null>(null);
    const insets = useSafeAreaInsets();
    const { height } = useSafeAreaFrame();
    const { routeFeatures, stationFeatures, zoneFeatures } =
        useHidingZoneDerived();
    const markAppMapReady = useMarkAppMapReady();
    const questionMapRenderState = useQuestionMapRenderState();
    const { playArea } = usePlayArea();
    const playAreaIsSet = isPlayAreaSet(playArea);
    const questions = useQuestions();

    const pinDrag = usePinDrag({
        pins,
        canMove,
        mapRef,
        onCommit: onPinCommit,
        questionId,
    });

    const playAreaBoundary = playAreaIsSet
        ? (playArea.boundary as import("geojson").FeatureCollection<
              import("geojson").Polygon | import("geojson").MultiPolygon
          >)
        : null;

    // The thermometer question currently open on the detail sheet. Preview and
    // bisector are derived from THIS question alone — never the family aggregate,
    // which would otherwise leak the first thermometer's line onto the second.
    const activeThermometer = useMemo(() => {
        const question =
            questions.find(
                (q): q is ThermometerQuestion =>
                    q.type === "thermometer" && q.id === questionId,
            ) ?? null;
        if (!question) return null;

        const dragging =
            pinDrag.isDragging &&
            pinDrag.draftCoordinate != null &&
            pinDrag.draggedPinKey != null;
        const p1 =
            dragging && pinDrag.draggedPinKey === "start"
                ? pinDrag.draftCoordinate
                : question.previousPosition;
        const p2 =
            dragging && pinDrag.draggedPinKey === "end"
                ? pinDrag.draftCoordinate
                : question.currentPosition;

        // Question with the live drag positions applied (used to recompute its
        // geometry without mutating the store).
        const liveQuestion: ThermometerQuestion = {
            ...question,
            previousPosition: p1,
            currentPosition: p2,
        };
        return { dragging, liveQuestion };
    }, [
        questions,
        questionId,
        pinDrag.isDragging,
        pinDrag.draftCoordinate,
        pinDrag.draggedPinKey,
        pinDrag.revision,
    ]);

    // Preview + bisector for the active question only.
    const activeThermometerRender = useMemo(() => {
        if (!activeThermometer || !playAreaBoundary) {
            return EMPTY_THERMOMETER_RENDER_STATE;
        }
        return buildSingleThermometerRenderState(
            activeThermometer.liveQuestion,
            playAreaBoundary,
        );
    }, [activeThermometer, playAreaBoundary]);

    // Combined thermometer hit mask for ALL thermometers. While dragging the
    // active question, rebuild the family aggregate with the active question's
    // live positions so other thermometers stay in the eligibility mask.
    const thermometerHitMaskFeatures = useMemo(() => {
        if (!activeThermometer?.dragging || !playAreaBoundary) {
            return questionMapRenderState.thermometer.hitMaskFeatures;
        }
        const { liveQuestion } = activeThermometer;
        const effectiveQuestions = questions.map((q) =>
            q.id === liveQuestion.id ? liveQuestion : q,
        );
        return buildThermometerRenderState(effectiveQuestions, playAreaBoundary)
            .hitMaskFeatures;
    }, [
        activeThermometer,
        playAreaBoundary,
        questions,
        questionMapRenderState.thermometer.hitMaskFeatures,
    ]);

    // Report live thermometer coordinates to the parent so the sheet can
    // show live distance and elimination percentage during drag.
    const liveDragCoords = useMemo(() => {
        if (!activeThermometer?.dragging) return null;
        const { previousPosition: p1, currentPosition: p2 } =
            activeThermometer.liveQuestion;
        return p1 && p2 ? { p1, p2 } : null;
    }, [activeThermometer]);
    const onThermometerDragUpdateRef = useRef(onThermometerDragUpdate);
    onThermometerDragUpdateRef.current = onThermometerDragUpdate;
    useEffect(() => {
        onThermometerDragUpdateRef.current?.(liveDragCoords);
    }, [liveDragCoords]);

    const playAreaMask = useMemo(
        () =>
            !playAreaIsSet
                ? { type: "FeatureCollection" as const, features: [] }
                : playArea.maskHoles
                  ? buildPlayAreaMaskFromMetadata(
                        playArea.boundary,
                        playArea.maskHoles,
                    )
                  : buildPlayAreaMask(playArea.boundary),
        [playAreaIsSet, playArea.boundary, playArea.maskHoles],
    );
    const combinedInsideMask = useMemo(() => {
        if (!playAreaIsSet)
            return { type: "FeatureCollection" as const, features: [] };
        // Single source of truth for constraint polarity/decomposition:
        // buildEligibilityConstraints + MASK_RULES (shared with the HUD,
        // per-question contribution, and station-elimination stats). The
        // overlay differs only in substituting the live thermometer-drag hit
        // mask, passed here as an override so the assembly logic stays unforked.
        const { required, excluded } = buildEligibilityConstraints(
            zoneFeatures as any,
            questionMapRenderState,
            {
                thermometer: {
                    hitMaskFeatures: thermometerHitMaskFeatures as any,
                },
            },
        );
        return buildCombinedEligibilityMask(
            playArea.boundary,
            required as any,
            excluded as any,
        );
    }, [
        playAreaIsSet,
        playArea.boundary,
        zoneFeatures,
        questionMapRenderState.radar.hitMaskFeatures,
        questionMapRenderState.radar.missMaskFeatures,
        questionMapRenderState.transitLine.hitMaskFeatures,
        questionMapRenderState.transitLine.missMaskFeatures,
        questionMapRenderState.osmMatching.hitMaskFeatures,
        questionMapRenderState.osmMatching.missMaskFeatures,
        thermometerHitMaskFeatures,
        questionMapRenderState.tentacles.hitMaskFeatures,
        questionMapRenderState.tentacles.missMaskFeatures,
        questionMapRenderState.measuring.hitMaskFeatures,
        questionMapRenderState.measuring.missMaskFeatures,
    ]);
    const mapStyle = useMemo(() => buildOsmRasterStyleJson(), []);
    const fitPadding = useMemo(
        () =>
            getTopViewportFitPadding({
                height,
                topInset: insets.top,
            }),
        [height, insets.top],
    );
    const { handleLocationUpdate, hasLocationPermission, locateUser } =
        useUserLocation(cameraRef);

    const fitPlayArea = useCallback(() => {
        if (!playAreaIsSet) return;
        fitCameraToBbox(cameraRef.current, playArea.bbox, fitPadding);
    }, [playAreaIsSet, fitPadding, playArea.bbox]);
    const handleMapReady = useCallback(() => {
        fitPlayArea();
        markAppMapReady();
    }, [fitPlayArea, markAppMapReady]);

    const handleMapPress = useCallback(
        (event?: unknown) => {
            const e = event as { features?: readonly unknown[] } | undefined;
            // Only dismiss the POI callout on background taps — taps that hit
            // a feature (e.g. a tentacles POI marker) are handled by that
            // feature's own onPress, and dismissing here would race with the
            // callout it's about to show.
            const isBackgroundTap = !e?.features || e.features.length === 0;
            if (isBackgroundTap) {
                dismissCallout();
            }
            onPress?.(event);
        },
        [onPress, dismissCallout],
    );

    // Project the callout coordinate to a screen point. Async over the native
    // bridge; failures (e.g. mid-gesture) are ignored and retried on the next
    // camera event.
    const projectCallout = useCallback(async () => {
        const coordinate = callout?.coordinate;
        const map = mapRef.current as {
            getPointInView?: (c: Position) => Promise<[number, number]>;
        } | null;
        if (!coordinate || !map?.getPointInView) {
            setCalloutPoint(null);
            return;
        }
        try {
            const p = await map.getPointInView(coordinate);
            if (p) setCalloutPoint({ x: p[0], y: p[1] });
        } catch {
            // Projection can fail while the map is settling; leave the last
            // point in place and let the next camera event reproject.
        }
    }, [callout]);

    // Hide immediately when the target POI changes or clears, so we never show
    // the new callout at the previous POI's stale screen point for a frame.
    useEffect(() => {
        setCalloutPoint(null);
    }, [callout?.id]);

    // (Re)project whenever the callout changes.
    useEffect(() => {
        void projectCallout();
    }, [projectCallout]);

    // A JS-positioned overlay can't track a native 60fps gesture without
    // visibly lagging (each reprojection is an async bridge round-trip). So we
    // hide the bubble while the camera moves and snap it back onto the POI when
    // the map settles, rather than dragging a stale point behind the map.
    const [isCameraMoving, setIsCameraMoving] = useState(false);
    const handleRegionWillChange = useCallback(() => {
        setIsCameraMoving(true);
    }, []);
    const handleRegionDidChange = useCallback(() => {
        setIsCameraMoving(false);
        void projectCallout();
    }, [projectCallout]);

    // Auto-fit the camera when the play area changes (user selects a new area).
    const isFirstRender = useRef(true);
    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        fitPlayArea();
    }, [playArea.osmId, fitPlayArea]);

    return (
        <GestureDetector gesture={pinDrag.gesture}>
            <View style={styles.container}>
                <MLMapView
                    attributionEnabled
                    compassEnabled
                    logoEnabled={false}
                    mapStyle={mapStyle}
                    onDidFinishLoadingMap={handleMapReady}
                    onPress={handleMapPress}
                    onRegionDidChange={handleRegionDidChange}
                    onRegionWillChange={handleRegionWillChange}
                    ref={mapRef}
                    // Re-show the settled callout promptly instead of waiting
                    // the default 500ms debounce after the camera stops.
                    regionDidChangeDebounceTime={60}
                    scrollEnabled={!pinDrag.isDragging}
                    style={styles.map}
                    testID="native-map"
                >
                    <MLCamera
                        ref={cameraRef}
                        defaultSettings={{
                            centerCoordinate: playAreaIsSet
                                ? playArea.center
                                : [0, 20],
                            zoomLevel: playAreaIsSet ? 4 : 2,
                        }}
                    />

                    <PlayAreaOutsideMaskLayer
                        osmId={playArea.osmId}
                        playAreaMask={playAreaMask}
                    />
                    <HidingZoneLayers
                        routeFeatures={routeFeatures}
                        stationFeatures={stationFeatures}
                        zoneFeatures={zoneFeatures}
                    />
                    <CombinedInsideMaskLayer
                        combinedInsideMask={combinedInsideMask}
                        osmId={playArea.osmId}
                    />
                    <RadarQuestionLayers
                        onPress={onPress}
                        radar={questionMapRenderState.radar}
                    />
                    <OsmMatchingLayers
                        osmMatching={questionMapRenderState.osmMatching}
                        visible={isQuestionDetailRoute}
                    />
                    <VoronoiOutlineLayers
                        voronoiOutlineFeatures={
                            questionMapRenderState.voronoiOutlineFeatures
                        }
                        visible={isQuestionDetailRoute}
                    />
                    <PlayAreaBoundaryLayer playArea={playArea} />
                    <MeasuringLayers
                        measuring={questionMapRenderState.measuring}
                        visible={isQuestionDetailRoute}
                    />
                    <ThermometerPreviewLayer
                        bisectorLine={activeThermometerRender.bisectorLine}
                        previewFeatures={
                            activeThermometerRender.previewFeatures
                        }
                        visible={isQuestionDetailRoute}
                    />
                    <TentaclesRadiusLayer
                        tentacles={questionMapRenderState.tentacles}
                        visible={isQuestionDetailRoute}
                    />
                    <TentaclesPoiLayer
                        onPoiPress={showCalloutFromPress}
                        tentacles={questionMapRenderState.tentacles}
                        visible={isQuestionDetailRoute}
                    />

                    <MLUserLocation
                        minDisplacement={5}
                        onUpdate={handleLocationUpdate}
                        visible={hasLocationPermission}
                    />

                    <QuestionPinLayer
                        canMove={canMove}
                        onPress={onPress}
                        pinDrag={pinDrag}
                        pins={pins}
                    />
                </MLMapView>

                <View style={[styles.topBar, { paddingTop: insets.top }]}>
                    <Text style={styles.title}>{playArea.label}</Text>
                </View>

                <MapControls
                    fitPlayArea={fitPlayArea}
                    locateUser={locateUser}
                    topInset={insets.top}
                />

                {/* Single, map-wide POI callout fed by any layer's ShapeSource
                     press (see useMapCallout). Rendered as a screen-space
                     overlay over the map, not a MapLibre annotation. */}
                <MapPoiCallout
                    callout={callout}
                    onDismiss={dismissCallout}
                    point={isCameraMoving ? null : calloutPoint}
                />
            </View>
        </GestureDetector>
    );
}

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.background,
    },
    map: {
        flex: 1,
    },
    title: {
        color: colors.ink,
        fontSize: 22,
        fontWeight: "800",
    },
    topBar: {
        left: 0,
        paddingHorizontal: 20,
        position: "absolute",
        top: 0,
    },
});
