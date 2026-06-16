import {
    asSeparateMaskConstraints,
    buildCombinedEligibilityMask,
} from "@/features/map/maskBuilder";
import type { MaskFeatureCollection } from "@/features/map/maskBuilder";
import type { QuestionMapRenderState } from "@/features/questions/radar/radarTypes";
import { geomAreaM2 } from "@/shared/geometry/parityMetrics";

/**
 * Shared math behind the elimination stats:
 *
 *  - Hero / total stat: "% of the hiding zone eliminated by all questions"
 *    (no-question state vs all-question state). Computed via
 *    {@link eligibleArea} + {@link zoneEliminationPercent}.
 *  - Per-question contribution shown on a question sheet: the percentage points
 *    of that total contributed by ONE question, assuming strict question
 *    ordering — its marginal over the cumulative state of every earlier
 *    question. Computed via {@link questionContributionPercent}. These
 *    contributions telescope: they sum to the total.
 *
 * All three render paths (hero drawer stat, hero hook, per-question sheet)
 * build the combined eligibility mask the same way, so constraint assembly and
 * area accounting live here once.
 *
 * `buildCombinedEligibilityMask` returns the INELIGIBLE region of the play area
 * (the grey-out layer), so eligible area is always `playAreaArea − maskArea`.
 */

type QuestionRenderKey =
    | "radar"
    | "transitLine"
    | "osmMatching"
    | "thermometer"
    | "tentacles"
    | "measuring";

/**
 * How each question family's hit/miss masks fold into the combined eligibility
 * mask. `separate` splits the collection into one AND/OR constraint per feature
 * (via `asSeparateMaskConstraints`); `whole` passes the collection as a single
 * constraint; `none` means that polarity contributes nothing.
 *
 * Mask polarity convention (see maskBuilder / AGENTS.md): hit masks are REQUIRED
 * regions (intersected); miss masks are EXCLUDED regions (subtracted).
 */
const MASK_RULES: Record<
    QuestionRenderKey,
    { hit: "separate" | "whole"; miss: "separate" | "whole" | "none" }
> = {
    radar: { hit: "separate", miss: "whole" },
    transitLine: { hit: "whole", miss: "whole" },
    osmMatching: { hit: "separate", miss: "whole" },
    thermometer: { hit: "separate", miss: "none" },
    tentacles: { hit: "separate", miss: "separate" },
    measuring: { hit: "separate", miss: "separate" },
};

type MaskFamily = {
    hitMaskFeatures: MaskFeatureCollection;
    missMaskFeatures?: MaskFeatureCollection;
};

function pushConstraint(
    target: MaskFeatureCollection[],
    fc: MaskFeatureCollection,
    mode: "separate" | "whole",
): void {
    if (mode === "separate") {
        target.push(...asSeparateMaskConstraints(fc));
    } else {
        target.push(fc);
    }
}

/**
 * Per-family mask overrides. When a family is present here, its supplied
 * hit/miss collection replaces the one in the render state for that polarity.
 * The map overlay uses this to substitute the thermometer hit mask with a
 * live-drag aggregate without forking the constraint-assembly logic.
 */
export type EligibilityMaskOverrides = Partial<
    Record<QuestionRenderKey, Partial<MaskFamily>>
>;

/**
 * Assemble the required/excluded constraint arrays for
 * `buildCombinedEligibilityMask` from the hiding-zone features and a question
 * render state. `overrides` lets a caller swap a family's hit/miss collection
 * (e.g. the map overlay's live thermometer-drag mask) while keeping the single
 * shared polarity/decomposition policy in {@link MASK_RULES}.
 */
export function buildEligibilityConstraints(
    zoneFeatures: MaskFeatureCollection,
    renderState: QuestionMapRenderState,
    overrides?: EligibilityMaskOverrides,
): {
    required: MaskFeatureCollection[];
    excluded: MaskFeatureCollection[];
} {
    const required: MaskFeatureCollection[] = [zoneFeatures];
    const excluded: MaskFeatureCollection[] = [];

    for (const key of Object.keys(MASK_RULES) as QuestionRenderKey[]) {
        const rule = MASK_RULES[key];
        const family = renderState[key] as MaskFamily;
        const override = overrides?.[key];
        const hitMaskFeatures =
            override?.hitMaskFeatures ?? family.hitMaskFeatures;
        const missMaskFeatures =
            override?.missMaskFeatures ?? family.missMaskFeatures;
        pushConstraint(required, hitMaskFeatures, rule.hit);
        if (rule.miss !== "none" && missMaskFeatures) {
            pushConstraint(excluded, missMaskFeatures, rule.miss);
        }
    }

    return { required, excluded };
}

export function featureCollectionArea(fc: MaskFeatureCollection): number {
    let total = 0;
    for (const feature of fc.features) {
        if (!feature?.geometry) continue;
        const { type } = feature.geometry;
        if (type === "Polygon" || type === "MultiPolygon") {
            total += geomAreaM2(feature.geometry);
        }
    }
    return total;
}

/**
 * Eligible area (m²) of the hiding zone given a question render state. Builds
 * the combined eligibility mask and returns `playAreaArea − maskArea` (the mask
 * is the ineligible region). The eligible area is always a subset of the zone,
 * since the zone is a required constraint.
 */
export function eligibleArea(
    boundary: MaskFeatureCollection,
    zoneFeatures: MaskFeatureCollection,
    renderState: QuestionMapRenderState,
): number {
    const { required, excluded } = buildEligibilityConstraints(
        zoneFeatures,
        renderState,
    );
    const mask = buildCombinedEligibilityMask(boundary, required, excluded);
    return Math.max(
        0,
        featureCollectionArea(boundary) - featureCollectionArea(mask),
    );
}

/**
 * Baseline eligible area (m²): the hiding zone clipped to the play-area
 * boundary, with NO question constraints applied. This is the correct
 * denominator for the elimination stats — the zone polygons (station circles)
 * can spill outside the boundary, and that spillover is never eligible hiding
 * space. Using the raw {@link featureCollectionArea} of the zone instead would
 * report phantom elimination (e.g. ~6%) even with zero questions, since the
 * numerator ({@link eligibleArea}) is always clipped to the boundary.
 */
export function zoneBaselineArea(
    boundary: MaskFeatureCollection,
    zoneFeatures: MaskFeatureCollection,
): number {
    const mask = buildCombinedEligibilityMask(boundary, [zoneFeatures], []);
    return Math.max(
        0,
        featureCollectionArea(boundary) - featureCollectionArea(mask),
    );
}

/**
 * The hero / total stat: the fraction of the hiding zone no longer eligible,
 * expressed as a whole percent in [0, 100].
 */
export function zoneEliminationPercent(
    eligibleArea: number,
    zoneArea: number,
): number {
    if (zoneArea <= 0) return 0;
    const eliminated = 1 - Math.max(0, eligibleArea) / zoneArea;
    return Math.max(0, Math.min(100, Math.round(eliminated * 100)));
}

/**
 * One question's contribution under strict ordering: the eligible area it
 * removes (eligible-before vs eligible-after, where "before" is the cumulative
 * state of every earlier question) as a fraction of the whole zone. Expressed
 * in the same units as {@link zoneEliminationPercent} so the two read together
 * as "X% eliminated (+Y% by this question)". Clamped to [0, 100], rounded.
 */
export function questionContributionPercent(
    eligibleBefore: number,
    eligibleAfter: number,
    zoneArea: number,
): number {
    if (zoneArea <= 0) return 0;
    const contributed = (eligibleBefore - eligibleAfter) / zoneArea;
    return Math.max(0, Math.min(100, Math.round(contributed * 100)));
}
