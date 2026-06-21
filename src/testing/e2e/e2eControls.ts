import { useSyncExternalStore } from "react";

import {
    getGeometryBackend,
    setGeometryBackendConfigOverride,
    type GeometryBackendConfig,
} from "@/shared/geometry/geometryBackend";

import { E2E_HOOKS_ENABLED } from "./isE2eHooksEnabled";
import type { E2eExpect } from "./scenarioSchema";

/**
 * Runtime state behind the debug readout. Everything here is inert in
 * production: the setters early-return when {@link E2E_HOOKS_ENABLED} is false,
 * so the store never leaves its initial state in a shipped app.
 */
export type E2eReadoutState = {
    /** Whether the readout overlay should render. */
    active: boolean;
    /** Scenario name, surfaced in the readout for flow debugging. */
    name: string | null;
    /** Expectations the flow may assert against (shown expected-vs-actual). */
    expect: E2eExpect | null;
    /** Scenario-declared device location `[lon, lat]`, recorded for the readout. */
    location: [number, number] | null;
};

const INITIAL_STATE: E2eReadoutState = {
    active: false,
    name: null,
    expect: null,
    location: null,
};

let state: E2eReadoutState = INITIAL_STATE;
const listeners = new Set<() => void>();

function setState(next: Partial<E2eReadoutState>): void {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function getSnapshot(): E2eReadoutState {
    return state;
}

/** Subscribe a component to the readout state (used by `E2eDebugReadout`). */
export function useE2eReadoutState(): E2eReadoutState {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ─── Control API ───────────────────────────────────────────────────────────
//
// The adapter `applyE2eScenario` receives. Each setter is a no-op unless the
// E2E hooks are enabled, so importing/calling this in production does nothing.

export type E2eControlsApi = {
    setGeometryBackend(backend: GeometryBackendConfig): void;
    setLocation(location: [number, number]): void;
    setReadout(show: boolean, name: string, expect?: E2eExpect): void;
};

export const e2eControls: E2eControlsApi = {
    setGeometryBackend(backend) {
        setGeometryBackendOverride(backend);
    },
    setLocation(location) {
        if (!E2E_HOOKS_ENABLED) return;
        setState({ location });
    },
    setReadout(show, name, expect) {
        if (!E2E_HOOKS_ENABLED) return;
        setState({ active: show, name, expect: expect ?? null });
    },
};

/**
 * Force the geometry backend for the rest of the session (inert when hooks are
 * off). Pass `null` to clear. Re-resolves through the real native probe, so
 * `"geos"` still falls back to JS when the native module is unavailable.
 */
export function setGeometryBackendOverride(
    backend: GeometryBackendConfig | null,
): void {
    if (!E2E_HOOKS_ENABLED) return;
    setGeometryBackendConfigOverride(backend);
}

/** The active geometry backend name. Reports the static value when hooks off. */
export function getActiveGeometryBackend(): "js" | "geos" {
    return getGeometryBackend().name;
}

/** @internal Reset all e2e control state. Only call from test files. */
export function __resetE2eControlsForTest(): void {
    state = INITIAL_STATE;
    setGeometryBackendConfigOverride(null);
    for (const listener of listeners) listener();
}
