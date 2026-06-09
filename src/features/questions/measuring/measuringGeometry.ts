import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiLineString,
    MultiPolygon,
    Point as GeoPoint,
    Polygon,
} from "geojson";

import type { Bbox, Position } from "@/shared/geojson";
import type { QuestionState } from "@/features/questions/questionTypes";
import { getGeometryBackend } from "@/shared/geometry/geometryBackend";
import { isLineMeasuringCategory } from "./measuringCategories";
import {
    clipLineFeaturesToPlayArea,
    computeLineBufferCached,
    computeLineCategory,
    getClippedLineFeaturesCached,
    getDilatedPlayArea,
    makeClippedLineCacheKey,
    polygonFeaturesToLineFeatures,
    type LineCategoryComputation,
} from "./lineMeasuringGeometry";
import {
    computeNearestPoiDistance,
    computePointUnionBuffer,
} from "./pointMeasuringGeometry";
import type { MeasuringRenderState } from "./measuringTypes";

// ─── Render state ───────────────────────────────────────────────────────────

export function buildMeasuringRenderState(
    questions: QuestionState[],
    playAreaBbox: Bbox | undefined,
    playAreaBoundary: FeatureCollection<Polygon | MultiPolygon> | undefined,
): MeasuringRenderState {
    const tTotal0 = performance.now();
    const measuring = questions.filter(
        (q): q is Extract<QuestionState, { type: "measuring" }> =>
            q.type === "measuring",
    );

    const hitFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const missFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const connectors: Feature<LineString>[] = [];
    const markers: Feature<GeoPoint>[] = [];

    // Collect category-level computations so the lineFeatures loop can
    // derive the clipped reference line from windowFeatures.
    const nearestPerCategory = new Map<
        string,
        {
            nearestPoint: Position;
            windowFeatures: Feature<
                LineString | MultiLineString | Polygon | MultiPolygon
            >[];
        }
    >();

    for (const q of measuring) {
        if (isLineMeasuringCategory(q.category)) {
            // Derive on render — nothing is read from the question except center.
            let lineCat: LineCategoryComputation | null;
            try {
                lineCat = computeLineCategory(
                    q.center,
                    q.category,
                    playAreaBbox,
                );
            } catch (err) {
                console.warn(
                    `[measuringGeometry] computeLineCategory failed for category=${q.category} center=${q.center}:`,
                    err,
                );
                continue;
            }
            if (!lineCat || lineCat.distanceMeters <= 0) continue;

            // Record the category-level computation so the lineFeatures loop
            // can derive the clipped reference line from windowFeatures.
            if (!nearestPerCategory.has(q.category)) {
                nearestPerCategory.set(q.category, {
                    nearestPoint: lineCat.nearestPoint,
                    windowFeatures: lineCat.windowFeatures,
                });
            }

            // Always show the auto-picked target, answered or not.
            connectors.push({
                type: "Feature",
                properties: {},
                geometry: {
                    type: "LineString",
                    coordinates: [q.center, lineCat.nearestPoint],
                },
            });
            markers.push({
                type: "Feature",
                properties: {},
                geometry: {
                    type: "Point",
                    coordinates: lineCat.nearestPoint,
                },
            });

            // Buffer the line at the seeker's distance so the mask covers
            // all points within range of ANY point on the line, not just
            // the single nearest point.
            if (q.answer === "positive" || q.answer === "negative") {
                let buf: Feature<Polygon | MultiPolygon> | null;
                try {
                    buf = computeLineBufferCached(
                        q.category,
                        q.center,
                        lineCat.distanceMeters,
                        lineCat.windowFeatures,
                    );
                } catch (err) {
                    console.warn(
                        `[measuringGeometry] computeLineBufferCached failed for category=${q.category}:`,
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
    // render the reference line (e.g. the nearest prefecture border).
    // Derived from computeLineCategory's windowFeatures — the same set
    // that feeds the mask buffer. Clipped to the ε-dilated play-area
    // boundary when available.
    const tLineFeatures0 = performance.now();
    const lineFeatures: Feature<LineString | MultiLineString>[] = [];
    const seenCategories = new Set<string>();
    for (const q of measuring) {
        if (!isLineMeasuringCategory(q.category)) continue;
        if (seenCategories.has(q.category)) continue;
        seenCategories.add(q.category);

        const nearby = nearestPerCategory.get(q.category);
        if (!nearby || nearby.windowFeatures.length === 0) continue;

        if (playAreaBoundary) {
            // Clip features to the ε-dilated play-area boundary so the
            // reference line never spills off-map (fixes HSR past
            // Yokohama) and coincident borders survive (fixes prefecture
            // border on Tokyo 23-wards edge).
            //
            // Convert polygon features to boundary lines before clipping
            // so the reference line renders as the shoreline, not a filled
            // polygon (P0 — body-of-water dissolved polygons).
            const tPolyToLine0 = performance.now();
            const lineOnlyFeatures = polygonFeaturesToLineFeatures(
                nearby.windowFeatures,
            );
            const tPolyToLineMs = performance.now() - tPolyToLine0;
            console.log(
                `[measuringGeometry] polygonFeaturesToLineFeatures: ` +
                    `${nearby.windowFeatures.length} window → ${lineOnlyFeatures.length} line features ` +
                    `in ${tPolyToLineMs.toFixed(0)}ms for ${q.category}`,
            );

            const tDilate0 = performance.now();
            const dilated = getDilatedPlayArea(playAreaBoundary);
            const tDilateMs = performance.now() - tDilate0;
            console.log(
                `[measuringGeometry] [${getGeometryBackend().name}] getDilatedPlayArea in ${tDilateMs.toFixed(0)}ms`,
            );

            const tClip0 = performance.now();
            const cacheKey = playAreaBbox
                ? makeClippedLineCacheKey(q.category, playAreaBbox)
                : null;
            const clipped =
                cacheKey && playAreaBbox
                    ? getClippedLineFeaturesCached(
                          lineOnlyFeatures,
                          dilated,
                          playAreaBbox,
                          cacheKey,
                      )
                    : clipLineFeaturesToPlayArea(
                          lineOnlyFeatures,
                          dilated,
                          playAreaBbox,
                      );
            const tClipMs = performance.now() - tClip0;
            console.log(
                `[measuringGeometry] clipLineFeaturesToPlayArea: ` +
                    `${lineOnlyFeatures.length} → ${clipped.length} features ` +
                    `in ${tClipMs.toFixed(0)}ms for ${q.category}`,
            );

            for (const f of clipped) {
                lineFeatures.push(f);
            }
        } else {
            // No boundary available — use window features unclipped
            // (backward-compatible path for tests without a boundary).
            // Convert polygon features to boundary lines so the reference
            // line always renders as a line.
            const lineOnlyFeatures = polygonFeaturesToLineFeatures(
                nearby.windowFeatures,
            );
            for (const f of lineOnlyFeatures) {
                lineFeatures.push(f);
            }
        }
    }
    const tLineFeaturesMs = performance.now() - tLineFeatures0;
    console.log(
        `[measuringGeometry] lineFeatures derivation: ${lineFeatures.length} total ` +
            `in ${tLineFeaturesMs.toFixed(0)}ms`,
    );

    const tTotalMs = performance.now() - tTotal0;
    console.log(
        `[measuringGeometry] buildMeasuringRenderState total: ${tTotalMs.toFixed(0)}ms ` +
            `for ${measuring.length} question(s)`,
    );

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
