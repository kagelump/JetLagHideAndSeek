# Task 03: Wire Format & Persistence

**Depends on**: Task 01 (type shapes), Task 02 (answer model)
**Audience**: intern-friendly; it's pattern-matching against existing schemas,
but it is load-bearing — without it, sharing/restoring a new question type
silently drops it.

## Why

The epic's Definition of Done requires every question to survive a
serialize/deserialize round-trip, but the sharing/wire layer only knows `radar`,
legacy `radius`, and `matching`. The relevant unions are **closed**:

- `src/sharing/wire/schema.ts` — `questionWireSchema = z.union([radar, legacyRadius, matching])`
- `src/sharing/wire/minified.ts` — compact codecs for radar/matching only

A `measuring` / `thermometer` / `tentacles` question fed through these today
fails Zod parsing and is dropped on share/restore. This task adds full wire +
minified support and round-trip tests for all three.

AsyncStorage persistence (`src/state/persistence.ts` + `questionStore`
`normalizeQuestionState`) stores questions as plain JSON and mostly round-trips
already, but `normalizeQuestionState` has type-specific branches — verify and
extend (see below).

## Test plan (write first)

### `src/sharing/wire/__tests__/codec.test.ts` (extend)

For each of measuring / thermometer / tentacles, build a representative question
(answered, with candidates and a selected POI where applicable) and assert:

- `encode(decode(encode(q))) === encode(q)` (round-trip stable)
- A decoded question deep-equals the original (modulo documented defaults)
- An app-state payload containing one of each new type round-trips with all
  questions preserved (none dropped)

### `src/sharing/wire/__tests__/minified.test.ts` (extend)

- Same round-trip for the minified codec.
- Candidate arrays use the existing `compactCandidate` packing (reuse, don't
  reinvent) so Measuring/Tentacles candidates compress like Matching's.
- A mixed payload (radar + matching + measuring + thermometer + tentacles)
  minifies and expands losslessly.

### `src/state/__tests__/persistence.test.ts` (extend)

- Persist then load an app state containing one of each new type; assert the
  loaded questions deep-equal the saved ones.
- A legacy/unknown question field is tolerated (defaults applied), matching the
  existing matching-schema `.default(...)` behavior.

## Implementation

### `src/sharing/wire/schema.ts`

Add three `z.object` schemas mirroring `matchingQuestionWireSchema`:

- **`measuringQuestionWireSchema`** — `type: z.literal("measuring")`, `answer`,
  `category` (enum of all 18 `MeasuringCategory` values), `center` (position),
  `candidates` (reuse the matching candidate object schema),
  `selectedOsmId`/`selectedOsmType` (nullable, defaults), `seekerDistanceMeters`
  (nullable number), `seekerDistanceUnit` (`["m","km","mi"]`), `id`,
  `createdAt`, `updatedAt`.
- **`thermometerQuestionWireSchema`** — `type: z.literal("thermometer")`,
  `answer`, `previousPosition` (nullable position), `currentPosition` (nullable
  position), `id`, timestamps.
- **`tentaclesQuestionWireSchema`** — `type: z.literal("tentacles")`, `answer`
  (`z.enum(["unanswered","positive"])`), `category` (enum of 8), `center`,
  `distanceMeters`, `distanceOption`, `candidates`, `selectedOsmId`/`Type`
  (nullable), `selectedName` (nullable string), `id`, timestamps.

Extend the union:

```diff
 export const questionWireSchema = z.union([
     radarQuestionWireSchema,
     legacyRadiusQuestionWireSchema,
     matchingQuestionWireSchema,
+    measuringQuestionWireSchema,
+    thermometerQuestionWireSchema,
+    tentaclesQuestionWireSchema,
 ]);
```

Export the inferred types (`MeasuringQuestionWireV1`, etc.) alongside the
existing ones.

> Reuse the existing candidate sub-schema (the `z.object({ lat, lon, name,
> osmId, osmType, tags })` array used by matching) — factor it into a shared
> `candidateWireSchema` const if it isn't already, rather than copy-pasting.

### `src/sharing/wire/minified.ts`

1. Extend `FIELD_MAP` with short keys for any new fields not already mapped
   (`seekerDistanceMeters`, `seekerDistanceUnit`, `previousPosition`,
   `currentPosition`, `distanceMeters`/`distanceOption` already exist via
   radius keys — reuse where the semantics match, add new where they don't).
2. Add a minified schema per new type and extend the minified union.
3. Extend the `minify` switch (currently `if (question.type === "radar") ... `)
   with `measuring` / `thermometer` / `tentacles` branches, reusing
   `compactCandidate` for candidate arrays.
4. Extend the `expand`/decode path symmetrically.

> Keep the field-key additions minimal and documented in the `FIELD_MAP`
> comment block. The wire format has no version bump budget here — these are
> additive within v1 (new `type` literals), so old payloads still parse.

### `src/state/questionStore.tsx` — `normalizeQuestionState`

`normalizeQuestionState` currently special-cases legacy radius, radar-without-
answer, and matching, then falls through to `return question as QuestionState`.
The new types fall through unchanged, which is correct **as long as** their
persisted shape already matches. Verify with the persistence test. If any new
type needs defaulting on restore (e.g. a `candidates: []` fallback, or
`selectedName: null` for older Tentacles payloads written before this task),
add a typed branch following the matching example. Do not broaden the
fall-through to hide missing fields.

## Acceptance Criteria

- `pnpm typecheck`, `pnpm test`, `pnpm check` pass
- Round-trip tests green for all three new types in both the full and minified
  codecs, and in AsyncStorage persistence
- Sharing a payload that mixes all five question types preserves every question
- Old radar/matching/legacy-radius payloads still decode unchanged (no
  regression)
