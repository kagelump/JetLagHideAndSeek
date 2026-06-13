import {
    getHidingZonePresets,
    getHidingZonePresetsOrEmpty,
    loadHidingZonePresets,
} from "@/features/hidingZone/hidingZoneData";

// The real hidingZoneData module is globally mocked in jest.setup.ts.
// The mock exposes these test-only helpers; they only exist on the mock.
const mockMod = require("@/features/hidingZone/hidingZoneData") as {
    __addPackPresetForTest: (preset: any) => void;
    __clearPackTransitSourcesForTest: () => void;
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

describe("hiding-zone preset data (pack-only)", () => {
    beforeEach(() => {
        mockMod.__clearPackTransitSourcesForTest();
    });

    it("returns empty array when no pack sources are registered", async () => {
        const presets = await loadHidingZonePresets();
        expect(presets).toEqual([]);
        expect(getHidingZonePresetsOrEmpty()).toEqual([]);
    });

    it("throws when presets not loaded and no pack presets exist", () => {
        expect(() => getHidingZonePresets()).toThrow("Presets not loaded yet");
    });

    // ── Pack transit source coverage ────────────────────────────────────

    describe("pack transit sources", () => {
        it("returns pack presets after loading", async () => {
            mockMod.__addPackPresetForTest(PACK_PRESET);
            const presets = await loadHidingZonePresets();
            expect(presets.some((p) => p.id === PACK_PRESET.id)).toBe(true);
        });

        it("getHidingZonePresets includes pack presets", () => {
            mockMod.__addPackPresetForTest(PACK_PRESET);
            const presets = getHidingZonePresets();
            expect(presets.some((p) => p.id === PACK_PRESET.id)).toBe(true);
        });

        it("getHidingZonePresetsOrEmpty includes pack presets", () => {
            mockMod.__addPackPresetForTest(PACK_PRESET);
            const presets = getHidingZonePresetsOrEmpty();
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
