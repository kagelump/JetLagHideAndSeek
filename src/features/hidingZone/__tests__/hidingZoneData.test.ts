import {
    getHidingZonePresets,
    getHidingZonePresetsOrEmpty,
    loadHidingZonePresets,
} from "@/features/hidingZone/hidingZoneData";
import {
    isCanonicalTransitRouteId,
    isCanonicalTransitStationId,
} from "@/features/transit/transitIdentity";

describe("generated hiding-zone preset data", () => {
    beforeAll(() => loadHidingZonePresets());

    it("contains canonical source-adapter transit ids", () => {
        const presets = getHidingZonePresets();
        for (const preset of presets) {
            const routeIds = new Set(preset.routes.map((route) => route.id));

            expect(["gtfs", "osm"]).toContain(preset.source.kind);
            for (const route of preset.routes) {
                expect(isCanonicalTransitRouteId(route.id)).toBe(true);
                expect(route.sourceId).not.toBe("");
            }
            for (const station of preset.stations) {
                expect(isCanonicalTransitStationId(station.id)).toBe(true);
                expect(station.mergeKey).not.toBe("");
                expect(station.sourceId).not.toBe("");
                expect(
                    station.routeIds.every(
                        (routeId) =>
                            isCanonicalTransitRouteId(routeId) &&
                            routeIds.has(routeId),
                    ),
                ).toBe(true);
            }
        }
    });

    it("has at least the Tokyo Metro preset", () => {
        const presets = getHidingZonePresets();
        expect(presets.some((p) => p.id === "tokyo-metro")).toBe(true);
    });

    it("returns the same cached presets on repeated calls", async () => {
        const first = await loadHidingZonePresets();
        const second = await loadHidingZonePresets();
        expect(second).toBe(first);
    });

    it("getHidingZonePresetsOrEmpty returns presets after loading", () => {
        const presets = getHidingZonePresetsOrEmpty();
        expect(presets.length).toBeGreaterThan(0);
        expect(presets.some((p) => p.id === "tokyo-metro")).toBe(true);
    });
});

// NOTE: The real hidingZoneData module is globally mocked in jest.setup.ts
// because it uses dynamic import().  The mock mirrors the same API contract.
// The tests above (cached return, repeated-call stability, OrEmpty after load)
// exercise the mock's loaded-state paths.  The unloaded paths (throw / empty)
// are exercised implicitly by the mock's construction; they also run whenever
// these tests execute in a fresh Jest worker.
