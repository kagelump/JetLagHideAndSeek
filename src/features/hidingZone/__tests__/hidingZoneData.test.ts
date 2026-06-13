import {
    getHidingZonePresets,
    getHidingZonePresetsOrEmpty,
    loadHidingZonePresets,
} from "@/features/hidingZone/hidingZoneData";
import {
    isCanonicalTransitRouteId,
    isCanonicalTransitStationId,
} from "@/features/transit/transitIdentity";

// The real hidingZoneData module is globally mocked in jest.setup.ts.
// The mock exposes these test-only helpers; they only exist on the mock.
const mockMod = require("@/features/hidingZone/hidingZoneData") as {
    __addPackPresetForTest: (preset: any) => void;
    registerTransitSource: (
        packId: string,
        path: string,
        summaries: any[],
    ) => void;
    onPackSourcesChanged: (listener: () => void) => () => void;
};

const PACK_PRESET = {
    id: "pack:europe-greater-london:london-underground",
    label: "London Underground",
    operator: "London Underground",
    kind: "operator" as const,
    bbox: [-0.48, 51.4, 0.23, 51.65] as [number, number, number, number],
    defaultColor: "#1f6f78",
    source: {
        kind: "osm-pack" as const,
        namespace: "pack:europe-greater-london",
    },
    routes: [],
    stations: [
        {
            id: "osm:node:780856",
            lat: 51.50607,
            lon: -0.2263134,
            name: "Shepherd's Bush Market",
            routeIds: ["osm:relation:7666927"],
            sourceId: "osm:node:780856",
            mergeKey: "osm:node:780856",
        },
    ],
};

describe("generated hiding-zone preset data", () => {
    beforeAll(() => loadHidingZonePresets());

    // ── Existing tests ─────────────────────────────────────────────────

    it("contains canonical source-adapter transit ids", () => {
        const presets = getHidingZonePresets();
        const allRouteIds = new Set(
            presets.flatMap((preset) => preset.routes.map((route) => route.id)),
        );

        for (const preset of presets) {
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
                            allRouteIds.has(routeId),
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

    // ── Pack transit source coverage ────────────────────────────────────

    describe("pack transit sources", () => {
        it("getHidingZonePresetsOrEmpty includes pack presets", () => {
            mockMod.__addPackPresetForTest(PACK_PRESET);

            const presets = getHidingZonePresetsOrEmpty();
            expect(presets.some((p) => p.id === PACK_PRESET.id)).toBe(true);
        });

        it("getHidingZonePresets includes pack presets after loading", () => {
            mockMod.__addPackPresetForTest(PACK_PRESET);

            const presets = getHidingZonePresets();
            expect(presets.some((p) => p.id === PACK_PRESET.id)).toBe(true);
        });

        it("onPackSourcesChanged listener fires on registerTransitSource", () => {
            let fired = false;
            const unsub = mockMod.onPackSourcesChanged(() => {
                fired = true;
            });

            mockMod.registerTransitSource(
                "test-pack",
                "/path/transit.json",
                [],
            );

            expect(fired).toBe(true);
            unsub();
        });

        it("onPackSourcesChanged unsubscribe stops notifications", () => {
            let count = 0;
            const unsub = mockMod.onPackSourcesChanged(() => {
                count++;
            });

            mockMod.registerTransitSource(
                "test-pack",
                "/path/transit.json",
                [],
            );
            expect(count).toBe(1);

            unsub();
            mockMod.registerTransitSource(
                "test-pack",
                "/path/transit.json",
                [],
            );
            expect(count).toBe(1); // unsubscribed — no second fire
        });
    });
});
