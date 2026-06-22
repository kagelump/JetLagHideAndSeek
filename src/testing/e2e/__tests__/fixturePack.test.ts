let mockE2eHooksEnabled = false;

jest.mock("../isE2eHooksEnabled", () => ({
    get E2E_HOOKS_ENABLED() {
        return mockE2eHooksEnabled;
    },
}));

import { installE2eFixturePack } from "../installE2eFixturePack";
import { loadInstalledPacks } from "@/features/offline/regionPacks";
import {
    __clearPackTransitSourcesForTest,
    __getPackTransitSourcesForTest,
} from "@/features/hidingZone/hidingZoneData";

const fixtureAssets = {
    transit: {
        schemaVersion: 1,
        presets: [
            {
                id: "osm-e2e-fixture-coverage",
                label: "Coverage",
                bbox: [139.69, 35.66, 139.78, 35.7],
                stations: [
                    { id: "n1", name: "Shinjuku", lat: 35.69, lon: 139.7 },
                    { id: "n2", name: "Shibuya", lat: 35.66, lon: 139.7 },
                ],
            },
        ],
    },
    meta: {
        schemaVersion: 1,
        regionId: "e2e-fixture",
        label: "E2E fixture",
        bbox: [139.69, 35.66, 139.78, 35.7],
        osmSnapshot: "2026-06-22",
        adminLevels: { matching: [4, 7, 9, 10] },
    },
    manifest: {
        id: "e2e-fixture",
        sourcePbfDate: "2026-06-22",
        version: 1,
        artifacts: {
            "transit.json": {
                sha256: "abc",
                bytes: 100,
                presets: 1,
                stations: 2,
            },
        },
        meta: { sha256: "def", bytes: 100 },
    },
};

beforeAll(() => {
    const mod = require("../installE2eFixturePack");
    mod.__setFixtureAssetsForTest(fixtureAssets);
});

beforeEach(() => {
    __clearPackTransitSourcesForTest();
    mockE2eHooksEnabled = true;
});

afterEach(() => {
    mockE2eHooksEnabled = false;
});

describe("installE2eFixturePack", () => {
    it("no-ops when E2E hooks are disabled", async () => {
        mockE2eHooksEnabled = false;
        await installE2eFixturePack();
        expect(__getPackTransitSourcesForTest().has("e2e-fixture")).toBe(false);
    });

    it("writes the installed index so loadInstalledPacks can register", async () => {
        // installE2eFixturePack writes files + AsyncStorage index.
        // loadInstalledPacks (called separately by AppStateProviders) then
        // registers transit sources from the index.
        await installE2eFixturePack();
        await loadInstalledPacks();

        const sources = __getPackTransitSourcesForTest();
        expect(sources.has("e2e-fixture")).toBe(true);
        const source = sources.get("e2e-fixture")!;
        expect(source.packId).toBe("e2e-fixture");
        expect(source.presetSummaries.length).toBe(1);
        expect(source.path).toMatch(/\/packs\/e2e-fixture\/transit.json$/);
    });
});
