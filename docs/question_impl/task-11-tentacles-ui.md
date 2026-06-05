# Task 11: Tentacles UI

**Depends on**: Task 02 (POI answer model), Task 10 (geometry)
**Audience**: senior-ish. New map layer + a POI-as-answer detail screen.

Build the Tentacles detail screen, the radius circle map layer, and wire the
POI-answer model (Task 02) so the answer *is* the chosen place.

## Detail Screen UX

```
┌──────────────────────────────────────┐
│  Category                            │
│  2 km                                │
│  ┌─────────────────────────────────┐ │
│  │ ● Museum    ○ Library           │ │
│  │ ○ Movie Theater   ○ Hospital    │ │
│  └─────────────────────────────────┘ │
│  25 km                               │
│  ┌─────────────────────────────────┐ │
│  │ ○ Metro Line  ○ Zoo             │ │
│  │ ○ Aquarium    ○ Amusement Park  │ │
│  └─────────────────────────────────┘ │
│  My Position  [Set to My Location]   │
│  35.67620, 139.65030                 │
│  Searching within 2 km               │
│                                      │
│  Hider is closest to: (pick one)     │
│  ┌─────────────────────────────────┐ │
│  │ ○ Tokyo National Museum   0.8 km│ │
│  │ ★ Edo-Tokyo Museum        1.1 km│ │  ← the answer
│  │ ○ Mori Art Museum         1.6 km│ │
│  └─────────────────────────────────┘ │
│  Answer: Edo-Tokyo Museum  ✓ [Reset] │
└──────────────────────────────────────┘
```

## Behavior

- **Category picker**: two sections, "2 km" and "25 km". Selecting a category
  sets `distanceOption` + `distanceMeters` from `tentaclesCategoryDistance` /
  `tentaclesDistanceMeters` (no separate distance toggle).
- **Position pin**: `QuestionLocationSelector`; the map pin drags via
  `updateQuestionCenter` (Task 01 widened it for tentacles). Moving the pin
  re-runs the search filtered to the radius.
- **Radius indicator**: subtitle "Searching within 2 km" / "25 km"; the map
  draws the dashed radius via `TentaclesRadiusLayer`.
- **Candidate list = the answer affordance.** This is a **POI answer model**
  question (Task 02), so there is **no** `QuestionAnswerSelector` (no
  Closer/Farther). Tapping a candidate records `selectedOsmId`, `selectedOsmType`,
  **and `selectedName`**, and sets `answer = "positive"`. The list shows in-radius
  POIs sorted by distance from `center`; only these participate in the Voronoi.
- **Reset**: clears `selectedOsmId/Type/Name` and sets `answer = "unanswered"`.
- The "answered?" state everywhere reads through `getQuestionAnswerStatus`
  (Task 02), which checks `selectedOsmId` for poi-model questions.

## Search

### `src/features/questions/tentacles/useTentaclesSearch.ts`

Follow the **real** `useMatchingSearch` contract (epic "Search contract"):
accept `(category, center, distanceMeters)`, map the category to its matching
selector, and return `{ isLoading, error, performSearch }`. The screen calls
`performSearch()`, then filters results to within `distanceMeters` of `center`
(`haversineDistanceMeters`) before writing them onto the question via
`updateQuestion`. For `transit-line`, use the same station-lookup path as
`TransitLineQuestionDetailScreen` (station points within radius), not route
geometry.

## Map layer

### `src/features/map/NativeMap.tsx` — `TentaclesRadiusLayer`

Render `tentacles.radiusOutlineFeature` as a dashed `LineLayer`:

- `lineDasharray: [4, 2]`, width 2, a color distinct from the radar fill (e.g.
  `#FF8C00` orange).
- Visible only on the `question-detail` route. When `radiusOutlineFeature` is
  `null`, the source is empty and nothing renders.
- Place it **between** the Voronoi outline layer and the POI marker layer
  (shapes before markers — conservative ordering per AGENTS.md).

The Tentacles `hitMaskFeatures` / `missMaskFeatures` feed the existing
`combinedInsideMask` / `combinedOutsideMask`; no new fill layers.

## Files

- Replace the Task 01 stub `TentaclesQuestionDetailScreen.tsx`.
- `useTentaclesSearch.ts` (new).
- `NativeMap.tsx` (add `TentaclesRadiusLayer`).
- Selection helper in `questionStore.tsx`:
  `selectTentaclesPoi(question, { osmId, osmType, name })` →
  sets the three selected fields + `answer: "positive"`, bumps `updatedAt`; and
  `resetTentaclesAnswer(question)` → clears them + `answer: "unanswered"`.

## Test plan (write first)

### `__tests__/TentaclesQuestionDetailScreen.test.tsx`

- Picking a category sets `distanceOption`/`distanceMeters` and the "Searching
  within N km" label.
- The screen renders the candidate list **as the answer control** and does
  **not** mount a positive/negative `QuestionAnswerSelector`.
- Tapping a candidate sets `selectedOsmId/Type/Name` and `answer: "positive"`;
  `getQuestionAnswerStatus` reports `"answered"`.
- Reset clears selection and `answer` returns to `"unanswered"`.

### `src/state/__tests__/questionStore.test.tsx` (extend)

- `selectTentaclesPoi` / `resetTentaclesAnswer` behave as specified.

### Maestro (optional)

If Thermometer (Task 09) is already the smoke type, a Tentacles flow is optional;
otherwise add create → pick category → pick POI → radius + cell render.

## Acceptance Criteria

- `pnpm typecheck`, `pnpm test` pass; `pnpm check` for UI lint
- Creating a Tentacles question, picking a category + POI, shows the dashed
  radius circle and the selected cell highlighted, others darkened
- The answer is the named POI (no Closer/Farther control); summary shows
  `selectedName`
- Moving the pin updates candidates and the map
- `transit-line` works via station points
- Serialization round-trip is owned by Task 03
- No regressions to Radar / Matching / Measuring / Thermometer
