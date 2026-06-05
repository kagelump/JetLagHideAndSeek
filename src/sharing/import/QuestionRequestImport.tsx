import { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { buildQuestionSharePrompt } from "@/features/questions/questionSharePrompt";
import { evaluateRadarAnswer } from "@/features/questions/radar/radarAnswer";
import { requestUserCoordinate } from "@/shared/location";
import type { QuestionRequestEnvelopeV1 } from "@/sharing/wire/schema";
import { useGameMode } from "@/state/questionStore";
import { colors } from "@/theme/colors";

type LocateStatus = "idle" | "locating" | "answered" | "denied" | "unavailable";

type QuestionRequestImportProps = {
    envelope: QuestionRequestEnvelopeV1;
    onAddQuestion: () => void;
    onCancel: () => void;
};

export function QuestionRequestImport({
    envelope,
    onAddQuestion,
    onCancel,
}: QuestionRequestImportProps) {
    const gameMode = useGameMode();
    const question = envelope.payload.question;
    const prompt = buildQuestionSharePrompt(question);

    // Only radar questions can be auto-answered from a coordinate. Other
    // question types (matching) need POI lookups, so a hider just adds them.
    const shouldAnswer = gameMode === "hider" && question.type === "radar";

    const [answer, setAnswer] = useState<"positive" | "negative" | null>(null);
    const [status, setStatus] = useState<LocateStatus>(
        shouldAnswer ? "locating" : "idle",
    );

    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const runLocate = useCallback(async () => {
        if (question.type !== "radar") return;
        setStatus("locating");
        const result = await requestUserCoordinate();
        if (!mountedRef.current) return;
        if (result.status === "granted") {
            setAnswer(evaluateRadarAnswer(question, result.coordinate));
            setStatus("answered");
        } else if (result.status === "unavailable") {
            setStatus("unavailable");
        } else {
            setStatus("denied");
        }
    }, [question]);

    useEffect(() => {
        if (shouldAnswer) void runLocate();
    }, [shouldAnswer, runLocate]);

    return (
        <View style={styles.screen}>
            <View style={styles.panel} testID="question-request-import">
                <Text style={styles.eyebrow}>
                    {shouldAnswer ? "Question For You" : "Shared Question"}
                </Text>
                <Text style={styles.title}>{prompt}</Text>

                {shouldAnswer ? (
                    <AnswerBlock
                        answer={answer}
                        onRetry={() => void runLocate()}
                        status={status}
                    />
                ) : (
                    <Text style={styles.detail}>
                        Add this question to your list to track it on the map.
                    </Text>
                )}

                <View style={styles.buttonRow}>
                    <Pressable
                        accessibilityLabel="Return to map"
                        accessibilityRole="button"
                        onPress={onCancel}
                        style={({ pressed }) => [
                            styles.secondaryButton,
                            pressed ? styles.actionPressed : null,
                        ]}
                        testID="question-request-return-button"
                    >
                        <Text style={styles.secondaryButtonText}>
                            Return to Map
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityLabel="Add question to my list"
                        accessibilityRole="button"
                        onPress={onAddQuestion}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            pressed ? styles.actionPressed : null,
                        ]}
                        testID="question-request-add-button"
                    >
                        <Text style={styles.primaryButtonText}>
                            Add Question
                        </Text>
                    </Pressable>
                </View>
            </View>
        </View>
    );
}

function AnswerBlock({
    answer,
    onRetry,
    status,
}: {
    answer: "positive" | "negative" | null;
    onRetry: () => void;
    status: LocateStatus;
}) {
    if (status === "locating") {
        return (
            <View style={styles.answerCard}>
                <ActivityIndicator color={colors.tint} />
                <Text style={styles.detail}>Checking your location…</Text>
            </View>
        );
    }

    if (status === "answered" && answer) {
        const isHit = answer === "positive";
        return (
            <View style={styles.answerCard} testID="question-request-answer">
                <Text style={styles.verdict}>{isHit ? "Yes" : "No"}</Text>
                <Text style={styles.detail}>
                    {isHit
                        ? "You are within range, based on your current location."
                        : "You are outside range, based on your current location."}
                </Text>
            </View>
        );
    }

    return (
        <View style={styles.answerCard}>
            <Text style={styles.detail} testID="question-request-answer">
                {status === "denied"
                    ? "Location permission is needed to answer this question."
                    : "Couldn't read your current location."}
            </Text>
            <Pressable
                accessibilityLabel="Check my location again"
                accessibilityRole="button"
                onPress={onRetry}
                style={({ pressed }) => [
                    styles.retryButton,
                    pressed ? styles.actionPressed : null,
                ]}
                testID="question-request-retry-button"
            >
                <Text style={styles.secondaryButtonText}>Try Again</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    actionPressed: {
        opacity: 0.72,
    },
    answerCard: {
        alignItems: "center",
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        gap: 10,
        marginTop: 18,
        padding: 20,
    },
    buttonRow: {
        flexDirection: "row",
        gap: 10,
        marginTop: 18,
    },
    detail: {
        color: colors.muted,
        fontSize: 15,
        lineHeight: 21,
        marginTop: 8,
        textAlign: "center",
    },
    eyebrow: {
        color: colors.tint,
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0,
        textTransform: "uppercase",
    },
    panel: {
        backgroundColor: colors.panel,
        borderColor: colors.border,
        borderRadius: 8,
        borderWidth: 1,
        padding: 20,
        width: "100%",
    },
    primaryButton: {
        alignItems: "center",
        backgroundColor: colors.button,
        borderRadius: 8,
        flex: 1,
        paddingVertical: 14,
    },
    primaryButtonText: {
        color: colors.white,
        fontSize: 15,
        fontWeight: "800",
    },
    retryButton: {
        alignItems: "center",
        backgroundColor: colors.buttonSubtle,
        borderRadius: 8,
        paddingHorizontal: 18,
        paddingVertical: 12,
    },
    screen: {
        alignItems: "center",
        backgroundColor: colors.background,
        flex: 1,
        justifyContent: "center",
        padding: 20,
    },
    secondaryButton: {
        alignItems: "center",
        backgroundColor: colors.buttonSubtle,
        borderRadius: 8,
        flex: 1,
        paddingVertical: 14,
    },
    secondaryButtonText: {
        color: colors.ink,
        fontSize: 15,
        fontWeight: "800",
    },
    title: {
        color: colors.ink,
        fontSize: 22,
        fontWeight: "800",
        lineHeight: 28,
        marginTop: 4,
    },
    verdict: {
        color: colors.ink,
        fontSize: 40,
        fontWeight: "800",
    },
});
