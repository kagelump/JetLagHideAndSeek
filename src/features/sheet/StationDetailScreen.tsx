import { useMemo, useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

import { CalculatingIndicator } from "@/components/CalculatingIndicator";
import { SheetScrollView } from "@/features/sheet/SheetScrollView";
import { useHidingZoneDerived } from "@/state/hidingZoneStore";
import { useStationElimination } from "@/features/map/useStationElimination";
import { colors } from "@/theme/colors";
import { createLogger } from "@/shared/logger";

const log = createLogger("StationDetailScreen");

export function StationDetailScreen() {
    const { selectedStations } = useHidingZoneDerived();
    const { remainingCount, totalCount, eliminatedStationIds, isComputing } =
        useStationElimination();

    // Debug: trace when the station detail screen sees computing state change.
    useEffect(() => {
        log.debug(
            `isComputing=${isComputing}, ` +
                `remaining=${remainingCount}/${totalCount}, ` +
                `eliminated=${eliminatedStationIds.size}`,
        );
    }, [isComputing, remainingCount, totalCount, eliminatedStationIds.size]);

    // Sort: remaining stations first, eliminated grouped below.
    // Within each group, sort alphabetically by display name.
    const sortedStations = useMemo(() => {
        if (selectedStations.length === 0) return [];
        const displayName = (s: (typeof selectedStations)[number]) =>
            s.nameEn || s.name;
        return [...selectedStations].sort((a, b) => {
            const aElim = eliminatedStationIds.has(a.id);
            const bElim = eliminatedStationIds.has(b.id);
            if (aElim !== bElim) return aElim ? 1 : -1;
            return displayName(a).localeCompare(displayName(b));
        });
    }, [selectedStations, eliminatedStationIds]);

    return (
        <SheetScrollView contentContainerStyle={styles.contentContainer}>
            {/* Summary header */}
            <View style={styles.summary}>
                {isComputing ? (
                    <CalculatingIndicator style={styles.summarySpinner} />
                ) : (
                    <Text style={styles.summaryNumber}>
                        {remainingCount}
                        <Text style={styles.summaryDivider}> / </Text>
                        {totalCount}
                    </Text>
                )}
                <Text style={styles.summaryLabel}>stations remaining</Text>
            </View>

            {/* Station list */}
            {sortedStations.length === 0 ? (
                <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>No stations selected</Text>
                </View>
            ) : (
                <View style={styles.list}>
                    {sortedStations.map((station) => {
                        const isEliminated = eliminatedStationIds.has(
                            station.id,
                        );
                        return (
                            <View key={station.id} style={styles.stationRow}>
                                {/* Route color dots */}
                                <View style={styles.colorDots}>
                                    {(station.routeColors &&
                                    station.routeColors.length > 0
                                        ? station.routeColors
                                        : ["#1f6f78"]
                                    ).map((color, i) => (
                                        <View
                                            key={i}
                                            style={[
                                                styles.dot,
                                                { backgroundColor: color },
                                            ]}
                                        />
                                    ))}
                                </View>

                                {/* Station name */}
                                <Text
                                    style={[
                                        styles.stationName,
                                        isEliminated &&
                                            styles.stationNameEliminated,
                                    ]}
                                    numberOfLines={1}
                                >
                                    {station.nameEn || station.name}
                                </Text>

                                {/* Eliminated badge */}
                                {isEliminated ? (
                                    <View style={styles.eliminatedBadge}>
                                        <Text
                                            style={styles.eliminatedBadgeText}
                                        >
                                            ELIMINATED
                                        </Text>
                                    </View>
                                ) : null}
                            </View>
                        );
                    })}
                </View>
            )}
        </SheetScrollView>
    );
}

const styles = StyleSheet.create({
    colorDots: {
        alignItems: "center",
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 2,
        width: 24,
    },
    contentContainer: {
        paddingHorizontal: 20,
    },
    dot: {
        borderRadius: 4,
        height: 8,
        width: 8,
    },
    eliminatedBadge: {
        backgroundColor: colors.tint,
        borderRadius: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    eliminatedBadgeText: {
        color: colors.white,
        fontSize: 10,
        fontWeight: "800",
        letterSpacing: 0.3,
    },
    emptyContainer: {
        alignItems: "center",
        paddingVertical: 40,
    },
    emptyText: {
        color: colors.muted,
        fontSize: 15,
    },
    list: {
        borderBottomLeftRadius: 8,
        borderBottomRightRadius: 8,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        overflow: "hidden",
    },
    stationName: {
        color: colors.ink,
        flex: 1,
        fontSize: 15,
        fontWeight: "600",
    },
    stationNameEliminated: {
        color: colors.muted,
        textDecorationLine: "line-through",
    },
    stationRow: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderBottomColor: colors.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    summary: {
        alignItems: "center",
        paddingBottom: 16,
        paddingTop: 8,
    },
    summaryDivider: {
        color: colors.muted,
        fontSize: 26,
        fontWeight: "900",
        fontVariant: ["tabular-nums"],
    },
    summaryLabel: {
        color: colors.muted,
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0.4,
        marginTop: 2,
        textTransform: "uppercase",
    },
    summaryNumber: {
        color: colors.ink,
        fontSize: 26,
        fontWeight: "900",
        fontVariant: ["tabular-nums"],
    },
    summarySpinner: {
        height: 26,
    },
});
