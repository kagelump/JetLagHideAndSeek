import { useEffect, useRef, useState } from "react";
import { InteractionManager } from "react-native";
import { createLogger } from "@/shared/logger";

const log = createLogger("useDeferredComputation");

/**
 * Result of {@link useDeferredComputation}.
 */
export type DeferredComputationResult<T> = {
    /** The latest computed value, or the previous value while recomputing. */
    value: T;
    /** True while a fresh computation is pending. */
    isComputing: boolean;
};

export type DeferredComputationOptions<T> = {
    /** Value used before the first result resolves. */
    initial: T;
    /**
     * Optional synchronous cache lookup. A hit returns immediately with no
     * loading state — use this to dedupe work across components or to make
     * navigation transitions instant. Return `null` on a miss.
     */
    getCached?: (key: string) => T | null;
    /** Optional cache writer, invoked when a freshly-computed result is ready. */
    putCached?: (key: string, value: T) => void;
};

/**
 * Run an expensive **synchronous** computation off the render path so the UI
 * can paint a loading state first.
 *
 * Heavy geometry (GEOS dissolve, mask building) blocks the JS thread, so a
 * spinner cannot paint if the work runs inside `useMemo` during render. This
 * hook sets `isComputing` immediately on a cache miss so the loading UI can
 * commit to the native side, then defers the work via
 * {@link InteractionManager.runAfterInteractions} (the same pattern proven in
 * `useStationElimination`). The previous value stays visible while recomputing
 * (stale-while-revalidate).
 *
 * The animation that consumes `isComputing` should run on the UI thread (e.g.
 * Reanimated) so it keeps moving even while the JS thread is blocked by the
 * computation itself.
 *
 * @param key      Content signature. A change triggers a recompute; identical
 *                 keys across renders are no-ops.
 * @param compute  The synchronous work. Called at most once per `key`. Its
 *                 closure is read fresh on each invocation, so it may capture
 *                 the latest props/state.
 * @param options  See {@link DeferredComputationOptions}.
 */
export function useDeferredComputation<T>(
    key: string,
    compute: () => T,
    options: DeferredComputationOptions<T>,
): DeferredComputationResult<T> {
    const { initial, getCached, putCached } = options;

    // Synchronous cache probe on every render. A hit is authoritative and
    // cheap, so we can return it directly without waiting for the effect.
    const cached = getCached ? getCached(key) : null;

    const [state, setState] = useState<DeferredComputationResult<T>>(() =>
        cached !== null
            ? { value: cached, isComputing: false }
            : { value: initial, isComputing: false },
    );

    // Read the latest closures inside the deferred callback without making the
    // effect re-run on every render (the effect keys off `key` alone).
    // Using refs avoids canceling a running `InteractionManager` handle when
    // an intervening `setState({ isComputing: true })` causes a re-render that
    // regenerates `getCached` / `putCached` function references.
    const computeRef = useRef(compute);
    computeRef.current = compute;
    const getCachedRef = useRef(getCached);
    getCachedRef.current = getCached;
    const putCachedRef = useRef(putCached);
    putCachedRef.current = putCached;

    const keyRef = useRef<string | null>(null);
    const computeIdRef = useRef(0);

    useEffect(() => {
        // Same key as the last effect run → nothing changed.
        if (keyRef.current === key) return;
        keyRef.current = key;

        // Cache hit → adopt synchronously, no loading state.
        const hit = getCachedRef.current ? getCachedRef.current(key) : null;
        if (hit !== null) {
            log.debug("sync cache HIT — key:", key.slice(0, 80));
            setState({ value: hit, isComputing: false });
            return;
        }

        const computeId = ++computeIdRef.current;
        log.debug(
            `cache MISS — scheduling computeId=${computeId}, ` +
                `key=${key.slice(0, 80)}`,
        );

        // Show the loading state immediately so React commits it to native
        // before the synchronous compute blocks the JS thread. The previous
        // value stays visible (stale-while-revalidate).
        setState((prev) => ({ value: prev.value, isComputing: true }));

        const t0 = performance.now();
        let rafId: number | null = null;

        const handle = InteractionManager.runAfterInteractions(() => {
            if (computeId !== computeIdRef.current) {
                log.debug(
                    `runAfterInteractions STALE ` +
                        `(computeId=${computeId}, current=${computeIdRef.current})`,
                );
                return;
            }
            // Yield one frame so React can commit the loading state before
            // the synchronous compute blocks the JS thread. Without this,
            // React batches setState(isComputing:true) together with the
            // setState(isComputing:false) below and the loading UI never paints.
            rafId = requestAnimationFrame(() => {
                rafId = null;
                if (computeId !== computeIdRef.current) return;
                log.debug(
                    `runAfterInteractions START compute ` +
                        `(computeId=${computeId}, elapsed=${(performance.now() - t0).toFixed(0)}ms)`,
                );
                const value = computeRef.current();
                const dt = (performance.now() - t0).toFixed(0);
                log.debug(
                    `runAfterInteractions DONE compute ` +
                        `(computeId=${computeId}, elapsed=${dt}ms)`,
                );
                if (computeId !== computeIdRef.current) return;
                if (putCachedRef.current) putCachedRef.current(key, value);
                setState({ value, isComputing: false });
            });
        });

        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            handle.cancel();
        };
    }, [key]);

    // A synchronous cache hit always wins over a stale/loading state.
    if (cached !== null) return { value: cached, isComputing: false };

    // The key changed but the effect hasn't fired yet (effects run after
    // render). Report isComputing: true immediately so callers don't call
    // expensive synchronous functions during this render frame.
    if (key !== keyRef.current && state.isComputing === false) {
        return { value: state.value, isComputing: true };
    }

    return state;
}
