/**
 * The gate is a module-load-time `const`, so each case resets modules and
 * re-requires after setting `__DEV__` / the env var.
 */
describe("E2E_HOOKS_ENABLED", () => {
    const origEnv = process.env.EXPO_PUBLIC_E2E_HOOKS;
    const origDev = (globalThis as { __DEV__?: boolean }).__DEV__;

    afterEach(() => {
        if (origEnv === undefined) delete process.env.EXPO_PUBLIC_E2E_HOOKS;
        else process.env.EXPO_PUBLIC_E2E_HOOKS = origEnv;
        (globalThis as { __DEV__?: boolean }).__DEV__ = origDev;
        jest.resetModules();
    });

    function load(dev: boolean, hooks: string | undefined): boolean {
        (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
        if (hooks === undefined) delete process.env.EXPO_PUBLIC_E2E_HOOKS;
        else process.env.EXPO_PUBLIC_E2E_HOOKS = hooks;

        let value = false;
        jest.isolateModules(() => {
            value = (
                require("../isE2eHooksEnabled") as {
                    E2E_HOOKS_ENABLED: boolean;
                }
            ).E2E_HOOKS_ENABLED;
        });
        return value;
    }

    it("is false when the env var is unset, even in dev", () => {
        expect(load(true, undefined)).toBe(false);
    });

    it("is false in a release build even when the env var is '1'", () => {
        expect(load(false, "1")).toBe(false);
    });

    it("is false when the env var is any value other than '1'", () => {
        expect(load(true, "0")).toBe(false);
        expect(load(true, "true")).toBe(false);
    });

    it("is true only when __DEV__ and the env var is exactly '1'", () => {
        expect(load(true, "1")).toBe(true);
    });
});
