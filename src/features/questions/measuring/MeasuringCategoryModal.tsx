import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { colors } from "@/theme/colors";
import {
    measuringCategoriesBySection,
    type MeasuringCategorySection,
} from "./measuringCategories";
import type { MeasuringCategory } from "./measuringTypes";

type MeasuringCategoryModalProps = {
    visible: boolean;
    selectedCategory: MeasuringCategory;
    onSelect: (category: MeasuringCategory) => void;
    onClose: () => void;
};

export function MeasuringCategoryModal({
    visible,
    selectedCategory,
    onSelect,
    onClose,
}: MeasuringCategoryModalProps) {
    return (
        <Modal
            animationType="slide"
            onRequestClose={onClose}
            transparent
            visible={visible}
        >
            <View style={styles.backdrop}>
                <View style={styles.container}>
                    <View style={styles.header}>
                        <Text style={styles.headerTitle}>Choose Category</Text>
                        <Pressable
                            accessibilityLabel="Close category picker"
                            accessibilityRole="button"
                            hitSlop={12}
                            onPress={onClose}
                            style={({ pressed }) => [
                                styles.closeButton,
                                pressed ? styles.actionPressed : null,
                            ]}
                            testID="measuring-category-modal-close"
                        >
                            <Text style={styles.closeButtonText}>Done</Text>
                        </Pressable>
                    </View>

                    <ScrollView
                        contentContainerStyle={styles.scrollContent}
                        keyboardShouldPersistTaps="handled"
                    >
                        {(
                            Object.entries(measuringCategoriesBySection) as [
                                MeasuringCategorySection,
                                (typeof measuringCategoriesBySection)[MeasuringCategorySection],
                            ][]
                        ).map(([section, configs]) => {
                            const implemented = configs.filter(
                                (
                                    c,
                                ): c is (typeof configs)[number] & {
                                    implemented: true;
                                } => c.implemented,
                            );
                            if (implemented.length === 0) return null;
                            return (
                                <View key={section} style={styles.section}>
                                    <Text style={styles.sectionLabel}>
                                        {section}
                                    </Text>
                                    {implemented.map((config) => {
                                        const isSelected =
                                            selectedCategory ===
                                            config.category;
                                        return (
                                            <Pressable
                                                accessibilityLabel={`${config.title} measuring category`}
                                                accessibilityRole="button"
                                                accessibilityState={{
                                                    selected: isSelected,
                                                }}
                                                key={config.category}
                                                onPress={() => {
                                                    onSelect(config.category);
                                                    onClose();
                                                }}
                                                style={[
                                                    styles.row,
                                                    isSelected
                                                        ? styles.rowSelected
                                                        : null,
                                                ]}
                                                testID={`measuring-category-modal-${config.category}`}
                                            >
                                                <View
                                                    style={[
                                                        styles.radio,
                                                        isSelected
                                                            ? styles.radioSelected
                                                            : null,
                                                    ]}
                                                />
                                                <Text style={styles.rowTitle}>
                                                    {config.title}
                                                </Text>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            );
                        })}
                    </ScrollView>
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
        maxHeight: "80%",
        paddingBottom: 40,
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
    radio: {
        borderColor: colors.muted,
        borderRadius: 10,
        borderWidth: 2,
        height: 20,
        marginRight: 10,
        width: 20,
    },
    radioSelected: {
        backgroundColor: colors.tint,
        borderColor: colors.tint,
        borderWidth: 6,
    },
    row: {
        alignItems: "center",
        flexDirection: "row",
        minHeight: 48,
        paddingHorizontal: 20,
        paddingVertical: 10,
    },
    rowSelected: {
        backgroundColor: colors.buttonSubtle,
    },
    rowTitle: {
        color: colors.ink,
        fontSize: 16,
        fontWeight: "600",
    },
    scrollContent: {
        paddingBottom: 20,
        paddingTop: 8,
    },
    section: {
        borderColor: colors.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingBottom: 4,
        paddingTop: 6,
    },
    sectionLabel: {
        color: colors.muted,
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 0.4,
        marginBottom: 2,
        paddingHorizontal: 20,
        textTransform: "uppercase",
    },
});
