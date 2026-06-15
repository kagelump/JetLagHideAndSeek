# Design: Deep-Link E2E Test Suite

Audience: junior SWEs. Read `research.md` first. This doc is the technical design
the epic (`epic.md`) decomposes into tasks.

The suite has two halves:

- **A — Seed state via a test-only deep link.** Inject a complete, un-minified
  scenario into the app stores with no UI taps.
- **B — Assert derived state via a debug readout.** Render the numbers we care
  about into stable accessibility text nodes Maestro can read.

Both ship **disabled** in production. Everything below is gated.

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
once from `APP_CONFIG.geometry.backend` (env-derived in `appConfig.ts`). Add a
small mutable override the geometry dispatcher consults (a test-only setter that
`applyE2eScenario` calls). Scope this carefully — see epic Task B0.

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

- **New route is reachable via `openLink`.** Maestro's `openLink:
jetlag-hide-seek-v2://e2e?d=...` fires the custom scheme. Because the dev client
  intercepts custom schemes, confirm whether the flow must wrap the link the way
  `bootstrap.yaml` wraps `MAESTRO_DEV_CLIENT_URL` (Expo dev-client deep links use
  the `exp+slug://expo-development-client/?url=...` form). **Spike this early**
  (epic Task C0): the test link may need to be passed _through_ the dev-client URL
  rather than opened directly.
- **Flow shape:**
    ```yaml
    appId: com.raycatdev.hideandseek.v2
    ---
    - clearState
    - runFlow: bootstrap.yaml # boots app, grants location, connects Metro
    - openLink: ${E2E_RADAR_MISS_LINK} # the test deep link (env-injected)
    - extendedWaitUntil:
          visible: "e2e-readout:ready=1"
          timeout: 30000
    - assertVisible: "e2e-readout:backend=geos"
    - assertVisible: "e2e-readout:totalPct=4[0-9]\\..*" # band, not exact
    ```
- **Registration.** Add each flow to the `flows` array in
  `scripts/e2e-maestro-stack.mjs` and document selecting it with
  `E2E_FLOW=<name>`. CI exposes flows through the `flow` workflow input.
- **Links as env vars.** The stack script builds the encoded links (calling
  `scripts/e2e/build-scenario-link.mjs`) and injects them into the Maestro `env`
  map alongside `MAESTRO_DEV_CLIENT_URL`, so flows reference `${E2E_*_LINK}` and
  never embed giant base64 blobs inline.

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
