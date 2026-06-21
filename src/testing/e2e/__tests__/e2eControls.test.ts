import { act, renderHook } from "@testing-library/react-native";

// The gate is normally false in Jest (env unset); a mutable getter lets each
// test flip it to exercise both the hooks-on and hooks-off paths.
let mockHooksEnabled = false;
jest.mock("../isE2eHooksEnabled", () => ({
    get E2E_HOOKS_ENABLED() {
        return mockHooksEnabled;
    },
}));

// APP_CONFIG is a frozen const; mock it to control the configured backend
// (same strategy as geometryBackend.selection.test.ts).
jest.mock("@/config/appConfig", () => ({
    APP_CONFIG: { geometry: { backend: "auto" as string } },
}));

import { __setGeometryBackendForTest } from "@/shared/geometry/geometryBackend";

import {
    __resetE2eControlsForTest,
    e2eControls,
    getActiveGeometryBackend,
    setGeometryBackendOverride,
    useE2eReadoutState,
} from "../e2eControls";

const appConfigMod = jest.requireMock("@/config/appConfig") as {
    APP_CONFIG: { geometry: { backend: string } };
};

function setNativeAvailable(available: boolean): void {
    const native = require("native-geometry") as Record<string, unknown>;
    native.isAvailable = () => available;
    native.nativeAbiVersion = () => (available ? 1 : 0);
    native.EXPECTED_NATIVE_ABI = 1;
}

beforeEach(() => {
    mockHooksEnabled = false;
    appConfigMod.APP_CONFIG.geometry.backend = "auto";
    setNativeAvailable(false);
    __setGeometryBackendForTest(null);
    __resetE2eControlsForTest();
});

describe("geometry backend override (B0)", () => {
    it("flips js → geos on the next call when hooks are on", () => {
        mockHooksEnabled = true;
        setNativeAvailable(true); // so "geos" can actually resolve to geos

        setGeometryBackendOverride("js");
        expect(getActiveGeometryBackend()).toBe("js");

        setGeometryBackendOverride("geos");
        expect(getActiveGeometryBackend()).toBe("geos");
    });

    it("clears the override with null (back to configured default)", () => {
        mockHooksEnabled = true;
        setNativeAvailable(true);
        appConfigMod.APP_CONFIG.geometry.backend = "auto"; // → geos when native

        setGeometryBackendOverride("js");
        expect(getActiveGeometryBackend()).toBe("js");

        setGeometryBackendOverride(null);
        expect(getActiveGeometryBackend()).toBe("geos");
    });

    it("is a no-op when hooks are off (override ignored)", () => {
        mockHooksEnabled = false;
        setNativeAvailable(true); // config auto + native ⇒ default is geos
        __setGeometryBackendForTest(null);

        expect(getActiveGeometryBackend()).toBe("geos");
        setGeometryBackendOverride("js"); // ignored
        expect(getActiveGeometryBackend()).toBe("geos");
    });

    it("falls back to JS when forcing geos with no native module", () => {
        mockHooksEnabled = true;
        setNativeAvailable(false);

        setGeometryBackendOverride("geos");
        expect(getActiveGeometryBackend()).toBe("js");
    });
});

describe("readout store (B1)", () => {
    it("setReadout / setLocation update observable state when hooks on", () => {
        mockHooksEnabled = true;
        const { result } = renderHook(() => useE2eReadoutState());

        act(() => {
            e2eControls.setReadout(true, "scenario-x", { totalPctMin: 40 });
            e2eControls.setLocation([139.7, 35.65]);
        });

        expect(result.current.active).toBe(true);
        expect(result.current.name).toBe("scenario-x");
        expect(result.current.expect).toEqual({ totalPctMin: 40 });
        expect(result.current.location).toEqual([139.7, 35.65]);
    });

    it("is inert when hooks are off", () => {
        mockHooksEnabled = false;
        const { result } = renderHook(() => useE2eReadoutState());

        act(() => {
            e2eControls.setReadout(true, "scenario-x");
            e2eControls.setLocation([1, 2]);
        });

        expect(result.current.active).toBe(false);
        expect(result.current.name).toBeNull();
        expect(result.current.location).toBeNull();
    });
});
