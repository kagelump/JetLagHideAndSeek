/**
 * Geometry backend selection unit tests (default Jest, native mocked).
 *
 * Covers W4 from the GEOS overlay parity plan: verifies that
 * `getGeometryBackend()` selects the correct backend based on
 * `APP_CONFIG.geometry.backend` and native-module availability,
 * including the stale-binary fallback path.
 */

import type { Feature, Polygon } from "geojson";

import { jsGeometryBackend } from "../jsGeometryBackend";
import { geosGeometryBackend } from "../geosGeometryBackend";
import {
    getGeometryBackend,
    __setGeometryBackendForTest,
} from "../geometryBackend";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeSquare(x = 0, y = 0, w = 1): Feature<Polygon> {
    return {
        type: "Feature",
        properties: {},
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [x, y],
                    [x + w, y],
                    [x + w, y + w],
                    [x, y + w],
                    [x, y],
                ],
            ],
        },
    };
}

// ─── Mocking strategy ─────────────────────────────────────────────────────
//
// APP_CONFIG is a frozen const, so we mock the module to control
// `geometry.backend`. The native-geometry mock from jest.setup.ts returns
// `isAvailable: () => false`; we override it per-test to simulate presence.

jest.mock("@/config/appConfig", () => ({
    APP_CONFIG: {
        geometry: { backend: "auto" as string },
    },
}));

// Override the mock factory's return value.
const appConfigMod = jest.requireMock("@/config/appConfig") as {
    APP_CONFIG: { geometry: { backend: string } };
};

beforeEach(() => {
    // Reset to defaults.
    appConfigMod.APP_CONFIG.geometry.backend = "auto";

    // Reset the native-geometry mock to default (unavailable).
    const native = require("native-geometry") as Record<string, unknown>;
    native.isAvailable = () => false;
    native.nativeAbiVersion = () => 0;
    native.EXPECTED_NATIVE_ABI = 0;

    // Clear memoized backend so getGeometryBackend() re-resolves.
    __setGeometryBackendForTest(null);
});

afterEach(() => {
    __setGeometryBackendForTest(null);
});

// ─── Cases ────────────────────────────────────────────────────────────────

describe("geometryBackend selection (W4)", () => {
    test('backend = "js" → always jsGeometryBackend', () => {
        appConfigMod.APP_CONFIG.geometry.backend = "js";

        const backend = getGeometryBackend();
        expect(backend.name).toBe("js");
        expect(backend).toBe(jsGeometryBackend);
    });

    test('backend = "geos" + native available → geosGeometryBackend', () => {
        appConfigMod.APP_CONFIG.geometry.backend = "geos";

        const native = require("native-geometry") as Record<string, unknown>;
        native.isAvailable = () => true;
        native.nativeAbiVersion = () => 1;
        native.EXPECTED_NATIVE_ABI = 1;

        const backend = getGeometryBackend();
        expect(backend.name).toBe("geos");
        expect(backend).toBe(geosGeometryBackend);
    });

    test('backend = "geos" + native unavailable → JS fallback with warning', () => {
        appConfigMod.APP_CONFIG.geometry.backend = "geos";

        // Native is not available (default mock).
        const warnSpy = jest.spyOn(console, "warn").mockImplementation();

        const backend = getGeometryBackend();
        expect(backend.name).toBe("js");
        expect(backend).toBe(jsGeometryBackend);

        // Should have logged a loud warning about fallback.
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("native-geometry module not found"),
        );

        warnSpy.mockRestore();
    });

    test('backend = "auto" + native available → geosGeometryBackend', () => {
        appConfigMod.APP_CONFIG.geometry.backend = "auto";

        const native = require("native-geometry") as Record<string, unknown>;
        native.isAvailable = () => true;
        native.nativeAbiVersion = () => 1;
        native.EXPECTED_NATIVE_ABI = 1;

        const backend = getGeometryBackend();
        expect(backend.name).toBe("geos");
        expect(backend).toBe(geosGeometryBackend);
    });

    test('backend = "auto" + native unavailable → jsGeometryBackend (no warning)', () => {
        appConfigMod.APP_CONFIG.geometry.backend = "auto";

        const warnSpy = jest.spyOn(console, "warn").mockImplementation();

        const backend = getGeometryBackend();
        expect(backend.name).toBe("js");
        expect(backend).toBe(jsGeometryBackend);

        // Auto mode does NOT warn on fallback — only "geos" mode does.
        expect(warnSpy).not.toHaveBeenCalledWith(
            expect.stringContaining("native-geometry module not found"),
        );

        warnSpy.mockRestore();
    });

    test("stale binary: bufferWKB present, overlay ops missing → GEOS backend with JS fallback per op", () => {
        appConfigMod.APP_CONFIG.geometry.backend = "geos";

        const native = require("native-geometry") as Record<string, unknown>;
        native.isAvailable = () => true;
        native.nativeAbiVersion = () => 1; // stale
        native.EXPECTED_NATIVE_ABI = 2; // expected is newer
        native.bufferWKB = jest.fn().mockReturnValue(new Uint8Array());
        // Overlay ops are missing (simulates stale binary).
        native.differenceWKB = undefined;
        native.unionWKB = undefined;
        native.intersectionWKB = undefined;
        native.unaryUnionWKB = undefined;

        const warnSpy = jest.spyOn(console, "warn").mockImplementation();

        const backend = getGeometryBackend();
        // Backend should still be GEOS (buffer is available).
        expect(backend.name).toBe("geos");
        expect(backend).toBe(geosGeometryBackend);

        // Should have warned about stale binary.
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("native-geometry binary is stale"),
        );

        warnSpy.mockRestore();

        // Overlay ops should fall back to JS without throwing.
        const a = makeSquare(0, 0, 1);
        const b = makeSquare(0.5, 0.5, 1);

        const diff = backend.difference(a, b);
        expect(diff).not.toBeNull();
        expect(diff!.geometry.type).toMatch(/Polygon/);

        const un = backend.union(a, b);
        expect(un).not.toBeNull();

        const inter = backend.intersection(a, b);
        expect(inter).not.toBeNull();

        const uu = backend.unaryUnion(a);
        expect(uu).not.toBeNull();
    });

    test("memoization: second call returns same backend without re-probing", () => {
        appConfigMod.APP_CONFIG.geometry.backend = "auto";

        const native = require("native-geometry") as Record<string, unknown>;
        const isAvailableSpy = jest.fn().mockReturnValue(true);
        native.isAvailable = isAvailableSpy;
        native.nativeAbiVersion = () => 1;
        native.EXPECTED_NATIVE_ABI = 1;

        const first = getGeometryBackend();
        const second = getGeometryBackend();

        expect(first).toBe(second);
        // isAvailable should only be called once (memoized).
        expect(isAvailableSpy).toHaveBeenCalledTimes(1);
    });
});
