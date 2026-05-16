import {
    Camera,
    LineLayer,
    MapView,
    setAccessToken,
    ShapeSource,
    UserLocation,
} from "@maplibre/maplibre-react-native";
import { useCallback, useMemo, useRef } from "react";
import type { ComponentType } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import {
    useSafeAreaFrame,
    useSafeAreaInsets,
} from "react-native-safe-area-context";

import { colors } from "@/theme/colors";

import {
    type CameraHandle,
    fitCameraToBbox,
    getTopViewportFitPadding,
} from "./camera";
import { buildOsmRasterStyleJson } from "./mapStyle";
import { useUserLocation } from "./useUserLocation";
import { usePlayArea } from "@/state/playAreaStore";

setAccessToken(null);

const MLMapView = MapView as ComponentType<any>;
const MLCamera = Camera as ComponentType<any>;
const MLShapeSource = ShapeSource as ComponentType<any>;
const MLLineLayer = LineLayer as ComponentType<any>;
const MLUserLocation = UserLocation as ComponentType<any>;

export function NativeMap() {
    const cameraRef = useRef<CameraHandle | null>(null);
    const insets = useSafeAreaInsets();
    const { height } = useSafeAreaFrame();
    const { playArea } = usePlayArea();
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

    const fitLabel = `Fit ${playArea.label}`;

    return (
        <View style={styles.container}>
            <MLMapView
                attributionEnabled
                compassEnabled
                logoEnabled={false}
                mapStyle={mapStyle}
                onDidFinishLoadingMap={fitPlayArea}
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

                <MLShapeSource
                    id={`play-area-boundary-${playArea.osmId}`}
                    shape={playArea.boundary}
                >
                    <MLLineLayer
                        id={`play-area-boundary-line-${playArea.osmId}`}
                        style={{
                            lineColor: colors.tint,
                            lineOpacity: 0.95,
                            lineWidth: 3,
                        }}
                    />
                </MLShapeSource>

                {hasLocationPermission ? (
                    <MLUserLocation
                        minDisplacement={5}
                        onUpdate={handleLocationUpdate}
                        visible
                    />
                ) : null}
            </MLMapView>

            <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
                <Text style={styles.title}>Hide & Seek</Text>
                <Text style={styles.subtitle}>{playArea.label}</Text>
            </View>

            <View
                style={[
                    styles.controls,
                    {
                        top: insets.top + 16,
                    },
                ]}
            >
                <MapControl label={fitLabel} onPress={fitPlayArea} />
                <MapControl label="Locate me" onPress={locateUser} />
            </View>
        </View>
    );
}

type MapControlProps = {
    label: string;
    onPress: () => void;
};

function MapControl({ label, onPress }: MapControlProps) {
    return (
        <Pressable
            accessibilityRole="button"
            onPress={onPress}
            style={({ pressed }) => [
                styles.controlButton,
                pressed ? styles.controlButtonPressed : null,
            ]}
        >
            <Text style={styles.controlLabel}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.background,
    },
    controlButton: {
        alignItems: "center",
        backgroundColor: colors.white,
        borderColor: "rgba(23, 32, 42, 0.14)",
        borderRadius: 8,
        borderWidth: 1,
        justifyContent: "center",
        minHeight: 44,
        paddingHorizontal: 12,
        ...Platform.select({
            default: {
                elevation: 5,
                shadowColor: "#000",
                shadowOffset: { height: 4, width: 0 },
                shadowOpacity: 0.14,
                shadowRadius: 10,
            },
            web: {
                boxShadow: "0 4px 10px rgba(0, 0, 0, 0.14)",
            },
        }),
    },
    controlButtonPressed: {
        opacity: 0.72,
    },
    controlLabel: {
        color: colors.ink,
        fontSize: 13,
        fontWeight: "800",
    },
    controls: {
        gap: 8,
        position: "absolute",
        right: 16,
    },
    map: {
        flex: 1,
    },
    subtitle: {
        color: colors.muted,
        fontSize: 14,
        marginTop: 2,
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
