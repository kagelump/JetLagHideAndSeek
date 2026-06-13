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
    const { applyPreset, applyRelationId, cacheSource, playArea, presets } =
        usePlayArea();
    const { snapToIndex } = useSheetSnap();
    const [query, setQuery] = useState("");
    const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
    const {
        data: results = [],
        error: searchError,
        isFetching: isSearching,
    } = usePlayAreaSearch(debouncedQuery);

    const scrollRef = useRef<SheetScrollViewHandle>(null);
    const [searchSectionY, setSearchSectionY] = useState(0);

    const handleSearchFocus = useCallback(() => {
        // Small delay to let the keyboard begin appearing before scrolling.
        setTimeout(() => {
            scrollRef.current?.scrollTo({ y: searchSectionY, animated: true });
        }, 100);
    }, [searchSectionY]);

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

        // Check for pack-derived admin levels first.
        const packInfo = findPackForPlayArea(playArea.bbox);
        if (packInfo) {
            const pack = buildPackAdminDivisionPack(packInfo);
            setAdminDivisionPack(pack);
            return;
        }

        // Fall back to geographic preset.
        if (isBboxInJapan(playArea.bbox)) {
            setAdminDivisionPresetName("japan");
        } else {
            setAdminDivisionPresetName("generic");
        }
    }, [playArea.osmId, setAdminDivisionPack, setAdminDivisionPresetName]);

    // Reset progress when the mutation settles, and dismiss on success.
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

    return (
        <>
            <SheetScrollView
                ref={scrollRef}
                style={styles.container}
                contentContainerStyle={styles.scrollContent}
            >
                <View style={styles.card} testID="current-play-area-card">
                    <Text style={styles.cardLabel}>Current</Text>
                    <Text style={styles.currentName}>{playArea.label}</Text>
                    <Text style={styles.metadata}>
                        Relation {playArea.osmId}
                    </Text>
                    <Text style={styles.metadata} testID="play-area-bbox">
                        Bbox {formatBbox(playArea.bbox)}
                    </Text>
                    <Text
                        style={styles.metadata}
                        testID="play-area-cache-status"
                    >
                        Boundary cache: {cacheSource}
                    </Text>
                </View>

                <View
                    style={styles.section}
                    onLayout={(e) => setSearchSectionY(e.nativeEvent.layout.y)}
                >
                    <Text style={styles.sectionTitle}>Search</Text>
                    <TextInput
                        accessibilityLabel="Search play areas"
                        onChangeText={setQuery}
                        onFocus={handleSearchFocus}
                        placeholder="Search for a city or ward"
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
                    <Text style={styles.sectionTitle}>Known presets</Text>
                    {presets.map((preset) => (
                        <Pressable
                            accessibilityRole="button"
                            key={preset.osmId}
                            onPress={() => {
                                applyPreset(preset);
                                snapToIndex(SHEET_SNAP_INDEX.medium);
                            }}
                            style={({ pressed }) => [
                                styles.resultRow,
                                pressed ? styles.actionPressed : null,
                            ]}
                        >
                            <View style={styles.resultCopy}>
                                <Text style={styles.resultTitle}>
                                    {preset.label}
                                </Text>
                                <Text style={styles.metadata}>
                                    Relation {preset.osmId}
                                </Text>
                            </View>
                            <Text style={styles.chevron}>›</Text>
                        </Pressable>
                    ))}
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

function formatBbox(bbox: [number, number, number, number]) {
    return `[${bbox.map((value) => value.toFixed(4)).join(", ")}]`;
}

const styles = StyleSheet.create({
    actionPressed: {
        opacity: 0.72,
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
    chevron: {
        color: colors.muted,
        fontSize: 28,
        lineHeight: 28,
    },
    container: {},
    scrollContent: {
        paddingHorizontal: 20,
        paddingTop: 0,
        // Extra bottom space so the search section can always scroll to the
        // top when the keyboard appears, even with few/no results.
        paddingBottom: 400,
    },
    currentName: {
        color: colors.ink,
        fontSize: 22,
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
    resultTitle: {
        color: colors.ink,
        fontSize: 16,
        fontWeight: "800",
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
