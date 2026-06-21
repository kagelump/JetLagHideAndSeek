# Epic: Deep-Link E2E Test Suite

Audience: junior SWEs. Read `research.md` then `design.md` first.

Each task is sized for one person and lists **acceptance criteria** and the
**commands to run**. Tasks are grouped into phases; within a phase, follow the
dependency order. Phases A–C build the harness; Phase D writes the actual tests
that pay it off. **Don't start Phase D scenarios before the C0 spike confirms how
the dev client receives the test link.**

Legend: 🔒 = safety-critical (get a careful review). 🧪 = needs a Jest suite.
🤖 = involves the device/CI.

> **Revalidated 2026-06-22.** Plan re-confirmed against the current tree — every
> reused seam exists, nothing of the harness is built yet. Three task notes were
> corrected since the original write-up (details inline): **B0** — the geometry
> dispatcher memoizes its selection, so the override must reset that cache;
> **C0/C2** — the 2026-06-21 no-console rule bans `console.*` in `src/**`, so the
> readout/controls must use `createLogger` (the `app/e2e` route is exempt);
> **D4** — `reconnect.yaml` currently lives **only** in ephemeral
> `.claude/worktrees/*`, so capture it into `e2e/` before it's GC'd.

---

## Phase A — Schema, parsing, gating (no device needed)

### A0 — Gate constant 🔒🧪 — ✅ DONE (2026-06-22)

Create `src/testing/e2e/isE2eHooksEnabled.ts` exporting
`E2E_HOOKS_ENABLED = __DEV__ && process.env.EXPO_PUBLIC_E2E_HOOKS === "1"`.

- **AC:** Importable from app + tests. Jest suite proves it's `false` when the
  env var is unset and `true` only when both conditions hold (mock `__DEV__` /
  env). No other module reads `EXPO_PUBLIC_E2E_HOOKS` directly — everyone imports
  this constant.
- **Run:** `pnpm test -- isE2eHooksEnabled`.

### A1 — Scenario schema 🧪 — ✅ DONE (2026-06-22)

Create `src/testing/e2e/scenarioSchema.ts` per design §2. Reuse the full-key wire
schemas from `src/sharing/wire/schema.ts` (`playAreaWireSchema`,
`hidingZonesWireSchema`, `questionWireSchema`, `adminDivisionsWireSchema`).

- **AC:** `e2eScenarioSchema` parses a hand-written valid scenario and rejects a
  malformed one with a useful error. `controls.showReadout` defaults to `true`.
  Types exported (`E2eScenario`, `E2eControls`).
- **AC:** A scenario carrying a full `radar` + `measuring` question validates
  (proves the wire-schema reuse actually fits authored questions).
- **Run:** `pnpm test -- scenarioSchema`.

### A2 — Link parse/encode 🧪 — ✅ DONE (2026-06-22)

Create `src/testing/e2e/parseE2eLink.ts`: extract the `d` query param (mirror
`src/sharing/links/parseLink.ts`'s `extractPayload`), base64url-decode (reuse
`src/sharing/wire/base64url.ts`), `JSON.parse`, validate with `e2eScenarioSchema`.
Return a discriminated result `{ ok: true; scenario } | { ok: false; error }`.

- **AC:** Round-trips a scenario (encode in test → parse → deep-equal). Handles
  missing `d`, non-base64, bad JSON, schema-invalid — each a distinct error.
- **Run:** `pnpm test -- parseE2eLink`.

---

## Phase B — Applying scenarios into the app (no device needed)

### B0 — Runtime geometry-backend override 🔒🧪 — ✅ DONE (2026-06-22)

Today the backend is read once from `APP_CONFIG.geometry.backend`
(`src/config/appConfig.ts`, env-derived) and then **memoized**:
`getGeometryBackend()` in `src/shared/geometry/geometryBackend.ts` caches the
selection in a module-level `let _backend` on the first call
(`geometryBackend.ts:144–156`). So the override cannot simply be "consulted after
the env default" — by scenario-apply time `_backend` is usually already set from
app start. Add a small mutable override that the dispatcher honors by **resetting
that memo** (set `_backend = null` so the next call re-selects, or branch on the
override before the cache check). Expose `setGeometryBackendOverride(b)` /
`getActiveGeometryBackend()` in `src/testing/e2e/e2eControls.ts`, and have them
**no-op / report the static value when `E2E_HOOKS_ENABLED` is false**.

- **AC:** With hooks off, behavior is byte-identical to today (override ignored).
  With hooks on, setting `"js"` then `"geos"` flips what the dispatcher uses on
  the **next** `getGeometryBackend()` call (i.e. the memo is invalidated). Jest
  covers both.
- **Caution:** Keep the override read on the hot path cheap (a module-level
  variable, not context). Don't regress geometry perf. Run `pnpm test:geos`
  locally if you touch the dispatcher.
- **Run:** `pnpm test -- e2eControls && pnpm test:geos`.

### B1 — e2e controls store 🧪 — ✅ DONE (2026-06-22)

Flesh out `src/testing/e2e/e2eControls.ts`: a tiny store (module-level or React
context — match neighboring `src/state` patterns) holding
`{ active, name, expect, location }`, plus the backend override from B0. Provide
hooks `useE2eReadoutState()` and setters used by `applyE2eScenario`.

- **AC:** Setters update; hooks read; everything inert when hooks off.
- **Run:** `pnpm test -- e2eControls`.

### B2 — applyE2eScenario 🧪 — ✅ DONE (2026-06-22)

Create `src/testing/e2e/applyE2eScenario.ts` per design §3. Wrap
`scenario.state` in an `app-state` `WireEnvelope` and delegate seeding to the
existing `applyImport` (`src/sharing/import/applyImport.ts`); apply controls
(backend, location, readout) via B1.

- **AC:** Given a scenario with play area + hiding zones + questions, the provided
  store adapter receives the right `importPlayArea` / `replaceSetup` /
  `importQuestions` calls (assert with mock stores, same style as
  `applyImport.test.ts`). Controls set as specified.
- **Run:** `pnpm test -- applyE2eScenario`.

---

## Phase C — Device entry point & readout (device/CI involved)

### C0 — Dev-client deep-link spike 🤖🔒 (**do before any flow work**) — ✅ DONE (2026-06-22)

Determine how Maestro must deliver `jetlag-hide-seek-v2://e2e?d=...` to the **dev
client**. Custom-scheme links may need wrapping in the
`exp+<slug>://expo-development-client/?url=...` form like
`MAESTRO_DEV_CLIENT_URL` in `bootstrap.yaml`, or may route directly once the app
is connected. Try both on a booted sim with a throwaway scenario; document the
working form.

- **AC:** A one-paragraph addendum to `design.md` §5 stating the exact `openLink`
  form that lands on `app/e2e/index.tsx`. A throwaway flow proves the route
  mounts (log a console line from the route on entry — fine here because
  `app/e2e/index.tsx` is under `app/`, outside the `src/**` no-console rule; use
  `createLogger` for anything that stays).
- **Run:** `pnpm test:e2e:ios:stack` (or `:stack` for Android) with a temp flow.

> **RESULT (verified on `iPhone 16 Pro / iOS 18.3`).** The **direct custom
> scheme** `openLink: "jetlag-hide-seek-v2://e2e?d=<base64url>"` routes to
> `app/e2e/index.tsx` after `bootstrap.yaml` connects the dev client; the `d`
> param survives intact (asserted green, single attempt). **No Form-B
> dev-client wrapping needed**; the `/i`-import fallback in the risk note is
> moot. Two timing hazards must be handled in every flow: (1) the **intermittent**
> iOS "Open in <app>?" prompt → tap "Open" _tolerantly_ after a
> `waitForAnimationToEnd` beat; (2) the **cold-connect bundle/a11y settle race**
> → gate asserts on `extendedWaitUntil ready=1`, never a bare `assertVisible`
> (this empirically justifies the §4 `ready=1` sentinel). Full write-up + the
> hardened flow shape: `design.md` §5 + "C0 addendum".
>
> **Throwaway spike artifacts** (delete or fold into C1/C4):
>
> - `app/e2e/index.tsx` — ungated stub; C1 replaces it with the gated impl.
> - `e2e/deeplink-spike.yaml` — the spike flow.
> - the `deeplink-spike` entry in `scripts/e2e-maestro-stack.mjs`'s `flows`
>   array (marked `TEMP`).

### C1 — Gated route 🔒🧪 — ✅ DONE (2026-06-22)

Create `app/e2e/index.tsx`: read `d` via `useLocalSearchParams`; if
`!E2E_HOOKS_ENABLED` render the `+not-found` UI; else parse (A2), apply (B2) using
the same store adapter `ImportScreen` builds, then `router.replace("/")`. On parse
failure, render a visible `testID="e2e-error"` node with the error (so flows can
assert failure paths too).

- **AC:** Jest component test: hooks-off renders not-found and does **not** touch
  stores; hooks-on with a valid `d` calls `applyE2eScenario` and replaces route;
  invalid `d` shows the error node.
- **Run:** `pnpm test -- app/e2e`.

### C2 — Debug readout overlay 🧪 — ✅ DONE (2026-06-22)

Create `src/testing/e2e/E2eDebugReadout.tsx` per design §4 and mount it in
`src/screens/MapAppScreen.tsx`. Start with keys: `name`, `backend`, `ready`,
`totalPct`. Each `Text` uses `accessible` + `accessibilityLabel` in the
`e2e-readout:<key>=<value>` format. `ready=1` renders only once derived state has
settled (no in-flight async geometry derivation).

- **AC:** Returns `null` when hooks off (Jest). When on + a seeded scenario, the
  expected labels render with correctly formatted values. A formatting unit test
  pins `totalPct=42.13`-style output. `pointerEvents="none"`.
- **Caution (iOS a11y):** the readout's value is the `accessibilityLabel`, not
  just the text child — see `AGENTS.md` "React Native E2E and Accessibility".
- **Caution (no-console):** this module and everything else under
  `src/testing/e2e/**` is inside the `src/**` eslint `no-console` zone. Use
  `createLogger("e2e")` for any diagnostics — a bare `console.*` reddens
  `pnpm check`.
- **Run:** `pnpm test -- E2eDebugReadout && pnpm check`.

### C3 — Link-builder CLI + stack wiring 🤖 — ✅ DONE (2026-06-22)

Create `scripts/e2e/build-scenario-link.mjs` (JSON file → encoded
`jetlag-hide-seek-v2://e2e?d=...`). Wire `scripts/e2e-maestro-stack.mjs` to build
links for registered scenarios and inject them into the Maestro `env` map; add
`EXPO_PUBLIC_E2E_HOOKS=1` to that env. Add the same env var to
`.github/workflows/maestro-e2e.yml` before the build step.

- **AC:** Running the builder on `e2e/scenarios/<x>.json` prints a link that C1's
  route parses. Stack script exposes `${E2E_<X>_LINK}` to flows. A node test for
  the builder (round-trip with `parseE2eLink` logic) passes.
- **Run:** `node scripts/e2e/build-scenario-link.mjs e2e/scenarios/<x>.json`.

### C4 — First green flow 🤖 — ✅ DONE (2026-06-22)

> **RESULT.** `E2E_FLOW=deeplink-smoke pnpm test:e2e:ios:stack` passes on the
> `iPhone 16 Pro / iOS 18.3` sim, single attempt. The flow seeds
> `e2e/scenarios/smoke-seed.json` (Tokyo play area + one unanswered radar) via
> the deep link and asserts `e2e-readout:ready=1`, `name=smoke-seed`,
> `backend=js`. The device log confirms the scenario's `geometryBackend: "js"`
> override took effect (`backend=js reason=config`).
>
> **Two implementation findings (folded into design.md):**
>
> - **Maestro `${VAR}` only auto-inherits `MAESTRO_`-prefixed shell vars.** A
>   plain OS env var (`E2E_SMOKE_SEED_LINK`) resolved to the literal `undefined`
>   and `simctl openurl` failed with `NSOSStatusErrorDomain -50`. Fix: the stack
>   injects scenario links via `maestro test --env KEY=VALUE`, not the process
>   env (design §5).
> - **`ready=1` means "derivation settled" (`!isComputing`), not "has a value."**
>   A bare play-area scenario has no hiding-zone stations, so `totalPct` is null,
>   but it has still settled. The readout renders `totalPct` only when a value
>   exists and `ready=1` whenever settled (design §4) — otherwise the smoke flow
>   could never reach `ready=1`.

Author `e2e/scenarios/smoke-seed.json` (play area + one radar question, no answer)
and `e2e/deeplink-smoke.yaml`: bootstrap → openLink → wait `ready=1` → assert
`name` + `backend`. Register it in the stack `flows` array (and
`scripts/e2e-maestro-stack-config.test.mjs` if it enumerates flows).

- **AC:** `E2E_FLOW=deeplink-smoke` passes locally on one platform; the readout
  asserts hold. Artifacts land under `e2e/artifacts/deeplink-smoke/`.
- **Run:** `E2E_FLOW=deeplink-smoke pnpm test:e2e:ios:stack`.

---

## Phase D — Scenario tests (the payoff)

Each is: a `e2e/scenarios/*.json` fixture + a `e2e/*.yaml` flow + registration +
any new readout key it needs (with a unit test). Pick scenarios from
`research.md` §6. Suggested order (cheapest signal first):

### D1 — Elimination math, GEOS backend 🤖

Radar (miss) + measuring answer over a known play area; `controls.geometryBackend
= "geos"`; assert `totalPct` in a band.

- **AC:** Flow passes; band chosen from an observed run, widened ~±5pp.

### D2 — Same scenario, JS backend (parity) 🤖

Reuse D1's fixture with `geometryBackend = "js"`; assert the band overlaps D1.

- **AC:** Both flows green; documents the JS↔GEOS spread for this scenario.

### D3 — Mask polarity (the P0 regression guard) 🤖🔒

Seed a `station-name-length` **negative** answer; expose `eligibleAreaM2`; assert
it matches the **correct** side (not its inverse). Cross-check the expected side
against `maskBuilder.ts` polarity convention + `docs/buglist1.md`.

- **AC:** Flow fails if the mask polarity is inverted (verify by temporarily
  flipping the answer in the fixture and seeing red).

### D4 — Persistence round-trip 🤖

Seed via deep link → relaunch (the `reconnect.yaml` pattern) → assert the readout
is unchanged.

- **Prereq (do early, 2026-06-22):** `reconnect.yaml` exists **only** in ephemeral
  `.claude/worktrees/*` (e.g. `.claude/worktrees/e2e-hardening/e2e/reconnect.yaml`),
  not in the main `e2e/` tree — those worktrees can be garbage-collected at any
  time. Copy it into `e2e/reconnect.yaml` (or re-derive the relaunch pattern:
  re-`openLink` `${MAESTRO_DEV_CLIENT_URL}` without `clearState`) and commit it
  before building this scenario, so the source can't vanish.
- **AC:** Post-relaunch `totalPct` equals pre-relaunch.

### D5 — Multi-question ordering contribution 🤖

Two thermometers + a radar; expose `byThisPct:<id>` keys; assert each contribution
and that the cumulative matches `totalPct`.

- **AC:** Per-question bands hold; sum-with-overlap consistent.

### D6 — Body-of-water measuring wall-clock guard 🤖

Seed a body-of-water measuring scenario; assert `ready=1` appears within a
generous-but-bounded `extendedWaitUntil` (catches the ~25 s JS-dissolve hard-lock
from a stale native binary, per `AGENTS.md`).

- **AC:** Passes on a correctly-built dev client; would time out on the degraded
  path.

### D7 — Overlay safety (iOS native style expressions) 🤖

Seed overlay geometry hitting the bounded states `AGENTS.md` warns about on iOS;
assert `e2e-readout:ready=1` still visible after render (map didn't crash).

- **AC:** Flow green on iOS specifically (`platform=ios`).

---

## Phase E — Docs & CI rollout

### E0 — Developer docs

Add a short "Running deep-link E2E flows" section to `AGENTS.md` (Commands +
Testing Expectations) and a `e2e/scenarios/README.md` explaining the fixture
format and the link builder.

- **AC:** A new contributor can author a scenario and run its flow from the docs
  alone.

### E1 — CI flow selection 🤖

Ensure the new flows are selectable via the workflow `flow` input and decide which
run in the default `platform=all` pre-merge pass vs on-demand. Keep the smoke fast;
gate the heavier scenarios behind explicit selection until stable.

- **AC:** `gh workflow run "Maestro E2E" -f flow=deeplink-smoke` works; the doc
  records which flows are in the default set.

---

## Definition of done (epic)

- Harness (A–C) merged, all hooks **inert in production** (A0/B0/C1 prove it).
- `pnpm check` and `pnpm test` green; `pnpm test:geos` green (B0 touched the
  dispatcher).
- ≥3 Phase-D scenarios green on CI (including D3 polarity guard).
- `AGENTS.md` updated; the suite documented for the next contributor.

## Risks / watch-items

- **C0 is the gating unknown** — if the dev client won't accept the custom-scheme
  test link, fall back to passing the scenario through the existing import route
  with a test-only `kind`, still flag-gated. Resolve before Phase D.
- **Async-derivation races** — always gate numeric asserts on `ready=1`.
- **Float drift** — bands/buckets only, never exact equality (design §6).
- **Don't let the readout become a kitchen sink** — one key per scenario need,
  each with a formatting test.
- **Backend override must not regress geometry perf** (B0) — keep it a cheap
  module-level read.
