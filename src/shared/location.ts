import * as Location from "expo-location";

import type { Position } from "./geojson";

export type LocationModule = Pick<
    typeof Location,
    | "getCurrentPositionAsync"
    | "getForegroundPermissionsAsync"
    | "requestForegroundPermissionsAsync"
> & {
    Accuracy: {
        Balanced: Location.Accuracy;
    };
};

export type UserCoordinateResult =
    | { coordinate: Position; status: "granted" }
    | { coordinate: null; status: "denied" | "undetermined" | "unavailable" };

/**
 * Reports whether foreground location permission is already granted, WITHOUT
 * triggering a system permission prompt. Use this to decide whether nearby
 * suggestions can be loaded automatically (vs. behind an explicit opt-in).
 */
export async function hasLocationPermission(
    locationModule: Pick<
        LocationModule,
        "getForegroundPermissionsAsync"
    > = Location,
): Promise<boolean> {
    try {
        const existing = await locationModule.getForegroundPermissionsAsync();
        return existing.granted;
    } catch {
        return false;
    }
}

export async function requestUserCoordinate(
    locationModule: LocationModule = Location,
): Promise<UserCoordinateResult> {
    let status: Location.PermissionStatus;
    try {
        // Check existing permission first to avoid unnecessary re-prompts.
        const existing = await locationModule.getForegroundPermissionsAsync();
        if (existing.granted) {
            status = existing.status;
        } else {
            ({ status } =
                await locationModule.requestForegroundPermissionsAsync());
        }
    } catch {
        return { coordinate: null, status: "unavailable" };
    }

    if (status !== "granted") {
        return { coordinate: null, status };
    }

    let position: Location.LocationObject;
    try {
        position = await locationModule.getCurrentPositionAsync({
            accuracy: locationModule.Accuracy.Balanced,
        });
    } catch {
        return { coordinate: null, status: "unavailable" };
    }

    return {
        coordinate: [position.coords.longitude, position.coords.latitude],
        status: "granted",
    };
}
