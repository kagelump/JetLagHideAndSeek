import type { QuestionState } from "@/features/questions/questionTypes";
import { getQuestionDefinition } from "@/features/questions/questionRegistry";

/**
 * Human-readable prompt shared in the chat message and shown in the import
 * preview. Delegates to each question type's {@link QuestionDefinition.sharePrompt}.
 */
export function buildQuestionSharePrompt(question: QuestionState): string {
    return getQuestionDefinition(question.type).sharePrompt(question);
}
