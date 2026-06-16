import { getLastKnownMapCenter, setLastKnownMapCenter } from "../mapCenter";

describe("mapCenter", () => {
    beforeEach(() => {
        // Reset to initial state.
        setLastKnownMapCenter(null as any);
    });

    it("returns null initially", () => {
        // We need a fresh module for this — but since the module-level variable
        // persists, we reset it in beforeEach. If the reset wasn't called,
        // this would still pass because the variable starts as null.
        const center = getLastKnownMapCenter();
        expect(center).toBeNull();
    });

    it("round-trips a coordinate through set and get", () => {
        setLastKnownMapCenter([139.7, 35.7]);
        expect(getLastKnownMapCenter()).toEqual([139.7, 35.7]);
    });

    it("overwrites on multiple writes", () => {
        setLastKnownMapCenter([139.7, 35.7]);
        setLastKnownMapCenter([-0.12, 51.5]);
        expect(getLastKnownMapCenter()).toEqual([-0.12, 51.5]);
    });
});
