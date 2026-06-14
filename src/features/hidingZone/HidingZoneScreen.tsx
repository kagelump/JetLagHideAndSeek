import { useMemo, useState } from "react";
import {
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

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
import {
    getPresetPlayAreaStats,
    clipStationsToPlayArea,
    partitionPresetsByScope,
} from "./hidingZone";

type DrillDownState = {
    preset: HidingZonePreset;
};

export function HidingZoneScreen() {
    const {
        radiusDisplayValue,
        radiusMeters,
        radiusUnit,
        selectedPresetIds,
        selectedRouteIds,
    } = useHidingZoneState();
    const {
        setRadiusDisplayValue,
        setRadiusUnit,
        setOperatorRouteSelection,
        togglePreset,
    } = useHidingZoneActions();
    const { presets, selectedStations: allSelectedStations } =
        useHidingZoneDerived();
    const { playArea } = usePlayArea();
    const selectedSet = new Set(selectedPresetIds);

    const [showBrowseAll, setShowBrowseAll] = useState(false);
    const [browseSearch, setBrowseSearch] = useState("");
    const [showRadiusModal, setShowRadiusModal] = useState(false);
    const [drillDown, setDrillDown] = useState<DrillDownState | null>(null);

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

    // Partition presets into scoped groups (operator / coverage / other).
    const { operatorPresets, coveragePresets, otherPresets } = useMemo(
        () => partitionPresetsByScope(presets, playAreaStats),
        [presets, playAreaStats],
    );

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
        <>
            <SheetScrollView
                style={styles.container}
                contentContainerStyle={styles.scrollContent}
            >
                {/* Eyebrow + 3-dot menu */}
                <View style={styles.eyebrowRow}>
                    <Text style={styles.eyebrow}>
                        Select your transit lines
                    </Text>
                    <Pressable
                        accessibilityLabel="More options"
                        accessibilityRole="button"
                        hitSlop={8}
                        onPress={() => setShowRadiusModal(true)}
                        style={({ pressed }) => [
                            styles.menuButton,
                            pressed ? styles.actionPressed : null,
                        ]}
                        testID="hiding-zone-menu-button"
                    >
                        <Text style={styles.menuButtonText}>•••</Text>
                    </Pressable>
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
                                            pressed
                                                ? styles.actionPressed
                                                : null,
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
                                    const customRoutes =
                                        selectedRouteIds[preset.id];
                                    const isCustom = customRoutes !== undefined;
                                    return (
                                        <PresetRow
                                            isSelected={selectedSet.has(
                                                preset.id,
                                            )}
                                            key={preset.id}
                                            preset={preset}
                                            onToggle={() =>
                                                togglePreset(preset.id)
                                            }
                                            onDrillDown={() =>
                                                setDrillDown({ preset })
                                            }
                                            customRouteCount={
                                                isCustom
                                                    ? customRoutes.length
                                                    : undefined
                                            }
                                            subtitle={
                                                stats
                                                    ? `${stats.stationsInArea} stations · ${preset.routes.length} line${preset.routes.length === 1 ? "" : "s"}`
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

            <Modal
                animationType="slide"
                onRequestClose={() => setShowRadiusModal(false)}
                transparent
                visible={showRadiusModal}
            >
                <Pressable
                    onPress={() => setShowRadiusModal(false)}
                    style={styles.modalBackdrop}
                >
                    <Pressable style={styles.modalContainer}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalHeaderTitle}>
                                Station radius
                            </Text>
                            <Pressable
                                accessibilityLabel="Close"
                                accessibilityRole="button"
                                hitSlop={12}
                                onPress={() => setShowRadiusModal(false)}
                                style={({ pressed }) => [
                                    styles.modalCloseButton,
                                    pressed ? styles.actionPressed : null,
                                ]}
                                testID="hiding-zone-radius-modal-close"
                            >
                                <Text style={styles.modalCloseButtonText}>
                                    Done
                                </Text>
                            </Pressable>
                        </View>
                        <View style={styles.modalBody}>
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
                    </Pressable>
                </Pressable>
            </Modal>

            {drillDown ? (
                <OperatorDrillDown
                    preset={drillDown.preset}
                    selectedRouteIds={
                        selectedRouteIds[drillDown.preset.id] ?? null
                    }
                    onSetRouteSelection={(routeIds) =>
                        setOperatorRouteSelection(drillDown.preset.id, routeIds)
                    }
                    onBack={() => setDrillDown(null)}
                />
            ) : null}
        </>
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
    onDrillDown,
    preset,
    customRouteCount,
    subtitle,
}: {
    isSelected: boolean;
    onToggle: () => void;
    onDrillDown?: () => void;
    preset: HidingZonePreset;
    customRouteCount?: number;
    subtitle?: string;
}) {
    const metaLine =
        subtitle ??
        `${preset.routes.length} line${preset.routes.length === 1 ? "" : "s"} · ${preset.stations.length} station${preset.stations.length === 1 ? "" : "s"}`;

    const isCustom = customRouteCount !== undefined;

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
                <Text style={styles.metadata}>
                    {isCustom
                        ? `Custom · ${customRouteCount} line${customRouteCount === 1 ? "" : "s"}`
                        : metaLine}
                </Text>
            </View>
            <View style={styles.presetTrailing}>
                <Text
                    style={[
                        styles.presetAction,
                        isSelected ? styles.presetActionSelected : null,
                    ]}
                >
                    {isSelected ? "Added ✓" : "Add"}
                </Text>
                {onDrillDown ? (
                    <Pressable
                        accessibilityLabel={`Pick lines for ${preset.label}`}
                        accessibilityRole="button"
                        hitSlop={8}
                        onPress={onDrillDown}
                        style={({ pressed: p }) => [
                            styles.drillDownChevron,
                            p ? styles.actionPressed : null,
                        ]}
                        testID={`hiding-zone-drill-down-${preset.id}`}
                    >
                        <Text style={styles.drillDownChevronText}>›</Text>
                    </Pressable>
                ) : null}
            </View>
        </Pressable>
    );
}

function OperatorDrillDown({
    preset,
    selectedRouteIds,
    onSetRouteSelection,
    onBack,
}: {
    preset: HidingZonePreset;
    selectedRouteIds: string[] | null;
    onSetRouteSelection: (routeIds: string[] | null) => void;
    onBack: () => void;
}) {
    const isAll = selectedRouteIds === null;
    const selectedSet = new Set(
        selectedRouteIds ?? preset.routes.map((r) => r.id),
    );

    const toggleRoute = (routeId: string) => {
        const next = new Set(selectedSet);
        if (next.has(routeId)) {
            next.delete(routeId);
        } else {
            next.add(routeId);
        }
        const allRouteIds = preset.routes.map((r) => r.id);
        const isAllSelected = allRouteIds.every((id) => next.has(id));
        onSetRouteSelection(isAllSelected ? null : [...next]);
    };

    const toggleAll = () => {
        onSetRouteSelection(isAll ? preset.routes.map((r) => r.id) : null);
    };

    return (
        <View style={styles.drillDownOverlay}>
            <View style={styles.drillDownHeader}>
                <Pressable
                    accessibilityLabel="Back"
                    accessibilityRole="button"
                    onPress={onBack}
                    style={({ pressed }) => [
                        styles.drillDownBack,
                        pressed ? styles.actionPressed : null,
                    ]}
                >
                    <Text style={styles.drillDownBackText}>‹ Back</Text>
                </Pressable>
                <Text style={styles.drillDownTitle}>{preset.label}</Text>
                <View style={styles.drillDownSpacer} />
            </View>
            <SheetScrollView contentContainerStyle={styles.drillDownContent}>
                <Pressable
                    accessibilityLabel={
                        isAll ? "Deselect all lines" : "Select all lines"
                    }
                    accessibilityRole="button"
                    onPress={toggleAll}
                    style={({ pressed }) => [
                        styles.presetRow,
                        !isAll ? styles.presetRowSelected : null,
                        pressed ? styles.actionPressed : null,
                    ]}
                >
                    <View style={styles.presetCopy}>
                        <Text style={styles.presetTitle}>All lines</Text>
                        <Text style={styles.metadata}>
                            {preset.routes.length} line
                            {preset.routes.length === 1 ? "" : "s"}
                        </Text>
                    </View>
                    <Text
                        style={[
                            styles.presetAction,
                            !isAll ? styles.presetActionSelected : null,
                        ]}
                    >
                        {!isAll ? "Selected ✓" : "Select"}
                    </Text>
                </Pressable>
                {preset.routes.map((route) => {
                    const isActive = selectedSet.has(route.id);
                    return (
                        <Pressable
                            accessibilityLabel={`${route.name}, ${isActive ? "Selected" : "Not selected"}`}
                            accessibilityRole="button"
                            key={route.id}
                            onPress={() => toggleRoute(route.id)}
                            style={({ pressed }) => [
                                styles.presetRow,
                                isActive ? styles.presetRowSelected : null,
                                pressed ? styles.actionPressed : null,
                            ]}
                        >
                            <View style={styles.routeColorDot}>
                                <View
                                    style={[
                                        styles.colorDot,
                                        {
                                            backgroundColor:
                                                route.color ||
                                                preset.defaultColor,
                                        },
                                    ]}
                                />
                            </View>
                            <View style={styles.presetCopy}>
                                <Text style={styles.presetTitle}>
                                    {route.name}
                                </Text>
                            </View>
                            <Text
                                style={[
                                    styles.presetAction,
                                    isActive
                                        ? styles.presetActionSelected
                                        : null,
                                ]}
                            >
                                {isActive ? "✓" : ""}
                            </Text>
                        </Pressable>
                    );
                })}
            </SheetScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    actionPressed: {
        opacity: 0.72,
    },
    addAllRow: {
        alignItems: "center",
        backgroundColor: colors.tint,
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
    colorDot: {
        borderRadius: 6,
        height: 12,
        width: 12,
    },
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
        borderColor: colors.button,
        borderRadius: 6,
        borderWidth: 1,
        color: colors.button,
        fontSize: 14,
        fontWeight: "800",
        paddingHorizontal: 10,
        paddingVertical: 4,
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
    eyebrow: {
        color: colors.tint,
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0,
        textTransform: "uppercase",
    },
    eyebrowRow: {
        alignItems: "center",
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 4,
        marginTop: 12,
    },
    menuButton: {
        alignItems: "center",
        justifyContent: "center",
        minHeight: 32,
        minWidth: 32,
    },
    menuButtonText: {
        color: colors.muted,
        fontSize: 18,
        fontWeight: "800",
        letterSpacing: 1,
    },
    modalBackdrop: {
        backgroundColor: "rgba(0,0,0,0.4)",
        flex: 1,
        justifyContent: "flex-end",
    },
    modalBody: {
        gap: 12,
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    modalCloseButton: {
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    modalCloseButtonText: {
        color: colors.tint,
        fontSize: 16,
        fontWeight: "700",
    },
    modalContainer: {
        backgroundColor: colors.background,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingBottom: 40,
    },
    modalHeader: {
        alignItems: "center",
        borderBottomColor: colors.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    modalHeaderTitle: {
        color: colors.ink,
        fontSize: 18,
        fontWeight: "800",
    },
    drillDownOverlay: {
        backgroundColor: colors.background,
        bottom: 0,
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
        zIndex: 10,
    },
    drillDownHeader: {
        alignItems: "center",
        borderBottomColor: colors.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        gap: 8,
        minHeight: 44,
        paddingHorizontal: 20,
        paddingVertical: 4,
    },
    drillDownBack: {
        minHeight: 44,
        minWidth: 72,
        justifyContent: "center",
    },
    drillDownBackText: {
        color: colors.tint,
        fontSize: 16,
        fontWeight: "700",
    },
    drillDownTitle: {
        color: colors.ink,
        flex: 1,
        fontSize: 16,
        fontWeight: "700",
        textAlign: "center",
    },
    drillDownSpacer: {
        minWidth: 72,
    },
    drillDownContent: {
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 40,
    },
    drillDownChevron: {
        justifyContent: "center",
        minHeight: 44,
        minWidth: 32,
        alignItems: "center",
    },
    drillDownChevronText: {
        color: colors.muted,
        fontSize: 28,
        lineHeight: 28,
    },
    presetTrailing: {
        alignItems: "center",
        flexDirection: "row",
        gap: 4,
    },
    routeColorDot: {
        paddingRight: 4,
    },
});
