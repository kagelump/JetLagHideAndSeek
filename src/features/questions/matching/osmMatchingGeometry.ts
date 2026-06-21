import { point } from "@turf/helpers";
import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Polygon,
} from "geojson";

import type { Bbox } from "@/shared/geojson";
import type { QuestionState } from "@/features/questions/questionTypes";
import type { OsmMatchingRenderState } from "@/features/questions/matching/matchingTypes";
import {
    buildNameLengthMasks,
    buildOsmMatchingHitMask,
    computeVoronoiCells,
    makeOsmKey,
} from "@/features/questions/matching/matchingVoronoi";
import { clipCellsToPlayArea } from "@/features/questions/clipVoronoiCells";
import { createLogger } from "@/shared/logger";

const log = createLogger("osmMatchingGeometry");

export function buildOsmMatchingRenderState(
    questions: QuestionState[],
    playAreaBbox: Bbox,
    playAreaBoundary: FeatureCollection<Polygon | MultiPolygon>,
): OsmMatchingRenderState {
    const t0 = Date.now();
    const osmMatchingQuestions = questions.filter(
        (q): q is Extract<QuestionState, { type: "matching" }> =>
            q.type === "matching" &&
            q.category !== "transit-line" &&
            q.targetOsmId !== null &&
            q.candidates.length > 0,
    );

    if (osmMatchingQuestions.length === 0) {
        return {
            hitMaskFeatures: { features: [], type: "FeatureCollection" },
            missMaskFeatures: { features: [], type: "FeatureCollection" },
            poiFeatures: { features: [], type: "FeatureCollection" },
            voronoiOutlineFeatures: {
                features: [],
                type: "FeatureCollection",
            },
        };
    }

    const hitFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const missFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const poiFeatures: OsmMatchingRenderState["poiFeatures"]["features"] = [];
    const outlineFeatures: Feature<Polygon | MultiPolygon>[] = [];

    for (const question of osmMatchingQuestions) {
        const cells = computeVoronoiCells(question.candidates, playAreaBbox);

        // Clip Voronoi cells to the play area boundary for outline rendering
        const clippedOutlines = clipCellsToPlayArea(cells, playAreaBoundary);
        outlineFeatures.push(...clippedOutlines.features);

        const selectedOsmKey =
            question.selectedOsmType !== null && question.selectedOsmId !== null
                ? makeOsmKey(question.selectedOsmType, question.selectedOsmId)
                : null;

        // Station-name-length uses name-length–based masks instead of
        // per-candidate Voronoi masks.
        if (question.category === "station-name-length") {
            const selectedNameLength =
                question.candidates.find(
                    (c) =>
                        c.osmId === question.selectedOsmId &&
                        c.osmType === question.selectedOsmType,
                )?.nameLength ?? null;

            const { hitMask } = buildNameLengthMasks(cells, selectedNameLength);

            if (question.answer === "positive") {
                hitFeatures.push(...hitMask.features);
            } else if (question.answer === "negative") {
                missFeatures.push(...hitMask.features);
            }
        } else if (question.answer === "positive") {
            const hitMask = buildOsmMatchingHitMask(cells, selectedOsmKey);
            hitFeatures.push(...hitMask.features);
        } else if (question.answer === "negative") {
            // For a negative answer the selected cell is the *excluded*
            // one — the user is saying "the target is NOT here." The miss
            // mask must be just the selected cell, not the union of all
            // other cells. (Using buildOsmMatchingMissMask — which
            // returns every cell *except* the selected one — would make
            // the inside mask visually identical to a positive answer.)
            const missMask = buildOsmMatchingHitMask(cells, selectedOsmKey);
            missFeatures.push(...missMask.features);
        }

        for (const candidate of question.candidates) {
            const isSelected =
                question.selectedOsmId === candidate.osmId &&
                question.selectedOsmType === candidate.osmType;
            poiFeatures.push(
                point([candidate.lon, candidate.lat], {
                    isSelected,
                    name: candidate.name,
                    osmId: candidate.osmId,
                }),
            );
        }
    }

    const durationMs = Date.now() - t0;
    log.debug(
        `[renderState] osmMatching: ${osmMatchingQuestions.length} questions, ` +
            `${hitFeatures.length} hit / ${missFeatures.length} miss / ` +
            `${poiFeatures.length} pois / ${outlineFeatures.length} outlines ` +
            `in ${durationMs}ms`,
    );

    return {
        hitMaskFeatures: { features: hitFeatures, type: "FeatureCollection" },
        missMaskFeatures: {
            features: missFeatures,
            type: "FeatureCollection",
        },
        poiFeatures: { features: poiFeatures, type: "FeatureCollection" },
        voronoiOutlineFeatures: {
            features: outlineFeatures,
            type: "FeatureCollection",
        },
    };
}
