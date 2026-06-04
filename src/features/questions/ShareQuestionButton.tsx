import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, Share, StyleSheet } from "react-native";

import { buildQuestionSharePrompt } from "@/features/questions/questionSharePrompt";
import type { QuestionState } from "@/features/questions/questionTypes";
import { buildQuestionRequestEnvelope } from "@/sharing/export/buildEnvelope";
import { buildImportLink } from "@/sharing/links/buildLink";
import { colors } from "@/theme/colors";

// iOS uses the box-and-arrow glyph; Android uses the connected-nodes glyph.
const SHARE_ICON_NAME =
    Platform.OS === "ios" ? "share-outline" : "share-social-outline";

export function ShareQuestionButton({ question }: { question: QuestionState }) {
    const handleShare = async () => {
        const url = buildImportLink({
            envelope: buildQuestionRequestEnvelope({ question }),
            mode: "https",
        });
        const message = `${buildQuestionSharePrompt(question)}\n${url}`;
        try {
            // The native share sheet already includes a "Copy" action. Pass the
            // URL inside `message` only, so iOS doesn't append a duplicate link.
            await Share.share({ message });
        } catch {
            // User dismissed the sheet, or sharing is unavailable — no-op.
        }
    };

    return (
        <Pressable
            accessibilityLabel="Share question"
            accessibilityRole="button"
            onPress={() => void handleShare()}
            style={({ pressed }) => [
                styles.button,
                pressed ? styles.pressed : null,
            ]}
            testID="question-share-button"
        >
            <Ionicons color={colors.ink} name={SHARE_ICON_NAME} size={20} />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    button: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        justifyContent: "center",
        minHeight: 42,
        minWidth: 44,
        paddingHorizontal: 10,
    },
    pressed: {
        opacity: 0.72,
    },
});
