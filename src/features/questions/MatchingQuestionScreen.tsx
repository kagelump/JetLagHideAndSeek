import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SheetScrollView } from "@/features/sheet/SheetScrollView";
import type { SheetRouteName } from "@/features/sheet/sheetRoutes";
import { usePlayArea } from "@/state/playAreaStore";
import {
    useAdminDivisionPack,
    useLabelLanguage,
    useQuestionActions,
} from "@/state/questionStore";
import { colors } from "@/theme/colors";
import type { MatchingCategory } from "./matching/matchingTypes";
import {
    matchingCategoriesBySection,
    type CategorySection,
    type MatchingCategoryConfig,
} from "./matching/matchingCategories";
import { buildAdminMatchingCategoryConfigs } from "./matching/adminDivisionConfig";

type MatchingQuestionScreenProps = {
    onNavigate: (route: SheetRouteName) => void;
};

const sectionOrder: CategorySection[] = [
    "Transit",
    "Administrative Divisions",
    "Natural",
    "Places of Interest",
    "Public Utilities",
];

export function MatchingQuestionScreen({
    onNavigate,
}: MatchingQuestionScreenProps) {
    const { playArea } = usePlayArea();
    const { createQuestion } = useQuestionActions();
    const adminDivisionPack = useAdminDivisionPack();
    const labelLanguage = useLabelLanguage();

    const categoriesBySection = useMemo<
        Record<CategorySection, MatchingCategoryConfig[]>
    >(() => {
        // Start with the static groupings, then replace admin entries
        // with dynamic configs derived from current settings.
        const sections = { ...matchingCategoriesBySection };
        sections["Administrative Divisions"] =
            buildAdminMatchingCategoryConfigs(adminDivisionPack, labelLanguage);
        return sections;
    }, [adminDivisionPack, labelLanguage]);

    const addMatchingQuestion = (category: MatchingCategory) => {
        createQuestion("matching", {
            center: playArea.center,
            category,
        });
        onNavigate("question-detail");
    };

    return (
        <SheetScrollView contentContainerStyle={styles.scrollContent}>
            {sectionOrder.map((section) => {
                const categories = categoriesBySection[section];
                if (!categories || categories.length === 0) return null;
                return (
                    <View key={section} style={styles.section}>
                        <Text style={styles.sectionTitle}>{section}</Text>
                        <View style={styles.list}>
                            {categories.map((config) => (
                                <Pressable
                                    accessibilityLabel={`Add ${config.title} matching question`}
                                    accessibilityRole="button"
                                    key={config.category}
                                    onPress={() =>
                                        addMatchingQuestion(config.category)
                                    }
                                    style={({ pressed }) => [
                                        styles.optionRow,
                                        pressed ? styles.actionPressed : null,
                                    ]}
                                    testID={`add-matching-${config.category}-row`}
                                >
                                    <View style={styles.optionCopy}>
                                        <Text style={styles.optionTitle}>
                                            {config.title}
                                        </Text>
                                    </View>
                                    <Text style={styles.chevron}>›</Text>
                                </Pressable>
                            ))}
                        </View>
                    </View>
                );
            })}
        </SheetScrollView>
    );
}

const styles = StyleSheet.create({
    actionPressed: {
        opacity: 0.72,
    },
    chevron: {
        color: colors.muted,
        fontSize: 28,
        lineHeight: 28,
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
    optionTitle: {
        color: colors.ink,
        fontSize: 18,
        fontWeight: "800",
    },
    scrollContent: {
        paddingHorizontal: 20,
        paddingTop: 0,
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
