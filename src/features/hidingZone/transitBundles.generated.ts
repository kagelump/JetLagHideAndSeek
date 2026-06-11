// GENERATED — regenerate with `pnpm data:transit`
// Do not hand-edit.

import type { Bbox } from "@/shared/geojson";
import type { HidingZonePreset } from "@/features/hidingZone/hidingZoneTypes";

export type TransitBundle = {
    attribution?: unknown;
    presets: HidingZonePreset[];
};

export type TransitBundleMeta = {
    id: string;
    bbox: Bbox;
    file: string;
    presets: { id: string; label: string; bbox: Bbox; kind?: string }[];
};

export type TransitManifest = {
    version: number;
    bundles: TransitBundleMeta[];
};

export const TRANSIT_MANIFEST = {
    version: 1,
    bundles: [
        {
            id: "japan-kanto",
            bbox: [138.4, 34.8, 140.9, 37.1],
            file: "japan-kanto.json",
            presets: [
                {
                    id: "tokyo-metro",
                    label: "Tokyo Metro",
                    bbox: [139.612865, 35.632485, 139.958767, 35.78835],
                    kind: "operator",
                },
                {
                    id: "toei-subway",
                    label: "Toei Subway",
                    bbox: [139.628901, 35.58705, 139.926613, 35.814541],
                    kind: "operator",
                },
                {
                    id: "osm-japan-kanto",
                    label: "All stations in japan-kanto",
                    bbox: [134.595873, 34.0538709, 140.8921829, 37.0972316],
                    kind: "coverage",
                },
            ],
        },
    ],
} as TransitManifest;

export const transitBundleLoaders: Record<
    string,
    () => Promise<TransitBundle>
> = {
    "japan-kanto": () =>
        import("../../../assets/transit/japan-kanto.json").then(
            (m) =>
                ((m as Record<string, unknown>).default ?? m) as TransitBundle,
        ),
};
