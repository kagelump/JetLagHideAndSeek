import {
    buildEligibilityConstraints,
    eligibleArea,
    featureCollectionArea,
    questionContributionPercent,
    zoneBaselineArea,
    zoneEliminationPercent,
} from "../eliminationMath";
import type { GeoJsonFeatureCollection } from "../geojsonTypes";
import type { QuestionMapRenderState } from "@/features/questions/radar/radarTypes";

function emptyFC(): GeoJsonFeatureCollection {
    return { type: "FeatureCollection", features: [] };
}

function squareFC(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
): GeoJsonFeatureCollection {
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [minX, minY],
                            [maxX, minY],
                            [maxX, maxY],
                            [minX, maxY],
                            [minX, minY],
                        ],
                    ],
                },
            },
        ],
    };
}

/** Render state with all families empty except the overrides supplied. */
function makeRenderState(
    overrides: Partial<
        Record<
            string,
            {
                hitMaskFeatures: GeoJsonFeatureCollection;
                missMaskFeatures?: GeoJsonFeatureCollection;
            }
        >
    > = {},
): QuestionMapRenderState {
    const base = {
        hitMaskFeatures: emptyFC(),
        missMaskFeatures: emptyFC(),
    };
    return {
        measuring: { ...base },
        osmMatching: { ...base },
        radar: { ...base },
        radarAreaFeatures: emptyFC(),
        tentacles: { ...base },
        thermometer: { hitMaskFeatures: emptyFC() },
        transitLine: { ...base },
        voronoiOutlineFeatures: emptyFC(),
        ...overrides,
    } as unknown as QuestionMapRenderState;
}

describe("zoneEliminationPercent", () => {
    it("reports 0% when the whole zone is still eligible", () => {
        expect(zoneEliminationPercent(100, 100)).toBe(0);
    });

    it("reports 50% when half the zone is eligible", () => {
        expect(zoneEliminationPercent(50, 100)).toBe(50);
    });

    it("reports 100% when nothing is eligible", () => {
        expect(zoneEliminationPercent(0, 100)).toBe(100);
    });

    it("never goes negative when drift pushes eligible past the zone", () => {
        expect(zoneEliminationPercent(105, 100)).toBe(0);
    });

    it("returns 0 for a degenerate (zero-area) zone", () => {
        expect(zoneEliminationPercent(0, 0)).toBe(0);
    });
});

describe("questionContributionPercent", () => {
    it("reports 0% when the question removes nothing", () => {
        expect(questionContributionPercent(100, 100, 100)).toBe(0);
    });

    it("reports the share of the zone the question removes", () => {
        // 30 m² of a 100 m² zone removed by this question.
        expect(questionContributionPercent(80, 50, 100)).toBe(30);
    });

    it("never goes negative when the eligible area grows", () => {
        expect(questionContributionPercent(50, 60, 100)).toBe(0);
    });

    it("returns 0 for a degenerate (zero-area) zone", () => {
        expect(questionContributionPercent(50, 0, 0)).toBe(0);
    });
});

describe("buildEligibilityConstraints", () => {
    it("always begins required constraints with the hiding zone", () => {
        const zone = squareFC(0, 0, 10, 10);
        const { required } = buildEligibilityConstraints(
            zone,
            makeRenderState(),
        );
        expect(required[0]).toBe(zone);
    });

    it("includes a family's hit mask feature as a separate constraint", () => {
        const zone = squareFC(0, 0, 10, 10);
        const thermoHit = squareFC(0, 0, 5, 10);
        const renderState = makeRenderState({
            thermometer: { hitMaskFeatures: thermoHit },
        });

        const { required } = buildEligibilityConstraints(zone, renderState);
        const allFeatures = required.flatMap((c) => c.features);
        expect(allFeatures).toContainEqual(thermoHit.features[0]);
    });

    it("routes hit masks to required and miss masks to excluded (polarity)", () => {
        // Mask polarity convention (AGENTS.md / maskBuilder): hit masks are
        // REQUIRED (intersected), miss masks are EXCLUDED (subtracted). A family
        // with both polarities must split across the two arrays.
        const zone = squareFC(0, 0, 10, 10);
        const hit = squareFC(0, 0, 5, 10);
        const miss = squareFC(5, 0, 10, 10);
        const renderState = makeRenderState({
            radar: { hitMaskFeatures: hit, missMaskFeatures: miss },
        });

        const { required, excluded } = buildEligibilityConstraints(
            zone,
            renderState,
        );
        expect(required.flatMap((c) => c.features)).toContainEqual(
            hit.features[0],
        );
        expect(required.flatMap((c) => c.features)).not.toContainEqual(
            miss.features[0],
        );
        expect(excluded.flatMap((c) => c.features)).toContainEqual(
            miss.features[0],
        );
    });

    it("passes the transit-line hit mask as one whole constraint (union, not separate)", () => {
        // Per-station circles on a line must be a single OR constraint;
        // decomposing them would intersect non-overlapping circles to empty.
        const zone = squareFC(0, 0, 10, 10);
        const transitHit: GeoJsonFeatureCollection = {
            type: "FeatureCollection",
            features: [
                squareFC(0, 0, 2, 2).features[0],
                squareFC(8, 8, 10, 10).features[0],
            ],
        };
        const renderState = makeRenderState({
            transitLine: {
                hitMaskFeatures: transitHit,
                missMaskFeatures: emptyFC(),
            },
        });

        const { required } = buildEligibilityConstraints(zone, renderState);
        // The two-feature collection appears as a single multi-feature
        // constraint, not two single-feature constraints.
        expect(required).toContain(transitHit);
    });

    it("ignores a thermometer miss mask (miss: none)", () => {
        // Thermometer only ever narrows toward the hotter side; its miss
        // polarity contributes nothing. Even a populated miss mask is dropped.
        const zone = squareFC(0, 0, 10, 10);
        const thermoMiss = squareFC(5, 0, 10, 10);
        const renderState = makeRenderState({
            thermometer: {
                hitMaskFeatures: squareFC(0, 0, 5, 10),
                missMaskFeatures: thermoMiss,
            },
        });
        const { excluded } = buildEligibilityConstraints(zone, renderState);
        expect(excluded.flatMap((c) => c.features)).not.toContainEqual(
            thermoMiss.features[0],
        );
    });

    it("substitutes a family's hit mask via the override seam (live thermometer drag)", () => {
        // The map overlay swaps the static thermometer hit mask for a live
        // drag aggregate. The override must win; the render-state value drops.
        const zone = squareFC(0, 0, 10, 10);
        const staticHit = squareFC(0, 0, 5, 10);
        const liveHit = squareFC(0, 0, 8, 10);
        const renderState = makeRenderState({
            thermometer: { hitMaskFeatures: staticHit },
        });

        const { required } = buildEligibilityConstraints(zone, renderState, {
            thermometer: { hitMaskFeatures: liveHit },
        });
        const allFeatures = required.flatMap((c) => c.features);
        expect(allFeatures).toContainEqual(liveHit.features[0]);
        expect(allFeatures).not.toContainEqual(staticHit.features[0]);
    });
});

describe("eligibleArea", () => {
    it("equals the zone area when no question constrains it", () => {
        const boundary = squareFC(0, 0, 10, 10);
        const zone = squareFC(2, 2, 8, 8);
        const area = eligibleArea(boundary, zone, makeRenderState());
        expect(area).toBeCloseTo(featureCollectionArea(zone), 0);
    });

    it("shrinks to the intersection with a hit mask", () => {
        const boundary = squareFC(0, 0, 10, 10);
        const zone = squareFC(0, 0, 10, 10);
        // Left half by longitude = exactly half the geographic area.
        const renderState = makeRenderState({
            thermometer: { hitMaskFeatures: squareFC(0, 0, 5, 10) },
        });
        const area = eligibleArea(boundary, zone, renderState);
        expect(area).toBeCloseTo(featureCollectionArea(zone) / 2, 0);
    });
});

describe("zoneBaselineArea", () => {
    it("equals the full zone when it sits inside the boundary", () => {
        const boundary = squareFC(0, 0, 10, 10);
        const zone = squareFC(2, 2, 8, 8);
        expect(zoneBaselineArea(boundary, zone)).toBeCloseTo(
            featureCollectionArea(zone),
            0,
        );
    });

    it("clips zone area that spills outside the boundary", () => {
        // Zone extends past the right edge of the boundary; only the half inside
        // counts. Using the raw zone area as the denominator would report
        // phantom elimination (the spillover) even with no questions.
        const boundary = squareFC(0, 0, 10, 10);
        const zone = squareFC(5, 0, 15, 10);
        const baseline = zoneBaselineArea(boundary, zone);
        expect(baseline).toBeCloseTo(featureCollectionArea(zone) / 2, 0);
        expect(baseline).toBeLessThan(featureCollectionArea(zone));
    });

    it("reports 0% eliminated against its own baseline with no questions", () => {
        const boundary = squareFC(0, 0, 10, 10);
        const zone = squareFC(5, 0, 15, 10);
        const baseline = zoneBaselineArea(boundary, zone);
        const eligible = eligibleArea(boundary, zone, makeRenderState());
        expect(zoneEliminationPercent(eligible, baseline)).toBe(0);
    });
});

describe("strict-ordering contribution decomposition", () => {
    // Models the per-question stat: each question's contribution is its marginal
    // over the cumulative state of earlier questions, and the contributions
    // telescope to the total. Two thermometer features get distinct slices.
    it("gives each question an independent slice that sums to the total", () => {
        const boundary = squareFC(0, 0, 10, 10);
        const zone = squareFC(0, 0, 10, 10);
        const zoneArea = featureCollectionArea(zone);

        const leftHalf = squareFC(0, 0, 5, 10).features[0];
        const bottomHalf = squareFC(0, 0, 10, 5).features[0];

        const rsWith = (features: (typeof leftHalf)[]) =>
            makeRenderState({
                thermometer: {
                    hitMaskFeatures: { type: "FeatureCollection", features },
                },
            });

        const eligibleBefore = eligibleArea(boundary, zone, rsWith([]));
        const eligibleAfterQ1 = eligibleArea(
            boundary,
            zone,
            rsWith([leftHalf]),
        );
        const eligibleAfterQ2 = eligibleArea(
            boundary,
            zone,
            rsWith([leftHalf, bottomHalf]),
        );

        const q1 = questionContributionPercent(
            eligibleBefore,
            eligibleAfterQ1,
            zoneArea,
        );
        const q2 = questionContributionPercent(
            eligibleAfterQ1,
            eligibleAfterQ2,
            zoneArea,
        );
        const total = zoneEliminationPercent(eligibleAfterQ2, zoneArea);

        // Q1 removes the right half (50%); Q2 then removes the top-left quarter
        // (25%); together 75% — and the slices differ.
        expect(q1).toBe(50);
        expect(q2).toBe(25);
        expect(q1 + q2).toBe(total);
    });
});
