import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
    getCoverageStatus,
    isBboxInJapan,
    type CoverageStatus,
    type InstalledPackInfo,
} from "@/features/offline/coverage";
import { usePackCatalog } from "@/features/offline/packCatalog";
import {
    useInstallPack,
    useInstalledPacks,
} from "@/features/offline/regionPacks";
import type { InstallProgress } from "@/features/offline/regionPacks";
import {
    buildPackAdminDivisionPack,
    findPackForPlayArea,
} from "@/features/offline/adminLevelDefaults";
import { defaultPlayArea } from "@/features/map/playArea";
import { OfflinePackModal } from "@/features/playArea/OfflinePackModal";
import {
    type PlayAreaSearchResult,
    usePlayAreaSearch,
} from "@/features/playArea/playAreaSearch";
import {
    type SheetScrollViewHandle,
    SheetScrollView,
} from "@/features/sheet/SheetScrollView";
import { useSheetSnap } from "@/features/sheet/SheetSnapContext";
import { SHEET_SNAP_INDEX } from "@/features/sheet/sheetRoutes";
import { useDebouncedValue } from "@/shared/useDebouncedValue";
import { usePlayArea } from "@/state/playAreaStore";
import { useQuestionActions } from "@/state/questionStore";
import { colors } from "@/theme/colors";

import type { SheetRouteName } from "@/features/sheet/sheetRoutes";

const SEARCH_DEBOUNCE_MS = 350;

type PlayAreaScreenProps = {
    onNavigate: (route: SheetRouteName) => void;
};

export function PlayAreaScreen({ onNavigate }: PlayAreaScreenProps) {
    const { applyPreset, applyRelationId, playArea, presets } = usePlayArea();
    const { snapToIndex } = useSheetSnap();
    const [query, setQuery] = useState("");
    const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
    const {
        data: results = [],
        error: searchError,
        isFetching: isSearching,
    } = usePlayAreaSearch(debouncedQuery);

    const scrollRef = useRef<SheetScrollViewHandle>(null);
    const searchInputRef = useRef<TextInput>(null);
    const [searchSectionY, setSearchSectionY] = useState(0);
    const [relationIdInput, setRelationIdInput] = useState("");
    const [relationIdError, setRelationIdError] = useState<string | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);

    const visiblePresets = useMemo(
        () => presets.filter((p) => p !== defaultPlayArea),
        [presets],
    );

    useEffect(() => {
        snapToIndex(SHEET_SNAP_INDEX.large);
    }, [snapToIndex]);

    useEffect(() => {
        const timer = setTimeout(() => {
            searchInputRef.current?.focus();
        }, 400);
        return () => clearTimeout(timer);
    }, []);

    const handleSearchFocus = useCallback(() => {
        setTimeout(() => {
            scrollRef.current?.scrollTo({ y: searchSectionY, animated: true });
        }, 100);
    }, [searchSectionY]);

    const handleApplyRelationId = useCallback(async () => {
        const trimmed = relationIdInput.trim();
        if (!trimmed) return;
        setRelationIdError(null);
        const ok = await applyRelationId(trimmed);
        if (!ok) {
            setRelationIdError("Could not resolve this relation ID.");
        } else {
            snapToIndex(SHEET_SNAP_INDEX.medium);
        }
    }, [relationIdInput, applyRelationId, snapToIndex]);

    // ── Offline pack prompt ───────────────────────────────────────────────
    const catalog = usePackCatalog();
    const installed = useInstalledPacks();
    const installMutation = useInstallPack();

    const installedPackInfos: InstalledPackInfo[] = useMemo(
        () =>
            (installed.data ?? []).map((p) => ({
                id: p.id,
                osmSnapshot: p.osmSnapshot,
                bbox: p.bbox,
                artifactKinds: p.artifacts
                    .filter((a) => a.status === "installed")
                    .map((a) => a.kind),
                missingKinds: p.artifacts
                    .filter((a) => a.status === "failed")
                    .map((a) => a.kind),
            })),
        [installed.data],
    );

    const [showOfflineModal, setShowOfflineModal] = useState(false);
    const [modalCoverage, setModalCoverage] = useState<CoverageStatus | null>(
        null,
    );
    const [installProgress, setInstallProgress] =
        useState<InstallProgress | null>(null);
    const dismissedOsmId = useRef<number | null>(null);
    const isFirstSelection = useRef(true);

    useEffect(() => {
        if (isFirstSelection.current) {
            isFirstSelection.current = false;
            return;
        }

        if (dismissedOsmId.current === playArea.osmId) return;

        const coverage = getCoverageStatus(
            playArea.bbox,
            catalog.data?.packs,
            installedPackInfos,
        );

        if (coverage.state === "available" || coverage.state === "partial") {
            setModalCoverage(coverage);
            setShowOfflineModal(true);
        }
    }, [playArea.osmId, catalog.data, installedPackInfos]);

    // ── Auto-select admin division preset ────────────────────────────────
    const { setAdminDivisionPresetName, setAdminDivisionPack } =
        useQuestionActions();
    const adminPresetInitialised = useRef(false);

    useEffect(() => {
        if (!adminPresetInitialised.current) {
            adminPresetInitialised.current = true;
            return;
        }

        const packInfo = findPackForPlayArea(playArea.bbox);
        if (packInfo) {
            const pack = buildPackAdminDivisionPack(packInfo);
            setAdminDivisionPack(pack);
            return;
        }

        if (isBboxInJapan(playArea.bbox)) {
            setAdminDivisionPresetName("japan");
        } else {
            setAdminDivisionPresetName("generic");
        }
    }, [playArea.osmId, setAdminDivisionPack, setAdminDivisionPresetName]);

    useEffect(() => {
        if (!installMutation.isPending && !installMutation.isError) {
            setInstallProgress(null);
        }
        if (installMutation.isSuccess) {
            setShowOfflineModal(false);
            dismissedOsmId.current = playArea.osmId;
            onNavigate("hiding-zone");
        }
    }, [
        installMutation.isPending,
        installMutation.isError,
        installMutation.isSuccess,
        playArea.osmId,
    ]);

    const handleInstallOfflinePack = useCallback(() => {
        if (
            !modalCoverage ||
            (modalCoverage.state !== "available" &&
                modalCoverage.state !== "partial")
        )
            return;

        const pack = catalog.data?.packs.find(
            (p) => p.id === modalCoverage.packId,
        );
        if (!pack) return;

        installMutation.mutate({
            pack,
            onProgress: (p) => setInstallProgress(p),
        });
    }, [modalCoverage, catalog.data, installMutation]);

    const handleDismissOfflineModal = useCallback(() => {
        setShowOfflineModal(false);
        dismissedOsmId.current = playArea.osmId;
        setInstallProgress(null);
    }, [playArea.osmId]);

    const installError =
        installMutation.isError && installMutation.error instanceof Error
            ? installMutation.error.message
            : installMutation.isError
              ? "Download failed."
              : null;

    const hasSearchQuery = debouncedQuery.trim().length > 0;
    const showNoResults =
        hasSearchQuery && !isSearching && !searchError && results.length === 0;

    return (
        <>
            <SheetScrollView
                ref={scrollRef}
                style={styles.container}
                contentContainerStyle={styles.scrollContent}
            >
                <View style={styles.summaryHeader}>
                    <Text style={styles.summaryLabel}>Current</Text>
                    <Text style={styles.summaryTitle}>{playArea.label}</Text>
                </View>

                {visiblePresets.length > 0 ? (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>
                            Where are you playing?
                        </Text>
                        {visiblePresets.map((preset) => {
                            const isActive = preset.osmId === playArea.osmId;
                            return (
                                <Pressable
                                    accessibilityRole="button"
                                    key={preset.osmId}
                                    onPress={() => {
                                        applyPreset(preset);
                                        snapToIndex(SHEET_SNAP_INDEX.medium);
                                    }}
                                    style={({ pressed }) => [
                                        styles.resultRow,
                                        isActive
                                            ? styles.resultRowActive
                                            : null,
                                        pressed ? styles.actionPressed : null,
                                    ]}
                                >
                                    <View style={styles.resultCopy}>
                                        <Text style={styles.resultTitle}>
                                            {preset.label}
                                        </Text>
                                        {isActive ? (
                                            <Text style={styles.activeBadge}>
                                                In use
                                            </Text>
                                        ) : null}
                                    </View>
                                    <Text style={styles.chevron}>›</Text>
                                </Pressable>
                            );
                        })}
                    </View>
                ) : null}

                <View
                    style={styles.section}
                    onLayout={(e) => setSearchSectionY(e.nativeEvent.layout.y)}
                >
                    <Text style={styles.sectionTitle}>Search</Text>
                    <TextInput
                        accessibilityLabel="Search play areas"
                        onChangeText={setQuery}
                        onFocus={handleSearchFocus}
                        placeholder="Search a city or region"
                        ref={searchInputRef}
                        style={styles.input}
                        testID="play-area-search-input"
                        value={query}
                    />
                    {isSearching ? (
                        <Text style={styles.loading}>Searching...</Text>
                    ) : null}
                    {searchError ? (
                        <Text style={styles.error}>
                            {searchError instanceof Error
                                ? searchError.message
                                : "Search failed."}
                        </Text>
                    ) : null}
                    {showNoResults ? (
                        <Text style={styles.noResults}>No matches found.</Text>
                    ) : null}
                    {results.map((result) => (
                        <ResultRow
                            key={result.osmId}
                            result={result}
                            onApply={() => {
                                void applyRelationId(String(result.osmId));
                                snapToIndex(SHEET_SNAP_INDEX.medium);
                            }}
                        />
                    ))}
                </View>

                <View style={styles.section}>
                    <Pressable
                        accessibilityLabel="Toggle advanced options"
                        accessibilityRole="button"
                        onPress={() => setShowAdvanced((v) => !v)}
                        style={({ pressed }) => [
                            styles.advancedToggle,
                            pressed ? styles.actionPressed : null,
                        ]}
                    >
                        <Text style={styles.advancedToggleText}>Advanced</Text>
                        <Text style={styles.advancedChevron}>
                            {showAdvanced ? "−" : "+"}
                        </Text>
                    </Pressable>
                    {showAdvanced ? (
                        <View style={styles.advancedContent}>
                            <TextInput
                                accessibilityLabel="OSM relation ID"
                                keyboardType="number-pad"
                                onChangeText={setRelationIdInput}
                                placeholder="OSM relation ID"
                                style={styles.input}
                                testID="play-area-relation-id-input"
                                value={relationIdInput}
                            />
                            {relationIdError ? (
                                <Text style={styles.error}>
                                    {relationIdError}
                                </Text>
                            ) : null}
                            <Pressable
                                accessibilityLabel="Apply relation ID"
                                accessibilityRole="button"
                                onPress={() => void handleApplyRelationId()}
                                style={({ pressed }) => [
                                    styles.applyButton,
                                    pressed ? styles.actionPressed : null,
                                ]}
                                testID="play-area-apply-relation-id"
                            >
                                <Text style={styles.applyButtonText}>
                                    Apply
                                </Text>
                            </Pressable>
                        </View>
                    ) : null}
                    <View style={styles.stickyFooter}>
                        <Pressable
                            accessibilityLabel="Continue to hiding zones"
                            accessibilityRole="button"
                            onPress={() => onNavigate("hiding-zone")}
                            style={({ pressed }) => [
                                styles.continueButton,
                                pressed ? styles.actionPressed : null,
                            ]}
                            testID="play-area-continue"
                        >
                            <Text style={styles.continueButtonText}>
                                Continue
                            </Text>
                        </Pressable>
                    </View>
                </View>
            </SheetScrollView>

            <OfflinePackModal
                visible={showOfflineModal}
                coverage={modalCoverage}
                progress={installProgress}
                isInstalling={installMutation.isPending}
                installError={installError}
                onInstall={handleInstallOfflinePack}
                onDismiss={handleDismissOfflineModal}
            />
        </>
    );
}

function ResultRow({
    onApply,
    result,
}: {
    onApply: () => void;
    result: PlayAreaSearchResult;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            onPress={onApply}
            style={({ pressed }) => [
                styles.resultRow,
                pressed ? styles.actionPressed : null,
            ]}
        >
            <View style={styles.resultCopy}>
                <Text style={styles.resultTitle}>{result.label}</Text>
                <Text style={styles.metadata}>
                    {[result.state, result.country].filter(Boolean).join(", ")}
                    {result.state || result.country ? " · " : ""}Relation{" "}
                    {result.osmId}
                </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    actionPressed: {
        opacity: 0.72,
    },
    activeBadge: {
        color: colors.tint,
        fontSize: 12,
        fontWeight: "800",
    },
    advancedChevron: {
        color: colors.tint,
        fontSize: 18,
        fontWeight: "800",
    },
    advancedContent: {
        gap: 8,
        marginTop: 10,
    },
    advancedToggle: {
        alignItems: "center",
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 8,
    },
    advancedToggleText: {
        color: colors.tint,
        fontSize: 14,
        fontWeight: "700",
    },
    applyButton: {
        alignItems: "center",
        backgroundColor: colors.tint,
        borderRadius: 8,
        justifyContent: "center",
        minHeight: 44,
    },
    applyButtonText: {
        color: colors.white,
        fontSize: 15,
        fontWeight: "800",
    },
    chevron: {
        color: colors.muted,
        fontSize: 28,
        lineHeight: 28,
    },
    container: {},
    continueButton: {
        alignItems: "center",
        backgroundColor: colors.tint,
        borderRadius: 8,
        justifyContent: "center",
        minHeight: 50,
    },
    continueButtonText: {
        color: colors.white,
        fontSize: 16,
        fontWeight: "800",
    },
    error: {
        color: "#b42318",
        fontSize: 13,
        fontWeight: "700",
        marginTop: 8,
    },
    input: {
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
    loading: {
        color: colors.muted,
        fontSize: 13,
        fontWeight: "700",
        marginTop: 8,
    },
    metadata: {
        color: colors.muted,
        fontSize: 13,
        lineHeight: 18,
    },
    noResults: {
        color: colors.muted,
        fontSize: 13,
        fontStyle: "italic",
        marginTop: 8,
    },
    resultCopy: {
        flex: 1,
    },
    resultRow: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        gap: 12,
        justifyContent: "space-between",
        marginTop: 10,
        minHeight: 58,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    resultRowActive: {
        backgroundColor: colors.tealTintBg,
        borderColor: colors.tint,
    },
    resultTitle: {
        color: colors.ink,
        fontSize: 16,
        fontWeight: "800",
    },
    scrollContent: {
        paddingHorizontal: 20,
        paddingTop: 0,
        paddingBottom: 200,
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
    stickyFooter: {
        borderTopColor: colors.border,
        borderTopWidth: 1,
        paddingHorizontal: 20,
        paddingVertical: 12,
    },
    summaryHeader: {
        marginBottom: 4,
    },
    summaryLabel: {
        color: colors.tint,
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0.5,
        textTransform: "uppercase",
    },
    summaryTitle: {
        color: colors.ink,
        fontSize: 22,
        fontWeight: "800",
        marginTop: 2,
    },
});
