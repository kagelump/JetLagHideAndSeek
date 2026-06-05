export type SheetRouteName =
    | "main"
    | "questions"
    | "add-question"
    | "matching"
    | "question-detail"
    | "settings"
    | "play-area"
    | "hiding-zone"
    | "offline-data"
    | "admin-divisions";

export const SHEET_SNAP_INDEX = {
    compact: 0,
    large: 2,
    medium: 1,
} as const;
