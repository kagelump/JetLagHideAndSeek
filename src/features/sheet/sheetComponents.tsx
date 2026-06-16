import { type ReactNode, useCallback } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, {
    type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import { SlideUpModal } from "@/components/SlideUpModal";
import {
    QuestionActionsMenu,
    QuestionDetailScreen,
} from "@/features/questions/QuestionDetailScreen";
import { getQuestionDefinition } from "@/features/questions/questionRegistry";
import type { SheetRouteName } from "@/features/sheet/sheetRoutes";
import { useQuestionDerived } from "@/state/questionStore";
import { colors } from "@/theme/colors";

// ─── ChildSheetShell ──────────────────────────────────────────────────────────

function ChildSheetShell({
    accessory,
    children,
    footer,
    onBack,
    title,
}: {
    accessory?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    onBack: () => void;
    title?: string;
}) {
    return (
        <View style={styles.fullContainer}>
            <View style={styles.childHeader}>
                <BackButton onPress={onBack} />
                {title ? (
                    <Text
                        numberOfLines={1}
                        pointerEvents="none"
                        style={styles.childHeaderTitle}
                    >
                        {title}
                    </Text>
                ) : null}
                <View style={styles.childHeaderSpacer} />
                {accessory ? (
                    <View style={styles.childHeaderAccessory}>{accessory}</View>
                ) : null}
            </View>
            <View style={styles.childBody}>{children}</View>
            {footer ? <View style={styles.childFooter}>{footer}</View> : null}
        </View>
    );
}

// ─── QuestionDetailShell ──────────────────────────────────────────────────────

function QuestionDetailShell({
    onBack,
    onNavigate,
}: {
    onBack: () => void;
    onNavigate: (route: SheetRouteName) => void;
}) {
    const { activeQuestion } = useQuestionDerived();
    const title = activeQuestion
        ? (() => {
              const def = getQuestionDefinition(activeQuestion.type);
              return def.title(activeQuestion);
          })()
        : undefined;

    return (
        <ChildSheetShell
            accessory={<QuestionActionsMenu onNavigate={onNavigate} />}
            onBack={onBack}
            title={title}
        >
            <QuestionDetailScreen />
        </ChildSheetShell>
    );
}

// ─── BackButton ───────────────────────────────────────────────────────────────

function BackButton({ onPress }: { onPress: () => void }) {
    return (
        <Pressable
            accessible
            accessibilityLabel="Back"
            accessibilityRole="button"
            onPress={onPress}
            style={styles.backButton}
        >
            <Text style={styles.backText}>Back</Text>
        </Pressable>
    );
}

// ─── DrawerAction ─────────────────────────────────────────────────────────────

type DrawerActionProps = {
    description: string;
    isActive: boolean;
    onPress: () => void;
    testID: string;
    title: string;
};

function DrawerAction({
    description,
    isActive,
    onPress,
    testID,
    title,
}: DrawerActionProps) {
    return (
        <Pressable
            accessible
            accessibilityLabel={title}
            accessibilityRole="button"
            onPress={onPress}
            style={({ pressed }) => [
                styles.action,
                isActive ? styles.actionActive : null,
                pressed ? styles.actionPressed : null,
            ]}
            testID={testID}
        >
            <View style={styles.actionCopy}>
                <Text style={styles.actionTitle} accessibilityLabel={title}>
                    {title}
                </Text>
                {description ? (
                    <Text
                        style={styles.actionDescription}
                        accessibilityLabel={description}
                    >
                        {description}
                    </Text>
                ) : null}
            </View>
            <Text style={styles.chevron}>›</Text>
        </Pressable>
    );
}

// ─── SeekTimeModal ────────────────────────────────────────────────────────────

type SeekTimeModalProps = {
    draft: Date;
    onCancel: () => void;
    onChange: (d: Date) => void;
    onSet: () => void;
};

function SeekTimeModal({
    draft,
    onCancel,
    onChange,
    onSet,
}: SeekTimeModalProps) {
    const handleChange = useCallback(
        (_event: DateTimePickerEvent, date?: Date) => {
            if (date) onChange(date);
        },
        [onChange],
    );

    const pickerMode =
        Platform.OS === "ios" ? ("datetime" as const) : ("time" as const);

    return (
        <SlideUpModal onClose={onCancel} scrimColor="rgba(0,0,0,0.4)" visible>
            <Pressable style={styles.modalContainer}>
                <View style={styles.modalHeader}>
                    <Pressable
                        accessibilityLabel="Cancel"
                        accessibilityRole="button"
                        hitSlop={12}
                        onPress={onCancel}
                        style={styles.modalCancelButton}
                    >
                        <Text style={styles.modalCancelText}>Cancel</Text>
                    </Pressable>
                    <Text style={styles.modalHeaderTitle}>
                        Seeking start time
                    </Text>
                    <Pressable
                        accessibilityLabel="Set time"
                        accessibilityRole="button"
                        hitSlop={12}
                        onPress={onSet}
                        style={styles.modalDoneButton}
                        testID="seek-time-modal-set"
                    >
                        <Text style={styles.modalDoneText}>Set</Text>
                    </Pressable>
                </View>
                <View style={styles.timePickerBody}>
                    <DateTimePicker
                        display={Platform.OS === "ios" ? "spinner" : "default"}
                        is24Hour
                        mode={pickerMode}
                        onChange={handleChange}
                        value={draft}
                    />
                </View>
                <View style={styles.nowRow}>
                    <Pressable
                        accessibilityLabel="Set to current date and time"
                        accessibilityRole="button"
                        onPress={() => onChange(new Date())}
                        style={({ pressed }) => [
                            styles.nowButton,
                            pressed ? styles.actionPressed : null,
                        ]}
                        testID="seek-time-modal-now"
                    >
                        <Text style={styles.nowButtonText}>Now</Text>
                    </Pressable>
                </View>
            </Pressable>
        </SlideUpModal>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    // ChildSheetShell
    fullContainer: {
        flex: 1,
    },
    childHeader: {
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
        minHeight: 44,
        paddingBottom: 4,
        paddingHorizontal: 20,
    },
    childHeaderTitle: {
        color: colors.ink,
        fontSize: 16,
        fontWeight: "700",
        left: 0,
        position: "absolute",
        right: 0,
        textAlign: "center",
    },
    childHeaderSpacer: {
        flex: 1,
    },
    childHeaderAccessory: {
        alignItems: "flex-end",
        minWidth: 94,
    },
    childBody: {
        flex: 1,
    },
    childFooter: {
        borderTopColor: colors.border,
        borderTopWidth: 1,
        paddingHorizontal: 20,
        paddingVertical: 12,
    },

    // BackButton
    backButton: {
        alignSelf: "flex-start",
        justifyContent: "center",
        minHeight: 44,
        minWidth: 72,
        paddingVertical: 4,
    },
    backText: {
        color: colors.tint,
        fontSize: 16,
        fontWeight: "700",
    },

    // DrawerAction
    action: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        gap: 12,
        justifyContent: "space-between",
        minHeight: 62,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    actionActive: {
        backgroundColor: colors.tealTintBg,
        borderColor: colors.tint,
    },
    actionPressed: {
        opacity: 0.72,
    },
    actionCopy: {
        flex: 1,
    },
    actionTitle: {
        color: colors.ink,
        fontSize: 17,
        fontWeight: "700",
    },
    actionDescription: {
        color: colors.muted,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 2,
    },
    chevron: {
        color: colors.muted,
        fontSize: 28,
        lineHeight: 28,
    },

    // SeekTimeModal
    modalCancelButton: {
        minWidth: 72,
    },
    modalCancelText: {
        color: colors.muted,
        fontSize: 16,
        fontWeight: "600",
    },
    modalContainer: {
        backgroundColor: colors.background,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingBottom: 40,
    },
    modalDoneButton: {
        alignItems: "flex-end",
        minWidth: 72,
    },
    modalDoneText: {
        color: colors.tint,
        fontSize: 16,
        fontWeight: "700",
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
    timePickerBody: {
        alignItems: "center",
        paddingHorizontal: 20,
        paddingVertical: 12,
    },
    nowRow: {
        alignItems: "center",
        paddingBottom: 16,
        paddingHorizontal: 20,
    },
    nowButton: {
        backgroundColor: colors.button,
        borderRadius: 8,
        paddingHorizontal: 24,
        paddingVertical: 10,
    },
    nowButtonText: {
        color: colors.white,
        fontSize: 15,
        fontWeight: "700",
    },
});

export {
    ChildSheetShell,
    QuestionDetailShell,
    BackButton,
    DrawerAction,
    SeekTimeModal,
};
