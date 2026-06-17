import { useCallback, useEffect, useRef, useState } from "react";

import { isLineMeasuringCategory } from "./measuringCategories";
import {
    getLineBundle,
    hasPackSources,
    loadLineBundle,
} from "./lineBundleLoader";
import type { MeasuringCategory, MeasuringQuestion } from "./measuringTypes";

/**
 * Hook that ensures measuring line bundles are loaded for all currently
 * active measuring questions. Fires async loads for uncached categories
 * and bumps a `revision` counter on completion so the map render state
 * memo recomputes.
 *
 * Call this in useQuestionMapRenderState (questionGeometry.ts) to hoist
 * the async load above the sync geometry computation.
 *
 * @param questions - Current measuring questions (filtered from all questions).
 * @returns A revision counter: bump this into useMemo dependencies.
 */
export function useEnsureMeasuringBundles(
    questions: MeasuringQuestion[],
): number {
    const [revision, setRevision] = useState(0);
    const loadingRef = useRef<Set<string>>(new Set());

    const ensureLoaded = useCallback(async (category: MeasuringCategory) => {
        // Skip already-cached or already-loading categories.
        const key = category;
        if (loadingRef.current.has(key)) return;
        if (getLineBundle(category) !== null) return;

        loadingRef.current.add(key);
        try {
            await loadLineBundle(category);
            setRevision((r) => r + 1);
        } catch (err) {
            console.warn(
                `[useEnsureMeasuringBundles] loadLineBundle failed for ${category}:`,
                err,
            );
        } finally {
            loadingRef.current.delete(key);
        }
    }, []);

    useEffect(() => {
        const categories = new Set<MeasuringCategory>();

        for (const q of questions) {
            if (q.type === "measuring" && isLineMeasuringCategory(q.category)) {
                categories.add(q.category);
            }
        }

        for (const category of categories) {
            // Skip fully bundled categories that are already cached.
            const cached = getLineBundle(category);
            if (cached !== null) continue;

            // No pack sources for this category — nothing to async-load.
            if (!hasPackSources(category)) continue;

            // Pack-only or hybrid: fire async load.
            ensureLoaded(category);
        }
    }, [questions, ensureLoaded]);

    return revision;
}
