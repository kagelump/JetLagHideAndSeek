# Task 09: Thermometer UI

**Depends on**: Task 04 (two-pin selector), Task 08 (geometry)
**Audience**: senior. New interaction + new map layer + planning read-outs.

Build the Thermometer detail screen on top of the two-pin primitive (Task 04)
and the half-plane geometry (Task 08), plus the preview layer in `NativeMap`.

## Product intent (drives the layout)

Thermometer is a **planning tool for halving the remaining hiding space**. The
seeker plans _how far to travel, from where to where, and which question it
spends_ so the bisector cuts the area roughly in half. The travel distance is
usually chosen **after** the two endpoints are placed. Optimize the screen for
that loop: prominent live distance, live half-plane preview, and (stretch) an
approximate area-split read-out.

## Detail Screen UX

```
┌──────────────────────────────────────┐
│                                      │
│  Start (P1)  35.67620, 139.65030  [Set GPS] │
│  End   (P2)  35.68900, 139.70160  [Set GPS] │
│                                      │
│  Distance traveled: 4.3 km           │  ← live, prominent
│  Splits remaining area ~52% / 48%    │  ← stretch (Task 08 helper)
│                                      │
│  Answer  [ Hotter ]  [ Colder ]  [ Reset ] │
│  ⚠ Positions are too close (<100 m)  │  ← only when degenerate
└──────────────────────────────────────┘
```

## Behavior

- **Two pins via Task 04.** Both pins respond to drag based on proximity
  (closest pin within hit radius). There is no active pin selector. Map drag
  commits through the per-pin commit path (Task 04) into the new updaters
  below.
- **Creation seeds an offset end pin.** Create with
  `previousPosition = currentGPS` and `currentPosition = currentGPS shifted a
small amount` (e.g. ~300 m east, comfortably above the 100 m degenerate
  threshold) so the screen does **not** open in the degenerate warning state.
  Default `activePin = "end"`. (Confirmed product decision.)
- **Set GPS** buttons set the respective pin to current GPS.
- **Live distance** via `haversineDistanceMeters(P1, P2)`; show in km (app
  default unit). Updates as pins move.
- **Answer selector** `QuestionAnswerSelector` "Hotter"/"Colder"; the half-plane
  overlay appears once both pins are set and an answer is chosen.
- **Degenerate state**: if `dist(P1,P2) < 100 m`, show the inline warning and
  disable the answer selector (geometry already returns empty in this case).

## Files

### `src/state/questionStore.tsx` — pin updaters

Add `updateThermometerPin(question, "start" | "end", position)` returning a new
question with the chosen position updated and `updatedAt` bumped. (Recall Task 01
deliberately made `updateQuestionCenter` a no-op for thermometer; this is the
dedicated path.) Wire it into the Task 04 per-pin commit callback.

### `src/features/questions/thermometer/ThermometerQuestionDetailScreen.tsx`

Replace the Task 01 stub. Compose: activePin toggle, two coordinate rows with
Set-GPS buttons (reuse `QuestionLocationSelector` per pin, or a thin two-pin
wrapper), live distance, optional area-split line, `QuestionAnswerSelector`, and
the degenerate warning. Use stable testIDs (`thermometer-active-pin-start`,
`-end`, `thermometer-distance`, answer selector prefix) — see the E2E note below.

### `src/features/map/NativeMap.tsx` — preview layer

Add a `ThermometerPreviewLayer` rendering `thermometer.previewFeatures`:

- `role === "travel-line"`: thin solid `LineLayer`, muted (`#888888`), width 2.
- `role` ∈ ring roles: dashed `LineLayer`, same muted color, width 1, via
  `lineDasharray` (use a `LineLayer`, not a `FillLayer`, so rings don't obscure
  the map).

Visible only when the active route is `question-detail` (same rule as
`OsmMatchingLayers` / `VoronoiOutlineLayers`). Keep layer ordering conservative
(shapes before markers). The `hitMaskFeatures` feed the existing
`combinedInsideMask` — no new fill layer.

## Test plan (write first)

### `__tests__/ThermometerQuestionDetailScreen.test.tsx`

- "Set GPS" on a pin updates that pin via `updateThermometerPin` (GPS mocked).
- Live distance reflects pin positions.
- Answer selector disabled while degenerate (<100 m), enabled otherwise.
- Selecting Hotter/Colder updates the question answer.

### `src/state/__tests__/questionStore.test.tsx` (extend)

- `updateThermometerPin` updates only the targeted pin and bumps `updatedAt`.

### Maestro smoke (add to existing flow)

Cover create → drag end pin (or Set GPS) → select Hotter → overlay present. Put
testIDs on native-accessible targets; iOS number pads / empty inputs are flaky
(see AGENTS.md "React Native E2E and Accessibility"). Thermometer is the
recommended new type for the smoke flow because it exercises the novel two-pin
interaction and a new map layer.

## Acceptance Criteria

- `pnpm typecheck`, `pnpm test` pass; `pnpm check` for UI lint
- Fresh Thermometer opens **without** a degenerate warning (offset end pin)
- Range rings (1/5/15 km from P1) and travel line render while editing
- Hotter darkens the P1-side; Colder darkens the P2-side; dragging either pin
  updates live
- Degenerate state warns and disables the answer
- Maestro smoke covers create → answer
- Serialization round-trip is owned by Task 03
- No regressions to Radar / Matching / Measuring
