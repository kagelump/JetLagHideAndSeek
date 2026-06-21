import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, Share, StyleSheet } from "react-native";

import { buildQuestionSharePrompt } from "@/features/questions/questionSharePrompt";
import type { QuestionState } from "@/features/questions/questionTypes";
import { buildQuestionRequestEnvelope } from "@/sharing/export/buildEnvelope";
import { buildImportLink } from "@/sharing/links/buildLink";
import { colors } from "@/theme/colors";
import { createLogger } from "@/shared/logger";

const log = createLogger("ShareQuestionButton");

// iOS uses the box-and-arrow glyph; Android uses the connected-nodes glyph.
const SHARE_ICON_NAME =
    Platform.OS === "ios" ? "share-outline" : "share-social-outline";

export function ShareQuestionButton({ question }: { question: QuestionState }) {
    const handleShare = async () => {
        try {
            const url = buildImportLink({
                envelope: buildQuestionRequestEnvelope({ question }),
                mode: "https",
            });
            const message = `${buildQuestionSharePrompt(question)}\n${url}`;
            // The native share sheet already includes a "Copy" action. Pass the
            // URL inside `message` only, so iOS doesn't append a duplicate link.
            await Share.share({ message });
        } catch (err) {
            // Android throws { dismissedAction: true } on dismissal. iOS rejects
            // with an error when no share target is available. Both are expected.
            if (
                err &&
                typeof err === "object" &&
                Object.prototype.hasOwnProperty.call(err, "dismissedAction")
            ) {
                return; // user dismissed — no-op
            }
            // Unexpected error — log it so we can debug.
            log.warn("share failed", err);
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
