import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { UnitSegmentedControl } from "@/components/UnitSegmentedControl";
import { SheetScrollView } from "@/features/sheet/SheetScrollView";
import {
    useHidingZoneActions,
    useHidingZoneDerived,
    useHidingZoneState,
} from "@/state/hidingZoneStore";
import { usePlayArea } from "@/state/playAreaStore";
import { colors } from "@/theme/colors";

import type { HidingZonePreset } from "./hidingZoneTypes";
import { getPresetPlayAreaStats, clipStationsToPlayArea } from "./hidingZone";
import { getTransitManifest } from "./hidingZoneData";

export function HidingZoneScreen() {
    const { radiusDisplayValue, radiusMeters, radiusUnit, selectedPresetIds } =
        useHidingZoneState();
    const { setRadiusDisplayValue, setRadiusUnit, togglePreset } =
        useHidingZoneActions();
    const { presets, selectedStations: allSelectedStations } =
        useHidingZoneDerived();
    const { playArea } = usePlayArea();
    const selectedSet = new Set(selectedPresetIds);

    const [showBrowseAll, setShowBrowseAll] = useState(false);
    const [browseSearch, setBrowseSearch] = useState("");

    // Classify presets by kind from the manifest.
    const manifest = getTransitManifest();
    const presetKind = useMemo(() => {
        const map = new Map<string, "coverage" | "operator">();
        for (const bundle of manifest.bundles) {
            for (const p of bundle.presets) {
                map.set(
                    p.id,
                    (p as { kind?: string }).kind === "coverage"
                        ? "coverage"
                        : "operator",
                );
            }
        }
        return map;
    }, [manifest]);

    // Per-preset station counts within the play area.
    const playAreaStats = useMemo(
        () =>
            playArea ? getPresetPlayAreaStats(presets, playArea.bbox) : null,
        [presets, playArea],
    );

    // Derived stations clipped to the play area.
    const clippedStations = useMemo(
        () =>
            clipStationsToPlayArea(
                allSelectedStations,
                playArea?.bbox,
                radiusMeters,
            ),
        [allSelectedStations, playArea?.bbox, radiusMeters],
    );

    // Partition presets into scoped groups.
    const { operatorPresets, coveragePresets, otherPresets } = useMemo(() => {
        const operators: HidingZonePreset[] = [];
        const coverages: HidingZonePreset[] = [];
        const others: HidingZonePreset[] = [];

        for (const preset of presets) {
            const kind = presetKind.get(preset.id) ?? "operator";
            if (!playArea || !playAreaStats) {
                // No play area: everything is "other" (browse-all).
                others.push(preset);
            } else {
                const stats = playAreaStats.find(
                    (s) => s.presetId === preset.id,
                );
                if (!stats || stats.stationsInArea === 0) {
                    others.push(preset);
                } else if (kind === "coverage") {
                    coverages.push(preset);
                } else {
                    operators.push(preset);
                }
            }
        }

        // Sort operators by in-play-area station count descending.
        if (playAreaStats) {
            const countOf = (p: HidingZonePreset) =>
                playAreaStats.find((s) => s.presetId === p.id)
                    ?.stationsInArea ?? 0;
            operators.sort((a, b) => countOf(b) - countOf(a));
        }

        return {
            operatorPresets: operators,
            coveragePresets: coverages,
            otherPresets: others,
        };
    }, [presets, presetKind, playArea, playAreaStats]);

    // Unselected operator count (for "Add all operators" button).
    const unselectedOperators = operatorPresets.filter(
        (p) => !selectedSet.has(p.id),
    );

    // Accessibility label.
    const currentAccessibilityLabel = `Hiding zone settings; radius ${radiusDisplayValue} ${radiusUnit}; stored as ${Math.round(radiusMeters)} m; ${selectedPresetIds.length} preset${selectedPresetIds.length === 1 ? "" : "s"} selected; ${clippedStations.length} station${clippedStations.length === 1 ? "" : "s"} in play area`;

    // Filter browse-all by search.
    const browsePresets = useMemo(() => {
        if (!browseSearch.trim()) return otherPresets;
        const q = browseSearch.toLowerCase();
        return otherPresets.filter((p) => p.label.toLowerCase().includes(q));
    }, [otherPresets, browseSearch]);

    const noPlayArea = !playArea;

    return (
        <SheetScrollView
            style={styles.container}
            contentContainerStyle={styles.scrollContent}
        >
            {/* Radius section — unchanged */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Station radius</Text>
                <View style={styles.radiusRow}>
                    <TextInput
                        accessibilityLabel="Hiding zone radius"
                        keyboardType="decimal-pad"
                        onChangeText={setRadiusDisplayValue}
                        style={styles.radiusInput}
                        testID="hiding-zone-radius-input"
                        value={radiusDisplayValue}
                    />
                    <UnitSegmentedControl
                        onChange={setRadiusUnit}
                        testIDPrefix="hiding-zone-unit"
                        value={radiusUnit}
                    />
                </View>
                <Text
                    accessibilityLabel={`Stored as ${Math.round(radiusMeters)} m`}
                    style={styles.metadata}
                    testID="hiding-zone-radius-meters"
                >
                    Stored as {Math.round(radiusMeters)} m
                </Text>
            </View>

            {/* Current card — clipped count vs total */}
            <View
                accessible
                accessibilityLabel={currentAccessibilityLabel}
                style={styles.card}
                testID="current-hiding-zone-card"
            >
                <Text style={styles.cardLabel}>Current</Text>
                <Text style={styles.currentName}>
                    {selectedPresetIds.length} preset
                    {selectedPresetIds.length === 1 ? "" : "s"} selected
                </Text>
                <Text style={styles.metadata}>
                    {clippedStations.length} station
                    {clippedStations.length === 1 ? "" : "s"} in play area
                    {clippedStations.length !== allSelectedStations.length
                        ? ` (${allSelectedStations.length} total)`
                        : ""}
                </Text>
            </View>

            {/* Scoped view or browse-all */}
            {noPlayArea ? (
                // No play area: direct browse-all.
                <PresetSection
                    presets={browsePresets}
                    selectedSet={selectedSet}
                    title="All presets"
                    togglePreset={togglePreset}
                    showSearch
                    searchValue={browseSearch}
                    onSearchChange={setBrowseSearch}
                />
            ) : (
                <>
                    {/* Operators in play area */}
                    {operatorPresets.length > 0 && (
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>
                                Operators in your play area
                            </Text>
                            {unselectedOperators.length >= 2 && (
                                <Pressable
                                    accessibilityLabel="Add all operators in play area"
                                    accessibilityRole="button"
                                    onPress={() =>
                                        unselectedOperators.forEach((p) =>
                                            togglePreset(p.id),
                                        )
                                    }
                                    style={({ pressed }) => [
                                        styles.addAllRow,
                                        pressed ? styles.actionPressed : null,
                                    ]}
                                    testID="hiding-zone-add-all-operators"
                                >
                                    <Text style={styles.addAllText}>
                                        Add all operators
                                    </Text>
                                </Pressable>
                            )}
                            {operatorPresets.map((preset) => {
                                const stats = playAreaStats?.find(
                                    (s) => s.presetId === preset.id,
                                );
                                return (
                                    <PresetRow
                                        isSelected={selectedSet.has(preset.id)}
                                        key={preset.id}
                                        preset={preset}
                                        onToggle={() => togglePreset(preset.id)}
                                        subtitle={
                                            stats
                                                ? `${stats.stationsInArea} stations in your play area · ${preset.routes.length} line${preset.routes.length === 1 ? "" : "s"}`
                                                : undefined
                                        }
                                    />
                                );
                            })}
                        </View>
                    )}

                    {/* Coverage presets */}
                    {coveragePresets.length > 0 && (
                        <PresetSection
                            presets={coveragePresets}
                            selectedSet={selectedSet}
                            title="All stations"
                            togglePreset={togglePreset}
                        />
                    )}

                    {/* Selected elsewhere — presets outside play area that are selected */}
                    {(() => {
                        const elsewhere = otherPresets.filter((p) =>
                            selectedSet.has(p.id),
                        );
                        if (elsewhere.length === 0) return null;
                        return (
                            <PresetSection
                                presets={elsewhere}
                                selectedSet={selectedSet}
                                title="Selected elsewhere"
                                togglePreset={togglePreset}
                            />
                        );
                    })()}

                    {/* Browse all regions (collapsed by default) */}
                    <View style={styles.section}>
                        <Pressable
                            accessibilityLabel={`Browse all regions${showBrowseAll ? ", expanded" : ", collapsed"}`}
                            accessibilityRole="button"
                            onPress={() => setShowBrowseAll((v) => !v)}
                            style={({ pressed }) => [
                                styles.browseToggle,
                                pressed ? styles.actionPressed : null,
                            ]}
                            testID="hiding-zone-browse-all-toggle"
                        >
                            <Text style={styles.browseToggleText}>
                                Browse all regions
                            </Text>
                            <Text style={styles.metadata}>
                                {showBrowseAll ? "▲" : "▼"}
                            </Text>
                        </Pressable>
                        {showBrowseAll && (
                            <>
                                <TextInput
                                    accessibilityLabel="Search presets"
                                    onChangeText={setBrowseSearch}
                                    placeholder="Search…"
                                    placeholderTextColor={colors.muted}
                                    style={styles.searchInput}
                                    testID="hiding-zone-browse-search"
                                    value={browseSearch}
                                />
                                {browsePresets.length === 0 ? (
                                    <Text style={styles.emptyText}>
                                        No matching presets.
                                    </Text>
                                ) : (
                                    browsePresets.map((preset) => (
                                        <PresetRow
                                            isSelected={selectedSet.has(
                                                preset.id,
                                            )}
                                            key={preset.id}
                                            preset={preset}
                                            onToggle={() =>
                                                togglePreset(preset.id)
                                            }
                                        />
                                    ))
                                )}
                            </>
                        )}
                    </View>
                </>
            )}
        </SheetScrollView>
    );
}

function PresetSection({
    presets,
    selectedSet,
    title,
    togglePreset,
    showSearch,
    searchValue,
    onSearchChange,
}: {
    presets: HidingZonePreset[];
    selectedSet: Set<string>;
    title: string;
    togglePreset: (presetId: string) => void;
    showSearch?: boolean;
    searchValue?: string;
    onSearchChange?: (v: string) => void;
}) {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {showSearch && (
                <TextInput
                    accessibilityLabel="Search presets"
                    onChangeText={onSearchChange ?? (() => {})}
                    placeholder="Search…"
                    placeholderTextColor={colors.muted}
                    style={styles.searchInput}
                    testID="hiding-zone-browse-search"
                    value={searchValue ?? ""}
                />
            )}
            {presets.length === 0 ? (
                <Text style={styles.emptyText}>No matching presets.</Text>
            ) : (
                presets.map((preset) => (
                    <PresetRow
                        isSelected={selectedSet.has(preset.id)}
                        key={preset.id}
                        preset={preset}
                        onToggle={() => togglePreset(preset.id)}
                    />
                ))
            )}
        </View>
    );
}

function PresetRow({
    isSelected,
    onToggle,
    preset,
    subtitle,
}: {
    isSelected: boolean;
    onToggle: () => void;
    preset: HidingZonePreset;
    subtitle?: string;
}) {
    const metaLine =
        subtitle ??
        `${preset.routes.length} line${preset.routes.length === 1 ? "" : "s"} · ${preset.stations.length} station${preset.stations.length === 1 ? "" : "s"}`;

    return (
        <Pressable
            accessibilityLabel={`${preset.label}, ${metaLine}, ${isSelected ? "Remove" : "Add"}`}
            accessibilityRole="button"
            onPress={onToggle}
            style={({ pressed }) => [
                styles.presetRow,
                isSelected ? styles.presetRowSelected : null,
                pressed ? styles.actionPressed : null,
            ]}
            testID={`hiding-zone-preset-${preset.id}`}
        >
            <View style={styles.presetCopy}>
                <Text style={styles.presetTitle}>{preset.label}</Text>
                <Text style={styles.metadata}>{metaLine}</Text>
            </View>
            <Text
                style={[
                    styles.presetAction,
                    isSelected ? styles.presetActionSelected : null,
                ]}
            >
                {isSelected ? "Remove" : "Add"}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    actionPressed: {
        opacity: 0.72,
    },
    addAllRow: {
        alignItems: "center",
        backgroundColor: colors.button,
        borderRadius: 8,
        flexDirection: "row",
        justifyContent: "center",
        marginBottom: 8,
        marginTop: 4,
        minHeight: 44,
        paddingHorizontal: 14,
    },
    addAllText: {
        color: colors.white,
        fontSize: 14,
        fontWeight: "800",
    },
    browseToggle: {
        alignItems: "center",
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 8,
        minHeight: 44,
    },
    browseToggleText: {
        color: colors.ink,
        fontSize: 16,
        fontWeight: "800",
    },
    card: {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        gap: 4,
        marginTop: 12,
        padding: 14,
    },
    cardLabel: {
        color: colors.tint,
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0,
        textTransform: "uppercase",
    },
    container: {},
    currentName: {
        color: colors.ink,
        fontSize: 22,
        fontWeight: "800",
    },
    emptyText: {
        color: colors.muted,
        fontSize: 14,
        lineHeight: 20,
    },
    metadata: {
        color: colors.muted,
        fontSize: 13,
        lineHeight: 18,
    },
    presetAction: {
        color: colors.button,
        fontSize: 14,
        fontWeight: "800",
    },
    presetActionSelected: {
        color: colors.tint,
    },
    presetCopy: {
        flex: 1,
    },
    presetRow: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        gap: 12,
        justifyContent: "space-between",
        marginTop: 8,
        minHeight: 58,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    presetRowSelected: {
        borderColor: colors.tint,
    },
    presetTitle: {
        color: colors.ink,
        fontSize: 16,
        fontWeight: "800",
    },
    radiusInput: {
        backgroundColor: colors.white,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        color: colors.ink,
        flex: 1,
        fontSize: 16,
        minHeight: 48,
        paddingHorizontal: 14,
    },
    radiusRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 10,
    },
    scrollContent: {
        paddingHorizontal: 20,
        paddingTop: 0,
    },
    searchInput: {
        backgroundColor: colors.white,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        color: colors.ink,
        fontSize: 14,
        marginBottom: 8,
        minHeight: 40,
        paddingHorizontal: 12,
    },
    section: {
        marginTop: 12,
    },
    sectionTitle: {
        color: colors.ink,
        fontSize: 16,
        fontWeight: "800",
        marginBottom: 10,
    },
});
