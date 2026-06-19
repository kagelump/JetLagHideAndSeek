import { useCallback, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Linking,
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
    artifactLabel,
    buildBugReportUrl,
    findBundleError,
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

/** Date + time — used to show when the loaded catalog was generated. */
function formatDateTime(iso: string): string {
    try {
        return new Date(iso).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return iso;
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
    | "bundle-error"
    | "update-available";

function getPackState(
    pack: CatalogPack,
    installed: InstalledPack | undefined,
): PackState {
    if (!installed) return "not-installed";

    // An unrecoverable artifact (bad blob/catalog) takes priority over a plain
    // incomplete: Retry can never fix it, so the row must offer "report" not
    // "retry".
    if (findBundleError(installed)) return "bundle-error";

    const allInstalled = installed.artifacts.every(
        (a) => a.status === "installed",
    );
    if (!allInstalled) return "incomplete";

    if (installed.osmSnapshot !== pack.osmSnapshot) return "update-available";

    return "installed";
}

function getStateDescription(
    state: PackState,
    pack: CatalogPack,
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
        case "bundle-error":
            return "Bundle error — tap to retry, or report below";
        case "update-available":
            return `Update available · installed ${installed?.osmSnapshot} → ${pack.osmSnapshot}`;
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
            {/* ── Catalog refresh ── */}
            <View style={styles.refreshRow}>
                <View style={styles.refreshMeta}>
                    <Text style={styles.refreshLabel}>Pack catalog</Text>
                    <Text style={styles.refreshSub}>
                        {catalog.data?.generatedAt
                            ? `Updated ${formatDateTime(catalog.data.generatedAt)}`
                            : catalog.isError
                              ? "Could not load — tap Refresh"
                              : "Loading…"}
                    </Text>
                </View>
                <Pressable
                    accessibilityLabel="Refresh pack catalog"
                    accessibilityRole="button"
                    disabled={catalog.isFetching}
                    onPress={() => {
                        void catalog.refetch();
                    }}
                    style={({ pressed }) => [
                        styles.refreshButton,
                        pressed ? styles.actionPressed : null,
                    ]}
                    testID="offline-refresh-catalog"
                >
                    {catalog.isFetching ? (
                        <ActivityIndicator color={colors.tint} size="small" />
                    ) : (
                        <Text style={styles.refreshButtonText}>Refresh</Text>
                    )}
                </Pressable>
            </View>

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
                                      const bundleError =
                                          findBundleError(installedEntry);

                                      const isSwipeable =
                                          state === "installed" ||
                                          state === "incomplete" ||
                                          state === "bundle-error" ||
                                          state === "update-available";

                                      const row = (
                                          <SheetListRow
                                              key={pack.id}
                                              accessibilityLabel={`${pack.label} — ${getStateDescription(state, pack, installedEntry, progress)}`}
                                              description={`${formatBytes(pack.totalBytes)} · ${getStateDescription(state, pack, installedEntry, downloading ? progress : undefined)}`}
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
                                                      case "bundle-error":
                                                          // Still retryable: a
                                                          // republished fix can
                                                          // only be picked up by
                                                          // re-downloading. If it
                                                          // re-fails, the banner's
                                                          // report button remains.
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
                                                          color={colors.danger}
                                                          size="small"
                                                      />
                                                  ) : undefined
                                              }
                                          />
                                      );

                                      const content = isSwipeable ? (
                                          <Swipeable
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
                                      ) : (
                                          row
                                      );

                                      if (
                                          state === "bundle-error" &&
                                          installedEntry &&
                                          bundleError
                                      ) {
                                          return (
                                              <View key={pack.id}>
                                                  {content}
                                                  <View
                                                      style={
                                                          styles.bundleErrorBanner
                                                      }
                                                      testID={`offline-pack-bundle-error-${pack.id}`}
                                                  >
                                                      <Text
                                                          style={
                                                              styles.bundleErrorTitle
                                                          }
                                                      >
                                                          Bundle error detected
                                                      </Text>
                                                      <Text
                                                          style={
                                                              styles.bundleErrorBody
                                                          }
                                                      >
                                                          {`${artifactLabel(bundleError)} is corrupt or mismatched and re-downloading won't fix it. This is a data bug — please report it.`}
                                                      </Text>
                                                      {bundleError.error ? (
                                                          <Text
                                                              style={
                                                                  styles.bundleErrorDetail
                                                              }
                                                          >
                                                              {
                                                                  bundleError.error
                                                              }
                                                          </Text>
                                                      ) : null}
                                                      <Pressable
                                                          accessibilityLabel={`Report bundle error for ${pack.label}`}
                                                          accessibilityRole="button"
                                                          onPress={() =>
                                                              void Linking.openURL(
                                                                  buildBugReportUrl(
                                                                      installedEntry,
                                                                      bundleError,
                                                                  ),
                                                              )
                                                          }
                                                          style={({
                                                              pressed,
                                                          }) => [
                                                              styles.reportButton,
                                                              pressed
                                                                  ? styles.actionPressed
                                                                  : null,
                                                          ]}
                                                      >
                                                          <Text
                                                              style={
                                                                  styles.reportButtonText
                                                              }
                                                          >
                                                              Report a bug
                                                          </Text>
                                                      </Pressable>
                                                  </View>
                                              </View>
                                          );
                                      }

                                      return (
                                          <View key={pack.id}>{content}</View>
                                      );
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
        color: colors.error,
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
    refreshRow: {
        alignItems: "center",
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 4,
    },
    refreshMeta: {
        flexShrink: 1,
        gap: 2,
    },
    refreshLabel: {
        color: colors.ink,
        fontSize: 15,
        fontWeight: "600",
    },
    refreshSub: {
        color: colors.muted,
        fontSize: 12,
    },
    refreshButton: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderRadius: 8,
        justifyContent: "center",
        minWidth: 84,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    refreshButtonText: {
        color: colors.tint,
        fontSize: 14,
        fontWeight: "600",
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
    bundleErrorBanner: {
        backgroundColor: "#fee4e2",
        borderRadius: 8,
        gap: 6,
        marginTop: 4,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    bundleErrorTitle: {
        color: "#912018",
        fontSize: 13,
        fontWeight: "700",
    },
    bundleErrorBody: {
        color: "#912018",
        fontSize: 13,
        lineHeight: 18,
    },
    bundleErrorDetail: {
        color: "#b42318",
        fontSize: 12,
        fontStyle: "italic",
        lineHeight: 16,
    },
    reportButton: {
        alignItems: "center",
        alignSelf: "flex-start",
        backgroundColor: "#b42318",
        borderRadius: 6,
        paddingHorizontal: 14,
        paddingVertical: 7,
    },
    reportButtonText: {
        color: colors.white,
        fontSize: 13,
        fontWeight: "700",
    },
});
