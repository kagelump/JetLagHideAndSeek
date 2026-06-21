# Design: Deep-Link E2E Test Suite

Audience: junior SWEs. Read `research.md` first. This doc is the technical design
the epic (`epic.md`) decomposes into tasks.

The suite has two halves:

- **A — Seed state via a test-only deep link.** Inject a complete, un-minified
  scenario into the app stores with no UI taps.
- **B — Assert derived state via a debug readout.** Render the numbers we care
  about into stable accessibility text nodes Maestro can read.

Both ship **disabled** in production. Everything below is gated.

> **Revalidated 2026-06-22.** All seams below confirmed present in the current
> tree. Two execution details were added since the original write-up:
>
> 1. **No-console rule.** Since the 2026-06-21 logging-primitive landing, raw
>    `console.*` is eslint-banned in `src/**/*.{ts,tsx}` (`AGENTS.md` → Logging).
>    Every module under `src/testing/e2e/**` (controls store, readout) must use
>    `createLogger("e2e")` for diagnostics or it fails `pnpm check`. The route
>    `app/e2e/index.tsx` is under `app/`, not `src/`, so a bare `console.log` for
>    the C0 spike is fine there — but prefer the logger for anything that stays.
> 2. **Geometry-backend memoization** (§3) — the dispatcher caches its selection
>    on first call, so the runtime override must reset that cache, not merely be
>    consulted "after the env default."

---

## 0. End-to-end picture

```
Maestro flow
  └─ openLink: jetlag-hide-seek-v2://e2e?d=<base64url(JSON scenario)>
        │
        ▼
   app/e2e/index.tsx           ← NEW route, DEV+flag gated; in prod renders +not-found
        │  useLocalSearchParams({ d })
        ▼
   parseE2eLink(d)             ← NEW  src/testing/e2e/parseE2eLink.ts
        │  base64url-decode → JSON.parse → e2eScenarioSchema (zod, full keys)
        ▼
   applyE2eScenario(scenario, stores, controls)   ← NEW src/testing/e2e/applyE2eScenario.ts
        │  • seeds playArea / hidingZones / questions  (reuses applyImport plumbing)
        │  • sets debug controls (backend, location, readout on)
        ▼
   router.replace("/")         ← back to the map
        │
        ▼
   <E2eDebugReadout/>          ← NEW overlay on MapAppScreen, flag gated
        │  renders derived values as a11y text:  "e2e-readout:totalPct=42.13"
        ▼
   Maestro: assertVisible "e2e-readout:totalPct=42\\..*"
```

---

## 1. Safety & gating (do this first, it constrains everything else)

The test hooks must be **impossible to trigger in a shipped app**. Two layers:

1. **Build-time / dev flag.** A single boolean:
    ```ts
    // src/testing/e2e/isE2eHooksEnabled.ts
    export const E2E_HOOKS_ENABLED =
        __DEV__ && process.env.EXPO_PUBLIC_E2E_HOOKS === "1";
    ```
    - `__DEV__` is `false` in release builds ⇒ hooks gone in production regardless
      of the env var.
    - `EXPO_PUBLIC_E2E_HOOKS` is inlined by Metro at bundle time (the `EXPO_PUBLIC_`
      prefix is required for client exposure). Unset in normal dev ⇒ a developer
      running the app locally never accidentally enables it.
2. **Route-level no-op.** `app/e2e/index.tsx` checks `E2E_HOOKS_ENABLED`; when
   false it renders the same "not found" UI as `app/+not-found.tsx`. The readout
   overlay returns `null` when false.

CI wiring: the Maestro workflow already sets `E2E_DISABLE_IOS_ASSOCIATED_DOMAINS:
"1"` before the build (see `RQ-E1.md`). Add `EXPO_PUBLIC_E2E_HOOKS: "1"` in the
same place, and to the local stack script env (`scripts/e2e-maestro-stack.mjs`).

> Why a flag _and_ `__DEV__`? `__DEV__` alone would enable the hooks in every dev
> build, including ones developers share informally. The flag keeps them off by
> default even in dev, so the surface only exists during an actual E2E run.

---

## 2. The test-only deep-link schema

A new zod schema, **separate** from `wireEnvelopeSchema`. Full keys, no
minification, free to evolve.

```ts
// src/testing/e2e/scenarioSchema.ts
import { z } from "zod";
// Reuse the existing FULL-key wire schemas — they already model questions etc.
import {
    playAreaWireSchema,
    hidingZonesWireSchema,
    questionWireSchema,
    adminDivisionsWireSchema,
} from "@/sharing/wire/schema";

export const e2eControlsSchema = z.object({
    /** Force the geometry backend on-device. Defaults to leaving app config. */
    geometryBackend: z.enum(["auto", "js", "geos"]).optional(),
    /** Override the simulated device location [lon, lat]. */
    location: z.tuple([z.number(), z.number()]).optional(),
    /** Turn the debug readout overlay on (default true for e2e links). */
    showReadout: z.boolean().default(true),
});

export const e2eScenarioSchema = z.object({
    kind: z.literal("e2e-scenario"),
    /** Free-form name, shown in the readout for flow debugging. */
    name: z.string().min(1),
    controls: e2eControlsSchema.default({ showReadout: true }),
    state: z.object({
        playArea: playAreaWireSchema.optional(),
        hidingZones: hidingZonesWireSchema.optional(),
        adminDivisions: adminDivisionsWireSchema.optional(),
        questions: z.array(questionWireSchema).optional(),
    }),
    /**
     * Optional expectations the flow may also assert in YAML. Recorded in the
     * readout so a failing flow shows expected-vs-actual side by side.
     */
    expect: z
        .object({
            totalPctMin: z.number().optional(),
            totalPctMax: z.number().optional(),
        })
        .optional(),
});

export type E2eScenario = z.infer<typeof e2eScenarioSchema>;
```

Key reuse decision: the `state.*` fields use the **existing full-key wire
schemas** (`playAreaWireSchema`, `questionWireSchema`, …). Those are already the
non-minified internal schemas (`src/sharing/wire/schema.ts` — the _minified_
variants live in `minified.ts`). So a scenario's `questions` array is authored in
exactly the shape `applyImport` already understands — minimal new modeling.

### Encoding

`d = base64url(utf8(JSON.stringify(scenario)))`. No gzip (size is irrelevant for
test links; skipping it keeps decode trivial and human-debuggable). Reuse
`src/sharing/wire/base64url.ts` for the encode/decode primitives.

A tiny Node helper builds the link so flows don't hand-encode:

```
node scripts/e2e/build-scenario-link.mjs scenarios/radar-miss.json
# prints: jetlag-hide-seek-v2://e2e?d=eyJraW5kIjoi...
```

Scenarios live as readable JSON under `e2e/scenarios/*.json` and are encoded at
flow-build time (or committed pre-encoded into the flow — see epic Phase 4).

---

## 3. Applying a scenario

`applyE2eScenario` is thin: it reuses the **same store adapter** `ImportScreen`
already builds for `applyImport`, plus sets debug controls.

```ts
// src/testing/e2e/applyE2eScenario.ts
export function applyE2eScenario({
    scenario,
    stores,
    controls,
}: {
    scenario: E2eScenario;
    stores: AppStores; // same type as applyImport's AppStores
    controls: E2eControlsApi; // setBackend / setLocation / setReadout
}): void {
    const { geometryBackend, location, showReadout } = scenario.controls;
    if (geometryBackend) controls.setGeometryBackend(geometryBackend);
    if (location) controls.setLocation(location);
    controls.setReadout(showReadout, scenario.name, scenario.expect);

    // Reuse the production apply path by wrapping state in an app-state envelope.
    applyImport({
        envelope: {
            kind: "app-state",
            version: 1,
            payload: {
                gameId: `e2e-${scenario.name}`,
                metadata: { createdAt: NOW, updatedAt: NOW },
                ...scenario.state,
            },
        },
        stores,
    });
}
```

> Reusing `applyImport` means scenario seeding exercises the **real** import
> code path (play-area resolution, question normalization, admin-division
> reconstruction). That's a feature: the seeding itself is covered by existing
> `applyImport` unit tests, and we get the production normalizations for free.

The geometry-backend control needs a runtime switch. Today the backend is read
once from `APP_CONFIG.geometry.backend` (env-derived in `appConfig.ts`) and then
**memoized**: `getGeometryBackend()` in `src/shared/geometry/geometryBackend.ts`
caches the selection in a module-level `let _backend` on the first call and
returns it for the rest of the process (`geometryBackend.ts:144–156`). So a
test-only override cannot just be "read after the env default" — by the time a
scenario applies, `_backend` is usually already populated from app start. The
override must **reset / invalidate that memo** (e.g. set
`_backend = null` so the next call re-selects, or branch on the override before
the cache check) and stay a cheap module-level read so it never regresses the hot
path. Scope this carefully — see epic Task B0.

---

## 4. The debug readout (the assertion surface)

A transparent overlay mounted on `MapAppScreen`, gated by `E2E_HOOKS_ENABLED` and
the runtime `showReadout` flag. It renders derived values as text nodes with
**stable, machine-parseable accessibility labels**.

```tsx
// src/testing/e2e/E2eDebugReadout.tsx
export function E2eDebugReadout() {
    if (!E2E_HOOKS_ENABLED) return null;
    const { active, name, expect } = useE2eReadoutState();
    const { totalPct } = useQuestionEliminationTotals(); // derived, real pipeline
    const backend = useActiveGeometryBackend();
    const masks = useReadoutMaskStats(); // feature counts, eligible area m²
    if (!active) return null;

    return (
        <View pointerEvents="none" style={styles.overlay} testID="e2e-readout">
            <Row label={`e2e-readout:name=${name}`} />
            <Row label={`e2e-readout:backend=${backend}`} />
            <Row label={`e2e-readout:totalPct=${totalPct.toFixed(2)}`} />
            <Row
                label={`e2e-readout:eligibleAreaM2=${masks.eligibleAreaM2.toFixed(0)}`}
            />
            <Row
                label={`e2e-readout:overlayFeatures=${masks.overlayFeatureCount}`}
            />
            <Row label={`e2e-readout:ready=1`} /> // sentinel: derivation
            settled
        </View>
    );
}
// <Row> = <Text accessibilityLabel={label} accessible>{label}</Text>
```

Conventions that make this robust:

- **Label format `e2e-readout:<key>=<value>`.** One key per text node so Maestro
  regex stays simple: `assertVisible: "e2e-readout:totalPct=42\\..*"`.
- **`accessible` + `accessibilityLabel`** on each `Text`, because iOS `Text` does
  not always expose its content to XCUITest reliably (`AGENTS.md`). The label is
  the contract; the visible text is for human debugging.
- **A `ready=1` sentinel** node that only renders once the derived state has
  settled (no in-flight async geometry). Flows `extendedWaitUntil` on it before
  asserting numbers — this is how we avoid racing the async derivation
  (`docs/measuring-perf/P3-async-derivation.md` is relevant background).
  **Implemented (C4) as `ready = !isComputing`** — "settled" means no in-flight
  derivation, _independent_ of whether there is an eliminable value yet. A bare
  play-area scenario (no hiding-zone stations ⇒ `useEliminationPercentage` value
  is `null`) has still settled and must reach `ready=1`; otherwise the smoke flow
  could never proceed. `totalPct` is therefore a _separate_ row, rendered only
  when settled **and** the value is non-null — never bundled with the sentinel.
- **`pointerEvents="none"`** so the overlay never blocks taps in flows that still
  drive UI.

What to expose (start small, grow per scenario need):

| Key               | Source                                      | Used by scenario                 |
| ----------------- | ------------------------------------------- | -------------------------------- |
| `name`            | scenario                                    | all (debug)                      |
| `backend`         | active geometry backend                     | GEOS/JS parity, body-of-water    |
| `ready`           | derivation-settled sentinel                 | all (sync gate)                  |
| `totalPct`        | `useQuestionElimination().totalPct`         | elimination math, multi-question |
| `eligibleAreaM2`  | `eliminationMath.eligibleArea`              | mask polarity                    |
| `overlayFeatures` | `buildQuestionMapRenderState` feature count | overlay safety                   |
| `byThisPct:<id>`  | `useQuestionElimination().byThisPct`        | ordering contribution            |

> Don't dump everything. Each readout key is a maintenance contract. Add a key
> when a scenario needs it, with a unit test asserting the formatting.

---

## 5. Maestro integration

- **New route is reachable via `openLink` — RESOLVED (C0 spike, 2026-06-22).**
  `openLink: jetlag-hide-seek-v2://e2e?d=...` (the **direct custom scheme**, no
  dev-client wrapping) routes correctly to `app/e2e/index.tsx` once
  `bootstrap.yaml` has connected the dev client to Metro, and the `d` query param
  survives intact. **Form B (wrapping the link in the
  `exp+slug://expo-development-client/?url=...` dev-client URL) is _not_ needed.**
  See the C0 addendum at the end of this section for the exact form and the two
  timing hazards the spike surfaced.
- **Flow shape (hardened per the C0 spike):**
    ```yaml
    appId: com.raycatdev.hideandseek.v2
    ---
    - clearState
    - runFlow: bootstrap.yaml # boots app, grants location, connects Metro
    - openLink: ${E2E_RADAR_MISS_LINK} # the test deep link (env-injected)
    # iOS *intermittently* shows an "Open in <app>?" SpringBoard prompt for the
    # custom scheme. Give it a beat to render, then tap it if present — tolerate
    # its absence (iOS often delivers the URL directly).
    - waitForAnimationToEnd:
          timeout: 5000
    - runFlow:
          when:
              visible: "Open"
          commands:
              - tapOn: "Open"
    # Gate on ready=1 with extendedWaitUntil — NEVER a bare assertVisible right
    # after openLink. On a cold connect the bundle is still building and the
    # native a11y tree lags the JS mount (the spike caught exactly this).
    - extendedWaitUntil:
          visible: "e2e-readout:ready=1"
          timeout: 60000
    - assertVisible: "e2e-readout:backend=geos"
    - assertVisible: "e2e-readout:totalPct=4[0-9]\\..*" # band, not exact
    ```
- **Registration.** Add each flow to the `flows` array in
  `scripts/e2e-maestro-stack.mjs` and document selecting it with
  `E2E_FLOW=<name>`. CI exposes flows through the `flow` workflow input.
- **Links as env vars — via `maestro test --env`, not the process env.** The
  stack script builds the encoded links (calling
  `scripts/e2e/build-scenario-link.mjs`) so flows reference `${E2E_*_LINK}` and
  never embed giant base64 blobs inline. **Implemented (C4):** these are passed
  as `maestro test --env E2E_SMOKE_SEED_LINK=<link>` flags, **not** the spawned
  process environment. Maestro's `${...}` interpolation only auto-inherits
  `MAESTRO_`-prefixed shell vars (which is why `MAESTRO_DEV_CLIENT_URL` works
  from the env); a plain OS var like `E2E_SMOKE_SEED_LINK` resolves to the
  literal `"undefined"` and `simctl openurl` fails with `NSOSStatusErrorDomain
-50`. `--env` is the reliable mechanism.

### C0 addendum — the working deep-link form (spike, 2026-06-22)

Empirically verified on the booted `iPhone 16 Pro / iOS 18.3` sim against the
installed dev build, via `E2E_FLOW=deeplink-spike pnpm test:e2e:ios:stack` with a
throwaway `app/e2e/index.tsx` (logs on mount + renders an accessible
`e2e-spike:mounted=1;d=<value>` label) and `e2e/deeplink-spike.yaml`.

**Working form:** after `runFlow: bootstrap.yaml` (which connects the dev client
to Metro), `openLink: "jetlag-hide-seek-v2://e2e?d=<base64url>"` lands on
`app/e2e/index.tsx` and the `d` query param arrives intact (proven: a route that
echoes `d` rendered `e2e-spike:mounted=1;d=spiketest`, asserted green on a single
attempt with no retry). The dev client does **not** require the
`exp+slug://expo-development-client/?url=...` wrapper for an _already-connected_
app — the custom scheme is registered by the dev build and expo-router handles
the `/e2e` path directly. The `exp+slug://…` wrapper remains only for the
_initial connect_, which `bootstrap.yaml` already owns.

**Two timing hazards the spike surfaced (both handled in the flow shape above):**

1. **Intermittent iOS "Open in <app>?" SpringBoard prompt.** On one run iOS
   showed this confirmation over the running app and blocked delivery (route never
   mounted) until "Open" was tapped; on two other runs it never appeared and the
   URL was delivered directly. It is **nondeterministic**, so the flow must tap
   "Open" _tolerantly_ (`runFlow: when: visible: "Open"` after a
   `waitForAnimationToEnd` beat) — never an unconditional tap (it would hang when
   the prompt is absent) and never assume it won't appear. This is the same prompt
   `bootstrap.yaml` already taps through for the dev-client URL.
2. **Cold-connect bundle + a11y-tree settle race.** On the first connect Metro is
   still bundling (~10 s, 2185 modules) when `openLink` fires; the route mounted
   (JS `useEffect` logged) but a **bare `assertVisible` fired too early and
   failed** because the native accessibility tree lagged the JS mount. Always gate
   the post-deep-link assert on `extendedWaitUntil visible: "…:ready=1"` with a
   generous timeout, never an immediate `assertVisible`. **This is direct
   empirical justification for the `ready=1` sentinel in §4** — it is not
   optional polish; without it the suite flakes on cold connects.

**Fallback (now moot):** the epic's risk note proposed routing test links through
the production `/i` import route if the custom scheme failed. The custom scheme
works, so that fallback is unnecessary.

---

## 6. Tolerance & determinism

- **Never assert exact floats.** JS vs GEOS and iOS vs Android differ at the
  edges. Use regex **bands** (`totalPct=4[0-9]\\..*`) or expose a rounded bucket
  key (`totalPctBucket=40-50`) when a band regex gets awkward.
- **Pin the backend per scenario** via `controls.geometryBackend` so a flow's
  expectations are stable. Run the same scenario twice (`backend=js` and
  `backend=geos`) when the point is parity.
- **Fix location** via `controls.location` (and keep `bootstrap.yaml`'s
  `setLocation`) so measuring/thermometer "seeker distance" is deterministic.
- **Gate on `ready=1`** before every numeric assert to dodge async-derivation
  races.

---

## 7. File inventory (what gets created)

| Path                                   | Purpose                                | New/changed |
| -------------------------------------- | -------------------------------------- | ----------- |
| `src/testing/e2e/isE2eHooksEnabled.ts` | the gate constant                      | new         |
| `src/testing/e2e/scenarioSchema.ts`    | zod scenario schema + types            | new         |
| `src/testing/e2e/parseE2eLink.ts`      | extract `d`, decode, validate          | new         |
| `src/testing/e2e/applyE2eScenario.ts`  | seed stores + set controls             | new         |
| `src/testing/e2e/e2eControls.ts`       | runtime backend/location/readout store | new         |
| `src/testing/e2e/E2eDebugReadout.tsx`  | the assertion overlay                  | new         |
| `app/e2e/index.tsx`                    | the gated route                        | new         |
| `src/screens/MapAppScreen.tsx`         | mount `<E2eDebugReadout/>`             | changed     |
| `src/shared/geometry/*` (dispatcher)   | consult runtime backend override       | changed     |
| `scripts/e2e/build-scenario-link.mjs`  | JSON → encoded link CLI                | new         |
| `e2e/scenarios/*.json`                 | readable scenario fixtures             | new         |
| `e2e/*.yaml`                           | the new flows                          | new         |
| `scripts/e2e-maestro-stack.mjs`        | register flows + inject link env       | changed     |
| `.github/workflows/maestro-e2e.yml`    | set `EXPO_PUBLIC_E2E_HOOKS=1`          | changed     |

Tests: each new pure module (`scenarioSchema`, `parseE2eLink`,
`applyE2eScenario`, readout formatting) gets a Jest suite. The flows themselves
are validated by `scripts/e2e-maestro-stack-config.test.mjs` (flow registry) and
by running them.

---

## 8. Non-goals

- **Not** replacing the smoke flow or existing question flows.
- **Not** changing the production `WireEnvelope` / sharing format.
- **Not** asserting pixel-exact rendering (screenshots stay diagnostic only).
- **Not** shipping any of this enabled in production.
- **Not** a general scripting/automation backdoor — the schema only seeds game
  state and a fixed set of debug controls, nothing arbitrary-code-shaped.
