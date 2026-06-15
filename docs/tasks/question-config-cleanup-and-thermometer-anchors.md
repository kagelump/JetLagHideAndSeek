# Question Config Cleanup + Thermometer Station Anchors

**Status:** Ready to implement. Self-contained — an agent can execute this end to
end without further context.

**Scope:** three independent-but-ordered parts.

- **Part A — Config cleanup.** Finish making `QuestionDefinition` clean and
  idiomatic (most of this already landed in the working tree; this part files
  off the remaining rough edges).
- **Part B — Per-pin closest-station label.** Show `{closestStation} (300m)`
  under each pin in the Thermometer question sheet.
- **Part C — Rich thermometer share prompt.** Produce
  `"I went {distance} from {startStation} ({startCoord}) to {endStation}
({endCoord}), am I hotter or colder?"`.

Parts B and C share the same new question-state fields, so do B before C.

---

## Background / current state

`QuestionDefinition` is the per-type config map collected in
[questionRegistry.ts](../../src/features/questions/questionRegistry.ts). The
working tree already:

- made `QuestionDefinition<T extends QuestionState = QuestionState>` generic, so
  each config is typed to its own question (`QuestionDefinition<RadarQuestion>`,
  …) and the old `question.type !== "x" ? … : ""` guards are gone;
- moved `sharePrompt` into each `*Config.ts`, leaving
  [questionSharePrompt.ts](../../src/features/questions/questionSharePrompt.ts)
  a one-line delegator;
- unified `title` to `title(question, index?) => string`;
- added `formatCoordinate` to [shared/geojson.ts](../../src/shared/geojson.ts).

Key facts an implementer must respect:

- `QuestionDefinition` uses **method-shorthand syntax** (`sharePrompt(q: T):
string`, not an arrow property) deliberately. Method params are checked
  **bivariantly**, which is what lets each narrowly-typed config satisfy
  `Record<QuestionType, QuestionDefinition>` in `questionDefinitions`. Do not
  "fix" these to arrow properties — it will break `pnpm typecheck`.
- `buildQuestionSharePrompt` is **synchronous** and is called from two places —
  [ShareQuestionButton.tsx:21](../../src/features/questions/ShareQuestionButton.tsx)
  (async handler) and
  [QuestionRequestImport.tsx:34](../../src/sharing/import/QuestionRequestImport.tsx)
  (render-time preview). Keep it sync. That is the central design constraint for
  Part C: the share string must read already-resolved data off the question, not
  perform a spatial/network lookup at share time.
- Nearest-feature lookup is `findMatchingFeaturesWithIndex(category, center,
opts)` in
  [osmMatchingCache.ts](../../src/features/questions/matching/osmMatchingCache.ts).
  It is **async**, resolves the covering region from the point itself (no region
  plumbing needed), and returns candidates carrying `name` and
  `distanceMeters`. The rail-station category id is **`"station-name-length"`**
  (see [measuringCategories.ts:29](../../src/features/questions/measuring/measuringCategories.ts)
  `MEASURING_TO_MATCHING_CATEGORY` and
  [matchingSelectors.ts:59](../../src/features/questions/matching/matchingSelectors.ts)).
  It is bundleable and `isCacheable` returns true for it.

---

## Part A — Config cleanup (idiomatic finish)

Goal: remove the remaining duplication/inconsistency so the config layer reads
cleanly. Small, mechanical, low-risk.

### A1. Document the bivariance requirement

In [questionRegistry.ts](../../src/features/questions/questionRegistry.ts), above
the `QuestionDefinition<T>` type, add a short comment explaining that the
members are written in method-shorthand **on purpose** (bivariant param
checking) so per-type configs satisfy the homogeneous `questionDefinitions`
record, and that converting them to arrow properties will break the build.

### A2. De-duplicate the indexed `title`

Four configs repeat the same `(_question, index?) => index != null ? \`X
${index + 1}\` : "X"`body (matching, measuring, tentacles, thermometer). Add a
factory to`questionRegistry.ts`:

```ts
/**
 * Title builder for question types whose title is just the list label plus the
 * 1-based position (detail views omit the index and show the bare label).
 */
export function indexedTitle(label: string) {
    return (_question: QuestionState, index?: number): string =>
        index != null ? `${label} ${index + 1}` : label;
}
```

Then in each of those four configs replace the inline `title` with
`title: indexedTitle("Matching")` (resp. `"Measuring"`, `"Tentacles"`,
`"Thermometer"`). Leave `radarConfig.title` as-is — it is genuinely
question-dependent (`${distanceOption} Radar`).

### A3. Align measuring `summary` with its `sharePrompt`

[measuringConfig.ts](../../src/features/questions/measuring/measuringConfig.ts)
`summary` still emits the raw category id (`Measuring: ${question.category}` →
`"Measuring: rail-station"`) while `sharePrompt` uses the human title via
`getMeasuringCategoryTitle`. Make `summary` use the same helper:

```ts
summary: (question) => `Measuring: ${getMeasuringCategoryTitle(question.category)}`,
```

Update the assertion in
[measuringConfig.test.ts](../../src/features/questions/measuring/__tests__/measuringConfig.test.ts)
that currently expects `"Measuring: rail-station"` to expect
`"Measuring: Rail Station"`.

### A4. Reuse `formatCoordinate` in the thermometer sheet

[ThermometerQuestionDetailScreen.tsx:14](../../src/features/questions/thermometer/ThermometerQuestionDetailScreen.tsx)
has a local `formatCoord` (4 decimals, no parens). This part of the screen is
rewritten in Part B anyway; when you do, drop the local helper in favor of the
shared `formatCoordinate` (5 decimals, parenthesized) so the sheet and the share
prompt agree on coordinate formatting. (If Part B is deferred, leave A4 out
rather than changing the coord format in isolation.)

### A5. Verify

```bash
pnpm typecheck
pnpm test -- --testPathPattern "Config"
```

---

## Part B — Per-pin closest-station label in the thermometer sheet

Goal: under each pin in the Thermometer sheet, show the nearest rail station and
its distance, e.g. **`Shibuya (300 m)`**. The resolved value is **persisted on
the question** so Part C's share prompt can read it synchronously.

### B1. Extend the question type

In
[thermometerTypes.ts](../../src/features/questions/thermometer/thermometerTypes.ts)
add an anchor shape and two nullable fields:

```ts
/** Nearest rail station to a thermometer pin, resolved from POI data. */
export type ThermometerStationAnchor = {
    /** Station display name, or null when none was found within the radius. */
    name: string | null;
    /** Distance in meters from the pin to that station. null when unresolved. */
    distanceMeters: number | null;
};

export type ThermometerQuestion = BaseQuestion & {
    type: "thermometer";
    answer: QuestionAnswer; // positive = hotter, negative = colder
    previousPosition: Position | null;
    currentPosition: Position | null;
    /** Closest-station anchor for previousPosition. null = not yet resolved. */
    previousStation: ThermometerStationAnchor | null;
    /** Closest-station anchor for currentPosition. null = not yet resolved. */
    currentStation: ThermometerStationAnchor | null;
};
```

Note the **resolved-but-none** vs **unresolved** distinction: a fully-resolved
pin with no nearby station is `{ name: null, distanceMeters: null }` (a non-null
anchor object); an unresolved pin is `null`. The hook (B4) treats a `null`
anchor as "needs resolving".

### B2. Persistence + wire schemas

Both schemas mirror the type. Schema is free to break pre-launch (no
migrations), so just add the fields with safe defaults.

- [appState.ts:185](../../src/state/appState.ts)
  `appStateThermometerQuestionSchema`:

    ```ts
    const appStateThermometerStationSchema = z.object({
        name: z.string().nullable().default(null),
        distanceMeters: z.number().nullable().default(null),
    });
    // inside appStateThermometerQuestionSchema:
    previousStation: appStateThermometerStationSchema.nullable().default(null),
    currentStation: appStateThermometerStationSchema.nullable().default(null),
    ```

- [schema.ts:180](../../src/sharing/wire/schema.ts)
  `thermometerQuestionWireSchema`: add the same two fields (reuse an equivalent
  station sub-schema). Confirm the codec/minify in `src/sharing/wire/` round-trips
  the new optional fields — they default to `null`, so an old payload without
  them parses fine.

### B3. Reset anchors when a pin moves

In [questionStore.tsx:676](../../src/state/questionStore.tsx) `updateThermometerPin`,
clear the anchor for the pin being moved so a stale station never lingers on a
new position. The resolution hook (B4) refills it.

```ts
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
```

Also seed `previousStation`/`currentStation` to `null` wherever a thermometer
question is **created** (the factory near
[questionStore.tsx:810](../../src/state/questionStore.tsx) `case "thermometer"`).

### B4. Resolution hook

Add `src/features/questions/thermometer/useThermometerStationAnchors.ts`. It
resolves the nearest station for any pin that has a position but a `null` anchor,
then writes it back. Key requirements:

- Use `findMatchingFeaturesWithIndex("station-name-length", position, {
maxCandidates: 1, requestedRadiusMeters: ANCHOR_SEARCH_RADIUS_METERS })`. Pick
  `ANCHOR_SEARCH_RADIUS_METERS = 2000` (constant in the hook). The first
  candidate's `name`/`distanceMeters` become the anchor; an empty result becomes
  the resolved-but-none anchor `{ name: null, distanceMeters: null }`.
- **Avoid the write→re-render→re-resolve loop:** only resolve a pin whose anchor
  is `null`. Because the write sets a non-null anchor, the effect won't re-fire
  for the same position.
- **Guard against stale writes** (position changed while the async query was in
  flight): write through `updateQuestion(id, (current) => …)` and, inside the
  updater, bail (return `current` unchanged) if `current.previousPosition` (resp
  `currentPosition`) no longer deep-equals the position you resolved for. Pin
  positions are `[lng, lat]` tuples — compare element-wise.
- Use a per-pin in-flight ref so a given (`pin`, position) is only queried once.
- Tolerate query failure: on throw, leave the anchor `null` (it will retry on a
  later render); do not crash the sheet.

Sketch:

```ts
export function useThermometerStationAnchors(
    question: ThermometerQuestion,
    updateQuestion: ReturnType<typeof useQuestionActions>["updateQuestion"],
): void {
    const inFlight = useRef(new Set<string>()); // keyed by `${pin}:${lng},${lat}`
    useEffect(() => {
        void resolvePin(
            "start",
            question.previousPosition,
            question.previousStation,
        );
        void resolvePin(
            "end",
            question.currentPosition,
            question.currentStation,
        );
        // resolvePin: if position && anchor == null && not in-flight → query →
        // updateQuestion with stale-guard as described above.
    }, [
        question.id,
        question.previousPosition,
        question.currentPosition,
        question.previousStation,
        question.currentStation,
        updateQuestion,
    ]);
}
```

Call it once from `ThermometerQuestionDetailScreen` (it already receives
`question` and `updateQuestion`).

### B5. Render the per-pin label

In
[ThermometerQuestionDetailScreen.tsx](../../src/features/questions/thermometer/ThermometerQuestionDetailScreen.tsx),
under each pin's coordinate text (the Start/End `positionCol`s, ~lines 86–105),
add a station line. Add a small formatter (module-scope in the screen, or export
from `shared/distanceUnits.ts` if you prefer reuse):

```ts
function formatStationLabel(anchor: ThermometerStationAnchor | null): string {
    if (!anchor) return "…"; // resolving
    if (anchor.name == null) return "No station nearby";
    const m = anchor.distanceMeters ?? 0;
    const dist = m < 1000 ? `${Math.round(m)} m` : `${fromMeters(m, "km")} km`;
    return `${anchor.name} (${dist})`;
}
```

Render it with a `testID` per pin (`thermometer-start-station`,
`thermometer-end-station`) and `colors.muted` styling. Only show it when the
corresponding position is set (when "Not set", don't render the station line).

Also apply **A4** here: replace the local `formatCoord` with the shared
`formatCoordinate`.

### B6. Tests

- Jest: a hook/component test that mounts the detail screen with a stubbed
  `findMatchingFeaturesWithIndex` (extend the matching/Overpass mock in
  `jest.setup.ts` rather than ad-hoc mocking — see CLAUDE.md "Testing
  Expectations") and asserts the station line renders `"Shibuya (300 m)"` and
  that `updateQuestion` was called with the resolved anchor. Cover the
  no-station path (`"No station nearby"`).
- Schema round-trip: extend the appState and wire schema tests to assert the new
  fields default to `null` and survive encode/decode.

### B7. Verify

```bash
pnpm typecheck
pnpm test
```

---

## Part C — Rich thermometer share prompt

Goal: replace the static `"Am I getting closer to you?"` with a data-rich prompt
built from the (now-persisted) pin anchors. **Synchronous** — reads only fields
already on the question.

### C1. Rewrite `thermometerConfig.sharePrompt`

In
[thermometerConfig.ts](../../src/features/questions/thermometer/thermometerConfig.ts):

```ts
sharePrompt: (question) => {
    const { previousPosition: from, currentPosition: to } = question;
    if (!from || !to) {
        return "Am I getting closer to you?"; // pins not both set
    }
    const meters = haversineDistanceMeters(from[1], from[0], to[1], to[0]);
    const distance = `${fromMeters(meters, "km")} km`;
    const start = describeAnchor(question.previousStation, from);
    const end = describeAnchor(question.currentStation, to);
    return `I went ${distance} from ${start} to ${end} — am I hotter or colder?`;
},
```

where `describeAnchor` (module-scope helper in the config) degrades gracefully:

```ts
function describeAnchor(
    anchor: ThermometerStationAnchor | null,
    pos: Position,
): string {
    const coord = formatCoordinate(pos);
    return anchor?.name ? `${anchor.name} ${coord}` : coord;
}
```

So the full string is e.g.
`"I went 3.2 km from Shibuya (139.70000, 35.66000) to Shinjuku (139.70100,
35.69000) — am I hotter or colder?"`, and falls back to bare coordinates when a
station hasn't resolved, and to the original static line when the pins aren't
both placed. Imports needed: `haversineDistanceMeters` + `formatCoordinate` from
`@/shared/geojson`, `fromMeters` from `@/shared/distanceUnits`, and the
`ThermometerStationAnchor`/`Position` types.

> Decision: coordinate goes in parentheses as `{Station} (lng, lat)` to match
> `formatCoordinate`'s existing `"(lat, lng)"` output. Note `formatCoordinate`
> prints **lat, lng** order despite the `[lng, lat]` Position — keep using the
> shared helper so all surfaces agree; do not hand-roll a second format.

### C2. Update the test

In
[thermometerConfig.test.ts](../../src/features/questions/thermometer/__tests__/thermometerConfig.test.ts),
replace the static-string assertion with cases for:

1. pins unset → `"Am I getting closer to you?"`;
2. pins set, anchors resolved → full `"I went … from {name} {coord} to {name}
{coord} — am I hotter or colder?"` (compute the expected distance with the
   real `haversineDistanceMeters` so the test isn't brittle to rounding — or
   assert with a `stringContaining`/regex on the station + coord fragments);
3. pins set, anchors `null` → coords-only variant.

Update `makeThermometerStub` to include `previousStation`/`currentStation`
(default `null`) so it matches the new `ThermometerQuestion`.

### C3. Verify

```bash
pnpm typecheck
pnpm test
pnpm check   # lint + format + perf-typecheck + POI-selector drift (does NOT run jest)
```

---

## Why persist the anchor instead of resolving at share time

`buildQuestionSharePrompt` is synchronous and also runs in a **render** path
(import preview), so it cannot `await` a spatial query. Resolving at share time
would also drag a network/Overpass dependency into a "copy link" action and make
the prompt non-deterministic. Persisting the anchor when the pin is placed (the
same place the spatial index is already warm) mirrors how tentacles persists
`selectedName`, keeps the share prompt a pure function of question state, and
guarantees the sheet label and the shared string always agree.

---

## Acceptance criteria

- [ ] A1–A4 applied; `indexedTitle` used by the four index-titled configs;
      measuring `summary` shows the human category title.
- [ ] Thermometer sheet shows `{station} ({distance})` under each set pin, `…`
      while resolving, `No station nearby` when none within 2 km.
- [ ] Moving a pin clears its stale station label, then re-resolves.
- [ ] Share prompt for a fully-placed thermometer reads `"I went {distance} from
{start} to {end} — am I hotter or colder?"`, degrading to coords-only and
      then to the static line.
- [ ] New question-state fields persist (appState) and round-trip (wire) with
      `null` defaults; old payloads still parse.
- [ ] `pnpm typecheck`, `pnpm test`, and `pnpm check` all pass.

## Out of scope

- Station anchors for any question type other than thermometer.
- Letting the user pick a different POI category for the anchor (rail-station is
  fixed).
- Map-tile / offline-pack changes. (Anchor resolution uses whatever POI data is
  already installed; outside a covered region the anchor resolves to
  `No station nearby` via the Overpass fallback or an empty result — acceptable.)
