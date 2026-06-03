import { useCallback, useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { SheetListRow } from "@/components/SheetListRow";
import { SheetScrollView } from "@/features/sheet/SheetScrollView";
import {
    listInstalledPacks,
    useDownloadPack,
    usePackManifest,
    useRemovePack,
    type PackMeta,
} from "@/features/questions/matching/regionPacks";
import { useQuery } from "@tanstack/react-query";
import { colors } from "@/theme/colors";

// ─── Manifest URL ─────────────────────────────────────────────────────────
// Update to your CDN once the packs are hosted.
const MANIFEST_URL = "https://<cdn>/poi/packs.json";

// ─── Installed packs query ───────────────────────────────────────────────

function useInstalledPacks() {
    return useQuery({
        queryKey: ["installed-poi-packs"],
        queryFn: listInstalledPacks,
        staleTime: 0, // always re-read after mutations
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    } catch {
        return iso.slice(0, 10);
    }
}

// ─── Section header ──────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
    return <Text style={styles.sectionHeader}>{title}</Text>;
}

// ─── Screen ────────────────────────────────────────────────────────────────

export function OfflineDataScreen() {
    const manifest = usePackManifest(MANIFEST_URL);
    const installed = useInstalledPacks();
    const download = useDownloadPack();
    const remove = useRemovePack();

    const installedIds = useMemo(() => {
        return new Set((installed.data ?? []).map((p) => p.id));
    }, [installed.data]);

    const totalBytes = useMemo(() => {
        return (installed.data ?? []).reduce((sum, p) => sum + p.bytes, 0);
    }, [installed.data]);

    const availablePacks = useMemo(() => {
        if (!manifest.data) return [];
        return manifest.data.packs.filter((p) => !installedIds.has(p.id));
    }, [manifest.data, installedIds]);

    const installedPacks = useMemo(() => {
        if (!manifest.data) return [];
        return manifest.data.packs.filter((p) => installedIds.has(p.id));
    }, [manifest.data, installedIds]);

    const handleDownload = useCallback(
        (pack: PackMeta) => {
            download.mutate(pack);
        },
        [download],
    );

    const handleRemove = useCallback(
        (packId: string) => {
            remove.mutate(packId);
        },
        [remove],
    );

    return (
        <SheetScrollView contentContainerStyle={styles.container}>
            {/* ── Storage summary ── */}
            {installed.data && installed.data.length > 0 ? (
                <View style={styles.storageSummary}>
                    <Text style={styles.storageLabel}>
                        Total offline storage
                    </Text>
                    <Text style={styles.storageValue}>
                        {formatBytes(totalBytes)}
                    </Text>
                </View>
            ) : null}

            {/* ── Available packs ── */}
            <SectionHeader title="Available" />

            {manifest.isLoading ? (
                <View style={styles.loadingRow}>
                    <ActivityIndicator color={colors.tint} size="small" />
                    <Text style={styles.loadingText}>
                        Loading pack catalog…
                    </Text>
                </View>
            ) : manifest.isError ? (
                <Text style={styles.errorText}>
                    Could not load pack catalog. Check your connection.
                </Text>
            ) : availablePacks.length === 0 ? (
                <Text style={styles.emptyText}>
                    {installed.data && installed.data.length > 0
                        ? "All available packs are installed."
                        : "No packs available."}
                </Text>
            ) : (
                availablePacks.map((pack) => {
                    const isDownloading =
                        download.isPending &&
                        download.variables?.id === pack.id;
                    return (
                        <SheetListRow
                            key={pack.id}
                            accessibilityLabel={`Download ${pack.label}`}
                            description={`${pack.totalCount.toLocaleString()} POIs · ${formatBytes(pack.bytes)} · generated ${formatDate(manifest.data!.generatedAt)}`}
                            onPress={() => {
                                if (!isDownloading) handleDownload(pack);
                            }}
                            title={pack.label}
                            trailing={
                                isDownloading ? (
                                    <ActivityIndicator
                                        color={colors.tint}
                                        size="small"
                                    />
                                ) : undefined
                            }
                        />
                    );
                })
            )}

            {/* ── Installed packs ── */}
            {installedPacks.length > 0 && (
                <>
                    <SectionHeader title="Installed" />
                    {installedPacks.map((pack) => {
                        const isRemoving =
                            remove.isPending && remove.variables === pack.id;
                        const installEntry = (installed.data ?? []).find(
                            (p) => p.id === pack.id,
                        );
                        return (
                            <SheetListRow
                                key={pack.id}
                                accessibilityLabel={`Remove ${pack.label}`}
                                description={`${pack.totalCount.toLocaleString()} POIs · ${formatBytes(pack.bytes)}${installEntry ? ` · built ${formatDate(installEntry.generatedAt)}` : ""}`}
                                destructive
                                onPress={() => {
                                    if (!isRemoving) handleRemove(pack.id);
                                }}
                                title={pack.label}
                                trailing={
                                    isRemoving ? (
                                        <ActivityIndicator
                                            color="#b42318"
                                            size="small"
                                        />
                                    ) : undefined
                                }
                            />
                        );
                    })}
                </>
            )}

            {/* ── Errors ── */}
            {download.isError ? (
                <Text style={styles.errorText}>
                    Download failed:{" "}
                    {download.error instanceof Error
                        ? download.error.message
                        : "Unknown error"}
                </Text>
            ) : null}

            {remove.isError ? (
                <Text style={styles.errorText}>
                    Remove failed:{" "}
                    {remove.error instanceof Error
                        ? remove.error.message
                        : "Unknown error"}
                </Text>
            ) : null}
        </SheetScrollView>
    );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        gap: 8,
        paddingBottom: 40,
        paddingHorizontal: 20,
    },
    emptyText: {
        color: colors.muted,
        fontSize: 14,
        lineHeight: 20,
    },
    errorText: {
        color: "#b42318",
        fontSize: 14,
        lineHeight: 20,
    },
    loadingRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 10,
    },
    loadingText: {
        color: colors.muted,
        fontSize: 14,
    },
    sectionHeader: {
        color: colors.muted,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.5,
        marginBottom: 4,
        marginTop: 16,
        textTransform: "uppercase",
    },
    storageLabel: {
        color: colors.muted,
        fontSize: 13,
    },
    storageSummary: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderRadius: 10,
        gap: 4,
        paddingVertical: 14,
    },
    storageValue: {
        color: colors.ink,
        fontSize: 22,
        fontWeight: "700",
    },
});
