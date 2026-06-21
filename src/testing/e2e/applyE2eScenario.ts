import {
    applyImport,
    type AppStores,
    type ImportApplyResult,
} from "@/sharing/import/applyImport";
import type { WireEnvelope } from "@/sharing/wire/schema";

import type { E2eControlsApi } from "./e2eControls";
import type { E2eScenario } from "./scenarioSchema";

/**
 * Seed a scenario into the app and apply its debug controls.
 *
 * Seeding wraps `scenario.state` in an `app-state` `WireEnvelope` and delegates
 * to the production {@link applyImport} — so it exercises the *real* import path
 * (play-area resolution, question normalization, admin-division reconstruction)
 * and inherits its unit-test coverage for free. Controls (backend, location,
 * readout) are applied through the provided adapter, which is inert in
 * production. Returns the import result so the route can surface apply failures.
 */
export function applyE2eScenario({
    scenario,
    stores,
    controls,
}: {
    scenario: E2eScenario;
    stores: AppStores;
    controls: E2eControlsApi;
}): ImportApplyResult {
    const { geometryBackend, location, showReadout } = scenario.controls;
    if (geometryBackend) controls.setGeometryBackend(geometryBackend);
    if (location) controls.setLocation(location);
    controls.setReadout(showReadout, scenario.name, scenario.expect);

    const now = new Date().toISOString();
    const envelope: WireEnvelope = {
        kind: "app-state",
        version: 1,
        payload: {
            gameId: `e2e-${scenario.name}`,
            metadata: { createdAt: now, updatedAt: now },
            ...scenario.state,
        },
    };

    return applyImport({ envelope, stores });
}
