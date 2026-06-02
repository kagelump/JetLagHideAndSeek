import AsyncStorage from "@react-native-async-storage/async-storage";

import { defaultPlayArea } from "@/features/map/playArea";
import {
    appStateV1Schema,
    createAppStateV1,
    migratePersistedAppState,
} from "@/state/appState";
import {
    clearPersistedAppState,
    loadPersistedAppState,
    persistAppState,
} from "@/state/persistence";
import { queryClient } from "@/state/queryClient";

function makeAppState() {
    return createAppStateV1({
        hidingZones: {
            radiusMeters: 900,
            radiusUnit: "m",
            selectedPresetIds: ["tokyo-metro", "toei"],
        },
        now: new Date("2026-05-18T00:00:00.000Z"),
        playArea: defaultPlayArea,
    });
}

function makeLegacyAppStateWithoutQuestions() {
    const state = makeAppState();
    return {
        hidingZones: state.hidingZones,
        metadata: state.metadata,
        playArea: state.playArea,
        version: state.version,
    };
}

function makeRadarQuestion() {
    return {
        answer: "unanswered" as const,
        center: defaultPlayArea.center,
        createdAt: "2026-05-18T00:00:00.000Z",
        distanceMeters: 500,
        distanceOption: "500m" as const,
        distanceUnit: "m" as const,
        id: "q-1",
        type: "radar" as const,
        updatedAt: "2026-05-18T00:00:00.000Z",
    };
}

function makeMatchingQuestion() {
    return {
        answer: "unanswered" as const,
        candidates: [],
        category: "transit-line" as const,
        center: defaultPlayArea.center,
        createdAt: "2026-05-18T00:00:00.000Z",
        id: "matching-1",
        lineId: "gtfs:test:route:line-1",
        lineName: "Line 1",
        selectedOsmId: null,
        selectedOsmType: null,
        targetName: null,
        targetOsmId: null,
        targetOsmType: null,
        type: "matching" as const,
        updatedAt: "2026-05-18T00:00:00.000Z",
    };
}

function makeLegacyMatchingQuestionWithoutCenter() {
    const question = makeMatchingQuestion();
    delete (question as Partial<ReturnType<typeof makeMatchingQuestion>>)
        .center;
    return question;
}

function makeLegacyRadiusQuestion() {
    return {
        center: defaultPlayArea.center,
        createdAt: "2026-05-18T00:00:00.000Z",
        id: "q-1",
        radiusMeters: 500,
        radiusOption: "500m" as const,
        radiusUnit: "m" as const,
        type: "radius" as const,
        updatedAt: "2026-05-18T00:00:00.000Z",
    };
}

describe("AppStateV1 schema", () => {
    it("parses a valid full app state", () => {
        const state = makeAppState();
        const result = appStateV1Schema.safeParse(state);

        expect(result.success).toBe(true);
        expect(state.questionSettings).toEqual({
            activeQuestionId: null,
            isPinLocked: false,
        });
        expect(state.questions).toEqual([]);
    });

    it("rejects an unknown version through the migration placeholder", () => {
        expect(
            migratePersistedAppState({
                ...makeAppState(),
                version: 2,
            }),
        ).toBeNull();
    });

    it("rejects an invalid play-area shape", () => {
        expect(
            migratePersistedAppState({
                ...makeAppState(),
                playArea: {
                    ...makeAppState().playArea,
                    boundary: undefined,
                },
            }),
        ).toBeNull();
    });

    it("accepts radar questions", () => {
        const state = { ...makeAppState(), questions: [makeRadarQuestion()] };
        expect(migratePersistedAppState(state)).toEqual(state);
    });

    it("accepts matching questions with centers", () => {
        const state = {
            ...makeAppState(),
            questions: [makeMatchingQuestion()],
        };
        expect(migratePersistedAppState(state)).toEqual(state);
    });

    it("clears legacy matching line selections instead of guessing", () => {
        const state = {
            ...makeAppState(),
            questions: [
                {
                    ...makeMatchingQuestion(),
                    answer: "positive" as const,
                    lineId: "tokyo-metro:3",
                },
            ],
        };

        expect(migratePersistedAppState(state)?.questions).toEqual([
            {
                ...makeMatchingQuestion(),
                answer: "unanswered",
                lineId: null,
                lineName: null,
            },
        ]);
    });

    it("backfills older matching question centers from the play area", () => {
        const state = {
            ...makeAppState(),
            questions: [makeLegacyMatchingQuestionWithoutCenter()],
        };
        expect(migratePersistedAppState(state)?.questions).toEqual([
            makeMatchingQuestion(),
        ]);
    });

    it("migrates legacy radius questions to radar questions", () => {
        const state = {
            ...makeAppState(),
            questions: [makeLegacyRadiusQuestion()],
        };
        expect(migratePersistedAppState(state)?.questions).toEqual([
            makeRadarQuestion(),
        ]);
    });

    it("defaults older radar questions without answers to unanswered", () => {
        const questionWithoutAnswer = { ...makeRadarQuestion() };
        delete (
            questionWithoutAnswer as Partial<
                ReturnType<typeof makeRadarQuestion>
            >
        ).answer;
        const state = {
            ...makeAppState(),
            questions: [questionWithoutAnswer],
        };

        expect(migratePersistedAppState(state)?.questions).toEqual([
            makeRadarQuestion(),
        ]);
    });

    it("accepts question settings", () => {
        const state = {
            ...makeAppState(),
            questionSettings: { activeQuestionId: null, isPinLocked: true },
        };
        expect(migratePersistedAppState(state)).toEqual(state);
    });

    it("rejects invalid question shapes", () => {
        expect(
            migratePersistedAppState({
                ...makeAppState(),
                questions: [{ ...makeRadarQuestion(), distanceMeters: -1 }],
            }),
        ).toBeNull();
    });

    it("migrates existing v1 app state without question slices to defaults", () => {
        expect(
            migratePersistedAppState(makeLegacyAppStateWithoutQuestions()),
        ).toEqual(makeAppState());
    });

    it("rejects an invalid hiding-zone shape", () => {
        expect(
            migratePersistedAppState({
                ...makeAppState(),
                hidingZones: {
                    radiusMeters: -1,
                    radiusUnit: "m",
                    selectedPresetIds: [],
                },
            }),
        ).toBeNull();
    });
});

describe("app-state persistence", () => {
    beforeEach(async () => {
        queryClient.clear();
        await AsyncStorage.clear();
    });

    it("returns null when nothing is persisted", async () => {
        const result = await loadPersistedAppState();
        expect(result).toBeNull();
    });

    it("round-trips a full persisted app state", async () => {
        const state = makeAppState();

        await persistAppState(state);

        await expect(loadPersistedAppState()).resolves.toEqual(state);
        await expect(AsyncStorage.getItem("app-state:v1")).resolves.toBeNull();
        await expect(
            AsyncStorage.getItem("app-state:play-area:v1"),
        ).resolves.toBe(JSON.stringify({ osmId: defaultPlayArea.osmId }));
    });

    it("stores custom boundaries separately from the app-state slices", async () => {
        const customPlayArea = {
            ...defaultPlayArea,
            label: "Custom Area",
            osmId: 999999,
        };
        const state = createAppStateV1({
            hidingZones: {
                radiusMeters: 600,
                radiusUnit: "m",
                selectedPresetIds: [],
            },
            playArea: customPlayArea,
        });

        await persistAppState(state);
        queryClient.clear();

        const playAreaReference = await AsyncStorage.getItem(
            "app-state:play-area:v1",
        );
        const boundaryEnvelope = await AsyncStorage.getItem(
            "play-area-boundary:999999",
        );
        expect(playAreaReference).toBe(JSON.stringify({ osmId: 999999 }));
        expect(playAreaReference).not.toContain("boundary");
        expect(JSON.parse(boundaryEnvelope ?? "{}")).toMatchObject({
            label: "Custom Area",
            osmId: 999999,
        });
        await expect(loadPersistedAppState()).resolves.toEqual(state);
    });

    it("loads existing v1 state without question slices as defaults", async () => {
        await AsyncStorage.setItem(
            "app-state:v1",
            JSON.stringify(makeLegacyAppStateWithoutQuestions()),
        );

        await expect(loadPersistedAppState()).resolves.toEqual(makeAppState());
    });

    it("returns null and cleans up corrupted JSON", async () => {
        await AsyncStorage.setItem("app-state:v1", "not json");

        await expect(loadPersistedAppState()).resolves.toBeNull();
        await expect(AsyncStorage.getItem("app-state:v1")).resolves.toBeNull();
    });

    it("returns null and cleans up an invalid app state", async () => {
        await AsyncStorage.setItem(
            "app-state:v1",
            JSON.stringify({ ...makeAppState(), version: 99 }),
        );

        await expect(loadPersistedAppState()).resolves.toBeNull();
        await expect(AsyncStorage.getItem("app-state:v1")).resolves.toBeNull();
    });

    it("removes the persisted app-state key", async () => {
        await persistAppState(makeAppState());

        await clearPersistedAppState();

        await expect(loadPersistedAppState()).resolves.toBeNull();
    });

    // -------------------------------------------------------------------
    // Split-state error-recovery paths (L64–L109 in persistence.ts)
    // -------------------------------------------------------------------

    it("returns null when multiGet throws", async () => {
        (AsyncStorage.multiGet as jest.Mock).mockRejectedValueOnce(
            new Error("Storage unavailable"),
        );

        await expect(loadPersistedAppState()).resolves.toBeNull();
    });

    it("returns null and cleans up when some (but not all) slice keys are populated", async () => {
        // Set only the metadata key — the other keys are absent → partial null.
        await AsyncStorage.setItem(
            "app-state:metadata:v1",
            JSON.stringify(makeAppState().metadata),
        );

        await expect(loadPersistedAppState()).resolves.toBeNull();

        // All split keys should have been cleaned up.
        const metadata = await AsyncStorage.getItem("app-state:metadata:v1");
        expect(metadata).toBeNull();
    });

    it("returns null and cleans up when play area reference is invalid", async () => {
        // A play area reference without osmId.
        await AsyncStorage.multiSet([
            ["app-state:metadata:v1", JSON.stringify(makeAppState().metadata)],
            ["app-state:play-area:v1", JSON.stringify({ notOsmId: true })],
            [
                "app-state:hiding-zones:v1",
                JSON.stringify(makeAppState().hidingZones),
            ],
            [
                "app-state:question-settings:v1",
                JSON.stringify(makeAppState().questionSettings),
            ],
            [
                "app-state:questions:v1",
                JSON.stringify(makeAppState().questions),
            ],
        ]);

        await expect(loadPersistedAppState()).resolves.toBeNull();

        // All split keys should have been cleaned up.
        const playArea = await AsyncStorage.getItem("app-state:play-area:v1");
        expect(playArea).toBeNull();
    });

    it("returns null and cleans up when a slice contains invalid JSON", async () => {
        await AsyncStorage.multiSet([
            ["app-state:metadata:v1", JSON.stringify(makeAppState().metadata)],
            [
                "app-state:play-area:v1",
                JSON.stringify({ osmId: defaultPlayArea.osmId }),
            ],
            ["app-state:hiding-zones:v1", "not valid json at all {{{"],
            [
                "app-state:question-settings:v1",
                JSON.stringify(makeAppState().questionSettings),
            ],
            [
                "app-state:questions:v1",
                JSON.stringify(makeAppState().questions),
            ],
        ]);

        await expect(loadPersistedAppState()).resolves.toBeNull();

        // All split keys should have been cleaned up.
        const hidingZones = await AsyncStorage.getItem(
            "app-state:hiding-zones:v1",
        );
        expect(hidingZones).toBeNull();
    });
});
