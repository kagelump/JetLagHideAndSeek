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
import { usePlayArea } from "@/state/playAreaStore";
import type { Position } from "@/shared/geojson";
import { useQuestionMapRenderState } from "@/features/questions/questionGeometry";

import { QuestionPinLayer } from "./QuestionPinLayer";
import {
    type CameraHandle,
    fitCameraToBbox,
    getTopViewportFitPadding,
} from "./camera";
import type { MapPin } from "./getQuestionPins";
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
import { MeasuringLayers } from "./MeasuringLayers";
import { RadarQuestionLayers } from "./RadarQuestionLayers";
import { TentaclesRadiusLayer } from "./TentaclesRadiusLayer";
import { ThermometerPreviewLayer } from "./ThermometerPreviewLayer";
import { usePinDrag } from "./usePinDrag";
import { useUserLocation } from "./useUserLocation";
import { VoronoiOutlineLayers } from "./VoronoiOutlineLayers";

setAccessToken(null);

const MLMapView = MapView as ComponentType<any>;
const MLCamera = Camera as ComponentType<any>;
const MLUserLocation = UserLocation as ComponentType<any>;

type NativeMapProps = {
    activePinKey?: string | null;
    canMove: boolean;
    isQuestionDetailRoute: boolean;
    onPinCommit: (
        questionId: string,
        pinKey: string,
        position: Position,
    ) => void;
    onPress?: (event?: unknown) => void;
    pins: MapPin[];
    questionId: string | null;
};

export function NativeMap({
    activePinKey,
    canMove,
    isQuestionDetailRoute,
    onPinCommit,
    onPress,
    pins,
    questionId,
}: NativeMapProps) {
    const cameraRef = useRef<CameraHandle | null>(null);
    const mapRef = useRef<any>(null);
    const insets = useSafeAreaInsets();
    const { height } = useSafeAreaFrame();
    const { routeFeatures, stationFeatures, zoneFeatures } =
        useHidingZoneDerived();
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
                ...asSeparateMaskConstraints(
                    questionMapRenderState.thermometer.hitMaskFeatures,
                ),
                ...asSeparateMaskConstraints(
                    questionMapRenderState.tentacles.hitMaskFeatures,
                ),
                ...asSeparateMaskConstraints(
                    questionMapRenderState.measuring.hitMaskFeatures,
                ),
            ],
            [
                questionMapRenderState.radar.missMaskFeatures,
                questionMapRenderState.transitLine.missMaskFeatures,
                questionMapRenderState.osmMatching.missMaskFeatures,
                ...asSeparateMaskConstraints(
                    questionMapRenderState.tentacles.missMaskFeatures,
                ),
                ...asSeparateMaskConstraints(
                    questionMapRenderState.measuring.missMaskFeatures,
                ),
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
        questionMapRenderState.thermometer.hitMaskFeatures,
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
        fitCameraToBbox(cameraRef.current, playArea.bbox, fitPadding);
    }, [fitPadding, playArea.bbox]);
    const handleMapReady = useCallback(() => {
        fitPlayArea();
        markAppMapReady();
    }, [fitPlayArea, markAppMapReady]);

    const pinDrag = usePinDrag({
        activePinKey,
        pins,
        canMove,
        mapRef,
        onCommit: onPinCommit,
        questionId,
    });

    return (
        <GestureDetector gesture={pinDrag.gesture}>
            <View style={styles.container}>
                <MLMapView
                    attributionEnabled
                    compassEnabled
                    logoEnabled={false}
                    mapStyle={mapStyle}
                    onDidFinishLoadingMap={handleMapReady}
                    onPress={onPress}
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
                    />
                    <ThermometerPreviewLayer
                        thermometer={questionMapRenderState.thermometer}
                        visible={isQuestionDetailRoute}
                    />
                    <TentaclesRadiusLayer
                        tentacles={questionMapRenderState.tentacles}
                        visible={isQuestionDetailRoute}
                    />

                    {hasLocationPermission ? (
                        <MLUserLocation
                            minDisplacement={5}
                            onUpdate={handleLocationUpdate}
                            visible
                        />
                    ) : null}

                    <QuestionPinLayer
                        activePinKey={activePinKey}
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
