import type { SheetRouteName } from "@/features/sheet/sheetRoutes";

const routeDepth: Record<SheetRouteName, number> = {
    main: 0,
    questions: 1,
    "add-question": 2,
    matching: 3,
    "question-detail": 4,
    settings: 1,
    "play-area": 2,
    "hiding-zone": 2,
    "offline-data": 2,
    "admin-divisions": 2,
    "geometry-parity": 2,
    "station-detail": 1,
};

export function getNavDirection(
    from: SheetRouteName,
    to: SheetRouteName,
): "forward" | "back" {
    return routeDepth[to] > routeDepth[from] ? "forward" : "back";
}

export function getBackTarget(route: SheetRouteName): SheetRouteName | null {
    switch (route) {
        case "main":
            return null;
        case "questions":
        case "settings":
            return "main";
        case "add-question":
            return "questions";
        case "matching":
            return "add-question";
        case "question-detail":
            return "questions";
        case "play-area":
        case "hiding-zone":
        case "offline-data":
        case "admin-divisions":
        case "geometry-parity":
            return "settings";
        case "station-detail":
            return "main";
    }
}
