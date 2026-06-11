import { haversineM } from "./grid.mjs";

const ABS_THRESHOLD_M = 20_000; // 20 km
const RELATIVE_MULTIPLIER = 4;
const DEFAULT_MAX_REPAIRS = 3;

function totalPathLengthM(stops) {
    let total = 0;
    for (let i = 1; i < stops.length; i++) {
        total += haversineM(
            stops[i - 1].lat,
            stops[i - 1].lon,
            stops[i].lat,
            stops[i].lon,
        );
    }
    return total;
}

/**
 * Detect indices of implausible gaps in a stop sequence.
 * A gap at index i is between stops[i] and stops[i+1].
 *
 * The median is computed over all gaps *except* the largest, so that a
 * single bad gap in a short variant (e.g. 3 stops) does not inflate the
 * threshold and hide itself.
 *
 * @param {{lat:number, lon:number}[]} stops
 * @returns {number[]} indices of gaps that exceed the threshold
 */
export function detectImplausibleJumps(stops) {
    if (stops.length < 3) return [];

    const gaps = [];
    for (let i = 0; i < stops.length - 1; i++) {
        gaps.push(
            haversineM(
                stops[i].lat,
                stops[i].lon,
                stops[i + 1].lat,
                stops[i + 1].lon,
            ),
        );
    }

    const sorted = [...gaps].sort((a, b) => a - b);
    // Exclude the largest gap from median computation (R8).
    sorted.pop();

    let median;
    if (sorted.length === 0) {
        median = 0;
    } else if (sorted.length % 2 === 1) {
        median = sorted[Math.floor(sorted.length / 2)];
    } else {
        median =
            (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    }

    const threshold = Math.max(ABS_THRESHOLD_M, RELATIVE_MULTIPLIER * median);

    const flagged = [];
    for (let i = 0; i < gaps.length; i++) {
        if (gaps[i] > threshold) {
            flagged.push(i);
        }
    }
    return flagged;
}

/**
 * Repair a stop sequence by minimally reinserting outlier stops.
 *
 * Acceptance is atomic at the variant level: if any flagged gap remains
 * after the repair loop, the entire sequence reverts to its original order.
 *
 * @param {{id:string, lat:number, lon:number}[]} stops
 * @param {{maxRepairs?:number}} opts
 * @returns {{stops:{id:string, lat:number, lon:number}[], repaired:boolean, repairsDone:number, warnings:string[]}}
 */
export function repairStopOrder(
    stops,
    { maxRepairs = DEFAULT_MAX_REPAIRS } = {},
) {
    const warnings = [];
    if (stops.length < 3) {
        return { stops: [...stops], repaired: false, repairsDone: 0, warnings };
    }

    const original = [...stops];
    let working = [...stops];
    let repairsDone = 0;

    while (repairsDone < maxRepairs) {
        const flagged = detectImplausibleJumps(working);
        if (flagged.length === 0) break;

        // Pick the largest flagged gap to repair first.
        let bestGapIndex = flagged[0];
        let bestGapDist = -1;
        for (const idx of flagged) {
            const d = haversineM(
                working[idx].lat,
                working[idx].lon,
                working[idx + 1].lat,
                working[idx + 1].lon,
            );
            if (d > bestGapDist) {
                bestGapDist = d;
                bestGapIndex = idx;
            }
        }

        const originalLength = totalPathLengthM(working);

        // Candidates: the stop before the gap, or the stop after the gap.
        const candidates = [];
        if (bestGapIndex >= 0) {
            candidates.push(bestGapIndex);
        }
        if (bestGapIndex + 1 < working.length) {
            candidates.push(bestGapIndex + 1);
        }

        let bestRepair = null;

        for (const idx of candidates) {
            const removed = working[idx];
            const otherStop =
                working[bestGapIndex === idx ? bestGapIndex + 1 : bestGapIndex];
            const remainder = working.filter((_, i) => i !== idx);

            for (let pos = 0; pos <= remainder.length; pos++) {
                const trial = [
                    ...remainder.slice(0, pos),
                    removed,
                    ...remainder.slice(pos),
                ];
                const trialLength = totalPathLengthM(trial);

                // The original flagged gap is eliminated if the two stops
                // are no longer adjacent.  Use index-based identity (R6).
                const removedIdx = trial.findIndex((s) => s === removed);
                const otherIdx = trial.findIndex((s) => s === otherStop);
                const gapGone = Math.abs(removedIdx - otherIdx) !== 1;

                if (!gapGone) continue;
                if (trialLength >= originalLength) continue;

                if (!bestRepair || trialLength < bestRepair.newLength) {
                    bestRepair = {
                        indexToRemove: idx,
                        insertAt: pos,
                        newLength: trialLength,
                    };
                }
            }
        }

        if (!bestRepair) {
            warnings.push(
                `Gap at index ${bestGapIndex} (${(bestGapDist / 1000).toFixed(1)} km) could not be repaired.`,
            );
            break;
        }

        const removed = working[bestRepair.indexToRemove];
        const remainder = working.filter(
            (_, i) => i !== bestRepair.indexToRemove,
        );
        working = [
            ...remainder.slice(0, bestRepair.insertAt),
            removed,
            ...remainder.slice(bestRepair.insertAt),
        ];

        repairsDone++;
    }

    const remaining = detectImplausibleJumps(working);
    if (remaining.length > 0) {
        // Revert to original order — partial repair is worse than no repair (R1).
        warnings.push(
            `Unrepairable: ${remaining.length} implausible gap(s) remain after ${repairsDone} repair(s).`,
        );
        return {
            stops: original,
            repaired: false,
            repairsDone: 0,
            warnings,
        };
    }

    return {
        stops: working,
        repaired: repairsDone > 0,
        repairsDone,
        warnings,
    };
}
