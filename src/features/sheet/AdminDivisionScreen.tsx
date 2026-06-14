import { useState } from "react";
import {
    Alert,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { SheetScrollView } from "@/features/sheet/SheetScrollView";
import {
    ADMIN_DIVISION_PRESETS,
    clonePack,
    type AdminDivisionNamePack,
    type AdminDivisionPresetName,
} from "@/features/questions/matching/adminDivisionConfig";
import {
    useAdminDivisionPack,
    useAdminDivisionPresetName,
    useQuestionActions,
} from "@/state/questionStore";
import { colors } from "@/theme/colors";

type EditingEntry = {
    index: number;
    field: "osmLevel" | "labelNative" | "labelEn";
};

export function AdminDivisionScreen() {
    const pack = useAdminDivisionPack();
    const presetName = useAdminDivisionPresetName();
    const { setAdminDivisionPack, setAdminDivisionPresetName } =
        useQuestionActions();
    const [editing, setEditing] = useState<EditingEntry | null>(null);
    const [editValue, setEditValue] = useState("");

    const selectPreset = (name: AdminDivisionPresetName) => {
        // Deep-clone so the preset's module-level const is never shared
        // with React state or mutated by accident.
        setAdminDivisionPack(clonePack(ADMIN_DIVISION_PRESETS[name]));
        setAdminDivisionPresetName(name);
        setEditing(null);
    };

    const startEdit = (index: number, field: EditingEntry["field"]) => {
        const entry = pack[index];
        setEditing({ index, field });
        setEditValue(entry[field]);
    };

    const commitEdit = () => {
        if (!editing) return;
        const trimmed = editValue.trim();
        if (!trimmed) {
            setEditing(null);
            return;
        }

        // Use functional updater so the edit is always applied to the
        // latest pack, not a stale render-time snapshot (fixes finding #3).
        const field = editing.field;
        const index = editing.index;
        setAdminDivisionPack(
            (prev) =>
                prev.map((entry, i) =>
                    i === index ? { ...entry, [field]: trimmed } : entry,
                ) as AdminDivisionNamePack,
        );
        // Any field edit makes the pack diverge from a stock preset, so
        // clear the preset name so exports don't assert a stale label source.
        setAdminDivisionPresetName("generic");
        setEditing(null);
    };

    const resetToDefaults = () => {
        Alert.alert(
            "Reset Admin Divisions",
            "Restore all entries to the default Generic preset?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Reset",
                    style: "destructive",
                    onPress: () => selectPreset("generic"),
                },
            ],
        );
    };

    const presetNames: AdminDivisionPresetName[] = ["generic", "japan"];

    return (
        <SheetScrollView contentContainerStyle={styles.scrollContent}>
            {/* Preset picker */}
            <View style={styles.section}>
                <Text style={styles.sectionHeading}>Preset</Text>
                <View style={styles.presetRow}>
                    {presetNames.map((name) => (
                        <Pressable
                            accessibilityLabel={`Use ${name} admin division preset`}
                            accessibilityRole="button"
                            key={name}
                            onPress={() => selectPreset(name)}
                            style={[
                                styles.presetChip,
                                presetName === name
                                    ? styles.presetChipActive
                                    : null,
                            ]}
                        >
                            <Text
                                style={[
                                    styles.presetChipText,
                                    presetName === name
                                        ? styles.presetChipTextActive
                                        : null,
                                ]}
                            >
                                {name === "generic" ? "Generic" : "Japan"}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </View>

            {/* 4 admin division entry rows */}
            <View style={styles.section}>
                <Text style={styles.sectionHeading}>Admin Division Levels</Text>
                {pack.map((entry, index) => (
                    <View key={index} style={styles.entryCard}>
                        <View style={styles.entryHeader}>
                            <Text style={styles.entryOrdinal}>
                                {ordinal(index + 1)} Admin. Division
                            </Text>
                        </View>

                        {/* OSM Level row */}
                        <EditableRow
                            editing={
                                editing?.index === index &&
                                editing?.field === "osmLevel"
                            }
                            label="OSM Level"
                            onPress={() => startEdit(index, "osmLevel")}
                            value={entry.osmLevel}
                        />

                        {/* Native label row */}
                        <EditableRow
                            editing={
                                editing?.index === index &&
                                editing?.field === "labelNative"
                            }
                            label="Native Label"
                            onPress={() => startEdit(index, "labelNative")}
                            value={entry.labelNative}
                        />

                        {/* English label row */}
                        <EditableRow
                            editing={
                                editing?.index === index &&
                                editing?.field === "labelEn"
                            }
                            label="English Label"
                            onPress={() => startEdit(index, "labelEn")}
                            value={entry.labelEn}
                        />
                    </View>
                ))}
            </View>

            {/* Inline editor */}
            {editing ? (
                <View style={styles.editor}>
                    <Text style={styles.editorLabel}>
                        Edit {editing.field}{" "}
                        {editing.field === "osmLevel"
                            ? "(empty string skips)"
                            : ""}
                    </Text>
                    <TextInput
                        autoFocus
                        keyboardType={
                            editing.field === "osmLevel"
                                ? "number-pad"
                                : "default"
                        }
                        onChangeText={setEditValue}
                        onSubmitEditing={commitEdit}
                        placeholder={
                            editing.field === "osmLevel"
                                ? "e.g. 4"
                                : editing.field === "labelNative"
                                  ? "e.g. 都道府県"
                                  : "e.g. Prefecture"
                        }
                        returnKeyType="done"
                        style={styles.editorInput}
                        value={editValue}
                    />
                    <View style={styles.editorButtons}>
                        <Pressable
                            accessibilityLabel="Cancel editing"
                            accessibilityRole="button"
                            onPress={() => setEditing(null)}
                            style={({ pressed }) => [
                                styles.editorSecondaryButton,
                                pressed ? styles.actionPressed : null,
                            ]}
                        >
                            <Text style={styles.editorSecondaryText}>
                                Cancel
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityLabel="Save edited value"
                            accessibilityRole="button"
                            onPress={commitEdit}
                            style={({ pressed }) => [
                                styles.editorPrimaryButton,
                                pressed ? styles.actionPressed : null,
                            ]}
                        >
                            <Text style={styles.editorPrimaryText}>Save</Text>
                        </Pressable>
                    </View>
                </View>
            ) : null}

            {/* Reset */}
            <View style={styles.section}>
                <Pressable
                    accessibilityLabel="Reset admin divisions to default"
                    accessibilityRole="button"
                    onPress={resetToDefaults}
                    style={({ pressed }) => [
                        styles.resetButton,
                        pressed ? styles.actionPressed : null,
                    ]}
                    testID="admin-divisions-reset-button"
                >
                    <Text style={styles.resetButtonText}>Reset to Default</Text>
                </Pressable>
            </View>
        </SheetScrollView>
    );
}

function EditableRow({
    editing,
    label,
    onPress,
    value,
}: {
    editing: boolean;
    label: string;
    onPress: () => void;
    value: string;
}) {
    return (
        <Pressable
            accessibilityLabel={`Edit ${label}`}
            accessibilityRole="button"
            onPress={onPress}
            style={({ pressed }) => [
                styles.editableRow,
                editing ? styles.editableRowActive : null,
                pressed ? styles.actionPressed : null,
            ]}
        >
            <Text style={styles.editableRowLabel}>{label}</Text>
            <Text
                style={[styles.editableRowValue, !value && styles.emptyValue]}
            >
                {value || "(empty)"}
            </Text>
        </Pressable>
    );
}

function ordinal(n: number): string {
    switch (n) {
        case 1:
            return "1st";
        case 2:
            return "2nd";
        case 3:
            return "3rd";
        default:
            return `${n}th`;
    }
}

const styles = StyleSheet.create({
    actionPressed: {
        opacity: 0.72,
    },
    editableRow: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 6,
        borderWidth: 1,
        flexDirection: "row",
        justifyContent: "space-between",
        marginTop: 6,
        minHeight: 44,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    editableRowActive: {
        borderColor: colors.tint,
    },
    editableRowLabel: {
        color: colors.muted,
        fontSize: 13,
        fontWeight: "600",
    },
    editableRowValue: {
        color: colors.ink,
        fontSize: 14,
        fontWeight: "700",
        maxWidth: "60%",
        textAlign: "right",
    },
    editor: {
        backgroundColor: colors.card,
        borderColor: colors.tint,
        borderRadius: 8,
        borderWidth: 1,
        marginTop: 12,
        padding: 12,
    },
    editorButtons: {
        flexDirection: "row",
        gap: 10,
        marginTop: 10,
    },
    editorInput: {
        backgroundColor: colors.buttonSubtle,
        borderColor: colors.border,
        borderRadius: 6,
        borderWidth: 1,
        color: colors.ink,
        fontSize: 16,
        fontWeight: "600",
        marginTop: 8,
        minHeight: 44,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    editorLabel: {
        color: colors.muted,
        fontSize: 12,
        fontWeight: "700",
    },
    editorPrimaryButton: {
        alignItems: "center",
        backgroundColor: colors.tint,
        borderRadius: 6,
        flex: 1,
        paddingVertical: 10,
    },
    editorPrimaryText: {
        color: colors.white,
        fontSize: 14,
        fontWeight: "800",
    },
    editorSecondaryButton: {
        alignItems: "center",
        backgroundColor: colors.buttonSubtle,
        borderRadius: 6,
        flex: 1,
        paddingVertical: 10,
    },
    editorSecondaryText: {
        color: colors.ink,
        fontSize: 14,
        fontWeight: "800",
    },
    emptyValue: {
        color: colors.muted,
        fontStyle: "italic",
    },
    entryCard: {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        marginTop: 10,
        padding: 12,
    },
    entryHeader: {
        marginBottom: 4,
    },
    entryOrdinal: {
        color: colors.ink,
        fontSize: 15,
        fontWeight: "800",
    },
    presetChip: {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flex: 1,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    presetChipActive: {
        backgroundColor: colors.tint,
        borderColor: colors.tint,
    },
    presetChipText: {
        color: colors.ink,
        fontSize: 14,
        fontWeight: "700",
        textAlign: "center",
    },
    presetChipTextActive: {
        color: colors.white,
    },
    presetRow: {
        flexDirection: "row",
        gap: 8,
        marginTop: 8,
    },
    resetButton: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        justifyContent: "center",
        minHeight: 48,
        paddingHorizontal: 16,
    },
    resetButtonText: {
        color: "#b42318",
        fontSize: 15,
        fontWeight: "800",
    },
    scrollContent: {
        paddingHorizontal: 20,
        paddingTop: 0,
    },
    section: {
        marginTop: 12,
    },
    sectionHeading: {
        color: colors.muted,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.5,
        marginBottom: 8,
        marginTop: 24,
        textTransform: "uppercase",
    },
});
