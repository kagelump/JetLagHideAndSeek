import {
    Camera,
    MapView,
    setAccessToken,
    UserLocation,
} from "@maplibre/maplibre-react-native";
import { useCallback, useMemo, useRef } from "react";
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
import { useQuestionDerived } from "@/state/questionStore";
import { usePlayArea } from "@/state/playAreaStore";
import type { Position } from "@/shared/geojson";
import { useQuestionMapRenderState } from "@/features/questions/questionGeometry";

import { ActivePinLayer } from "./ActivePinLayer";
import {
    type CameraHandle,
    fitCameraToBbox,
    getTopViewportFitPadding,
} from "./camera";
import { getEventCoordinate } from "./eventCoordinate";
import { getQuestionPins } from "./getQuestionPins";
import { HidingZoneLayers } from "./HidingZoneLayers";
import { MapControls } from "./MapControls";
import { buildOsmRasterStyleJson } from "./mapStyle";
import {
    asSeparateMaskConstraints,
    buildCombinedEligibilityMask,
    buildPlayAreaMask,
    buildPlayAreaMaskFromMetadata,
} from "./maskBuilder";
import { OsmMatchingLayers } from "./OsmMatchingLayers";
import { PlayAreaBoundaryLayer } from "./PlayAreaBoundaryLayer";
import {
    CombinedInsideMaskLayer,
    PlayAreaOutsideMaskLayer,
} from "./PlayAreaMaskLayers";
import { RadarQuestionLayers } from "./RadarQuestionLayers";
import { usePinDrag } from "./usePinDrag";
import { useUserLocation } from "./useUserLocation";
import { VoronoiOutlineLayers } from "./VoronoiOutlineLayers";

setAccessToken(null);

const MLMapView = MapView as ComponentType<any>;
const MLCamera = Camera as ComponentType<any>;
const MLUserLocation = UserLocation as ComponentType<any>;

type NativeMapProps = {
    isQuestionDetailRoute: boolean;
    onPinCommit: (
        questionId: string,
        pinKey: string,
        position: Position,
    ) => void;
    onPress?: (event?: unknown) => void;
};

export function NativeMap({
    isQuestionDetailRoute,
    onPinCommit,
    onPress,
}: NativeMapProps) {
    const cameraRef = useRef<CameraHandle | null>(null);
    const mapRef = useRef<any>(null);
    const insets = useSafeAreaInsets();
    const { height } = useSafeAreaFrame();
    const { routeFeatures, stationFeatures, zoneFeatures } =
        useHidingZoneDerived();
    const { activeQuestion } = useQuestionDerived();
    const markAppMapReady = useMarkAppMapReady();
    const questionMapRenderState = useQuestionMapRenderState();
    const { playArea } = usePlayArea();

    const playAreaMask = useMemo(
        () =>
            playArea.maskHoles
                ? buildPlayAreaMaskFromMetadata(
                      playArea.boundary,
                      playArea.maskHoles,
                  )
                : buildPlayAreaMask(playArea.boundary),
        [playArea.boundary, playArea.maskHoles],
    );
    const combinedInsideMask = useMemo(() => {
        return buildCombinedEligibilityMask(
            playArea.boundary,
            [
                zoneFeatures,
                ...asSeparateMaskConstraints(
                    questionMapRenderState.radar.hitMaskFeatures,
                ),
                // Transit-line hit mask contains one circle per station
                // on the selected line. asSeparateMaskConstraints would
                // decompose them into individual required constraints,
                // and buildCombinedEligibilityMask intersects all required
                // constraints — producing an empty result for any line
                // with non-overlapping station circles. Pass the whole
                // collection so the circles are treated as a union.
                questionMapRenderState.transitLine.hitMaskFeatures,
                ...asSeparateMaskConstraints(
                    questionMapRenderState.osmMatching.hitMaskFeatures,
                ),
            ],
            [
                questionMapRenderState.radar.missMaskFeatures,
                questionMapRenderState.transitLine.missMaskFeatures,
                questionMapRenderState.osmMatching.missMaskFeatures,
            ],
        );
    }, [
        playArea.boundary,
        zoneFeatures,
        questionMapRenderState.radar.hitMaskFeatures,
        questionMapRenderState.radar.missMaskFeatures,
        questionMapRenderState.transitLine.hitMaskFeatures,
        questionMapRenderState.transitLine.missMaskFeatures,
        questionMapRenderState.osmMatching.hitMaskFeatures,
        questionMapRenderState.osmMatching.missMaskFeatures,
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
        fitCameraToBbox(cameraRef.current, playArea.bbox, fitPadding);
    }, [fitPadding, playArea.bbox]);
    const handleMapReady = useCallback(() => {
        fitPlayArea();
        markAppMapReady();
    }, [fitPlayArea, markAppMapReady]);

    const pins = useMemo(
        () => getQuestionPins(activeQuestion),
        [activeQuestion],
    );
    const questionId = activeQuestion?.id ?? null;
    const canMoveActivePin = Boolean(
        isQuestionDetailRoute &&
            !(activeQuestion?.isLocked ?? false) &&
            pins.length > 0,
    );

    const pinDrag = usePinDrag({
        pins,
        canMove: canMoveActivePin,
        mapRef,
        onCommit: onPinCommit,
        questionId,
    });

    const activePinFeature = useMemo(
        () =>
            pins.length > 0 && activeQuestion
                ? {
                      features: [
                          {
                              geometry: {
                                  coordinates:
                                      pinDrag.draftCoordinate ??
                                      pins[0].position,
                                  type: "Point" as const,
                              },
                              properties: {
                                  id: activeQuestion.id,
                                  isDragging: pinDrag.isDragging,
                                  isUnlocked: canMoveActivePin,
                              },
                              type: "Feature" as const,
                          },
                      ],
                      type: "FeatureCollection" as const,
                  }
                : { features: [], type: "FeatureCollection" as const },
        [
            activeQuestion,
            canMoveActivePin,
            pins,
            pinDrag.draftCoordinate,
            pinDrag.isDragging,
            pinDrag.revision,
        ],
    );

    const handleMapPress = useCallback(
        (event?: unknown) => {
            const coordinate = getEventCoordinate(event);
            if (canMoveActivePin && coordinate && activeQuestion) {
                const questionId = activeQuestion.id;
                setTimeout(() => {
                    onPinCommit(questionId, "center", coordinate);
                }, 0);
            }
            onPress?.(event);
        },
        [activeQuestion, canMoveActivePin, onPress, onPinCommit],
    );

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
                    ref={mapRef}
                    scrollEnabled={!pinDrag.isDragging}
                    style={styles.map}
                    testID="native-map"
                >
                    <MLCamera
                        ref={cameraRef}
                        defaultSettings={{
                            centerCoordinate: playArea.center,
                            zoomLevel: 4,
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
                        onPress={handleMapPress}
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

                    {hasLocationPermission ? (
                        <MLUserLocation
                            minDisplacement={5}
                            onUpdate={handleLocationUpdate}
                            visible
                        />
                    ) : null}

                    <ActivePinLayer
                        canMove={canMoveActivePin}
                        feature={activePinFeature}
                        onPress={handleMapPress}
                        pinDrag={pinDrag}
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
