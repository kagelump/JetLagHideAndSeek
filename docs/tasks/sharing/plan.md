# Plan: Share a question as a deep link (seeker → hider)

## Context

Today a seeker can only share the **entire game setup** (`app-state` envelope) from
Settings, and importing it **replaces** the receiver's whole game. There is no way to
share a single question, and no way for a hider to get an answer from a shared link.

This adds a **share button** to the question detail header that produces a chat-friendly
link like:

> Are you within 5km of (35.65860, 139.74540)? https://jetlag.hinoka.org/i/?d=<payload>

Opening that link routes to the existing import screen, where behavior depends on a new
**Hider/Seeker mode** (decided: persistent toggle in Settings, default Seeker):

- **Seeker (default):** preview the question + **Add question** (appends to the list, does
  not replace anything).
- **Hider:** for **radar** questions, auto-compute and display the yes/no answer from the
  device's current GPS location (no answer is sent back — the hider relays it in chat).
  For non-radar questions, fall back to the Add-question view.

Scope decisions (confirmed with user): **persistent mode toggle**; share button on **all
question types** (radar auto-answers; matching/transit-line are share + add-only); **no
return/answer link** (one-way `question-request` only).

This is Milestone 4 (part 1) from `docs/sharing_strat.md`. The wire codec, minifier,
link builders, deep-link routes (`app/import.tsx`, `app/i/index.tsx`), AASA/intent
filters, and import screen already exist and are reused as-is — we extend the envelope
union with a second `kind`.

## Existing pieces we reuse (do not rebuild)

- Codec is generic over the `WireEnvelope` union: `encodeEnvelope` / `decodeEnvelopePayload`
  in `src/sharing/wire/codec.ts` need **no changes** once the union grows.
- Link builders: `buildHttpsImportUrl(payload)` → `https://jetlag.hinoka.org/i/?d=...`
  in `src/config/appLinks.ts`; `buildImportLink` in `src/sharing/links/buildLink.ts`.
- Link parsing: `parseImportPayload` in `src/sharing/links/parseLink.ts` already returns
  the decoded `WireEnvelope` union — **no changes**.
- Native share: React Native `Share.share({ message })` (its sheet already includes
  "Copy"), pattern at `src/sharing/export/ShareSetupModal.tsx`.
- Icons: `@expo/vector-icons` is already installed (transitive Expo dep, font-based, no
  native rebuild). Use `Ionicons` `share-outline` on iOS / `share-social-outline` on
  Android via `Platform.OS`.
- Geometry: `haversineDistanceMeters(lat1, lon1, lat2, lon2)` in `src/shared/geojson.ts`.
- Location: `requestUserCoordinate()` in `src/shared/location.ts` (returns `[lon, lat]`
  or a denied/unavailable status; already mocked in `jest.setup.ts`).
- Question label helpers: `radarQuestionConfig` / `matchingQuestionConfig`,
  `getCategoryTitle` (`src/features/questions/matching/matchingCategories.ts`).
- Persistence: split-slice AsyncStorage in `src/state/persistence.ts`; the
  `questionSettings` slice (`src/state/appState.ts`) already persists `labelLanguage` and
  is the home for the new `gameMode` field.

## Implementation

### 1. Wire format — add a `question-request` envelope

**`src/sharing/wire/schema.ts`**

- Extract the existing question union into a named `questionWireSchema =
z.union([radarQuestionWireSchema, legacyRadiusQuestionWireSchema, matchingQuestionWireSchema])`
  and reuse it in `appStatePayloadSchema.questions`.
- Add:
    ```ts
    export const questionRequestPayloadSchema = z.object({
        createdAt: z.string().min(1),
        question: questionWireSchema,
        requestId: z.string().min(1), // future-proofs an answer-return link
    });
    export const questionRequestEnvelopeSchema = z.object({
        kind: z.literal("question-request"),
        payload: questionRequestPayloadSchema,
        version: z.literal(1),
    });
    ```
- Grow the union: `wireEnvelopeSchema = z.discriminatedUnion("kind",
[appStateEnvelopeSchema, questionRequestEnvelopeSchema])`. Export
  `QuestionRequestEnvelopeV1`.

**`src/sharing/wire/minified.ts`**

- Refactor: extract the per-question minify/unminify logic currently inlined in
  `minifyEnvelope` / `unminifyEnvelope` into reusable `minifyQuestion(question)` and
  `unminifyQuestion(q, { createdAt, fallbackCenter, index })` helpers, and call them from
  the app-state branch (behavior unchanged).
- Add `questionRequestPayloadMinifiedSchema` (`createdAt`, `question` reusing the existing
  `radar|matching` minified union, `requestId`) and `questionRequestEnvelopeMinifiedSchema`
  with `[FIELD_MAP.kind]: z.literal("question-request")`; add it to
  `wireEnvelopeMinifiedSchema`. Add `requestId` to `FIELD_MAP` (e.g. `"rq"`).
- Make `minifyEnvelope` branch on `env.kind` (remove the `throw` for non-app-state) and
  change `unminifyEnvelope` to return `WireEnvelope`, branching on `mini[FIELD_MAP.kind]`.
- `codec.ts` (`getUnsupportedVersion` reads `v`, both kinds are `version: 1`) needs no
  logic change — just confirm it typechecks against the widened `unminifyEnvelope` return.

### 2. Build envelope + share text

**`src/sharing/export/buildEnvelope.ts`** — add:

```ts
export function buildQuestionRequestEnvelope({
    question,
    now = new Date(),
}): QuestionRequestEnvelopeV1;
```

For `matching` questions, strip `candidates` (send `[]`) — the recipient re-searches
locally and it keeps the link short.

**New `src/features/questions/questionSharePrompt.ts`** — `buildQuestionSharePrompt(question)`
returns the human sentence used in both the share message and the import display:

- radar → `Are you within ${label} of (${lat}, ${lon})?` where `label` =
  `distanceOption !== "other" ? distanceOption : Math.round(distanceMeters)+"m"`, and
  `lat`/`lon` = `center[1]`/`center[0]` rounded to ~5 dp.
- matching transit-line → `lineName ? "Are you on the "+lineName+"?" : "Which transit line are you on?"`.
- other matching categories → derive from `getCategoryTitle(category)` (generic wording;
  refine later).

**New `src/features/questions/radar/radarAnswer.ts`**:

```ts
export function evaluateRadarAnswer(
    question: RadarQuestion,
    location: Position,
): QuestionAnswer {
    const m = haversineDistanceMeters(
        location[1],
        location[0],
        question.center[1],
        question.center[0],
    );
    return m <= question.distanceMeters ? "positive" : "negative"; // positive = within
}
```

### 3. Share button in the question detail header

**New `src/features/questions/ShareQuestionButton.tsx`** — a `Pressable` styled like the
existing `menuButton`, containing the platform `Ionicons` glyph; `accessibilityLabel="Share question"`,
`testID="question-share-button"`. On press: build envelope → `encodeEnvelope` →
`buildHttpsImportUrl` → `Share.share({ message: \`${buildQuestionSharePrompt(q)}\n${url}\` })`
(put the URL in the message only, to avoid iOS duplicating it; wrap in try/catch).

**`src/features/questions/QuestionDetailScreen.tsx`** — change `QuestionActionsMenu` to
render a `flexDirection:"row", gap:8` container with `[<ShareQuestionButton question={activeQuestion}/>, <existing "..." Pressable>]` before the `Modal`. Show the share button for
every question type that has a `center` (same guard already used at line 90). Verify the
`childHeaderAccessory` width in `src/features/sheet/MainDrawer.tsx` (currently `minWidth:94`)
comfortably fits two 44-wide buttons + gap; widen if needed.

### 4. Hider/Seeker mode state (persistent, default Seeker)

Store `gameMode: "hider" | "seeker"` in the existing **question-settings** slice (lowest
plumbing; reuses the whole persist/restore path that already carries `labelLanguage`).

- **`src/state/questionStore.tsx`**: add `gameMode` to `QuestionStateValue`, a
  `GameModeContext` + `useGameMode()` hook (mirroring `LabelLanguageContext`/`useLabelLanguage`),
  a `setGameMode` action, and include it in `QuestionSettingsImportState` +
  `importQuestionSettings`.
- **`src/state/appState.ts`**: add `gameMode: z.enum(["hider","seeker"]).default("seeker")`
  to `appStateQuestionSettingsSchema`; thread through `createAppStateV1`,
  `appStateQuestionSettingsToImportState`, and the default object in `addMissingV1Slices`.
- **`src/state/AppStateProviders.tsx`**: add `gameMode: questionState.gameMode` to the
  `questionSettings` object in the persist effect and to that effect's dependency array.
- **`src/features/sheet/SettingsScreen.tsx`**: add a `SheetListRow` + `Switch` ("Hider
  Mode", off = Seeker) following the existing English-Labels row, `testID="settings-hider-mode-row"`.
- Note: `Reset Game` clears `questionSettings`, so mode returns to Seeker on reset
  (acceptable default; call out if stickier behavior is wanted later).

### 5. Import — additive add + mode-aware answer

**`src/state/questionStore.tsx`** — add an additive action
`addImportedQuestion(question: QuestionState): QuestionState` that normalizes the question,
assigns a fresh local id + `createdAt/updatedAt`, resets `answer` to `"unanswered"`,
**appends** (does not replace), and sets it active.

**`src/sharing/import/applyImport.ts`** — extend `AppStores.questions` with
`addImportedQuestion` and add a `question-request` branch that calls it. (The hider
answer path is display-only and does not go through `applyImport`.)

**New `src/sharing/import/QuestionRequestImport.tsx`** — renders the question-request UI:

- Derives the prompt via `buildQuestionSharePrompt(envelope.payload.question)`.
- **Hider + radar:** on mount, call `requestUserCoordinate()`; on `granted`, show
  `evaluateRadarAnswer` result as plain language ("✅ You are within 5km" /
  "❌ You are not within 5km"); on denied/unavailable show a message + retry. Always also
  offer **Add question** and **Return to Map**.
- **Seeker, or non-radar:** show the prompt + **Add question** + **Cancel**.
- **Add question** → `applyImport({ envelope, stores })` (additive) → `router.replace("/")`.

**`src/sharing/import/ImportScreen.tsx`** — dispatch by `parsed.envelope.kind`: keep the
existing `app-state` preview/replace UI; when `kind === "question-request"`, render
`<QuestionRequestImport envelope={parsed.envelope} />`. Build the app-state preview only
inside the app-state branch (today `buildImportPreview` is called unconditionally and
assumes app-state).

### 6. Tests (`pnpm test`)

- `schema`/`minified` round-trip for a `question-request` (radar + matching), incl.
  candidate stripping.
- `buildQuestionRequestEnvelope`, `buildQuestionSharePrompt` (radar + matching),
  `evaluateRadarAnswer` (inside / outside / boundary).
- `questionStore`: `addImportedQuestion` appends + fresh id + unanswered; `gameMode`
  get/set + restore via `importQuestionSettings`.
- `applyImport` question-request adds without touching play area / hiding zones.
- `QuestionRequestImport`/`ImportScreen`: seeker→Add path; hider+radar answer path with
  `expo-location` mock returning a known coordinate (assert the displayed yes/no).
- `SettingsScreen`: Hider Mode toggle flips `gameMode`.

## Critical files

| Area              | Files                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wire              | `src/sharing/wire/schema.ts`, `src/sharing/wire/minified.ts` (codec.ts verify-only)                                                                            |
| Export/share text | `src/sharing/export/buildEnvelope.ts`, **new** `src/features/questions/questionSharePrompt.ts`, **new** `src/features/questions/radar/radarAnswer.ts`          |
| Header UI         | **new** `src/features/questions/ShareQuestionButton.tsx`, `src/features/questions/QuestionDetailScreen.tsx`, `src/features/sheet/MainDrawer.tsx` (layout only) |
| Mode state        | `src/state/questionStore.tsx`, `src/state/appState.ts`, `src/state/AppStateProviders.tsx`, `src/features/sheet/SettingsScreen.tsx`                             |
| Import            | `src/sharing/import/applyImport.ts`, `src/sharing/import/ImportScreen.tsx`, **new** `src/sharing/import/QuestionRequestImport.tsx`                             |

## Verification

1. `pnpm typecheck` and `pnpm test` (add the suites above). `pnpm check` for the UI/state
   changes.
2. Manual round-trip in the dev build (`pnpm exec expo start --dev-client ...`):
    - Create a radar question → tap the new share button → confirm the message reads
      "Are you within <d> of (lat, lon)?" + an `https://jetlag.hinoka.org/i/?d=...` link.
    - Open the link on a second device/sim (or paste into the import route):
        - Settings → **Hider Mode ON** → opening shows the GPS-based yes/no.
        - Hider Mode OFF (Seeker) → opening shows the question + **Add question**, and adding
          does **not** wipe existing questions / play area / hiding zones.
    - Share a matching/transit-line question → opening offers **Add question** (no GPS
      answer), regardless of mode.
3. Optional native check: `gh workflow run "Maestro E2E" --ref <branch> -f platform=ios`
   for the bottom-sheet/header accessibility surface.

## Out of scope (future, per `docs/sharing_strat.md`)

- `question-answer` return link + seeker apply-answer flow (Milestone 4 part 2).
- GPS auto-answer for non-radar questions (needs POI lookups).
- QR code for question links (reuse `QRCodeView` later if wanted).
