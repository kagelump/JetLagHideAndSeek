import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useMemo,
    useState,
} from "react";

import type { MatchingCategory } from "@/features/questions/matching/matchingTypes";
import {
    type AdminDivisionNamePack,
    type AdminDivisionPresetName,
    DEFAULT_ADMIN_DIVISION_PACK,
    DEFAULT_ADMIN_DIVISION_PRESET_NAME,
} from "@/features/questions/matching/adminDivisionConfig";
import { setDefaultAdminConfig } from "@/features/questions/matching/matchingCategories";
import type { MeasuringCategory } from "@/features/questions/measuring/measuringTypes";
import { radarQuestionConfig } from "@/features/questions/radar/radarConfig";
import {
    type ImplementedQuestionType,
    type QuestionAnswer,
    type QuestionState,
    type QuestionsImportState,
} from "@/features/questions/questionTypes";
import {
    type RadarDistanceOption,
    type RadarQuestion,
    radarDistanceOptionMeters,
} from "@/features/questions/radar/radarTypes";
import {
    type TentaclesCategory,
    type TentaclesQuestion,
    tentaclesCategoryDistance,
    tentaclesDistanceMeters,
} from "@/features/questions/tentacles/tentaclesTypes";
import { type ThermometerQuestion } from "@/features/questions/thermometer/thermometerTypes";
import {
    derivePoiAnswer,
    isPoiAnswerModel,
} from "@/features/questions/questionRegistry";
import { questionSchema } from "@/sharing/wire/questionSchemas";
import { assertNever } from "@/shared/assertNever";
import { offsetPosition, type Position } from "@/shared/geojson";
import {
    fromMeters,
    toMeters,
    type DistanceUnit,
} from "@/shared/distanceUnits";

export type GameMode = "hider" | "seeker";

// ---------------------------------------------------------------------------
// State context — scalar values that change frequently
// ---------------------------------------------------------------------------

type QuestionStateValue = {
    activeQuestionId: string | null;
    adminDivisionPack: AdminDivisionNamePack;
    adminDivisionPresetName: AdminDivisionPresetName;
    gameMode: GameMode;
    isRestored: boolean;
    labelLanguage: "native" | "english";
    seekingStartedAt: number | null;
};

const QuestionStateContext = createContext<QuestionStateValue | null>(null);

export function useQuestionState(): QuestionStateValue {
    const context = useContext(QuestionStateContext);
    if (!context) {
        throw new Error(
            "useQuestionState must be used within QuestionProvider.",
        );
    }
    return context;
}

// ---------------------------------------------------------------------------
// Granular subscriptions — prevent re-renders for consumers that only need a
// scalar value or stable question ordering.
// ---------------------------------------------------------------------------

const LabelLanguageContext = createContext<"native" | "english">("native");
const GameModeContext = createContext<GameMode>("seeker");
const AdminDivisionPackContext = createContext<AdminDivisionNamePack>(
    DEFAULT_ADMIN_DIVISION_PACK,
);
const AdminDivisionPresetNameContext = createContext<AdminDivisionPresetName>(
    DEFAULT_ADMIN_DIVISION_PRESET_NAME,
);
const SeekingStartedAtContext = createContext<number | null>(null);
const QuestionIdsContext = createContext<string[] | null>(null);
const QuestionsByIdContext = createContext<Record<
    string,
    QuestionState
> | null>(null);

export function useLabelLanguage(): "native" | "english" {
    return useContext(LabelLanguageContext);
}

export function useGameMode(): GameMode {
    return useContext(GameModeContext);
}

export function useAdminDivisionPack(): AdminDivisionNamePack {
    return useContext(AdminDivisionPackContext);
}

export function useAdminDivisionPresetName(): AdminDivisionPresetName {
    return useContext(AdminDivisionPresetNameContext);
}

export function useSeekingStartedAt(): number | null {
    return useContext(SeekingStartedAtContext);
}

export function useQuestionIds(): string[] {
    const context = useContext(QuestionIdsContext);
    if (!context) {
        throw new Error("useQuestionIds must be used within QuestionProvider.");
    }
    return context;
}

export function useQuestions(): QuestionState[] {
    const questionIds = useQuestionIds();
    const questionsById = useContext(QuestionsByIdContext);
    if (!questionsById) {
        throw new Error("useQuestions must be used within QuestionProvider.");
    }

    return useMemo(
        () => questionIds.map((questionId) => questionsById[questionId]),
        [questionIds, questionsById],
    );
}

// ---------------------------------------------------------------------------
// Actions context — stable callbacks
// ---------------------------------------------------------------------------

type QuestionActionsValue = {
    addImportedQuestion: (question: QuestionState) => QuestionState;
    createQuestion: (
        type: ImplementedQuestionType,
        options: {
            center: Position;
            category?: MatchingCategory | MeasuringCategory | TentaclesCategory;
        },
    ) => QuestionState;
    deleteQuestion: (questionId: string) => void;
    importQuestionSettings: (settings: QuestionSettingsImportState) => void;
    importQuestions: (questions: QuestionsImportState) => void;
    markRestored: () => void;
    setActiveQuestionId: (questionId: string | null) => void;
    setAdminDivisionPack: (
        packOrUpdater:
            | AdminDivisionNamePack
            | ((prev: AdminDivisionNamePack) => AdminDivisionNamePack),
    ) => void;
    setAdminDivisionPresetName: (name: AdminDivisionPresetName) => void;
    setGameMode: (mode: GameMode) => void;
    setLabelLanguage: (language: "native" | "english") => void;
    setSeekingStartedAt: (timestamp: number | null) => void;
    updateQuestion: (
        questionId: string,
        updater: (question: QuestionState) => QuestionState,
    ) => void;
};

const QuestionActionsContext = createContext<QuestionActionsValue | null>(null);

export function useQuestionActions(): QuestionActionsValue {
    const context = useContext(QuestionActionsContext);
    if (!context) {
        throw new Error(
            "useQuestionActions must be used within QuestionProvider.",
        );
    }
    return context;
}

// ---------------------------------------------------------------------------
// Derived context — computed values derived from state
// ---------------------------------------------------------------------------

type QuestionDerivedValue = {
    activeQuestion: QuestionState | null;
};

const QuestionDerivedContext = createContext<QuestionDerivedValue | null>(null);

export function useQuestionDerived(): QuestionDerivedValue {
    const context = useContext(QuestionDerivedContext);
    if (!context) {
        throw new Error(
            "useQuestionDerived must be used within QuestionProvider.",
        );
    }
    return context;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export type QuestionSettingsImportState = {
    activeQuestionId: string | null;
    adminDivisionPack: AdminDivisionNamePack;
    adminDivisionPresetName: AdminDivisionPresetName;
    gameMode: GameMode;
    labelLanguage: "native" | "english";
    seekingStartedAt: number | null;
};

type NormalizedQuestions = {
    allIds: string[];
    byId: Record<string, QuestionState>;
};

const emptyQuestions: NormalizedQuestions = {
    allIds: [],
    byId: createQuestionsById(),
};

export function QuestionProvider({ children }: { children: ReactNode }) {
    const [questions, setQuestions] =
        useState<NormalizedQuestions>(emptyQuestions);
    const [activeQuestionId, setActiveQuestionIdState] = useState<
        string | null
    >(null);
    const [labelLanguage, setLabelLanguageState] = useState<
        "native" | "english"
    >("native");
    const [gameMode, setGameModeState] = useState<GameMode>("seeker");
    const [adminDivisionPack, setAdminDivisionPackState] =
        useState<AdminDivisionNamePack>(DEFAULT_ADMIN_DIVISION_PACK);
    const [adminDivisionPresetName, setAdminDivisionPresetNameState] =
        useState<AdminDivisionPresetName>(DEFAULT_ADMIN_DIVISION_PRESET_NAME);
    const [isRestored, setIsRestored] = useState(false);
    const [seekingStartedAt, setSeekingStartedAtState] = useState<
        number | null
    >(null);

    const activeQuestion = useMemo(
        () =>
            activeQuestionId
                ? (questions.byId[activeQuestionId] ?? null)
                : null,
        [activeQuestionId, questions.byId],
    );

    const updateQuestion = useCallback(
        (
            questionId: string,
            updater: (question: QuestionState) => QuestionState,
        ) => {
            setQuestions((current) => {
                const question = current.byId[questionId];
                if (!question) return current;

                const updatedQuestion = updater(question);
                if (updatedQuestion === question) return current;
                if (updatedQuestion.id !== question.id) {
                    throw new Error(
                        "updateQuestion cannot change a question id.",
                    );
                }

                const byId = cloneQuestionsById(current.byId);
                byId[questionId] = updatedQuestion;
                return {
                    ...current,
                    byId,
                };
            });
        },
        [],
    );

    const createQuestion = useCallback(
        (
            type: ImplementedQuestionType,
            options: {
                center: Position;
                category?:
                    | MatchingCategory
                    | MeasuringCategory
                    | TentaclesCategory;
            },
        ) => {
            const now = new Date().toISOString();
            const question = createDefaultQuestion(
                type,
                options.center,
                now,
                options.category,
            );
            setQuestions((current) => {
                const byId = cloneQuestionsById(current.byId);
                byId[question.id] = question;
                return {
                    allIds: [...current.allIds, question.id],
                    byId,
                };
            });
            setActiveQuestionIdState(question.id);
            return question;
        },
        [],
    );

    const addImportedQuestion = useCallback((question: QuestionState) => {
        const now = new Date().toISOString();
        // For poi-model questions, clear the entire selection (not just
        // `answer`) so `normalizeQuestionState`'s re-derivation doesn't
        // restore `answer: "positive"` from a still-present `selectedOsmId`.
        // Preserve an explicit "negative" answer (e.g. tentacles "None") since
        // it's a valid answered state with no selection to drift.
        const resetQuestion = isPoiAnswerModel(question.type)
            ? question.answer === "negative"
                ? {
                      ...question,
                      answer: "negative" as const,
                      selectedOsmId: null as null,
                      selectedOsmType: null as null,
                      selectedName: null as null,
                  }
                : {
                      ...question,
                      answer: "unanswered" as const,
                      selectedOsmId: null as null,
                      selectedOsmType: null as null,
                      selectedName: null as null,
                  }
            : { ...question, answer: "unanswered" as const };
        const imported = normalizeQuestionState({
            ...resetQuestion,
            createdAt: now,
            id: createQuestionId(),
            updatedAt: now,
        });
        setQuestions((current) => {
            const byId = cloneQuestionsById(current.byId);
            byId[imported.id] = imported;
            return {
                allIds: [...current.allIds, imported.id],
                byId,
            };
        });
        setActiveQuestionIdState(imported.id);
        return imported;
    }, []);

    const deleteQuestion = useCallback((questionId: string) => {
        setQuestions((current) => {
            if (!hasQuestionId(current.byId, questionId)) return current;

            const byId = cloneQuestionsById(current.byId);
            delete byId[questionId];
            return {
                allIds: current.allIds.filter((id) => id !== questionId),
                byId,
            };
        });
        setActiveQuestionIdState((current) =>
            current === questionId ? null : current,
        );
    }, []);

    const importQuestions = useCallback(
        (nextQuestions: QuestionsImportState) => {
            setQuestions(
                normalizeQuestions(nextQuestions.map(normalizeQuestionState)),
            );
            setActiveQuestionIdState(null);
        },
        [],
    );

    const setActiveQuestionId = useCallback((questionId: string | null) => {
        setActiveQuestionIdState(questionId);
    }, []);

    const setLabelLanguage = useCallback(
        (language: "native" | "english") => {
            setLabelLanguageState(language);
            setDefaultAdminConfig(adminDivisionPack, language);
        },
        [adminDivisionPack],
    );

    const setGameMode = useCallback((mode: GameMode) => {
        setGameModeState(mode);
    }, []);

    const setAdminDivisionPack = useCallback(
        (
            packOrUpdater:
                | AdminDivisionNamePack
                | ((prev: AdminDivisionNamePack) => AdminDivisionNamePack),
        ) => {
            setAdminDivisionPackState((prev) => {
                const next =
                    typeof packOrUpdater === "function"
                        ? (
                              packOrUpdater as (
                                  p: AdminDivisionNamePack,
                              ) => AdminDivisionNamePack
                          )(prev)
                        : packOrUpdater;
                setDefaultAdminConfig(next, labelLanguage);
                return next;
            });
        },
        [labelLanguage],
    );

    const setAdminDivisionPresetName = useCallback(
        (name: AdminDivisionPresetName) => {
            setAdminDivisionPresetNameState(name);
        },
        [],
    );

    const importQuestionSettings = useCallback(
        (settings: QuestionSettingsImportState) => {
            setActiveQuestionIdState(settings.activeQuestionId);
            setLabelLanguageState(settings.labelLanguage ?? "native");
            setGameModeState(settings.gameMode ?? "seeker");
            setSeekingStartedAtState(settings.seekingStartedAt ?? null);
            const pack =
                settings.adminDivisionPack ?? DEFAULT_ADMIN_DIVISION_PACK;
            setAdminDivisionPackState(pack);
            setAdminDivisionPresetNameState(
                settings.adminDivisionPresetName ??
                    DEFAULT_ADMIN_DIVISION_PRESET_NAME,
            );
            // Sync module-level defaults synchronously so non-React code
            // paths (matchingConfig.summary, questionSharePrompt) see the
            // correct admin division labels from the first render.
            setDefaultAdminConfig(pack, settings.labelLanguage ?? "native");
        },
        [],
    );

    const markRestored = useCallback(() => {
        setIsRestored(true);
    }, []);

    const setSeekingStartedAt = useCallback((timestamp: number | null) => {
        setSeekingStartedAtState(timestamp);
    }, []);

    const stateValue = useMemo<QuestionStateValue>(
        () => ({
            activeQuestionId,
            adminDivisionPack,
            adminDivisionPresetName,
            gameMode,
            isRestored,
            labelLanguage,
            seekingStartedAt,
        }),
        [
            activeQuestionId,
            adminDivisionPack,
            adminDivisionPresetName,
            gameMode,
            isRestored,
            labelLanguage,
            seekingStartedAt,
        ],
    );

    const actionsValue = useMemo<QuestionActionsValue>(
        () => ({
            addImportedQuestion,
            createQuestion,
            deleteQuestion,
            importQuestionSettings,
            importQuestions,
            markRestored,
            setActiveQuestionId,
            setAdminDivisionPack,
            setAdminDivisionPresetName,
            setGameMode,
            setLabelLanguage,
            setSeekingStartedAt,
            updateQuestion,
        }),
        [
            addImportedQuestion,
            createQuestion,
            deleteQuestion,
            importQuestionSettings,
            importQuestions,
            markRestored,
            setActiveQuestionId,
            setAdminDivisionPack,
            setAdminDivisionPresetName,
            setGameMode,
            setLabelLanguage,
            setSeekingStartedAt,
            updateQuestion,
        ],
    );

    const derivedValue = useMemo<QuestionDerivedValue>(
        () => ({
            activeQuestion,
        }),
        [activeQuestion],
    );

    return (
        <QuestionStateContext.Provider value={stateValue}>
            <QuestionActionsContext.Provider value={actionsValue}>
                <QuestionDerivedContext.Provider value={derivedValue}>
                    <QuestionIdsContext.Provider value={questions.allIds}>
                        <QuestionsByIdContext.Provider value={questions.byId}>
                            <LabelLanguageContext.Provider
                                value={labelLanguage}
                            >
                                <GameModeContext.Provider value={gameMode}>
                                    <AdminDivisionPackContext.Provider
                                        value={adminDivisionPack}
                                    >
                                        <AdminDivisionPresetNameContext.Provider
                                            value={adminDivisionPresetName}
                                        >
                                            <SeekingStartedAtContext.Provider
                                                value={seekingStartedAt}
                                            >
                                                {children}
                                            </SeekingStartedAtContext.Provider>
                                        </AdminDivisionPresetNameContext.Provider>
                                    </AdminDivisionPackContext.Provider>
                                </GameModeContext.Provider>
                            </LabelLanguageContext.Provider>
                        </QuestionsByIdContext.Provider>
                    </QuestionIdsContext.Provider>
                </QuestionDerivedContext.Provider>
            </QuestionActionsContext.Provider>
        </QuestionStateContext.Provider>
    );
}

// ---------------------------------------------------------------------------
// Pure helper functions (stateless, keep outside context)
// ---------------------------------------------------------------------------

function normalizeQuestions(questions: QuestionState[]): NormalizedQuestions {
    return questions.reduce<NormalizedQuestions>(
        (normalized, question) => {
            if (!hasQuestionId(normalized.byId, question.id)) {
                normalized.allIds.push(question.id);
            }
            normalized.byId[question.id] = question;
            return normalized;
        },
        { allIds: [], byId: createQuestionsById() },
    );
}

function createQuestionsById(): Record<string, QuestionState> {
    return Object.create(null) as Record<string, QuestionState>;
}

function cloneQuestionsById(
    questionsById: Record<string, QuestionState>,
): Record<string, QuestionState> {
    return Object.assign(createQuestionsById(), questionsById);
}

function hasQuestionId(
    questionsById: Record<string, QuestionState>,
    questionId: string,
): boolean {
    return Object.prototype.hasOwnProperty.call(questionsById, questionId);
}

export function getRadarDistanceDisplayValue(question: RadarQuestion): string {
    return fromMeters(question.distanceMeters, question.distanceUnit);
}

export function getRadarDistanceDisplayValueForUnit(
    question: RadarQuestion,
    unit: DistanceUnit,
): string {
    return fromMeters(question.distanceMeters, unit);
}

export function updateQuestionCenter(
    question: QuestionState,
    center: Position,
): QuestionState {
    if (
        question.type !== "radar" &&
        question.type !== "matching" &&
        question.type !== "measuring" &&
        question.type !== "tentacles"
    ) {
        return question;
    }
    return {
        ...question,
        center,
        updatedAt: new Date().toISOString(),
    };
}

export const updateRadarQuestionCenter = updateQuestionCenter;

export function updateRadarAnswer(
    question: RadarQuestion,
    answer: QuestionAnswer,
): RadarQuestion {
    return {
        ...question,
        answer,
        updatedAt: new Date().toISOString(),
    };
}

export function updateRadarDistanceOption(
    question: RadarQuestion,
    option: RadarDistanceOption,
): RadarQuestion {
    const now = new Date().toISOString();
    if (option === "other") {
        return {
            ...question,
            distanceOption: option,
            updatedAt: now,
        };
    }
    return {
        ...question,
        distanceMeters: radarDistanceOptionMeters[option],
        distanceOption: option,
        distanceUnit: "m",
        updatedAt: now,
    };
}

export function updateRadarDistanceValue(
    question: RadarQuestion,
    value: string,
): RadarQuestion {
    const meters = toMeters(value, question.distanceUnit);
    if (meters === null) return question;
    return {
        ...question,
        distanceMeters: meters,
        distanceOption: "other",
        updatedAt: new Date().toISOString(),
    };
}

export function updateRadarDistanceUnit(
    question: RadarQuestion,
    unit: DistanceUnit,
): RadarQuestion {
    return {
        ...question,
        distanceOption: "other",
        distanceUnit: unit,
        updatedAt: new Date().toISOString(),
    };
}

export function updateThermometerPin(
    question: ThermometerQuestion,
    pin: "start" | "end",
    position: Position,
): ThermometerQuestion {
    const isStart = pin === "start";
    return {
        ...question,
        [isStart ? "previousPosition" : "currentPosition"]: position,
        [isStart ? "previousStation" : "currentStation"]: null,
        updatedAt: new Date().toISOString(),
    };
}

// ---------------------------------------------------------------------------
// Tentacles POI answer helpers (Task 02)
// ---------------------------------------------------------------------------

/**
 * Select a POI as the Tentacles answer.
 * This is the *only* function allowed to set a Tentacles question's answer
 * status — it sets all three selected fields AND derives `answer: "positive"`
 * in the same update, preventing the canonical fields from drifting from the
 * derived status.
 */
export function selectTentaclesPoi(
    question: TentaclesQuestion,
    poi: { osmId: number; osmType: "node" | "way" | "relation"; name: string },
): TentaclesQuestion {
    if (poi.osmId <= 0) {
        throw new Error(
            `selectTentaclesPoi: osmId must be positive, got ${poi.osmId}`,
        );
    }
    return {
        ...question,
        answer: derivePoiAnswer(poi.osmId),
        selectedOsmId: poi.osmId,
        selectedOsmType: poi.osmType,
        selectedName: poi.name,
        updatedAt: new Date().toISOString(),
    };
}

/**
 * Select "None" as the Tentacles answer — the hider is not closest to any
 * candidate. Sets `answer: "negative"` and clears all selected fields atomically.
 */
export function selectTentaclesNone(
    question: TentaclesQuestion,
): TentaclesQuestion {
    return {
        ...question,
        answer: "negative",
        selectedOsmId: null,
        selectedOsmType: null,
        selectedName: null,
        updatedAt: new Date().toISOString(),
    };
}

/**
 * Reset a Tentacles question's POI selection.
 * Clears all three selected fields AND sets `answer: "unanswered"` atomically.
 * No UI component or generic action may write a Tentacles `answer` directly.
 */
export function resetTentaclesAnswer(
    question: TentaclesQuestion,
): TentaclesQuestion {
    return {
        ...question,
        answer: "unanswered",
        selectedOsmId: null,
        selectedOsmType: null,
        selectedName: null,
        updatedAt: new Date().toISOString(),
    };
}

function createQuestionId(): string {
    return `q-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
}

function createDefaultQuestion(
    type: ImplementedQuestionType,
    center: Position,
    now: string,
    category?: MatchingCategory | MeasuringCategory | TentaclesCategory,
): QuestionState {
    switch (type) {
        case "radar":
            return {
                answer: radarQuestionConfig.defaultAnswer,
                center,
                createdAt: now,
                distanceMeters: radarDistanceOptionMeters["500m"],
                distanceOption: "500m",
                distanceUnit: "m",
                id: createQuestionId(),
                isLocked: false,
                type: "radar",
                updatedAt: now,
            };
        case "matching":
            return {
                answer: "unanswered",
                candidates: [],
                category: (category as MatchingCategory) ?? "transit-line",
                center,
                createdAt: now,
                id: createQuestionId(),
                isLocked: false,
                lineId: null,
                lineName: null,
                selectedOsmId: null,
                selectedOsmType: null,
                targetName: null,
                targetOsmId: null,
                targetOsmType: null,
                type: "matching",
                updatedAt: now,
            };
        case "measuring":
            return {
                answer: "unanswered",
                category: (category as MeasuringCategory) ?? "park",
                center,
                createdAt: now,
                id: createQuestionId(),
                isLocked: false,
                nearestPoiName: null,
                seekerDistanceMeters: null,
                seekerDistanceUnit: "m",
                type: "measuring",
                updatedAt: now,
            };
        case "thermometer":
            return {
                answer: "unanswered",
                previousPosition: center,
                currentPosition: offsetPosition(center, 300, 90),
                previousStation: null,
                currentStation: null,
                createdAt: now,
                id: createQuestionId(),
                isLocked: false,
                type: "thermometer",
                updatedAt: now,
            };
        case "tentacles": {
            const tentCategory = (category as TentaclesCategory) ?? "museum";
            const distOption = tentaclesCategoryDistance[tentCategory];
            return {
                answer: "unanswered",
                candidates: [],
                category: tentCategory,
                center,
                createdAt: now,
                distanceMeters: tentaclesDistanceMeters[distOption],
                distanceOption: distOption,
                id: createQuestionId(),
                isLocked: false,
                selectedOsmId: null,
                selectedOsmType: null,
                selectedName: null,
                type: "tentacles",
                updatedAt: now,
            };
        }
        default:
            return assertNever(type);
    }
}

/**
 * Normalize a persisted/imported question through the single shared question
 * schema ({@link questionSchema}): legacy `radius` → `radar`, default-filling,
 * transit-line repair, and POI-answer re-derivation (preserving an explicit
 * tentacles "None"). This is the only normalizer — the wire and persistence
 * paths derive from the same schema, so they cannot drift. Falls back to the
 * input on parse failure to stay as lenient as the old imperative guards.
 */
function normalizeQuestionState(question: unknown): QuestionState {
    const parsed = questionSchema.safeParse(question);
    return parsed.success
        ? (parsed.data as QuestionState)
        : (question as QuestionState);
}
