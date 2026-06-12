/**
 * Line stitching, dedup, gap bridging, and continuity validation for
 * measuring bundle line categories (HSR, waterways).
 *
 * OSM ways that form one continuous track share *exact* node coordinates at
 * their join points. We assemble maximal polylines by walking that shared-node
 * graph, so connectivity never depends on fuzzy endpoint-distance heuristics.
 *
 * @module lineStitching
 */

import { computeBbox } from "./geometryCleanup.mjs";

// ─── Geometry primitives ────────────────────────────────────────────────────

/**
 * Great-circle distance in meters between two [lon, lat] points.
 */
export function haversineMeters(a, b) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLon = Math.sin(dLon / 2);
    const h =
        sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Cosine similarity between two 2D vectors.
 */
export function cosineSimilarity(v1, v2) {
    return v1[0] * v2[0] + v1[1] * v2[1];
}

/**
 * Point-to-segment distance in meters between `p` and segment `a`–`b`
 * (small-angle planar approximation, accurate enough at track scale).
 */
export function pointSegDistMeters(p, a, b) {
    const kx = 111320 * Math.cos((p[1] * Math.PI) / 180);
    const ky = 111320;
    const ax = a[0] * kx;
    const ay = a[1] * ky;
    const bx = b[0] * kx;
    const by = b[1] * ky;
    const px = p[0] * kx;
    const py = p[1] * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
        t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
    }
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ─── Segment stitching (exact shared-node assembly) ─────────────────────────
//
// Tuning values (nodePrecision, maxTurnCos) are passed via opts.

/** Stable key for a coordinate so shared OSM nodes hash to the same bucket. */
export function nodeKey(pt, precision = 7) {
    return `${pt[0].toFixed(precision)},${pt[1].toFixed(precision)}`;
}

/**
 * Unit tangent of `coords` at the given end, pointing *out of* the endpoint
 * toward the interior of the line. Two ways that continue straight through a
 * shared node have antiparallel departure tangents (cos ≈ -1).
 */
export function departureTangent(coords, atStart) {
    const a = atStart ? coords[0] : coords[coords.length - 1];
    const b = atStart ? coords[1] : coords[coords.length - 2];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const mag = Math.sqrt(dx * dx + dy * dy);
    return mag === 0 ? [0, 0] : [dx / mag, dy / mag];
}

/**
 * Stitch fragmented LineString features into maximal continuous lines by
 * walking the exact shared-node graph.
 *
 * The connected-component count never *increases*: every degree-2 node is
 * joined unconditionally, so any two ways that share a node in OSM stay
 * connected in the output. Junctions split into separate features that still
 * meet at the exact junction coordinate, so the rendered line has no gaps.
 *
 * @param {object[]} features
 * @param {object} opts
 * @param {number} opts.nodePrecision - decimal places for node key
 * @param {number} opts.maxTurnCos - max cosine for junction turn (-0.5 ≈ 120°)
 */
export function stitchSegments(
    features,
    { nodePrecision = 7, maxTurnCos = -0.5 } = {},
) {
    const n = features.length;
    if (n <= 1) return features;

    const nk = (pt) => nodeKey(pt, nodePrecision);

    // node key -> endpoint stubs { way, atStart } of every way meeting there.
    const nodes = new Map();
    for (let w = 0; w < n; w++) {
        const c = features[w].geometry.coordinates;
        for (const [pt, atStart] of [
            [c[0], true],
            [c[c.length - 1], false],
        ]) {
            const k = nk(pt);
            let stubs = nodes.get(k);
            if (!stubs) nodes.set(k, (stubs = []));
            stubs.push({ way: w, atStart });
        }
    }

    // Seed degree-1 ways first — those with at least one endpoint that no other
    // way shares (true chain termini). Processing termini before interior ways
    // prevents the greedy order from consuming a junction's "correct" forward
    // continuation before the chain that needs it arrives, which would otherwise
    // force the stitcher to append a backward stub and create a local zigzag.
    const degree1Seeds = [];
    const otherSeeds = [];
    for (let w = 0; w < n; w++) {
        const c = features[w].geometry.coordinates;
        const dS = (nodes.get(nk(c[0])) ?? []).length;
        const dE = (nodes.get(nk(c[c.length - 1])) ?? []).length;
        (dS === 1 || dE === 1 ? degree1Seeds : otherSeeds).push(w);
    }
    const seedOrder = [...degree1Seeds, ...otherSeeds];

    const used = new Array(n).fill(false);

    // From node `key`, having arrived with departure tangent `inbound` (the
    // tangent leaving `key` along the line built so far), choose the straightest
    // unused way to continue along. A degree-2 node (one unused continuation)
    // joins unconditionally; a junction requires a near-straight continuation.
    const pickNext = (key, inbound) => {
        const candidates = (nodes.get(key) ?? []).filter((s) => !used[s.way]);
        if (candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0];
        let best = null;
        let bestCos = Infinity;
        for (const s of candidates) {
            const dep = departureTangent(
                features[s.way].geometry.coordinates,
                s.atStart,
            );
            const cos = cosineSimilarity(inbound, dep);
            if (cos < bestCos) {
                bestCos = cos;
                best = s;
            }
        }
        return bestCos <= maxTurnCos ? best : null;
    };

    const result = [];

    for (const seed of seedOrder) {
        if (used[seed]) continue;
        used[seed] = true;
        const seedProps = features[seed].properties;
        let coords = [...features[seed].geometry.coordinates];

        // Grow forward from the tail node.
        for (;;) {
            const tailKey = nk(coords[coords.length - 1]);
            const next = pickNext(tailKey, departureTangent(coords, false));
            if (!next) break;
            used[next.way] = true;
            const nc = features[next.way].geometry.coordinates;
            const seg = nk(nc[0]) === tailKey ? nc : [...nc].reverse();
            for (let i = 1; i < seg.length; i++) coords.push(seg[i]);
        }

        // Grow backward from the head node.
        for (;;) {
            const headKey = nk(coords[0]);
            const next = pickNext(headKey, departureTangent(coords, true));
            if (!next) break;
            used[next.way] = true;
            const nc = features[next.way].geometry.coordinates;
            const seg =
                nk(nc[nc.length - 1]) === headKey ? nc : [...nc].reverse();
            coords = seg.slice(0, seg.length - 1).concat(coords);
        }

        result.push(makeFeature(coords, seedProps));
    }

    return result;
}

function makeFeature(coords, props) {
    const bbox = computeBbox(coords);
    return {
        type: "Feature",
        bbox,
        geometry: { type: "LineString", coordinates: coords },
        properties: { ...(props ?? {}) },
    };
}

// ─── Parallel track de-duplication ──────────────────────────────────────────

/** Bbox [w,s,e,n] of a coordinate array, expanded by `padDeg`. */
export function coordsBbox(coords, padDeg = 0) {
    let w = Infinity,
        s = Infinity,
        e = -Infinity,
        nth = -Infinity;
    for (const p of coords) {
        if (p[0] < w) w = p[0];
        if (p[0] > e) e = p[0];
        if (p[1] < s) s = p[1];
        if (p[1] > nth) nth = p[1];
    }
    return [w - padDeg, s - padDeg, e + padDeg, nth + padDeg];
}

export function bboxesOverlap(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * True when every sampled point of `shorter` lies within `maxLateral` of
 * `longer` — i.e. `shorter` runs alongside `longer` for its whole length and is
 * a duplicate track. A point that strays (a diverging branch) fails fast.
 */
function shorterHugsLonger(longer, shorter, maxLateral, hugSamples = 80) {
    const step = Math.max(1, Math.floor(shorter.length / hugSamples));
    for (let k = 0; k < shorter.length; k += step) {
        const p = shorter[k];
        let min = Infinity;
        for (let i = 0; i < longer.length - 1; i++) {
            const d = pointSegDistMeters(p, longer[i], longer[i + 1]);
            if (d < min) min = d;
            if (min <= maxLateral) break;
        }
        if (min > maxLateral) return false;
    }
    return true;
}

/**
 * Collapse the two ~4 m-apart tracks of a double-track line by keeping the
 * longer (most complete) track and dropping shorter near-duplicates that hug it
 * along their whole length. Unlike centerline averaging this is raw-faithful —
 * it never invents geometry, so it cannot zigzag or stagger — and preferring the
 * longest track keeps the most continuous version of each corridor.
 *
 * @param {object[]} features
 * @param {object} opts
 * @param {number} opts.maxLateralM
 * @param {number} opts.minCosine
 * @param {number} opts.hugSamples
 */
export function dedupeParallelTracks(
    features,
    { maxLateralM = 30, minCosine = 0.966, hugSamples = 80 } = {},
) {
    const n = features.length;
    if (n <= 1) return features;

    // Longest first, so the most complete corridor becomes the keeper.
    const order = [...features.keys()].sort(
        (a, b) =>
            lineLengthMeters(features[b].geometry.coordinates) -
            lineLengthMeters(features[a].geometry.coordinates),
    );

    const dropped = new Array(n).fill(false);
    const bbox = features.map((f) =>
        coordsBbox(f.geometry.coordinates, maxLateralM / 111320),
    );
    const dir = features.map((f) => {
        const c = f.geometry.coordinates;
        const dx = c[c.length - 1][0] - c[0][0];
        const dy = c[c.length - 1][1] - c[0][1];
        const m = Math.sqrt(dx * dx + dy * dy);
        return m > 0 ? [dx / m, dy / m] : [0, 0];
    });

    for (let oi = 0; oi < n; oi++) {
        const i = order[oi];
        if (dropped[i]) continue;
        for (let oj = oi + 1; oj < n; oj++) {
            const j = order[oj]; // length(j) <= length(i)
            if (dropped[j]) continue;
            if (!bboxesOverlap(bbox[i], bbox[j])) continue;
            // Same axis (parallel tracks may be digitized either way).
            if (Math.abs(cosineSimilarity(dir[i], dir[j])) < minCosine) {
                continue;
            }
            if (
                shorterHugsLonger(
                    features[i].geometry.coordinates,
                    features[j].geometry.coordinates,
                    maxLateralM,
                    hugSamples,
                )
            ) {
                dropped[j] = true;
            }
        }
    }

    return features.filter((_, i) => !dropped[i]);
}

// ─── Collinear gap bridging ─────────────────────────────────────────────────

/**
 * Bridge short collinear gaps between corridor ends.
 *
 * @param {object[]} features
 * @param {object} opts
 * @param {number} opts.maxGapM
 * @param {number} opts.minFacingCos
 */
export function bridgeCollinearGaps(
    features,
    { maxGapM = 1500, minFacingCos = 0.95 } = {},
) {
    let feats = features.map((f) => f.geometry.coordinates);

    for (;;) {
        const eps = [];
        for (let i = 0; i < feats.length; i++) {
            const c = feats[i];
            eps.push({ i, start: true, p: c[0], t: departureTangent(c, true) });
            eps.push({
                i,
                start: false,
                p: c[c.length - 1],
                t: departureTangent(c, false),
            });
        }

        let best = null;
        for (let a = 0; a < eps.length; a++) {
            for (let b = a + 1; b < eps.length; b++) {
                const ea = eps[a];
                const eb = eps[b];
                if (ea.i === eb.i) continue;
                const gap = haversineMeters(ea.p, eb.p);
                if (gap < 1 || gap > maxGapM) continue;
                // Ends must face each other (inward tangents antiparallel) …
                if (cosineSimilarity(ea.t, eb.t) > -minFacingCos) {
                    continue;
                }
                // … and the gap must open straight ahead of each loose end.
                const v = localUnit(ea.p, eb.p);
                if (-(v[0] * ea.t[0] + v[1] * ea.t[1]) < 0.9) continue;
                if (v[0] * eb.t[0] + v[1] * eb.t[1] < 0.9) continue;
                if (!best || gap < best.gap) best = { ea, eb, gap };
            }
        }
        if (!best) break;

        // Orient both so A ends at its loose endpoint and B starts at hers,
        // then concatenate (the join segment bridges the gap).
        const a = best.ea;
        const b = best.eb;
        const A = a.start ? [...feats[a.i]].reverse() : feats[a.i];
        const B = b.start ? feats[b.i] : [...feats[b.i]].reverse();
        const merged = A.concat(B);
        const hi = Math.max(a.i, b.i);
        const lo = Math.min(a.i, b.i);
        feats.splice(hi, 1);
        feats.splice(lo, 1);
        feats.push(merged);
    }

    return feats.map((c) => makeFeature(c));
}

// ─── Continuity validation ──────────────────────────────────────────────────

/** Unit vector a→b in local meters (for short gaps). */
export function localUnit(a, b) {
    const dx =
        (b[0] - a[0]) *
        111320 *
        Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
    const dy = (b[1] - a[1]) * 111320;
    const mag = Math.hypot(dx, dy);
    return mag === 0 ? [0, 0] : [dx / mag, dy / mag];
}

/** Great-circle length of a coordinate ring/line in meters. */
export function lineLengthMeters(coords) {
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        total += haversineMeters(coords[i], coords[i + 1]);
    }
    return total;
}

/**
 * Guard against the discontinuous-line regression. The substantial features
 * of a line category (≥ `minFeatureLenM`, i.e. main corridors, not station
 * sidings or platform stubs) must form a small number of connected components
 * and must not contain interior "holes": pairs of endpoints that are collinear
 * continuations of one another separated by a visible gap. Throws when the
 * geometry is too fragmented, so a bad regeneration fails loudly instead of
 * shipping a broken bundle. Returns the measured metrics.
 */
export function validateLineContinuity(features, extractBbox, opts = {}) {
    const {
        maxComponents = 40,
        maxHoles = 8,
        minFeatureLenM = 1000,
        holeMinM = 40,
        holeMaxM = 2500,
        joinTolM = 25,
        edgeMarginDeg = 0.02,
    } = opts;

    // Restrict every check to substantial features; short sidings/stubs near
    // stations have legitimate loose ends and are not rendering gaps.
    const mainFeatures = features.filter(
        (f) => lineLengthMeters(f.geometry.coordinates) >= minFeatureLenM,
    );
    const n = mainFeatures.length;
    const ends = mainFeatures.map((f) => {
        const c = f.geometry.coordinates;
        return { s: c[0], e: c[c.length - 1] };
    });

    // Connected components by endpoint proximity. Post-merge centerlines no
    // longer share exact nodes, so use a small metric tolerance rather than
    // the exact key the stitcher uses internally.
    const parent = [...Array(n).keys()];
    const find = (x) => {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    };
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const pi = ends[i];
            const pj = ends[j];
            if (
                haversineMeters(pi.s, pj.s) <= joinTolM ||
                haversineMeters(pi.s, pj.e) <= joinTolM ||
                haversineMeters(pi.e, pj.s) <= joinTolM ||
                haversineMeters(pi.e, pj.e) <= joinTolM
            ) {
                parent[find(i)] = find(j);
            }
        }
    }
    const roots = new Set();
    for (let i = 0; i < n; i++) roots.add(find(i));
    const components = roots.size;

    // Interior collinear holes.
    const [west, south, east, north] = extractBbox;
    const nearEdge = (p) =>
        p[0] - west < edgeMarginDeg ||
        east - p[0] < edgeMarginDeg ||
        p[1] - south < edgeMarginDeg ||
        north - p[1] < edgeMarginDeg;

    const eps = [];
    for (let i = 0; i < n; i++) {
        const c = mainFeatures[i].geometry.coordinates;
        eps.push({ i, p: c[0], t: departureTangent(c, true) });
        eps.push({ i, p: c[c.length - 1], t: departureTangent(c, false) });
    }

    const holes = [];
    for (let a = 0; a < eps.length; a++) {
        const ea = eps[a];
        if (nearEdge(ea.p)) continue;
        for (let b = a + 1; b < eps.length; b++) {
            const eb = eps[b];
            if (ea.i === eb.i) continue;
            const d = haversineMeters(ea.p, eb.p);
            if (d < holeMinM || d > holeMaxM) continue;
            if (nearEdge(eb.p)) continue;
            // Each tangent faces into its own body, away from the gap, so two
            // ends facing each other across a hole are antiparallel.
            if (cosineSimilarity(ea.t, eb.t) > -0.9) continue;
            // The gap must open in front of ea's loose end (opposite its
            // tangent).
            const v = localUnit(ea.p, eb.p);
            if (-(v[0] * ea.t[0] + v[1] * ea.t[1]) < 0.9) continue;
            holes.push({ a: ea.p, gap: Math.round(d) });
        }
    }

    console.log(
        `  [validate] main-corridors=${n} (≥${minFeatureLenM}m) ` +
            `components=${components} interior-holes=${holes.length}`,
    );
    if (holes.length) {
        console.log(
            `  [validate] sample holes: ` +
                holes
                    .slice(0, 5)
                    .map(
                        (h) =>
                            `${h.gap}m@[${h.a[0].toFixed(4)},${h.a[1].toFixed(4)}]`,
                    )
                    .join(", "),
        );
    }

    const problems = [];
    if (components > maxComponents) {
        problems.push(
            `${components} connected components (max ${maxComponents})`,
        );
    }
    if (holes.length > maxHoles) {
        problems.push(
            `${holes.length} interior collinear holes ${holeMinM}–${holeMaxM} m (max ${maxHoles})`,
        );
    }
    if (problems.length) {
        throw new Error(
            `Discontinuous line geometry: ${problems.join("; ")}. ` +
                `The shared-node stitcher likely regressed.`,
        );
    }

    return { components, holes: holes.length };
}
