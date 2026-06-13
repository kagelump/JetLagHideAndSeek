import { useCallback, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";

import { SheetListRow } from "@/components/SheetListRow";
import { SheetScrollView } from "@/features/sheet/SheetScrollView";
import { colors } from "@/theme/colors";
import { usePackCatalog, type CatalogPack } from "./packCatalog";
import {
    formatBytes,
    useInstallPack,
    useInstalledPacks,
    useRemovePack,
    useRetryPack,
} from "./regionPacks";
import type { InstalledPack, InstallProgress } from "./regionPacks";

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

// ─── Pack row helpers ─────────────────────────────────────────────────────

type PackState =
    | "not-installed"
    | "downloading"
    | "installed"
    | "incomplete"
    | "update-available";

function getPackState(
    pack: CatalogPack,
    installed: InstalledPack | undefined,
): PackState {
    if (!installed) return "not-installed";

    const allInstalled = installed.artifacts.every(
        (a) => a.status === "installed",
    );
    if (!allInstalled) return "incomplete";

    if (installed.osmSnapshot !== pack.osmSnapshot) return "update-available";

    return "installed";
}

function getStateDescription(
    state: PackState,
    installed: InstalledPack | undefined,
    progress?: InstallProgress,
): string {
    switch (state) {
        case "not-installed":
            return "Tap to download";
        case "downloading":
            if (progress) {
                return `Downloading … ${progress.done}/${progress.total} (${progress.currentKind})`;
            }
            return "Downloading …";
        case "installed":
            return installed?.installedAt
                ? `Installed ${formatDate(installed.installedAt)} · snapshot ${installed.osmSnapshot}`
                : "Installed";
        case "incomplete":
            return "Incomplete — tap to retry";
        case "update-available":
            return `Update available · installed ${installed?.osmSnapshot} → ${installed?.osmSnapshot}`;
    }
}

// ─── Screen ────────────────────────────────────────────────────────────────

export function OfflineDataScreen() {
    const catalog = usePackCatalog();
    const installed = useInstalledPacks();
    const installMutation = useInstallPack();
    const retryMutation = useRetryPack();
    const removeMutation = useRemovePack();

    const [installProgress, setInstallProgress] = useState<
        Record<string, InstallProgress>
    >({});

    const installedMap = useMemo(() => {
        const map = new Map<string, InstalledPack>();
        for (const pack of installed.data ?? []) {
            map.set(pack.id, pack);
        }
        return map;
    }, [installed.data]);

    // Group packs by continent (regionPath[0]).
    const sections = useMemo(() => {
        const grouped = new Map<string, CatalogPack[]>();
        for (const pack of catalog.data?.packs ?? []) {
            const continent = pack.regionPath[0] ?? "Other";
            const existing = grouped.get(continent) ?? [];
            existing.push(pack);
            grouped.set(continent, existing);
        }
        return grouped;
    }, [catalog.data]);

    const totalInstalledBytes = useMemo(() => {
        return (installed.data ?? []).reduce((sum, p) => {
            return (
                sum +
                p.artifacts
                    .filter((a) => a.status === "installed")
                    .reduce((s, a) => s + a.bytes, 0)
            );
        }, 0);
    }, [installed.data]);

    const handleInstall = useCallback(
        (pack: CatalogPack) => {
            installMutation.mutate({
                pack,
                onProgress: (p) => {
                    setInstallProgress((prev) => ({
                        ...prev,
                        [pack.id]: p,
                    }));
                },
            });
        },
        [installMutation],
    );

    const handleRetry = useCallback(
        (pack: CatalogPack) => {
            retryMutation.mutate({
                pack,
                onProgress: (p) => {
                    setInstallProgress((prev) => ({
                        ...prev,
                        [pack.id]: p,
                    }));
                },
            });
        },
        [retryMutation],
    );

    const handleRemove = useCallback(
        (packId: string) => {
            Alert.alert(
                "Remove Pack",
                "Remove this offline pack? Installed data will be deleted.",
                [
                    { text: "Cancel", style: "cancel" },
                    {
                        text: "Remove",
                        style: "destructive",
                        onPress: () => removeMutation.mutate(packId),
                    },
                ],
            );
        },
        [removeMutation],
    );

    const handleSwipeRemove = useCallback(
        (packId: string) => {
            removeMutation.mutate(packId);
        },
        [removeMutation],
    );

    const isDownloading = (packId: string) =>
        (installMutation.isPending &&
            (installMutation.variables as { pack: { id: string } } | undefined)
                ?.pack?.id === packId) ||
        (retryMutation.isPending &&
            (retryMutation.variables as { pack: { id: string } } | undefined)
                ?.pack?.id === packId);

    const isRemoving = (packId: string) =>
        removeMutation.isPending && removeMutation.variables === packId;

    return (
        <SheetScrollView contentContainerStyle={styles.container}>
            {/* ── Storage summary ── */}
            {installed.data && installed.data.length > 0 ? (
                <View style={styles.storageSummary}>
                    <Text style={styles.storageLabel}>
                        Total offline storage
                    </Text>
                    <Text style={styles.storageValue}>
                        {formatBytes(totalInstalledBytes)}
                    </Text>
                </View>
            ) : null}

            {/* ── Stale catalog banner ── */}
            {catalog.isError && installed.data && installed.data.length > 0 ? (
                <View style={styles.staleBanner}>
                    <Text style={styles.staleBannerText}>
                        Could not check for updates. Installed packs still work.
                    </Text>
                </View>
            ) : null}

            {/* ── Loading state ── */}
            {catalog.isLoading ? (
                <View style={styles.loadingRow}>
                    <ActivityIndicator color={colors.tint} size="small" />
                    <Text style={styles.loadingText}>
                        Loading pack catalog…
                    </Text>
                </View>
            ) : null}

            {/* ── Catalog fetch error (no installed packs) ── */}
            {catalog.isError &&
            (!installed.data || installed.data.length === 0) ? (
                <Text style={styles.errorText}>
                    Could not load pack catalog. Check your connection.
                </Text>
            ) : null}

            {/* ── Sectioned pack list ── */}
            {catalog.isSuccess
                ? Array.from(sections.entries()).map(
                      ([continent, packs]) =>
                          packs.length > 0 && (
                              <View key={continent}>
                                  <SectionHeader title={continent} />
                                  {packs.map((pack) => {
                                      const installedEntry = installedMap.get(
                                          pack.id,
                                      );
                                      const state = getPackState(
                                          pack,
                                          installedEntry,
                                      );
                                      const downloading = isDownloading(
                                          pack.id,
                                      );
                                      const removing = isRemoving(pack.id);
                                      const progress = installProgress[pack.id];

                                      const isSwipeable =
                                          state === "installed" ||
                                          state === "incomplete" ||
                                          state === "update-available";

                                      const row = (
                                          <SheetListRow
                                              key={pack.id}
                                              accessibilityLabel={`${pack.label} — ${getStateDescription(state, installedEntry, progress)}`}
                                              description={`${formatBytes(pack.totalBytes)} · ${getStateDescription(state, installedEntry, downloading ? progress : undefined)}`}
                                              destructive={
                                                  state === "installed" ||
                                                  state === "incomplete"
                                              }
                                              onPress={() => {
                                                  if (downloading || removing)
                                                      return;

                                                  switch (state) {
                                                      case "not-installed":
                                                          handleInstall(pack);
                                                          break;
                                                      case "incomplete":
                                                          handleRetry(pack);
                                                          break;
                                                      case "installed":
                                                      case "update-available":
                                                          handleRemove(pack.id);
                                                          break;
                                                  }
                                              }}
                                              testID={`offline-pack-row-${pack.id}`}
                                              title={pack.label}
                                              trailing={
                                                  downloading ? (
                                                      <ActivityIndicator
                                                          color={colors.tint}
                                                          size="small"
                                                      />
                                                  ) : removing ? (
                                                      <ActivityIndicator
                                                          color="#b42318"
                                                          size="small"
                                                      />
                                                  ) : undefined
                                              }
                                          />
                                      );

                                      if (isSwipeable) {
                                          return (
                                              <Swipeable
                                                  key={pack.id}
                                                  overshootRight={false}
                                                  renderRightActions={() => (
                                                      <View
                                                          style={
                                                              styles.deleteActionWrapper
                                                          }
                                                      >
                                                          <Pressable
                                                              accessibilityLabel={`Delete ${pack.label}`}
                                                              accessibilityRole="button"
                                                              onPress={() =>
                                                                  handleSwipeRemove(
                                                                      pack.id,
                                                                  )
                                                              }
                                                              style={({
                                                                  pressed,
                                                              }) => [
                                                                  styles.deleteAction,
                                                                  pressed
                                                                      ? styles.actionPressed
                                                                      : null,
                                                              ]}
                                                          >
                                                              <Text
                                                                  style={
                                                                      styles.deleteActionText
                                                                  }
                                                              >
                                                                  Delete
                                                              </Text>
                                                          </Pressable>
                                                      </View>
                                                  )}
                                              >
                                                  {row}
                                              </Swipeable>
                                          );
                                      }

                                      return row;
                                  })}
                              </View>
                          ),
                  )
                : null}

            {/* ── No packs available ── */}
            {catalog.isSuccess && sections.size === 0 ? (
                <Text style={styles.emptyText}>No packs available.</Text>
            ) : null}

            {/* ── Errors from mutations ── */}
            {installMutation.isError ? (
                <Text style={styles.errorText}>
                    Download failed:{" "}
                    {installMutation.error instanceof Error
                        ? installMutation.error.message
                        : "Unknown error"}
                </Text>
            ) : null}

            {removeMutation.isError ? (
                <Text style={styles.errorText}>
                    Remove failed:{" "}
                    {removeMutation.error instanceof Error
                        ? removeMutation.error.message
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
    staleBanner: {
        backgroundColor: "#fef3c7",
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    staleBannerText: {
        color: "#92400e",
        fontSize: 13,
        lineHeight: 18,
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
    actionPressed: {
        opacity: 0.72,
    },
    deleteAction: {
        alignItems: "center",
        backgroundColor: "#d92d20",
        justifyContent: "center",
        minHeight: 58,
        paddingHorizontal: 20,
    },
    deleteActionText: {
        color: colors.white,
        fontSize: 15,
        fontWeight: "800",
    },
    deleteActionWrapper: {
        borderRadius: 8,
        marginLeft: 8,
        overflow: "hidden",
    },
});
