# Handoff: Share a question as a deep link (seeker → hider)

Companion to [`plan.md`](./plan.md). Read the plan first for the full design; this
doc records **what is already built**, **key decisions made during
implementation**, and **what remains**.

## Status

Implementation is **functionally complete and type-clean**. Only test-writing
and the final lint/format gate remain.

- Branch: **`feat/share-question-link`** (off `master`).
- `pnpm typecheck` → **0 errors**.
- `pnpm test` → full suite green **except** the new feature still needs its own
  unit/component tests (plan §6). The 2 pre-existing `persistence.test.ts`
  failures caused by the new `gameMode` field have already been fixed.
- Not yet run: `pnpm lint`, `pnpm format:check` (i.e. `pnpm check`). Run these
  before committing — there may be import-order / formatting nits.
- Nothing has been committed yet. No native rebuild needed (no new native deps;
  `@expo/vector-icons` is already a transitive Expo dep, font-based).

## Tasks (TaskList mirror)

1. ✅ Wire: add `question-request` envelope (schema + minified)
2. ✅ Build envelope + share text + answer eval
3. ✅ Share button in question header
4. ✅ Hider/Seeker mode state + Settings toggle
5. ✅ Import: additive add + mode-aware answer
6. ⏳ **Tests + typecheck/lint** ← resume here

## What was built

### 1. Wire format — new `question-request` envelope kind

The codec/link layers are generic over the `WireEnvelope` union, so only the
schema + minifier changed.

- `src/sharing/wire/schema.ts`: extracted `questionWireSchema` (radar | legacy |
  matching union, reused by app-state), added `questionRequestPayloadSchema`
  (`{ createdAt, question, requestId }`) and `questionRequestEnvelopeSchema`,
  grew `wireEnvelopeSchema` discriminated union, exported
  `QuestionRequestEnvelopeV1`, `QuestionRequestPayloadV1`, `QuestionWireV1`.
- `src/sharing/wire/minified.ts`:
    - Added `FIELD_MAP` keys `question: "qq"`, `requestId: "rq"` (every single
      letter a–z was already taken; new keys are 2-char like the existing `cd`).
    - **Refactored** the per-question minify/unminify logic out of
      `minifyEnvelope`/`unminifyEnvelope` into reusable `minifyQuestion` /
      `unminifyQuestion` helpers (behavior preserved — the 56 wire tests still
      pass).
    - `minifyEnvelope` now branches on `env.kind` (no longer throws for
      non-app-state); `unminifyEnvelope` now returns `WireEnvelope` and branches on
      `mini[FIELD_MAP.kind]`. Split into `minifyAppState`/`minifyQuestionRequest`
      and `unminifyAppState`/`unminifyQuestionRequest`.
- `src/sharing/wire/codec.ts`: **unchanged** (generic; verified it still types).

### 2. Export + domain helpers

- `src/sharing/export/buildEnvelope.ts`: added `buildQuestionRequestEnvelope({
question, now? })`. **Strips matching `candidates` (sends `[]`)** to keep links
  short — the recipient re-searches locally.
- `src/features/questions/questionSharePrompt.ts` **(new)**:
  `buildQuestionSharePrompt(question)` → the human sentence used in both the
  share message and the import screen. Radar →
  `"Are you within 5km of (lat, lon)?"` (coords to 5dp, `(lat, lon)` order).
  Matching transit-line → `"Are you on the <line>?"`; other categories →
  `"Do we match on <CategoryTitle> (<target>)?"` via `getCategoryTitle`.
- `src/features/questions/radar/radarAnswer.ts` **(new)**:
  `evaluateRadarAnswer(question, location)` → `"positive"` (within = Hit) /
  `"negative"`, using `haversineDistanceMeters` from `src/shared/geojson.ts`.
  Both `location` and `center` are `[lon, lat]`.

### 3. Share button

- `src/features/questions/ShareQuestionButton.tsx` **(new)**: `Pressable` styled
  like the existing `menuButton`, platform `Ionicons` glyph (`share-outline` on
  iOS / `share-social-outline` on Android). On press: `buildImportLink({
envelope: buildQuestionRequestEnvelope({ question }), mode: "https" })` →
  `Share.share({ message: \`${prompt}\n${url}\` })`(URL only in`message`to
avoid iOS duplicating it; try/catch around the dismiss). testID`question-share-button`, a11y label "Share question".
- `src/features/questions/QuestionDetailScreen.tsx`: `QuestionActionsMenu` now
  renders a `headerActions` row = `[<ShareQuestionButton question={activeQuestion}/>,
<… menu button>]`. Shown for every question type (the existing
  `"center" in activeQuestion` guard already gates it).
- `MainDrawer.tsx` `childHeaderAccessory` was **left as-is** (`minWidth: 94`); two
  44px buttons + 8 gap = 96px and `minWidth` is a floor, so it expands. **Verify
  visually** that the title isn't pushed oddly (see Verification).

### 4. Hider/Seeker mode (persistent, default Seeker)

Stored in the existing **question-settings** persistence slice (lowest-churn;
reuses the whole persist/restore path that already carries `labelLanguage`).

- `src/state/questionStore.tsx`: added `export type GameMode = "hider" |
"seeker"`, `GameModeContext` + `useGameMode()`, `setGameMode` action, `gameMode`
  in `QuestionStateValue` + `QuestionSettingsImportState` +
  `importQuestionSettings` (defaults `"seeker"`), and the `GameModeContext`
  provider in the tree.
- `src/state/appState.ts`: `gameMode: z.enum(["hider","seeker"]).default("seeker")`
  on `appStateQuestionSettingsSchema`; threaded through `createAppStateV1`,
  `appStateQuestionSettingsToImportState`, and the `addMissingV1Slices` default.
- `src/state/AppStateProviders.tsx`: persists `gameMode` (in the questionSettings
  object + effect deps).
- `src/state/maintenance.ts`: `defaultQuestionSettings` gained `gameMode:
"seeker"` (Reset Game resets mode to Seeker — acceptable default).
- `src/features/sheet/SettingsScreen.tsx`: new **"Mode"** section with a
  `SheetListRow` + `Switch` "Hider Mode" (off = Seeker), testID
  `settings-hider-mode-row`.

### 5. Import — additive add + mode-aware answer

- `src/state/questionStore.tsx`: new `addImportedQuestion(question)` action —
  normalizes, assigns a **fresh local id + timestamps**, resets `answer` to
  `"unanswered"`, **appends** (never replaces), sets active.
- `src/sharing/import/applyImport.ts`: `AppStores.questions` gained
  `addImportedQuestion`; added a `question-request` branch that calls it (does
  **not** touch play area / hiding zones).
- `src/sharing/import/QuestionRequestImport.tsx` **(new)**: presentational +
  location logic. Hider + radar → on mount calls `requestUserCoordinate()`,
  shows GPS-based Yes/No verdict (`evaluateRadarAnswer`) with denied/unavailable
  retry; otherwise shows the prompt. Always offers **Add Question** + **Return to
  Map**. testIDs: `question-request-import`, `question-request-answer`,
  `question-request-add-button`, `question-request-return-button`,
  `question-request-retry-button`.
- `src/sharing/import/ImportScreen.tsx`: dispatches by `parsed.envelope.kind`.
  `question-request` → `<QuestionRequestImport … onAddQuestion={applyEnvelope} />`
  (single mutation path via `applyImport`). The app-state preview is now built
  only when `kind === "app-state"` (`buildImportPreview` was narrowed to take
  `AppStateEnvelopeV1`).
- `src/sharing/import/preview.ts`: `buildImportPreview` param narrowed to
  `AppStateEnvelopeV1` (caller guards by kind).

### Gotcha already handled: union-narrowing in existing tests

Widening `WireEnvelope` to 2 members broke ~30 spots in existing tests that
accessed app-state fields without narrowing. Fixed cleanly by **aliasing the
import and wrapping with a local narrowing helper** (no per-call-site edits):

- `minified.test.ts`: local `minifyEnvelope`/`unminifyEnvelope` wrappers narrow to
  app-state.
- `codec.test.ts`: local `decodeEnvelopePayload` wrapper.
- `links.test.ts`: local `parseImportLink` wrapper.

Use this same pattern if you hit more union-narrowing errors.

## Remaining work (Task 6)

### A. Add the new tests (plan §6)

Mirror existing patterns. The component test pattern (render under
`AppStateProviders`, mock `expo-router`'s `useLocalSearchParams`/`useRouter`,
probe store via a child component) is in
`src/sharing/import/__tests__/ImportScreen.test.tsx`. Jest already mocks
MapLibre, gorhom sheet, Reanimated, AsyncStorage, and `expo-location` in
`jest.setup.ts`.

Suggested files:

1. `src/features/questions/radar/__tests__/radarAnswer.test.ts` — inside /
   outside / exactly-on-boundary (`meters === distanceMeters` ⇒ `"positive"`).
2. `src/features/questions/__tests__/questionSharePrompt.test.ts` — radar
   sentence + coord formatting; matching transit-line (with/without lineName);
   another category via `getCategoryTitle`.
3. `src/sharing/__tests__/questionRequestShare.test.ts` (or co-locate under
   `export/__tests__`) — `buildQuestionRequestEnvelope` strips matching
   `candidates`; **round-trip** `encodeEnvelope → decodeEnvelopePayload` returns
   `kind: "question-request"` and the same radar/matching question. This also
   covers the new schema/minified branch end-to-end.
4. `src/sharing/import/__tests__/applyImport.test.ts` (or extend ImportScreen
   test) — a `question-request` envelope calls `addImportedQuestion` and leaves
   play area / hiding zones untouched; appends (doesn't replace existing
   questions).
5. Extend `src/state/__tests__/questionStore.test.tsx` — `addImportedQuestion`
   appends with a fresh id + `unanswered`; `setGameMode`/`useGameMode` and
   restore via `importQuestionSettings`.
6. `QuestionRequestImport` / `ImportScreen` dispatch:
    - **Seeker** (default mode): question-request link shows
      `question-request-add-button`; pressing it appends the question and
      navigates (router.replace mocked).
    - **Hider + radar**: mock `@/shared/location`'s `requestUserCoordinate` to
      return a known `{ status: "granted", coordinate }` and assert
      `question-request-answer` shows "Yes"/"No". Easiest is
      `jest.mock("@/shared/location", …)` so you control the coordinate
      deterministically (don't rely on the generic expo-location mock).
    - To force hider mode in a test, set it before asserting: render a small probe
      that calls `useQuestionActions().setGameMode("hider")`, or seed persisted
      `questionSettings.gameMode = "hider"` in AsyncStorage before render (the
      ImportScreen test clears AsyncStorage in `beforeEach`).
7. Optional: `SettingsScreen.test.tsx` — `settings-hider-mode-row` toggles
   `gameMode` (probe `useGameMode`).

### B. Gate + commit

```bash
pnpm typecheck   # currently 0 errors
pnpm test
pnpm check       # lint + format:check + the data guards — NOT yet run
```

Fix any lint/format nits (import ordering is enforced; new files were written to
match but double-check). Then commit on `feat/share-question-link` with a
Co-Authored-By trailer, and open a PR if desired. **Ask the user before
committing/pushing** unless they've said to proceed.

### C. Manual / native verification (see plan §Verification)

- Dev build: create a radar question → tap the new share button → confirm
  message is `Are you within <d> of (lat, lon)?` + `https://jetlag.hinoka.org/i/?d=…`.
- Open the link with **Hider Mode ON** (Settings) → GPS Yes/No; **OFF** (Seeker)
  → Add Question, and confirm it does **not** wipe existing questions / play area
  / hiding zones.
- Matching/transit-line share → Add-only (no GPS answer) in either mode.
- Eyeball the question detail header: share button sits left of `…`, title not
  shifted. If it looks off, bump `childHeaderAccessory.minWidth` in
  `src/features/sheet/MainDrawer.tsx`.
- Optional device check: `gh workflow run "Maestro E2E" --ref feat/share-question-link -f platform=ios`.

## New files created

- `src/features/questions/radar/radarAnswer.ts`
- `src/features/questions/questionSharePrompt.ts`
- `src/features/questions/ShareQuestionButton.tsx`
- `src/sharing/import/QuestionRequestImport.tsx`

## Out of scope (future, per `docs/sharing_strat.md`)

`question-answer` return link + seeker apply-answer flow (Milestone 4 pt 2); GPS
auto-answer for non-radar; QR for question links.
