import { createContext, useContext } from "react";
import type { Position } from "@/shared/geojson";

export type ThermometerDragState = {
    distanceMeters: number;
    p1: Position;
    p2: Position;
} | null;

const ThermometerDragContext = createContext<ThermometerDragState>(null);

export const ThermometerDragProvider = ThermometerDragContext.Provider;

export function useThermometerDrag(): ThermometerDragState {
    return useContext(ThermometerDragContext);
}
