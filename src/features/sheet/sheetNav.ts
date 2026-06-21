import type { SheetRouteName } from "@/features/sheet/sheetRoutes";

const ROUTE_GRAPH = [
    { name: "main", parent: null },
    { name: "questions", parent: "main" },
    { name: "add-question", parent: "questions" },
    { name: "matching", parent: "add-question" },
    { name: "measuring", parent: "add-question" },
    { name: "question-detail", parent: "questions" },
    { name: "settings", parent: "main" },
    { name: "play-area", parent: "settings" },
    { name: "hiding-zone", parent: "settings" },
    { name: "hiding-zone-operator", parent: "hiding-zone" },
    { name: "offline-data", parent: "settings" },
    { name: "admin-divisions", parent: "settings" },
    { name: "geometry-parity", parent: "settings" },
    { name: "station-detail", parent: "main" },
] as const;

// Derive depth and back-target from the graph (computed once at module load)
const routeDepthMap = new Map<SheetRouteName, number>();
const backTargetMap = new Map<SheetRouteName, SheetRouteName | null>();

function buildMaps(): void {
    // Build a lookup for parent relationships
    const parentMap = new Map<SheetRouteName, SheetRouteName | null>();

    for (const node of ROUTE_GRAPH) {
        parentMap.set(node.name, node.parent);
        backTargetMap.set(node.name, node.parent);
    }

    // Compute depth by walking from each node to root
    for (const node of ROUTE_GRAPH) {
        let depth = 0;
        let current: SheetRouteName | null = node.name;
        while (current !== null) {
            const parent: SheetRouteName | null =
                parentMap.get(current) ?? null;
            if (parent === null) break;
            depth++;
            current = parent;
        }
        routeDepthMap.set(node.name, depth);
    }
}

buildMaps();

// Detail/leaf routes are always entered "forward" and left "back",
// regardless of parent depth. The depth model can't express sibling→leaf
// forward navigation (e.g. add-question → question-detail, both depth 2).
const LEAF_ROUTES = new Set<SheetRouteName>([
    "question-detail",
    "station-detail",
    "hiding-zone-operator",
]);

export function getNavDirection(
    from: SheetRouteName,
    to: SheetRouteName,
): "forward" | "back" {
    if (LEAF_ROUTES.has(to) && !LEAF_ROUTES.has(from)) return "forward";
    if (LEAF_ROUTES.has(from) && !LEAF_ROUTES.has(to)) return "back";
    // Same-depth non-leaf routes (e.g. matching -> measuring) resolve to "back"
    // because the fallback comparison uses strict greater-than, not >=.
    return (routeDepthMap.get(to) ?? 0) > (routeDepthMap.get(from) ?? 0)
        ? "forward"
        : "back";
}

export function getBackTarget(route: SheetRouteName): SheetRouteName | null {
    return backTargetMap.get(route) ?? null;
}
