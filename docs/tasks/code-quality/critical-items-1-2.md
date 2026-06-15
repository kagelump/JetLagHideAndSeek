# Implementation Plan — Critical Audit Items #1 & #2

Plan for the two **Critical** findings in
[`docs/code-quality-audit-2026-06.md`](../../code-quality-audit-2026-06.md):

1. Question schemas + normalization triplicated across persistence/wire/minified.
2. Eligibility-mask pipeline duplicated `MainDrawer` ↔ `NativeMap`
   (polarity-sensitive). **✅ DONE (2026-06-16).**

> **Status:** Item #2 implemented. `buildEligibilityConstraints` gained an
> `overrides` param (`eliminationMath.ts`); `NativeMap.combinedInsideMask` now
> routes through it instead of hand-assembling the required/excluded arrays, so
> `MASK_RULES` is the single source of truth across the HUD, per-question
> contribution, station elimination, and the map overlay. Added render-state
> polarity + override tests to `eliminationMath.test.ts`. `pnpm check` + full
> jest suite green. Item #1 below is not yet started.

> **State of the audit at planning time (re-grepped 2026-06-16).** Line numbers
> in the audit have drifted. Item #2 is **partially already fixed**: the HUD /
> elimination math was extracted into
> [`src/features/map/eliminationMath.ts`](../../../src/features/map/eliminationMath.ts)
> with a data-driven `MASK_RULES` table, consumed by `useEliminationPercentage`
> and `useStationElimination`. `MainDrawer.tsx` no longer hand-builds the mask or
> imports `geomAreaM2`/`asSeparateMaskConstraints`. The **remaining** duplication
> is `NativeMap.tsx` (the map overlay path), which still hand-assembles the same
> constraint arrays inline. The plan below reflects the real current code, not
> the audit's stale citations.

---

## Item #1 — Consolidate question schema + normalization — **✅ DONE (2026-06-16)**

> **Status:** Implemented. New
> [`src/sharing/wire/questionSchemas.ts`](../../../src/sharing/wire/questionSchemas.ts)
> is the single source of truth for the per-question leaf schemas, enums,
> candidate schema, and the two normalizations. `appState.ts` and `schema.ts`
> now import the shared `questionSchema`; the duplicated definitions were
> deleted. The minified codec's loosened `category: z.string()` was tightened to
> the real enums. `questionStore.normalizeQuestionState` collapsed to a thin
> `questionSchema.safeParse` (the four imperative `is*` guards + the unused
> `REVERSE_FIELD_MAP` were removed). The shared `normalizePoiAnswer` preserves an
> explicit tentacles `"negative"`, **fixing the data-loss bug below**. New
> regression suite `__tests__/questionSchemas.test.ts` (7 tests). `pnpm check` +
> full jest suite (90 suites / 1149 tests) green.
>
> **Follow-up — tentacles share, now FIXED (2026-06-16):** the _minified_ wire
> format previously could not carry a tentacles `"negative"` (its answer enum
> was `["p"]` and `unminifyQuestion` re-derived from `selectedOsmId`), so sharing
> a game with a tentacles "None" answer via link/QR lost it. Fixed by widening
> the minified answer enum to `["p", "n"]` and routing `unminifyQuestion`'s
> tentacles branch through the shared `normalizePoiAnswer` (preserve negative,
> else re-derive). Added a minified round-trip regression test. Persistence,
> full-key wire, and minified link/QR now all preserve a tentacles "None".

### Current state (verified)

The per-question Zod schemas exist as three copies that must be hand-synced:

- Persistence: [`src/state/appState.ts:40-270`](../../../src/state/appState.ts)
  (`appState*QuestionSchema`, `appStateQuestionsSchema`).
- Wire: [`src/sharing/wire/schema.ts:35-263`](../../../src/sharing/wire/schema.ts)
  (`*QuestionWireSchema`, `questionWireSchema`) — near-verbatim duplicate.
- Minified: [`src/sharing/wire/minified.ts:95-202`](../../../src/sharing/wire/minified.ts)
  — a hand-divergent third copy that loosens `category` to `z.string().min(1)`,
  so the wire path won't reject a bad category.

The two normalizations (legacy `radius`→`radar`, re-derive POI `answer` from
`selectedOsmId`) are reimplemented **four times, three mechanisms**:

- Imperative type-guards: `normalizeQuestionState`
  [`questionStore.tsx:852-892`](../../../src/state/questionStore.tsx) +
  `isLegacyRadiusQuestion` / `isRadarQuestionWithoutAnswer` / `isMatchingQuestion`
  / `isPoiAnswerQuestion` (`:894-942`).
- Zod `.transform`s in `appState.ts` (tentacles `:251-259`, legacy radius
  `:139-150`) and `schema.ts` (tentacles `:246-254`, legacy radius `:134-145`).
- Manual object-building in `minified.ts:581-779` (`unminifyQuestion`).

### ⚠️ Live correctness bug surfaced while planning

The normalizers **disagree** on a tentacles "negative" (None) answer:

- `derivePoiAnswer` ([`questionRegistry.ts:76`](../../../src/features/questions/questionRegistry.ts))
  only returns `"unanswered" | "positive"` — never `"negative"`.
- The Zod tentacles transforms (`appState.ts:251`, `schema.ts:246`) re-derive
  **unconditionally**: `if (q.answer !== derivedAnswer) return {...q, answer: derivedAnswer}`.
  So a tentacles question with `answer:"negative"`, `selectedOsmId:null` is
  rewritten to `"unanswered"` — **destroying the explicit None answer**.
- `normalizeQuestionState` ([`questionStore.tsx:881-890`](../../../src/state/questionStore.tsx))
  explicitly **preserves** `"negative"` (`if (question.answer === "negative") return question;`).
- `minified.ts:727` uses `derivePoiAnswer(selectedOsmId ?? null)` — also cannot
  produce `"negative"`.

On restore, `importQuestions` runs the Zod schema first (via
`migratePersistedAppState`) **then** `normalizeQuestionState`, so the store's
preservation happens to win on the persistence path — but the wire/minified
paths drop it. This is exactly the silent divergence #1 warns about. The single
shared transform must encode the **preserve-negative** rule once.

### Target

One shared leaf-schema module; the Zod schemas become the only normalizer.

```
src/sharing/wire/questionSchemas.ts   (new — shared leaf schemas + transforms)
  ├── used by  src/state/appState.ts        (persistence full-key schema)
  ├── used by  src/sharing/wire/schema.ts   (wire full-key schema)
  └── used by  src/sharing/wire/minified.ts (minified schema + codec)
```

### Steps

1. **Create `src/sharing/wire/questionSchemas.ts`.** Export the shared leaves
   that are currently copy-pasted:

    - `positionSchema`, `bboxSchema`, `featureCollectionSchema`.
    - `radarDistanceOptionSchema`, `questionAnswerSchema`, `matchingCategorySchema`,
      `measuringCategorySchema`, `tentaclesCategorySchema`,
      `tentaclesDistanceOptionSchema`, the candidate object schema.
    - The two shared transforms as named functions:
      `normalizeLegacyRadiusToRadar(q)` and `normalizePoiAnswer(q)` (the
      tentacles re-derive). `normalizePoiAnswer` must **preserve an explicit
      `"negative"`** before calling `derivePoiAnswer` — fixing the bug above and
      matching `questionStore.tsx:881-890`.
    - Optionally export pre-built per-question object schemas
      (`radarQuestionSchema`, `matchingQuestionSchema`, …) since `appState.ts`
      and `schema.ts` are nearly identical. Watch the two real differences:
      `appStatePlayAreaSchema` requires `osmId` positive + boundary present; the
      wire `playAreaWireSchema` allows optional boundary. Keep play-area schemas
      where they are; only question schemas are shared here.

2. **Rewire `appState.ts` and `schema.ts`** to import from
   `questionSchemas.ts`. Delete the duplicated enum/candidate/transform
   definitions. `appStateQuestionsSchema` and `questionWireSchema` become thin
   `z.union([...])` over the shared schemas. Keep the exported type names
   (`QuestionWireV1`, etc.) stable — they're imported widely.

3. **Tighten `minified.ts` category validation.** Replace the loosened
   `category: z.string().min(1)` in `matchingQuestionMinifiedSchema` /
   `measuringQuestionMinifiedSchema` / `tentaclesQuestionMinifiedSchema` with the
   real category enums from `questionSchemas.ts`, so the wire path rejects bad
   categories instead of silently dropping the question downstream.

4. **Route `minified.ts` answer derivation through the shared transform.**
   `unminifyQuestion` (`:711-758` tentacles, `:598-650` matching) should call the
   shared `normalizePoiAnswer` / `normalizeLegacyRadiusToRadar` rather than
   re-implementing `derivePoiAnswer` inline, so all four paths agree.

5. **Collapse `questionStore`'s imperative normalizer.** Replace
   `normalizeQuestionState` + the four `is*` guards
   ([`questionStore.tsx:852-942`](../../../src/state/questionStore.tsx)) with a
   single `appStateQuestionsSchema.parse`/`safeParse` over the incoming array in
   `importQuestions` (`:374-382`) and `addImportedQuestion` (`:316-345`). The
   schema now does legacy-radius rename + poi-answer derivation, so the bespoke
   guards are redundant. Keep `addImportedQuestion`'s deliberate selection-reset
   (it clears `selectedOsmId` so the re-derive yields `unanswered`) — that's
   intent, not normalization, and stays.

6. **Delete `REVERSE_FIELD_MAP`** (`minified.ts:62-68`) if still unused after
   the rewire (audit notes it's built-but-unused; re-grep before deleting).

### Tests

- `pnpm test -- minified` / `codec` / `questionStore` / `persistence` — existing
  round-trip suites must stay green.
- **Add a regression test** for the tentacles-negative bug: a tentacles question
  with `answer:"negative"`, `selectedOsmId:null` must survive
  (a) `appStateQuestionsSchema.parse`, (b) `questionWireSchema.parse`,
  (c) minified round-trip — all preserving `"negative"`. Today (a)/(b)/(c)
  silently downgrade to `"unanswered"`.
- Add a test that an unknown `category` is **rejected** by the minified schema
  (currently accepted).
- `pnpm typecheck` — the shared-schema refactor is type-heavy; the inferred
  union types must still match `QuestionState` / `QuestionWireV1` consumers.

### Risks

- The wire format is versioned (`version: 1`); this is a **pure refactor** of
  validation/normalization, not a format change — round-trip tests must prove
  byte-identical minified output. Do not bump the version.
- Per-question default differences (e.g. matching `category` default
  `"transit-line"`) must be preserved exactly; diff the inferred types before/after.

---

## Item #2 — Single eligibility-mask assembly

### Current state (verified)

- `eliminationMath.ts` already owns the canonical assembly:
  `buildEligibilityConstraints(zoneFeatures, renderState)` driven by the
  `MASK_RULES` table ([`eliminationMath.ts:46-100`](../../../src/features/map/eliminationMath.ts)).
- `useStationElimination` (`:241-249`) and `useEliminationPercentage` consume it.
  `MainDrawer.tsx` only consumes those hooks — its duplication is **already gone**.
- The remaining duplicate is the **map overlay**:
  [`NativeMap.tsx:232-288`](../../../src/features/map/NativeMap.tsx)
  (`combinedInsideMask` useMemo) hand-assembles the identical required/excluded
  arrays inline, including the per-type `asSeparateMaskConstraints` vs whole-
  collection decisions and the transit-line "pass whole" comment.

Verified the two are **currently consistent** (NativeMap's inline ordering
matches `MASK_RULES` exactly: radar hit=separate/miss=whole, transitLine
hit=whole/miss=whole, osmMatching hit=separate/miss=whole, thermometer
hit=separate/miss=none, tentacles hit=separate/miss=separate, measuring
hit=separate/miss=separate). They can silently drift on the next change — the
exact failure mode the audit calls out.

### One wrinkle: thermometer live-drag override

NativeMap doesn't use the static `renderState.thermometer.hitMaskFeatures`. It
substitutes `thermometerHitMaskFeatures` ([`NativeMap.tsx:189-204`](../../../src/features/map/NativeMap.tsx)),
which during an active drag rebuilds the thermometer family from live drag
positions. `buildEligibilityConstraints` uses the static render state. The shared
builder must accept an override so NativeMap can pass the live mask.

### Target

`NativeMap.combinedInsideMask` calls `buildEligibilityConstraints` +
`buildCombinedEligibilityMask` instead of hand-assembling. `MASK_RULES` becomes
the single source of truth for constraint polarity/decomposition across the HUD,
the per-question contribution stat, station elimination, **and** the map overlay.

### Steps

1. **Add an override seam to `buildEligibilityConstraints`.** Extend the
   signature with an optional per-family hit/miss mask override, e.g.:

    ```ts
    buildEligibilityConstraints(
        zoneFeatures,
        renderState,
        overrides?: Partial<Record<QuestionRenderKey, Partial<MaskFamily>>>,
    )
    ```

    When an override is present for a family, use it in place of
    `renderState[key]`. (Simplest viable alternative: NativeMap builds a shallow-
    merged `renderState` with `thermometer.hitMaskFeatures` replaced and passes
    that — no signature change. Prefer the explicit override param for clarity.)

2. **Rewrite `NativeMap.combinedInsideMask`** (`:232-288`) to:

    ```ts
    const { required, excluded } = buildEligibilityConstraints(
        zoneFeatures,
        questionMapRenderState,
        activeThermometer?.dragging
            ? { thermometer: { hitMaskFeatures: thermometerHitMaskFeatures } }
            : undefined,
    );
    return buildCombinedEligibilityMask(playArea.boundary, required, excluded);
    ```

    Keep the existing `useMemo` dependency list (it already lists every
    hit/miss family + `thermometerHitMaskFeatures`). Delete the inline
    `asSeparateMaskConstraints` calls and the long transit-line comment (its
    rationale now lives next to `MASK_RULES.transitLine = { hit: "whole" }`).

3. **Drop NativeMap's now-unused imports** (`asSeparateMaskConstraints`, and
   `buildCombinedEligibilityMask` only if no longer referenced — it still is).

### Tests

- **Add a render-state polarity test** (per the AGENTS.md mask-polarity rule)
  asserting the constraint arrays from `buildEligibilityConstraints` match the
  expected required/excluded membership for each of the 6 families, including the
  thermometer-drag override path. This is the "single target" the audit asks for.
- `pnpm test -- NativeMap` — must still pass the no-conditional-mount guards.
- `pnpm test -- eliminationMath useStationElimination maskBuilder` — the shared
  builder is now exercised by one more consumer; existing suites guard behavior.
- Snapshot/equality check: the mask produced by the new NativeMap path equals the
  old hand-assembled output for a representative multi-question fixture (prove no
  behavioral change).

### Risks

- Low. NativeMap and the HUD already produce matching constraints; this removes
  the ability to drift, it doesn't change current behavior. The only live-path
  subtlety is the thermometer-drag override — cover it explicitly in the test.

---

## Sequencing & verification

Audit Phase 1 ("stop the bleeding") groups #1 + #2 as mutually reinforcing. Do
**#2 first** (smaller, isolated, no format risk) to validate the
single-source-of-truth approach, then **#1** (wider blast radius, touches
persistence + wire + store).

For each item, before committing:

```bash
pnpm typecheck
pnpm test          # NOT run by pnpm check
pnpm check         # lint + format + perf-typecheck + POI-selector drift
```

#1 touches state + sharing (data-loss-adjacent); after it lands, manually verify
a full export → import → reload round-trip preserves a tentacles "None" answer,
a legacy `radius` question, and a matching question with candidates.

Neither item requires a native rebuild or Maestro run (no native/map-mount or
accessibility surface changes — NativeMap's change is inside an existing
`useMemo`, layers stay permanently mounted).
