import type { AppStores } from "@/sharing/import/applyImport";

import { applyE2eScenario } from "../applyE2eScenario";
import type { E2eControlsApi } from "../e2eControls";
import { e2eScenarioSchema, type E2eScenario } from "../scenarioSchema";

function makeStores() {
    const importedPlayAreas: unknown[] = [];
    const replacedSetups: unknown[] = [];
    const importedQuestions: unknown[][] = [];

    const stores: AppStores = {
        hidingZones: { replaceSetup: (s) => void replacedSetups.push(s) },
        playArea: { importPlayArea: (p) => void importedPlayAreas.push(p) },
        questions: {
            addImportedQuestion: () => {},
            importQuestions: (q) => void importedQuestions.push(q),
        },
    };

    return { stores, importedPlayAreas, replacedSetups, importedQuestions };
}

function makeControls() {
    const calls = {
        backend: [] as string[],
        location: [] as [number, number][],
        readout: [] as { show: boolean; name: string; expect: unknown }[],
    };
    const controls: E2eControlsApi = {
        setGeometryBackend: (b) => void calls.backend.push(b),
        setLocation: (l) => void calls.location.push(l),
        setReadout: (show, name, expect) =>
            void calls.readout.push({ show, name, expect }),
    };
    return { controls, calls };
}

function makeScenario(): E2eScenario {
    return e2eScenarioSchema.parse({
        kind: "e2e-scenario",
        name: "seed-1",
        controls: { geometryBackend: "js", location: [139.7, 35.65] },
        state: {
            playArea: {
                bbox: [139.5, 35.5, 140.0, 35.9],
                boundary: { type: "FeatureCollection", features: [] },
                center: [139.75, 35.7],
                label: "Tokyo 23 Wards",
                osmId: 19631009,
                osmType: "R",
            },
            hidingZones: {
                radiusMeters: 800,
                radiusUnit: "m",
                selectedPresetIds: ["jr-yamanote"],
            },
            questions: [
                {
                    answer: "unanswered",
                    center: [139.69171, 35.6895],
                    createdAt: "2026-06-05T00:00:00.000Z",
                    distanceMeters: 5000,
                    distanceOption: "5km",
                    distanceUnit: "m",
                    id: "q-radar-1",
                    isLocked: false,
                    type: "radar",
                    updatedAt: "2026-06-05T00:00:00.000Z",
                },
            ],
        },
        expect: { totalPctMin: 40, totalPctMax: 50 },
    });
}

describe("applyE2eScenario", () => {
    it("seeds play area, hiding zones, and questions via applyImport", () => {
        const { stores, importedPlayAreas, replacedSetups, importedQuestions } =
            makeStores();
        const { controls } = makeControls();

        const result = applyE2eScenario({
            scenario: makeScenario(),
            stores,
            controls,
        });

        expect(result).toEqual({ ok: true });
        expect(importedPlayAreas).toHaveLength(1);
        expect(replacedSetups).toHaveLength(1);
        expect(importedQuestions).toHaveLength(1);
        expect(importedQuestions[0]).toHaveLength(1);
    });

    it("applies controls as specified by the scenario", () => {
        const { stores } = makeStores();
        const { controls, calls } = makeControls();

        applyE2eScenario({ scenario: makeScenario(), stores, controls });

        expect(calls.backend).toEqual(["js"]);
        expect(calls.location).toEqual([[139.7, 35.65]]);
        expect(calls.readout).toEqual([
            {
                show: true,
                name: "seed-1",
                expect: { totalPctMin: 40, totalPctMax: 50 },
            },
        ]);
    });

    it("omits optional controls that the scenario does not set", () => {
        const scenario = e2eScenarioSchema.parse({
            kind: "e2e-scenario",
            name: "minimal",
            state: {
                playArea: {
                    bbox: [139.5, 35.5, 140.0, 35.9],
                    boundary: { type: "FeatureCollection", features: [] },
                    center: [139.75, 35.7],
                    label: "Tokyo 23 Wards",
                    osmId: 19631009,
                    osmType: "R",
                },
            },
        });
        const { stores } = makeStores();
        const { controls, calls } = makeControls();

        applyE2eScenario({ scenario, stores, controls });

        // No geometryBackend / location set → those setters are not called,
        // but the readout is always armed (showReadout defaults to true).
        expect(calls.backend).toEqual([]);
        expect(calls.location).toEqual([]);
        expect(calls.readout).toEqual([
            { show: true, name: "minimal", expect: undefined },
        ]);
    });
});
