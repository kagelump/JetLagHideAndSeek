import { renderHook, waitFor } from "@testing-library/react-native";

import { useDeferredComputation } from "../useDeferredComputation";

describe("useDeferredComputation", () => {
    it("returns the initial value, then the deferred result", async () => {
        const compute = jest.fn(() => 42);

        const { result } = renderHook(() =>
            useDeferredComputation("k1", compute, { initial: 0 }),
        );

        // Synchronous first render: initial value, isComputing true immediately.
        expect(result.current.value).toBe(0);
        expect(result.current.isComputing).toBe(true);

        await waitFor(() => expect(result.current.value).toBe(42));
        expect(result.current.isComputing).toBe(false);
        expect(compute).toHaveBeenCalledTimes(1);
    });

    it("does not recompute when the key is unchanged across rerenders", async () => {
        const compute = jest.fn(() => 7);

        const { result, rerender } = renderHook(() =>
            useDeferredComputation("stable", compute, { initial: -1 }),
        );

        await waitFor(() => expect(result.current.value).toBe(7));

        rerender({});
        rerender({});

        expect(compute).toHaveBeenCalledTimes(1);
    });

    it("recomputes when the key changes", async () => {
        const compute = jest.fn((n: number) => n * 2);

        let n = 1;
        const { result, rerender } = renderHook(
            ({ key }: { key: string }) =>
                useDeferredComputation(key, () => compute(n), { initial: 0 }),
            { initialProps: { key: "a" } },
        );

        await waitFor(() => expect(result.current.value).toBe(2));

        n = 5;
        rerender({ key: "b" });

        await waitFor(() => expect(result.current.value).toBe(10));
        expect(compute).toHaveBeenCalledTimes(2);
    });

    it("returns a synchronous cache hit without computing", () => {
        const compute = jest.fn(() => 99);
        const cache = new Map<string, number>([["hot", 123]]);

        const { result } = renderHook(() =>
            useDeferredComputation("hot", compute, {
                initial: 0,
                getCached: (k) => cache.get(k) ?? null,
            }),
        );

        expect(result.current.value).toBe(123);
        expect(result.current.isComputing).toBe(false);
        expect(compute).not.toHaveBeenCalled();
    });

    it("flips isComputing to true synchronously on cache miss", async () => {
        const compute = jest.fn(() => 42);

        const { result } = renderHook(() =>
            useDeferredComputation("fresh", compute, { initial: 0 }),
        );

        // isComputing must be true on the very first synchronous render —
        // not deferred to the effect — so callers can avoid expensive sync
        // work during the render frame.
        expect(result.current.isComputing).toBe(true);

        // After the compute resolves, the flag must flip back.
        await waitFor(() => expect(result.current.value).toBe(42));
        expect(result.current.isComputing).toBe(false);
    });

    it("flips isComputing to true synchronously on key change", async () => {
        const compute = jest.fn((n: number) => n);

        let n = 1;
        const { result, rerender } = renderHook(
            ({ key }: { key: string }) =>
                useDeferredComputation(key, () => compute(n), { initial: 0 }),
            { initialProps: { key: "a" } },
        );

        await waitFor(() => expect(result.current.value).toBe(1));
        expect(result.current.isComputing).toBe(false);

        // Change the key — isComputing must be true on this very render,
        // not deferred to the next effect.
        n = 2;
        rerender({ key: "b" });
        expect(result.current.isComputing).toBe(true);

        await waitFor(() => expect(result.current.value).toBe(2));
        expect(result.current.isComputing).toBe(false);
    });

    it("writes freshly-computed results back to the cache", async () => {
        const store = new Map<string, number>();
        const compute = jest.fn(() => 55);

        const { result } = renderHook(() =>
            useDeferredComputation("miss", compute, {
                initial: 0,
                getCached: (k) => store.get(k) ?? null,
                putCached: (k, v) => store.set(k, v),
            }),
        );

        await waitFor(() => expect(result.current.value).toBe(55));
        expect(store.get("miss")).toBe(55);
    });
});
