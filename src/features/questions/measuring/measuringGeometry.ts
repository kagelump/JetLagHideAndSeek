import type {
    Feature,
    LineString,
    MultiLineString,
    MultiPolygon,
    Point as GeoPoint,
    Polygon,
} from "geojson";

import { bboxIntersects } from "@/shared/geojson";
import type { Bbox, Position } from "@/shared/geojson";
import type { QuestionState } from "@/features/questions/questionTypes";
import { isLineMeasuringCategory } from "./measuringCategories";
import {
    computeLineBuffer,
    computeLineDistance,
} from "./lineMeasuringGeometry";
import {
    computeNearestPoiDistance,
    computePointUnionBuffer,
} from "./pointMeasuringGeometry";
import { getLineBundle } from "./lineBundleLoader";
import type { MeasuringRenderState } from "./measuringTypes";

// ─── Relation-id lookup ──────────────────────────────────────────────────────

/** 100 m search radius for matching a nearest point to a bundle feature. */
const NEARBY_TOLERANCE_DEG = 100 / 111_320;

/**
 * Returns the set of `relationId`s from bundle features whose geometry is
 * within ~100 m of `pt`. Used to filter the orange reference line to only the
 * border that the connector actually points at.
 */
function findNearbyRelationIds(
    features: readonly Feature<LineString | MultiLineString>[],
    pt: Position,
): Set<number> {
    const ids = new Set<number>();
    for (const f of features) {
        const rid = (f.properties as Record<string, unknown> | undefined)
            ?.relationId;
        if (typeof rid !== "number") continue;

        const coords = f.geometry.coordinates;
        if (f.geometry.type === "LineString") {
            if (coordsNearPoint(coords as Position[], pt)) {
                ids.add(rid);
            }
        } else {
            for (const seg of coords as Position[][]) {
                if (coordsNearPoint(seg, pt)) {
                    ids.add(rid);
                    break;
                }
            }
        }
    }
    return ids;
}

function coordsNearPoint(coords: Position[], pt: Position): boolean {
    const tol = NEARBY_TOLERANCE_DEG;
    for (const c of coords) {
        if (Math.abs(c[0] - pt[0]) < tol && Math.abs(c[1] - pt[1]) < tol) {
            return true;
        }
    }
    return false;
}

/** Spatial fallback: true when any vertex of `f` is within ~100 m of `pt`. */
function featureNearPoint(
    f: Feature<LineString | MultiLineString>,
    pt: Position,
): boolean {
    const tol = NEARBY_TOLERANCE_DEG;
    const coords = f.geometry.coordinates;
    if (f.geometry.type === "LineString") {
        return coordsNearPointTol(coords as Position[], pt, tol);
    }
    for (const seg of coords as Position[][]) {
        if (coordsNearPointTol(seg, pt, tol)) return true;
    }
    return false;
}

function coordsNearPointTol(
    coords: Position[],
    pt: Position,
    tol: number,
): boolean {
    for (const c of coords) {
        if (Math.abs(c[0] - pt[0]) < tol && Math.abs(c[1] - pt[1]) < tol) {
            return true;
        }
    }
    return false;
}

// ─── Render state ───────────────────────────────────────────────────────────

export function buildMeasuringRenderState(
    questions: QuestionState[],
    playAreaBbox: Bbox | undefined,
): MeasuringRenderState {
    const measuring = questions.filter(
        (q): q is Extract<QuestionState, { type: "measuring" }> =>
            q.type === "measuring",
    );

    const hitFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const missFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const connectors: Feature<LineString>[] = [];
    const markers: Feature<GeoPoint>[] = [];

    // Collect nearest points per category so the lineFeatures loop can
    // filter to only the relevant border (not all borders in the play area).
    const nearestPerCategory = new Map<
        string,
        { nearestPoint: Position; relationIds: Set<number> }
    >();

    for (const q of measuring) {
        if (isLineMeasuringCategory(q.category)) {
            // Derive on render — nothing is read from the question except center.
            let result: {
                nearestPoint: [number, number];
                distanceMeters: number;
            } | null;
            try {
                result = computeLineDistance(q.center, q.category);
            } catch (err) {
                console.warn(
                    `[measuringGeometry] computeLineDistance failed for category=${q.category} center=${q.center}:`,
                    err,
                );
                continue;
            }
            if (!result || result.distanceMeters <= 0) continue;

            // Record the nearest point so we can identify which specific
            // border feature(s) to highlight in the reference line.
            if (!nearestPerCategory.has(q.category)) {
                const bundle = getLineBundle(q.category);
                if (bundle) {
                    const rIds = findNearbyRelationIds(
                        bundle.features,
                        result.nearestPoint,
                    );
                    nearestPerCategory.set(q.category, {
                        nearestPoint: result.nearestPoint,
                        relationIds: rIds,
                    });
                }
            }

            // Always show the auto-picked target, answered or not.
            connectors.push({
                type: "Feature",
                properties: {},
                geometry: {
                    type: "LineString",
                    coordinates: [q.center, result.nearestPoint],
                },
            });
            markers.push({
                type: "Feature",
                properties: {},
                geometry: {
                    type: "Point",
                    coordinates: result.nearestPoint,
                },
            });

            // Buffer the line at the seeker's distance so the mask covers
            // all points within range of ANY point on the line, not just
            // the single nearest point.
            if (q.answer === "positive" || q.answer === "negative") {
                let buf: Feature<Polygon | MultiPolygon> | null;
                try {
                    buf = computeLineBuffer(
                        q.center,
                        q.category,
                        result.distanceMeters,
                        playAreaBbox,
                    );
                } catch (err) {
                    console.warn(
                        `[measuringGeometry] computeLineBuffer failed for category=${q.category}:`,
                        err,
                    );
                    continue;
                }
                if (buf) {
                    (q.answer === "positive" ? hitFeatures : missFeatures).push(
                        buf,
                    );
                }
            }
            continue;
        } else {
            // Point category: auto-compute nearest POI distance and buffer
            // the union of d-circles around every POI of the category.
            let dist: {
                nearestPoint: [number, number];
                distanceMeters: number;
            } | null;
            try {
                dist = computeNearestPoiDistance(q.center, q.category);
            } catch (err) {
                console.warn(
                    `[measuringGeometry] computeNearestPoiDistance failed for category=${q.category} center=${q.center}:`,
                    err,
                );
                continue;
            }
            if (!dist || dist.distanceMeters <= 0) continue;

            // Show connector + marker to the nearest POI (same affordance as
            // line categories).
            connectors.push({
                type: "Feature",
                properties: {},
                geometry: {
                    type: "LineString",
                    coordinates: [q.center, dist.nearestPoint],
                },
            });
            markers.push({
                type: "Feature",
                properties: {},
                geometry: {
                    type: "Point",
                    coordinates: dist.nearestPoint,
                },
            });

            // Buffer the union of circles around every POI in range.
            if (q.answer === "positive" || q.answer === "negative") {
                let buf: Feature<Polygon | MultiPolygon> | null;
                try {
                    buf = computePointUnionBuffer(
                        q.center,
                        q.category,
                        dist.distanceMeters,
                        playAreaBbox,
                    );
                } catch (err) {
                    console.warn(
                        `[measuringGeometry] computePointUnionBuffer failed for category=${q.category}:`,
                        err,
                    );
                    continue;
                }
                if (buf) {
                    (q.answer === "positive" ? hitFeatures : missFeatures).push(
                        buf,
                    );
                }
            }
            continue;
        }
    }

    // Collect line geometry for line-category questions so the map can
    // render the reference line (e.g. the nearest prefecture border) in
    // orange. When relationId data is available, only features belonging
    // to the nearest border are included — not every border in the play area.
    const lineFeatures: Feature<LineString | MultiLineString>[] = [];
    const seenCategories = new Set<string>();
    for (const q of measuring) {
        if (!isLineMeasuringCategory(q.category)) continue;
        if (seenCategories.has(q.category)) continue;
        seenCategories.add(q.category);

        const bundle = getLineBundle(q.category);
        if (!bundle) continue;

        const nearby = nearestPerCategory.get(q.category);

        for (const f of bundle.features) {
            // Filter to the play area window so we don't render lines
            // hundreds of km away.
            if (playAreaBbox) {
                const fb = (f.bbox?.slice(0, 4) ??
                    computeBbox(f.geometry.coordinates)) as Bbox;
                if (!bboxIntersects(fb, playAreaBbox)) continue;
            }

            // Only show the border that the connector actually points at.
            // Prefer relationId filtering (specific prefecture); fall back
            // to spatial proximity when relationId data is sparse.
            if (nearby) {
                // Try relationId match first.
                const rid = (
                    f.properties as Record<string, unknown> | undefined
                )?.relationId;
                if (
                    nearby.relationIds.size > 0 &&
                    (typeof rid !== "number" || !nearby.relationIds.has(rid))
                ) {
                    continue;
                }
                // Spatial fallback when no relationIds found: only include
                // features within ~500 m of the nearest point.
                if (
                    nearby.relationIds.size === 0 &&
                    !featureNearPoint(f, nearby.nearestPoint)
                ) {
                    continue;
                }
            }

            lineFeatures.push(f);
        }
    }

    return {
        hitMaskFeatures: { features: hitFeatures, type: "FeatureCollection" },
        missMaskFeatures: {
            features: missFeatures,
            type: "FeatureCollection",
        },
        nearestPointConnectors: {
            features: connectors,
            type: "FeatureCollection",
        },
        nearestPointMarkers: { features: markers, type: "FeatureCollection" },
        lineFeatures: {
            features: lineFeatures,
            type: "FeatureCollection",
        },
    };
}

function computeBbox(
    coords: number[][][] | number[][],
): [number, number, number, number] {
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    const walk = (c: unknown) => {
        if (typeof (c as number[])?.[0] === "number") {
            const [x, y] = c as number[];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        } else if (Array.isArray(c)) {
            for (const item of c) walk(item);
        }
    };
    walk(coords);
    return [minX, minY, maxX, maxY];
}
