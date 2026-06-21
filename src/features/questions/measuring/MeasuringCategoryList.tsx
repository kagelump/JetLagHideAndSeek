import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "@/theme/colors";
import { useAdminDivisionPack, useLabelLanguage } from "@/state/questionStore";
import { isAdminBorderCategory } from "@/features/questions/matching/adminDivisionConfig";

import {
    buildAdminMeasuringBorderConfig,
    measuringCategoriesBySection,
    type MeasuringCategoryConfig,
} from "./measuringCategories";
import type { MeasuringCategory } from "./measuringTypes";

const sectionOrder = [
    "Transit",
    "Borders & Lines",
    "Natural",
    "Places of Interest",
    "Public Utilities",
] as const;

type MeasuringCategoryListProps = {
    /** When set, the matching row shows a checkmark (used by the in-detail
     *  change flow). Omit in the add flow (no pre-selection). */
    selectedCategory?: MeasuringCategory;
    onSelect: (category: MeasuringCategory) => void;
    /** Prefix for row testIDs; default "measuring-category". */
    testIDPrefix?: string;
};

function CategoryRow({
    config,
    selected,
    selectionActive,
    testIDPrefix,
    onSelect,
}: {
    config: MeasuringCategoryConfig;
    selected: boolean;
    selectionActive: boolean;
    testIDPrefix: string;
    onSelect: (category: MeasuringCategory) => void;
}) {
    const testID = `${testIDPrefix}-${config.category}`;

    return (
        <Pressable
            accessibilityLabel={`${config.title} measuring category`}
            accessibilityRole="button"
            {...(selectionActive ? { accessibilityState: { selected } } : {})}
            onPress={() => onSelect(config.category)}
            style={({ pressed }) => [
                styles.optionRow,
                selected ? styles.optionRowSelected : null,
                pressed ? styles.actionPressed : null,
            ]}
            testID={testID}
        >
            <View style={styles.optionCopy}>
                <Text style={styles.optionTitle}>{config.title}</Text>
            </View>
            {selected ? (
                <Text style={styles.checkmark}>✓</Text>
            ) : (
                <Text style={styles.chevron}>›</Text>
            )}
        </Pressable>
    );
}

export function MeasuringCategoryList({
    selectedCategory,
    onSelect,
    testIDPrefix = "measuring-category",
}: MeasuringCategoryListProps) {
    const adminPack = useAdminDivisionPack();
    const labelLanguage = useLabelLanguage();

    return (
        <View style={styles.container}>
            {sectionOrder.map((section) => {
                const baseCategories = measuringCategoriesBySection[section];
                if (!baseCategories || baseCategories.length === 0) return null;

                // Admin border rows derive their title/level from the shared
                // admin-division pack so they track the current region.
                const categories = baseCategories.map((config) =>
                    isAdminBorderCategory(config.category)
                        ? buildAdminMeasuringBorderConfig(
                              config.category,
                              adminPack,
                              labelLanguage,
                          )
                        : config,
                );

                return (
                    <View key={section} style={styles.section}>
                        <Text style={styles.sectionTitle}>{section}</Text>
                        <View style={styles.list}>
                            {categories.map((config) => (
                                <CategoryRow
                                    config={config}
                                    key={config.category}
                                    onSelect={onSelect}
                                    selected={
                                        selectedCategory === config.category
                                    }
                                    selectionActive={
                                        selectedCategory !== undefined
                                    }
                                    testIDPrefix={testIDPrefix}
                                />
                            ))}
                        </View>
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    actionPressed: {
        opacity: 0.72,
    },
    checkmark: {
        color: colors.tint,
        fontSize: 22,
        fontWeight: "800",
        lineHeight: 22,
    },
    chevron: {
        color: colors.muted,
        fontSize: 28,
        lineHeight: 28,
    },
    container: {
        paddingHorizontal: 20,
    },
    list: {
        gap: 8,
    },
    optionCopy: {
        flex: 1,
    },
    optionRow: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        flexDirection: "row",
        gap: 12,
        justifyContent: "space-between",
        minHeight: 58,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    optionRowSelected: {
        backgroundColor: colors.buttonSubtle,
    },
    optionTitle: {
        color: colors.ink,
        fontSize: 18,
        fontWeight: "800",
    },
    section: {
        marginTop: 12,
    },
    sectionTitle: {
        color: colors.muted,
        fontSize: 13,
        fontWeight: "800",
        letterSpacing: 0,
        marginBottom: 8,
        textTransform: "uppercase",
    },
});
