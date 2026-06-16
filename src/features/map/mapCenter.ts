import type { Position } from "@/shared/geojson";

let lastKnownMapCenter: Position | null = null;

export function setLastKnownMapCenter(center: Position): void {
    lastKnownMapCenter = center;
}

export function getLastKnownMapCenter(): Position | null {
    return lastKnownMapCenter;
}
