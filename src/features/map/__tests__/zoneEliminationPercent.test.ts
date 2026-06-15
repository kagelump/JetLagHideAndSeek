import { zoneEliminationPercent } from "@/features/map/useEliminationPercentage";

// `buildCombinedEligibilityMask` returns the INELIGIBLE region of the whole
// play area (the grey-out layer), so `maskArea ≈ playAreaArea − eligibleArea`.
// These cases lock in the regression where the stat used `1 - maskArea/zoneArea`
// directly and was clamped to 0% for any realistic play-area / zone ratio.
describe("zoneEliminationPercent", () => {
    const PLAY_AREA = 1000;

    it("reports 0% when nothing is eliminated (eligible === full zone)", () => {
        const zone = 100;
        // No questions answered: mask = playArea − zone, eligible = zone.
        const mask = PLAY_AREA - zone;
        expect(zoneEliminationPercent(PLAY_AREA, mask, zone)).toBe(0);
    });

    it("reports 50% when half the zone is eliminated", () => {
        const zone = 100;
        const eligible = 50;
        const mask = PLAY_AREA - eligible;
        expect(zoneEliminationPercent(PLAY_AREA, mask, zone)).toBe(50);
    });

    it("reports 100% when the whole zone is eliminated (mask === play area)", () => {
        const zone = 100;
        // Contradictory constraints: eligible empty → mask = full play area.
        expect(zoneEliminationPercent(PLAY_AREA, PLAY_AREA, zone)).toBe(100);
    });

    it("does not go negative when geometry drift pushes eligible past the zone", () => {
        const zone = 100;
        // eligible slightly larger than zone due to numeric drift.
        const mask = PLAY_AREA - (zone + 5);
        expect(zoneEliminationPercent(PLAY_AREA, mask, zone)).toBe(0);
    });

    it("returns 0 for a degenerate (zero-area) zone", () => {
        expect(zoneEliminationPercent(PLAY_AREA, PLAY_AREA, 0)).toBe(0);
    });
});
