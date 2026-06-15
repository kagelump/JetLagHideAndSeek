import type { QuestionState } from "@/features/questions/questionTypes";

/**
 * Title builder for question types whose title is just the list label plus the
 * 1-based position (detail views omit the index and show the bare label).
 */
export function indexedTitle(label: string) {
    return (_question: QuestionState, index?: number): string =>
        index != null ? `${label} ${index + 1}` : label;
}
