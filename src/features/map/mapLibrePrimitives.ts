import {
    Callout,
    CircleLayer,
    FillLayer,
    Images,
    LineLayer,
    PointAnnotation,
    ShapeSource,
    SymbolLayer,
} from "@maplibre/maplibre-react-native";
import type { ComponentType } from "react";

export const MLShapeSource = ShapeSource as ComponentType<any>;
export const MLCircleLayer = CircleLayer as ComponentType<any>;
export const MLFillLayer = FillLayer as ComponentType<any>;
export const MLImages = Images as ComponentType<any>;
export const MLLineLayer = LineLayer as ComponentType<any>;
export const MLSymbolLayer = SymbolLayer as ComponentType<any>;
export const MLPointAnnotation = PointAnnotation as ComponentType<any>;
export const MLCallout = Callout as ComponentType<any>;
