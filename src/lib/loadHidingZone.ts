import { toast } from "react-toastify";

import {
    additionalMapGeoLocations,
    customPresets,
    customStations,
    defaultUnit,
    disabledStations,
    displayHidingZoneOperators,
    displayHidingZones,
    displayHidingZonesOptions,
    displayHidingZonesStyle,
    hidingRadius,
    hidingRadiusUnits,
    hidingZoneData,
    includeDefaultStations,
    mapGeoJSON,
    mapGeoLocation,
    mergeDuplicates,
    permanentOverlay,
    playAreaMode,
    polyGeoJSON,
    questions,
    refreshPlayAreaModeFromCurrentLocations,
    refreshPlayAreaModeFromGeometry,
    setSuppressPlayAreaModeRefresh,
    team,
    trainStations,
    transitGraph,
    useCustomStations,
} from "@/lib/context";
import { parseHidingZoneRuntimeData } from "@/lib/hidingZoneRuntimeData";
import { normalizePlayAreaGeometry } from "@/lib/playAreaMode";
import { PLAY_AREA_MODES, type PlayAreaModeId } from "@/lib/playAreaModes";
import { TOKYO_METRO_DAYPASS_PROFILE } from "@/lib/transitPasses";
import {
    stripWireEnvelope,
    teamSchema,
    wireV1SnapshotSchema,
} from "@/lib/wire";
import { questionsSchema, type Units } from "@/maps/schema";

type DisplayHidingZonesStyle =
    | "zones"
    | "stations"
    | "no-overlap"
    | "no-display";

const UNIT_VALUES = ["miles", "kilometers", "meters"] as const;
const DISPLAY_HIDING_ZONES_STYLE_VALUES = [
    "zones",
    "stations",
    "no-overlap",
    "no-display",
] as const;

const isUnit = (value: unknown): value is Units =>
    typeof value === "string" &&
    (UNIT_VALUES as readonly string[]).includes(value);

const isDisplayHidingZonesStyle = (
    value: unknown,
): value is DisplayHidingZonesStyle =>
    typeof value === "string" &&
    (DISPLAY_HIDING_ZONES_STYLE_VALUES as readonly string[]).includes(value);

const isPlayAreaModeId = (value: unknown): value is PlayAreaModeId =>
    typeof value === "string" && value in PLAY_AREA_MODES;

const sameStringArray = (a: unknown, b: readonly string[]) =>
    Array.isArray(a) &&
    a.length === b.length &&
    a.every((value, idx) => value === b[idx]);

const shouldRepairTokyoMetroDaypassRadiusUnits = (
    geojson: Record<string, unknown>,
) =>
    geojson.hidingRadius === TOKYO_METRO_DAYPASS_PROFILE.radius &&
    geojson.hidingRadiusUnits === "miles" &&
    sameStringArray(
        geojson.zoneOptions,
        TOKYO_METRO_DAYPASS_PROFILE.zoneOptions,
    ) &&
    sameStringArray(
        geojson.zoneOperators,
        TOKYO_METRO_DAYPASS_PROFILE.operators,
    ) &&
    geojson.displayHidingZones === true &&
    geojson.displayHidingZonesStyle ===
        TOKYO_METRO_DAYPASS_PROFILE.displayStyle &&
    geojson.useCustomStations === false &&
    geojson.includeDefaultStations === false;

export function applyWireV1Payload(jsonText: string) {
    const snap = wireV1SnapshotSchema.parse(JSON.parse(jsonText));
    const { geo, team: teamPayload } = stripWireEnvelope(snap);
    team.set(teamPayload);
    applyHidingZoneGeojson(geo);
}

export function applyHidingZoneGeojson(geojson: Record<string, unknown>) {
    const playAreaGeometry = normalizePlayAreaGeometry(geojson);
    const incomingPlayAreaMode = isPlayAreaModeId(geojson.playAreaMode)
        ? geojson.playAreaMode
        : null;

    if (incomingPlayAreaMode) {
        setSuppressPlayAreaModeRefresh(true);
    }
    try {
        if (
            geojson.properties &&
            typeof geojson.properties === "object" &&
            (geojson.properties as { isHidingZone?: boolean }).isHidingZone ===
                true
        ) {
            questions.set(
                questionsSchema.parse(
                    (geojson.properties as { questions?: unknown }).questions ??
                        [],
                ),
            );
            mapGeoLocation.set(geojson as never);
            mapGeoJSON.set(null);
            polyGeoJSON.set(null);

            if (geojson.alternateLocations) {
                additionalMapGeoLocations.set(
                    geojson.alternateLocations as never,
                );
            } else {
                additionalMapGeoLocations.set([]);
            }

            if (incomingPlayAreaMode) {
                playAreaMode.set(incomingPlayAreaMode);
            } else if (playAreaGeometry) {
                void refreshPlayAreaModeFromGeometry(playAreaGeometry);
            } else {
                void refreshPlayAreaModeFromCurrentLocations();
            }
        } else if (geojson.questions) {
            questions.set(questionsSchema.parse(geojson.questions));
            const clone = { ...geojson };
            delete clone.questions;
            mapGeoJSON.set(clone as never);
            polyGeoJSON.set(clone as never);
            if (incomingPlayAreaMode) {
                playAreaMode.set(incomingPlayAreaMode);
            } else {
                void refreshPlayAreaModeFromGeometry(clone);
            }
        } else {
            questions.set([]);
            mapGeoJSON.set(geojson as never);
            polyGeoJSON.set(geojson as never);
            if (incomingPlayAreaMode) {
                playAreaMode.set(incomingPlayAreaMode);
            } else {
                void refreshPlayAreaModeFromGeometry(geojson);
            }
        }
    } finally {
        if (incomingPlayAreaMode) {
            setSuppressPlayAreaModeRefresh(false);
        }
    }

    const incomingPresets =
        geojson.presets ??
        (geojson.properties as { presets?: unknown } | undefined)?.presets;
    if (incomingPresets && Array.isArray(incomingPresets)) {
        try {
            const normalized = (incomingPresets as any[])
                .filter((p) => p && p.data)
                .map((p) => ({
                    id:
                        p.id ??
                        (typeof crypto !== "undefined" &&
                        typeof (crypto as Crypto).randomUUID === "function"
                            ? crypto.randomUUID()
                            : String(Date.now()) + Math.random()),
                    name: p.name ?? "Imported preset",
                    type: p.type ?? "custom",
                    data: p.data,
                    createdAt: p.createdAt ?? new Date().toISOString(),
                }));
            if (normalized.length > 0) {
                customPresets.set(normalized);
                toast.info(`Imported ${normalized.length} preset(s)`);
            }
        } catch (err) {
            console.warn("Failed to import presets", err);
        }
    }

    if (
        geojson.disabledStations !== null &&
        geojson.disabledStations !== undefined &&
        Array.isArray(geojson.disabledStations)
    ) {
        disabledStations.set(geojson.disabledStations as never);
    }

    if (
        typeof geojson.hidingRadius === "number" &&
        Number.isFinite(geojson.hidingRadius)
    ) {
        hidingRadius.set(geojson.hidingRadius);
    }

    if (isUnit(geojson.hidingRadiusUnits)) {
        hidingRadiusUnits.set(
            shouldRepairTokyoMetroDaypassRadiusUnits(geojson)
                ? TOKYO_METRO_DAYPASS_PROFILE.radiusUnits
                : geojson.hidingRadiusUnits,
        );
    }

    if (isUnit(geojson.defaultUnit)) {
        defaultUnit.set(geojson.defaultUnit);
    }

    if (isDisplayHidingZonesStyle(geojson.displayHidingZonesStyle)) {
        displayHidingZonesStyle.set(geojson.displayHidingZonesStyle);
    }

    if (geojson.zoneOptions) {
        displayHidingZonesOptions.set((geojson.zoneOptions as string[]) ?? []);
    }

    const zoneOptsArr = geojson.zoneOptions;
    const zoneOpsArr = geojson.zoneOperators;
    const hasZoneOpts =
        zoneOptsArr !== undefined &&
        Array.isArray(zoneOptsArr) &&
        zoneOptsArr.length > 0;
    const hasZoneOps =
        zoneOpsArr !== undefined &&
        Array.isArray(zoneOpsArr) &&
        zoneOpsArr.length > 0;

    if (typeof geojson.displayHidingZones === "boolean") {
        displayHidingZones.set(geojson.displayHidingZones);
    } else if (
        !("displayHidingZones" in geojson) &&
        (hasZoneOpts || hasZoneOps)
    ) {
        // Legacy snapshots did not persist this flag; turn zones on when the
        // payload clearly configures station discovery (was confusing sharing).
        displayHidingZones.set(true);
    }

    displayHidingZoneOperators.set(
        Array.isArray(geojson.zoneOperators)
            ? (geojson.zoneOperators as string[])
            : [],
    );

    if (typeof geojson.useCustomStations === "boolean") {
        useCustomStations.set(geojson.useCustomStations);
    }

    if (geojson.customStations && Array.isArray(geojson.customStations)) {
        customStations.set(geojson.customStations as never);
    }

    if (typeof geojson.includeDefaultStations === "boolean") {
        includeDefaultStations.set(geojson.includeDefaultStations);
    }

    if (typeof geojson.mergeDuplicates === "boolean") {
        mergeDuplicates.set(geojson.mergeDuplicates);
    }

    const runtimeData = parseHidingZoneRuntimeData(geojson.hidingZoneData);
    hidingZoneData.set(runtimeData);
    if (runtimeData) {
        trainStations.set(runtimeData.stationCircles);
        transitGraph.set(runtimeData.transitGraph);
    } else {
        trainStations.set([]);
        transitGraph.set(null);
    }

    if (geojson.permanentOverlay) {
        permanentOverlay.set(geojson.permanentOverlay as never);
    } else {
        permanentOverlay.set(null);
    }

    toast.success("Hiding zone loaded successfully", {
        autoClose: 2000,
    });
}

export function loadHidingZoneFromJsonString(hidingZoneText: string) {
    try {
        const parsed = JSON.parse(hidingZoneText) as Record<string, unknown>;
        if (parsed && parsed.v === 1) {
            applyWireV1Payload(hidingZoneText);
            return;
        }
        const geo = { ...parsed };
        if ("team" in geo) {
            const tr = teamSchema.safeParse(geo.team);
            team.set(tr.success ? tr.data : null);
            delete geo.team;
        }
        applyHidingZoneGeojson(geo);
    } catch (e) {
        toast.error(`Invalid hiding zone settings: ${e}`);
    }
}
