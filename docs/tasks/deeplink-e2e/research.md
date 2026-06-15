# Research: Deep-Link E2E Test Suite

Date: 2026-06-15. Audience: junior SWEs. Status: research complete, ready to design.

This doc answers: **what gap are we filling, what already exists that we build on,
and why is a test-only deep link the right tool?** Read it before `design.md`.

---

## 1. The test pyramid today

We have three test layers. Each is good at something and blind to something.

| Layer                                                            | What runs                                                                                                                                                                                                    | Strong at                                                                                                          | Blind to                                                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Jest** (`pnpm test`, ~83 suites)                               | Node + jsdom; MapLibre, bottom sheet, Reanimated, AsyncStorage, `expo-location` are **mocked** (`jest.setup.ts`); geometry runs the **pure-JS** backend (`EXPO_PUBLIC_GEOMETRY_BACKEND` unset ⇒ JS in Jest). | Pure logic: wire codec, selectors, mask polarity at the render-state level, elimination math. Fast, deterministic. | Native GEOS results, real MapLibre rendering, persistence across a real relaunch, deep-link intent handling, the iOS native-style-expression crashes called out in `AGENTS.md`. |
| **GEOS parity** (`pnpm test:geos`, XCTest, Android instrumented) | Real vendored GEOS 3.14.1 vs JS over golden fixtures.                                                                                                                                                        | Cross-engine geometry **parity** on curated fixtures.                                                              | Whole-app behavior — it only checks geometry ops in isolation, not "did answering this question eliminate the right region."                                                    |
| **Maestro E2E** (`e2e/smoke.yaml`, CI `Maestro E2E`)             | Real dev build on a simulator/emulator.                                                                                                                                                                      | Proving the app boots, the sheet opens, the map renders, a tap path doesn't crash.                                 | **Assertions on derived numbers.** Today flows mostly `takeScreenshot` and rely on human eyeballing. Selectors are brittle coordinate taps.                                     |

The **uncovered middle** is: _the real app, on a real device, computing real
derived state with native GEOS and rendering it with native MapLibre, and a
machine checking the numbers are correct._ That is what this epic adds.

---

## 2. Existing research & audit pointers (don't re-derive these)

- **`docs/architecture-audit.md` §4 "Testing Strategy" (lines 160–195)** — the
  canonical list of coverage gaps. It explicitly flags:
    - "E2E brittleness": `play-area.yaml`, `hiding-zone.yaml`, `radar-question.yaml`
      "rely on percentage-coordinate taps (`point: "38%,39%"`) … break if snap
      points, font scale, or safe-area insets change."
    - "Missing E2E": **Deep-link import flow (`/i`)**, pin-drag, play-area error
      paths, hiding-zone radius verification.
    - This epic's deep-link seeding directly removes the coordinate-tap brittleness
      for state setup (we stop _tapping_ state in and start _injecting_ it).
- **`docs/native-geometry/native-module-test-suite-plan.md` (line 69)** — sets the
  policy that "Map rendering, bottom sheet, deep links — that is the 1 Maestro
  smoke's job." We are **extending** that job deliberately, not contradicting it:
  the smoke stays a smoke; these are new, separately-selectable flows.
- **`docs/native-geometry/research-findings/RQ-E1.md`** — the two infra fixes that
  make Maestro green on CI (native-geometry `link:` dep + iOS associated-domains
  gate via `E2E_DISABLE_IOS_ASSOCIATED_DOMAINS`). Our new env flag for test hooks
  follows the same pattern (see design §5).
- **`docs/sharing_strat.md`** — the production deep-link/sharing design. Our
  test-only schema is a _sibling_ of this, not a modification of it. Section 1561:
  "Deep link, QR code, share sheet, pasted URL … should all produce the same
  validated WireEnvelope." We deliberately do **not** route test links through the
  production `WireEnvelope` — see §4 below.
- **`docs/buglist1.md`** + memory `project_gameplay_audit` — the gameplay-audit
  P0s (station-name-length **mask-polarity inversion**, tentacles negative answer)
  are exactly the bug class these tests would have caught end-to-end. Use them as
  the seed scenarios for the polarity tests.

---

## 3. What already exists that we reuse (don't rebuild)

The deep-link import machinery is **already shipped**. We are adding a parallel,
test-only entry point that reuses most of it.

- **Routes.** `app/import.tsx` and `app/i/index.tsx` both render
  `src/sharing/import/ImportScreen.tsx`. The scheme is `jetlag-hide-seek-v2`
  (`app.json` `expo.scheme`; constants in `src/config/appLinks.ts`).
- **Link parsing.** `src/sharing/links/parseLink.ts` →
  `src/sharing/wire/codec.ts` → `src/sharing/wire/schema.ts`
  (`wireEnvelopeSchema`, a discriminated union of `app-state` and
  `question-request`).
- **Apply path.** `src/sharing/import/applyImport.ts` takes a `WireEnvelope` plus
  an `AppStores` adapter and writes into the play-area / hiding-zone / question
  stores. **This is the seam we reuse** — a test scenario is "just" an envelope
  plus the same store writes.
- **Derived state we want to assert on:**
    - `src/features/questions/useQuestionElimination.ts` → `totalPct` (hero stat)
      and `byThisPct` (this question's strict-ordering contribution).
    - `src/features/map/eliminationMath.ts` → `eligibleArea`, `zoneBaselineArea`,
      `zoneEliminationPercent`, `questionContributionPercent`.
    - `src/features/questions/questionGeometry.ts` → `buildQuestionMapRenderState`
      (the overlay GeoJSON that feeds `NativeMap`).
    - Combined eligibility mask: `buildCombinedEligibilityMask` (mask polarity
      convention lives in `maskBuilder.ts`, per `AGENTS.md`).
- **Dev-only screen precedent.** `src/features/sheet/GeometryParityScreen.tsx` is
  already gated by `__DEV__` and runs on-device harnesses. This proves the pattern
  of "test/debug surface that ships disabled" is accepted in this codebase. Our
  debug readout follows it.
- **E2E harness.** `scripts/e2e-maestro-stack.mjs` +
  `scripts/e2e-maestro-stack-config.mjs` start Metro, warm the bundle, run flows
  with 2 retries, capture artifacts. The flow list is the `flows` array in the
  stack script. New flows get registered there. The CI workflow is
  `.github/workflows/maestro-e2e.yml` with a `flow` input.
- **Deep-link-in-Maestro precedent.** `e2e/bootstrap.yaml` and the
  `reconnect.yaml` flow (currently only in worktrees) already use
  `openLink: ${MAESTRO_DEV_CLIENT_URL}`. Maestro's `openLink` is exactly how we'll
  fire a test deep link.

---

## 4. Why a _separate, test-only_ schema (not the production wire format)

The production share format (`wireEnvelopeSchema`) is deliberately constrained:

- **Minified** (`src/sharing/wire/minified.ts` `FIELD_MAP`) to fit QR codes and
  URL length budgets — painful to author by hand in a YAML flow.
- **Only carries shareable game state** — play area, hiding zones, questions. It
  has no concept of "force the GEOS backend on", "set the device location",
  "render the debug overlay", or "this is the answer I expect".
- **Schema-locked at `version: 1`** — we don't want test conveniences leaking into
  the format real users' links must stay compatible with.

A test-only schema removes every one of those constraints:

- **Not minified** — full, readable keys. A junior SWE can read the JSON in a
  flow and understand the scenario.
- **Can carry non-shareable fields** — forced geometry backend, forced location,
  debug-overlay toggle, expected-assertion metadata, even raw seed questions that
  bypass normalization.
- **Free to change** — it lives behind a dev/flag gate and ships disabled, so it
  has no compatibility obligations.
- **Safety boundary stays clean** — production link handling is untouched, so we
  add zero attack surface to the real `/i` route.

The cost is one extra parse path and one extra apply path. Both are thin and
mostly delegate to the existing `applyImport` store writes (design §3).

---

## 5. The hard part: asserting on derived state in Maestro

Maestro drives and reads the **native iOS/Android accessibility tree**, _not_ the
React tree (`AGENTS.md` "React Native E2E and Accessibility"). It can:

- tap by accessibility label / text,
- `assertVisible` / `assertNotVisible` with literal or regex text,
- `takeScreenshot` (proves pixels, **not** correctness).

It **cannot** read a JS variable, a GeoJSON object, or a number that isn't
rendered into a visible, accessible text node. So to assert "total eliminated =
42%", that number must be **rendered as text with a stable accessibility label**.

Two existing facts make this tractable:

1. The derived numbers already exist (`useQuestionElimination`, `eliminationMath`).
2. The hero stat is already shown in the UI — but at low precision and without a
   machine-stable label.

So the design adds a **flag-gated debug-readout surface** that renders the derived
values we care about (elimination %, mask area, overlay feature counts, voronoi
cell counts, active geometry backend) into text nodes with **stable, parseable
accessibility labels** (e.g. `e2e-readout:totalPct=42.13`). Maestro then does
`assertVisible: "e2e-readout:totalPct=42\\..*"`. This is the linchpin of the whole
suite — see design §4.

---

## 6. Candidate scenarios (the payoff — why this is worth building)

These are the things that are **hard or impossible** to cover at the Jest/GEOS
layer and become straightforward with seed-state + readout:

1. **End-to-end elimination math on real GEOS.** Seed play area + hiding-zone
   presets + a radar (miss) + a measuring answer; assert `totalPct` within a
   tolerance band. Jest can't — it runs the JS backend; GEOS parity can't — it
   doesn't run the elimination pipeline.
2. **Mask-polarity regressions (the P0 bug class).** Seed a `station-name-length`
   negative answer; assert the eligible region is on the **correct** side (e.g.
   `eligibleAreaM2` matches the expected side, not its inverse). This is the
   end-to-end guard the name-length inversion bug needed.
3. **Tentacles negative/POI answer.** Seed a tentacles answer; assert the derived
   POI answer and resulting elimination match.
4. **Persistence round-trip.** Seed via deep link → relaunch the app (the
   `reconnect.yaml` pattern) → assert the readout is unchanged. Covers the
   AsyncStorage restore path end-to-end.
5. **Multi-question ordering contribution.** Seed two thermometers + a radar;
   assert each `byThisPct` and that they sum (with overlap) to `totalPct`.
6. **Body-of-water measuring doesn't hard-lock on a real build.** `AGENTS.md`
   warns a stale native binary degrades to a ~25 s JS dissolve. A seeded
   body-of-water measuring scenario with a wall-clock budget catches that
   regression on device.
7. **iOS native-style-expression safety.** Seed overlay geometry with the bounded
   states `AGENTS.md` warns about; assert the map didn't crash (readout still
   visible after render).

Each becomes a small flow once the harness (deep link + readout) exists.

---

## 7. Open questions to resolve in design

- **Encoding of the test payload** — raw JSON in the URL vs base64url. (Design
  picks base64url of un-minified JSON: readable when decoded, no URL-escaping
  pain, no size limit pressure.)
- **Gate mechanism** — `__DEV__` only, or `__DEV__` + `EXPO_PUBLIC_E2E_HOOKS`?
  (Design picks both, so even a dev build is inert unless the flag is set; CI sets
  the flag alongside the existing `E2E_DISABLE_IOS_ASSOCIATED_DOMAINS`.)
- **Readout placement** — overlay on the map screen vs a dedicated route. (Design
  picks a transparent, flag-gated overlay so existing flows can read it without
  navigating.)
- **Tolerance strategy** — geometry differs slightly JS vs GEOS and across
  platforms. (Design picks regex band assertions, not exact equality.)
