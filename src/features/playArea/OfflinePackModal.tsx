import {
    ActivityIndicator,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";

import type { CoverageStatus } from "@/features/offline/coverage";
import { formatBytes } from "@/features/offline/regionPacks";
import type { InstallProgress } from "@/features/offline/regionPacks";
import { colors } from "@/theme/colors";

type OfflinePackModalProps = {
    visible: boolean;
    coverage: CoverageStatus | null;
    onInstall: () => void;
    onDismiss: () => void;
    /** Only needed for "available" state. */
    progress: InstallProgress | null;
    isInstalling: boolean;
    installError: string | null;
};

export function OfflinePackModal({
    visible,
    coverage,
    onInstall,
    onDismiss,
    progress,
    isInstalling,
    installError,
}: OfflinePackModalProps) {
    const state = coverage?.state ?? null;
    const isActionable = state === "available" || state === "partial";

    // Derive display strings from coverage.
    const packLabel =
        coverage?.state === "available"
            ? coverage.label
            : coverage?.state === "partial"
              ? coverage.packId
              : "";
    const totalBytes =
        coverage?.state === "available" ? coverage.totalBytes : 0;
    const missingKinds =
        coverage?.state === "partial" ? coverage.missingKinds : [];

    const body = (() => {
        if (installError) {
            return (
                <View style={styles.body}>
                    <Text style={styles.errorText}>{installError}</Text>
                    <Pressable
                        accessibilityLabel="Retry download"
                        accessibilityRole="button"
                        onPress={onInstall}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            pressed ? styles.actionPressed : null,
                        ]}
                    >
                        <Text style={styles.primaryButtonText}>Retry</Text>
                    </Pressable>
                </View>
            );
        }

        if (isInstalling) {
            return (
                <View style={styles.body}>
                    <View style={styles.progressRow}>
                        <ActivityIndicator color={colors.tint} size="small" />
                        {progress ? (
                            <Text style={styles.progressText}>
                                Downloading… {progress.done}/{progress.total} (
                                {progress.currentKind})
                            </Text>
                        ) : (
                            <Text style={styles.progressText}>
                                Downloading…
                            </Text>
                        )}
                    </View>
                </View>
            );
        }

        if (state === "available") {
            return (
                <View style={styles.body}>
                    <Text style={styles.message}>
                        Download game data for{" "}
                        <Text style={styles.bold}>{packLabel}</Text> now?
                    </Text>
                    <Pressable
                        accessibilityLabel={`Download ${packLabel} offline pack`}
                        accessibilityRole="button"
                        onPress={onInstall}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            pressed ? styles.actionPressed : null,
                        ]}
                    >
                        <Text style={styles.primaryButtonText}>
                            Download ({formatBytes(totalBytes)})
                        </Text>
                    </Pressable>
                </View>
            );
        }

        if (state === "partial") {
            return (
                <View style={styles.body}>
                    <Text style={styles.message}>
                        <Text style={styles.bold}>{packLabel}</Text> is missing{" "}
                        {missingKinds.join(", ")}. Download remaining data?
                    </Text>
                    <Pressable
                        accessibilityLabel={`Download missing data for ${packLabel}`}
                        accessibilityRole="button"
                        onPress={onInstall}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            pressed ? styles.actionPressed : null,
                        ]}
                    >
                        <Text style={styles.primaryButtonText}>
                            Download remaining
                        </Text>
                    </Pressable>
                </View>
            );
        }

        return null;
    })();

    if (!isActionable && !isInstalling && !installError) return null;

    return (
        <Modal
            animationType="slide"
            onRequestClose={onDismiss}
            transparent
            visible={visible}
        >
            <View style={styles.backdrop}>
                <View style={styles.container}>
                    <View style={styles.header}>
                        <Text style={styles.headerTitle}>
                            Download game data
                        </Text>
                        <Pressable
                            accessibilityLabel="Not now"
                            accessibilityRole="button"
                            hitSlop={12}
                            onPress={onDismiss}
                            style={({ pressed }) => [
                                styles.closeButton,
                                pressed ? styles.actionPressed : null,
                            ]}
                            testID="offline-pack-modal-dismiss"
                        >
                            <Text style={styles.closeButtonText}>
                                {isInstalling ? "Hide" : "Not now"}
                            </Text>
                        </Pressable>
                    </View>
                    {body}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    actionPressed: {
        opacity: 0.72,
    },
    backdrop: {
        backgroundColor: "rgba(0,0,0,0.4)",
        flex: 1,
        justifyContent: "flex-end",
    },
    bold: {
        fontWeight: "800",
    },
    body: {
        gap: 16,
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    closeButton: {
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    closeButtonText: {
        color: colors.tint,
        fontSize: 16,
        fontWeight: "700",
    },
    container: {
        backgroundColor: colors.background,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingBottom: 40,
    },
    errorText: {
        color: "#b42318",
        fontSize: 14,
        lineHeight: 20,
    },
    header: {
        alignItems: "center",
        borderBottomColor: colors.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    headerTitle: {
        color: colors.ink,
        fontSize: 18,
        fontWeight: "800",
    },
    message: {
        color: colors.ink,
        fontSize: 15,
        lineHeight: 22,
    },
    primaryButton: {
        alignItems: "center",
        backgroundColor: colors.button,
        borderRadius: 8,
        justifyContent: "center",
        minHeight: 48,
        paddingHorizontal: 16,
    },
    primaryButtonText: {
        color: colors.white,
        fontSize: 15,
        fontWeight: "800",
    },
    progressRow: {
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
    },
    progressText: {
        color: colors.muted,
        fontSize: 14,
    },
});
