/* global console, process, fetch */

import { execFileSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import YAML from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const geofabrikDir = resolve(scriptDir, "..");
const configPath = resolve(geofabrikDir, "config.yaml");
const root = resolve(geofabrikDir, "..", "..");

// ─── Category definitions ────────────────────────────────────────────────────

const CATEGORIES = [
    {
        key: "coastline",
        osmiumFilter: "w/natural=coastline",
        postFilter: null,
        geometry: "pass",
    },
    {
        key: "high-speed-rail",
        osmiumFilter: "r/route=railway w/railway=rail",
        postFilter: "high-speed",
        geometry: "pass",
    },
    {
        key: "body-of-water",
        osmiumFilter:
            "w/natural=water r/natural=water w/landuse=basin w/waterway=riverbank",
        postFilter: null,
        geometry: "polygon-to-ring",
    },
    {
        key: "admin-1st-border",
        osmiumFilter: "r/boundary=administrative",
        postFilter: "admin-4",
        geometry: "polygon-to-ring",
    },
    {
        key: "admin-2nd-border",
        osmiumFilter: "r/boundary=administrative",
        postFilter: "admin-7",
        geometry: "polygon-to-ring",
    },
];

// ─── Simplify tolerances (degrees) ────────────────────────────────────────────

const SIMPLIFY_TOLERANCES = {
    "high-speed-rail": 0.0001,
    coastline: 0.0005,
    "body-of-water": 0.0005,
    "admin-1st-border": 0.0003,
    "admin-2nd-border": 0.0003,
};

// ─── Post-filter predicates ───────────────────────────────────────────────────

function highSpeedPostFilter(tags) {
    // Exclude linear motor (maglev) lines — e.g. Chūō Shinkansen.
    if (tags.propulsion === "linear_motor") return false;
    if (tags.highspeed === "yes") return true;
    if (tags.service === "high_speed") return true;
    const ms = parseInt(tags.maxspeed, 10);
    return Number.isFinite(ms) && ms >= 200;
}

function adminLevelPostFilter(tags, level) {
    return tags.admin_level === String(level);
}

function applyPostFilter(category, tags) {
    switch (category.postFilter) {
        case "high-speed":
            return highSpeedPostFilter(tags);
        case "admin-4":
            return adminLevelPostFilter(tags, 4);
        case "admin-7":
            return adminLevelPostFilter(tags, 7);
        default:
            return true;
    }
}

// ─── Geometry conversion (polygon → outer-ring LineString) ──────────────────

function featureToLineStrings(feature) {
    const { type, coordinates } = feature.geometry;
    if (type === "LineString" || type === "MultiLineString") return [feature];

    const lines = [];
    const pushRing = (ring) => {
        if (ring.length < 4) return; // skip degenerate rings
        lines.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: ring },
            properties: {},
        });
    };

    // Outer ring is coordinates[0]; holes (coordinates[1..]) are skipped.
    if (type === "Polygon") {
        pushRing(coordinates[0]);
    } else if (type === "MultiPolygon") {
        for (const poly of coordinates) pushRing(poly[0]);
    }
    return lines;
}

// ─── Bbox computation ────────────────────────────────────────────────────────

function computeBbox(coords) {
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    const walk = (c) => {
        if (typeof c[0] === "number") {
            if (c[0] < minX) minX = c[0];
            if (c[0] > maxX) maxX = c[0];
            if (c[1] < minY) minY = c[1];
            if (c[1] > maxY) maxY = c[1];
        } else c.forEach(walk);
    };
    walk(coords);
    return [minX, minY, maxX, maxY];
}

// ─── Simplification ──────────────────────────────────────────────────────────

function simplifyCoords(coords, tolerance) {
    // Ramer-Douglas-Peucker simplification.
    if (coords.length <= 2) return coords;

    const sqTolerance = tolerance * tolerance;

    function findFarthest(points) {
        let maxDist = 0;
        let maxIdx = 0;
        const first = points[0];
        const last = points[points.length - 1];
        const dx = last[0] - first[0];
        const dy = last[1] - first[1];
        const lenSq = dx * dx + dy * dy;

        for (let i = 1; i < points.length - 1; i++) {
            let dist;
            if (lenSq === 0) {
                const dxi = points[i][0] - first[0];
                const dyi = points[i][1] - first[1];
                dist = dxi * dxi + dyi * dyi;
            } else {
                let t =
                    ((points[i][0] - first[0]) * dx +
                        (points[i][1] - first[1]) * dy) /
                    lenSq;
                if (t < 0) t = 0;
                if (t > 1) t = 1;
                const px = first[0] + t * dx;
                const py = first[1] + t * dy;
                const dxi = points[i][0] - px;
                const dyi = points[i][1] - py;
                dist = dxi * dxi + dyi * dyi;
            }
            if (dist > maxDist) {
                maxDist = dist;
                maxIdx = i;
            }
        }
        return { index: maxIdx, dist: maxDist };
    }

    function simplify(points) {
        const { index, dist } = findFarthest(points);
        if (dist > sqTolerance) {
            const left = simplify(points.slice(0, index + 1));
            const right = simplify(points.slice(index));
            return left.slice(0, -1).concat(right);
        }
        return [points[0], points[points.length - 1]];
    }

    return simplify(coords);
}

function simplifyFeature(feature, tolerance) {
    const simplified = { ...feature, geometry: { ...feature.geometry } };
    if (feature.geometry.type === "LineString") {
        simplified.geometry.coordinates = simplifyCoords(
            feature.geometry.coordinates,
            tolerance,
        );
    } else if (feature.geometry.type === "MultiLineString") {
        simplified.geometry.coordinates = feature.geometry.coordinates.map(
            (seg) => simplifyCoords(seg, tolerance),
        );
    }
    return simplified;
}

// ─── High-speed-rail post-processing ────────────────────────────────────────

/**
 * Great-circle distance in meters between two [lon, lat] points.
 */
function haversineMeters(a, b) {
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
function cosineSimilarity(v1, v2) {
    return v1[0] * v2[0] + v1[1] * v2[1];
}

/**
 * Point-to-segment distance in meters between `p` and segment `a`–`b`
 * (small-angle planar approximation, accurate enough at track scale).
 */
function pointSegDistMeters(p, a, b) {
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

// ─── Segment stitching (exact shared-node assembly) ──────────────────────────
//
// OSM ways that form one continuous track share *exact* node coordinates at
// their join points. We assemble maximal polylines by walking that shared-node
// graph, so connectivity never depends on fuzzy endpoint-distance heuristics
// (an earlier distance/cross-track matcher silently shattered the network).
// A node where exactly two way-ends meet is an unambiguous pass-through and is
// always joined; at a junction (>2 way-ends) we continue along the straightest
// available track and let genuinely diverging branches start their own line.

/** Decimal places at which two OSM node coordinates are treated as identical. */
const NODE_PRECISION = 7;

/**
 * Maximum turn allowed when choosing a continuation at a junction, as the
 * cosine between the two ways' departure tangents. A straight pass-through is
 * ≈ -1 (the tangents leave the shared node in opposite directions); a 90° turn
 * is ≈ 0. We continue only when the straightest option turns by < ~60°.
 */
const STITCH_MAX_TURN_COS = -0.5;

/** Stable key for a coordinate so shared OSM nodes hash to the same bucket. */
function nodeKey(pt) {
    return `${pt[0].toFixed(NODE_PRECISION)},${pt[1].toFixed(NODE_PRECISION)}`;
}

/**
 * Unit tangent of `coords` at the given end, pointing *out of* the endpoint
 * toward the interior of the line. Two ways that continue straight through a
 * shared node have antiparallel departure tangents (cos ≈ -1).
 */
function departureTangent(coords, atStart) {
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
 */
function stitchSegments(features) {
    const n = features.length;
    if (n <= 1) return features;

    // node key -> endpoint stubs { way, atStart } of every way meeting there.
    const nodes = new Map();
    for (let w = 0; w < n; w++) {
        const c = features[w].geometry.coordinates;
        for (const [pt, atStart] of [
            [c[0], true],
            [c[c.length - 1], false],
        ]) {
            const k = nodeKey(pt);
            let stubs = nodes.get(k);
            if (!stubs) nodes.set(k, (stubs = []));
            stubs.push({ way: w, atStart });
        }
    }

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
        return bestCos <= STITCH_MAX_TURN_COS ? best : null;
    };

    const result = [];

    for (let seed = 0; seed < n; seed++) {
        if (used[seed]) continue;
        used[seed] = true;
        let coords = [...features[seed].geometry.coordinates];

        // Grow forward from the tail node.
        for (;;) {
            const tailKey = nodeKey(coords[coords.length - 1]);
            const next = pickNext(tailKey, departureTangent(coords, false));
            if (!next) break;
            used[next.way] = true;
            const nc = features[next.way].geometry.coordinates;
            const seg = nodeKey(nc[0]) === tailKey ? nc : [...nc].reverse();
            for (let i = 1; i < seg.length; i++) coords.push(seg[i]);
        }

        // Grow backward from the head node.
        for (;;) {
            const headKey = nodeKey(coords[0]);
            const next = pickNext(headKey, departureTangent(coords, true));
            if (!next) break;
            used[next.way] = true;
            const nc = features[next.way].geometry.coordinates;
            const seg =
                nodeKey(nc[nc.length - 1]) === headKey ? nc : [...nc].reverse();
            coords = seg.slice(0, seg.length - 1).concat(coords);
        }

        result.push(makeFeature(coords));
    }

    return result;
}

function makeFeature(coords) {
    const bbox = computeBbox(coords);
    return {
        type: "Feature",
        bbox,
        geometry: { type: "LineString", coordinates: coords },
        properties: {},
    };
}

// ─── Parallel track de-duplication ───────────────────────────────────────────

const PARALLEL_MAX_LATERAL_M = 30; // max perpendicular distance for dual tracks
const PARALLEL_MIN_COSINE = 0.966; // cos(15°)
/** Sample at most this many points along a track for the hug test. */
const PARALLEL_HUG_SAMPLES = 80;

/** Bbox [w,s,e,n] of a coordinate array, expanded by `padDeg`. */
function coordsBbox(coords, padDeg = 0) {
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

function bboxesOverlap(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * True when every sampled point of `shorter` lies within `maxLateral` of
 * `longer` — i.e. `shorter` runs alongside `longer` for its whole length and is
 * a duplicate track. A point that strays (a diverging branch) fails fast.
 */
function shorterHugsLonger(longer, shorter, maxLateral) {
    const step = Math.max(1, Math.floor(shorter.length / PARALLEL_HUG_SAMPLES));
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
 */
function dedupeParallelTracks(features) {
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
        coordsBbox(f.geometry.coordinates, PARALLEL_MAX_LATERAL_M / 111320),
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
            if (Math.abs(cosineSimilarity(dir[i], dir[j])) < PARALLEL_MIN_COSINE) {
                continue;
            }
            if (
                shorterHugsLonger(
                    features[i].geometry.coordinates,
                    features[j].geometry.coordinates,
                    PARALLEL_MAX_LATERAL_M,
                )
            ) {
                dropped[j] = true;
            }
        }
    }

    return features.filter((_, i) => !dropped[i]);
}

// ─── Collinear gap bridging ──────────────────────────────────────────────────
//
// A handful of real OSM coverage breaks remain where a connecting segment is
// missing the high-speed tag, leaving a short gap between two otherwise-collinear
// corridors. This pass joins such corridor ends. It runs only on the assembled
// corridors and requires the two ends to face each other nearly head-on, so it
// cannot reconnect unrelated tracks. Gaps larger than BRIDGE_MAX_GAP_M are left
// for `validateLineContinuity` to flag rather than bridged blindly.

const BRIDGE_MAX_GAP_M = 1500;
const BRIDGE_MIN_FACING_COS = 0.95; // facing tangents must be near-antiparallel

function bridgeCollinearGaps(features) {
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
                if (gap < 1 || gap > BRIDGE_MAX_GAP_M) continue;
                // Ends must face each other (inward tangents antiparallel) …
                if (cosineSimilarity(ea.t, eb.t) > -BRIDGE_MIN_FACING_COS) {
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

// ─── Continuity validation ───────────────────────────────────────────────────

/** Unit vector a→b in local meters (for short gaps). */
function localUnit(a, b) {
    const dx =
        (b[0] - a[0]) * 111320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
    const dy = (b[1] - a[1]) * 111320;
    const mag = Math.hypot(dx, dy);
    return mag === 0 ? [0, 0] : [dx / mag, dy / mag];
}

/** Great-circle length of a coordinate ring/line in meters. */
function lineLengthMeters(coords) {
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
function validateLineContinuity(features, extractBbox, opts = {}) {
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
            // The gap must open in front of ea's loose end (opposite its tangent).
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
        problems.push(`${components} connected components (max ${maxComponents})`);
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

// ─── Main ─────────────────────────────────────────────────────────────────────

const attribution = {
    text: "© OpenStreetMap contributors. Data available under the Open Database License (ODbL). Geofabrik extract from download.geofabrik.de.",
    license: "ODbL-1.0",
    url: "https://www.openstreetmap.org/copyright",
};

async function main() {
    const config = YAML.parse(await readFile(configPath, "utf8"));

    if (!config.measuring) {
        throw new Error("No 'measuring' block found in config.yaml");
    }

    const cacheOnly = process.argv.includes("--cache-only");
    const checkMode = process.argv.includes("--check");
    // --only=<category> regenerates a single bundle (e.g. high-speed-rail)
    // without touching the others — handy when iterating on one category.
    const onlyArg = process.argv.find((a) => a.startsWith("--only="));
    const onlyCategory = onlyArg ? onlyArg.slice("--only=".length) : null;
    if (onlyCategory && !CATEGORIES.some((c) => c.key === onlyCategory)) {
        throw new Error(
            `Unknown --only category "${onlyCategory}". Valid: ${CATEGORIES.map((c) => c.key).join(", ")}`,
        );
    }
    const categories = onlyCategory
        ? CATEGORIES.filter((c) => c.key === onlyCategory)
        : CATEGORIES;
    const measConfig = config.measuring;
    const cacheDir = resolve(geofabrikDir, config.cacheDir ?? "cache");
    const extractBbox = measConfig.extractBbox;
    const sourceUrl = measConfig.sourcePbfUrl;

    const outputDir = checkMode
        ? resolve(
              (await import("node:os")).tmpdir(),
              `measuring-bundle-check-${Date.now()}`,
          )
        : resolve(root, "assets", "measuring");

    await mkdir(cacheDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    // 1. Ensure whole-Japan PBF is cached.
    const japanPbfPath = resolve(cacheDir, "japan-latest.osm.pbf");
    if (existsSync(japanPbfPath)) {
        console.log(`Using cached: ${japanPbfPath}`);
    } else if (cacheOnly) {
        throw new Error(
            "japan-latest.osm.pbf not cached and --cache-only is set. Run without --cache-only to download.",
        );
    } else {
        console.log(`Downloading: ${sourceUrl}`);
        const response = await fetch(sourceUrl);
        if (!response.ok) {
            throw new Error(`Download failed: ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(japanPbfPath, buffer);
        console.log(`Wrote ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
    }

    const japanStat = await stat(japanPbfPath);
    console.log(
        `Japan PBF size: ${(japanStat.size / 1024 / 1024).toFixed(1)} MB`,
    );

    // 2. Extract Kantō+margin window (reuse the cached extract if present).
    const widePbfPath = resolve(cacheDir, "measuring-kanto-wide.osm.pbf");
    const bboxStr = extractBbox.join(",");
    if (existsSync(widePbfPath)) {
        console.log(`Using cached Kantō+margin extract: ${widePbfPath}`);
    } else {
        console.log(`Extracting Kantō+margin window: ${bboxStr}`);
        execFileSync(
            "osmium",
            [
                "extract",
                "-b",
                bboxStr,
                japanPbfPath,
                "-o",
                widePbfPath,
                "--overwrite",
            ],
            { stdio: "inherit" },
        );
    }
    const wideStat = await stat(widePbfPath);
    console.log(
        `Kantō+margin extract: ${(wideStat.size / 1024 / 1024).toFixed(1)} MB`,
    );

    // 3. Shared coarse filter for admin 1st/2nd.
    const adminTmpDir = join(
        (await import("node:os")).tmpdir(),
        `measuring-admin-${Date.now()}`,
    );
    await mkdir(adminTmpDir, { recursive: true });
    const adminPbfPath = join(adminTmpDir, "admin-boundaries.osm.pbf");
    const adminSeqPath = join(adminTmpDir, "admin-boundaries.seq");
    let adminSeqExists = false;

    const generatedAt = new Date().toISOString();
    const sizes = {};

    for (const category of categories) {
        console.log(`\n=== ${category.key} ===`);

        let pbfPath;
        if (
            category.key === "admin-1st-border" ||
            category.key === "admin-2nd-border"
        ) {
            // Shared coarse filter for admin boundaries.
            if (!adminSeqExists) {
                console.log(
                    `  [shared] Filtering r/boundary=administrative...`,
                );
                execFileSync(
                    "osmium",
                    [
                        "tags-filter",
                        widePbfPath,
                        "r/boundary=administrative",
                        "-o",
                        adminPbfPath,
                        "-O",
                    ],
                    { stdio: "inherit" },
                );
                console.log(`  [shared] Exporting to GeoJSONSeq...`);
                execFileSync(
                    "osmium",
                    [
                        "export",
                        adminPbfPath,
                        "-f",
                        "geojsonseq",
                        "-a",
                        "type",
                        "-o",
                        adminSeqPath,
                        "-O",
                    ],
                    { stdio: "inherit" },
                );
                adminSeqExists = true;
            }
            pbfPath = adminPbfPath;
        } else {
            console.log(`  Filtering: ${category.osmiumFilter}`);
            const tmpDir = join(
                (await import("node:os")).tmpdir(),
                `measuring-${category.key}-${Date.now()}`,
            );
            await mkdir(tmpDir, { recursive: true });
            pbfPath = join(tmpDir, `${category.key}.osm.pbf`);
            execFileSync(
                "osmium",
                [
                    "tags-filter",
                    widePbfPath,
                    ...category.osmiumFilter.split(" "),
                    "-o",
                    pbfPath,
                    "-O",
                ],
                { stdio: "inherit" },
            );
        }

        // Export to GeoJSONSeq.
        let seqPath;
        if (
            category.key === "admin-1st-border" ||
            category.key === "admin-2nd-border"
        ) {
            seqPath = adminSeqPath;
        } else {
            const tmpDir = dirname(pbfPath);
            seqPath = join(tmpDir, `${category.key}.seq`);
            console.log(`  Exporting to GeoJSONSeq...`);
            execFileSync(
                "osmium",
                [
                    "export",
                    pbfPath,
                    "-f",
                    "geojsonseq",
                    "-a",
                    "type",
                    "-o",
                    seqPath,
                    "-O",
                ],
                { stdio: "inherit" },
            );
        }

        // Stream, post-filter, convert, simplify, collect.
        console.log(`  Processing features...`);
        const features = [];
        const rl = createInterface({
            input: createReadStream(seqPath, { encoding: "utf8" }),
            crlfDelay: Infinity,
        });

        for await (const line of rl) {
            const RS = String.fromCharCode(0x1e);
            const clean = line.startsWith(RS)
                ? line.slice(1).trim()
                : line.trim();
            if (!clean) continue;

            let feature;
            try {
                feature = JSON.parse(clean);
            } catch {
                continue;
            }

            // Apply post-filter.
            if (category.postFilter) {
                if (!applyPostFilter(category, feature.properties ?? {})) {
                    continue;
                }
            }

            // Convert polygon to outer-ring LineString.
            let lineFeatures;
            if (category.geometry === "polygon-to-ring") {
                lineFeatures = featureToLineStrings(feature);
            } else {
                // Coastline / high-speed-rail: pass-through LineString.
                if (
                    feature.geometry.type === "LineString" ||
                    feature.geometry.type === "MultiLineString"
                ) {
                    lineFeatures = [feature];
                } else {
                    // Skip non-line geometry (shouldn't happen with way filters).
                    continue;
                }
            }

            for (const lf of lineFeatures) {
                // Split MultiLineStrings into individual LineStrings.
                // Route relation exports may produce MultiLineStrings when
                // member ways have gaps; splitting lets stitchSegments
                // reconnect them properly.
                const lineStrings =
                    lf.geometry.type === "MultiLineString"
                        ? lf.geometry.coordinates.map((coords) => ({
                              type: "Feature",
                              geometry: {
                                  type: "LineString",
                                  coordinates: coords,
                              },
                              properties: lf.properties ?? {},
                          }))
                        : [lf];

                for (const ls of lineStrings) {
                    // High-speed-rail is simplified *after* stitching (below) so
                    // the shared-node assembler sees full-resolution endpoints;
                    // every other category simplifies here.
                    const tolerance =
                        SIMPLIFY_TOLERANCES[category.key] ?? 0.0001;
                    const simplified =
                        category.key === "high-speed-rail"
                            ? ls
                            : simplifyFeature(ls, tolerance);

                    // Compute bbox on the (possibly simplified) geometry.
                    const bbox = computeBbox(simplified.geometry.coordinates);

                    features.push({
                        type: "Feature",
                        bbox,
                        geometry: simplified.geometry,
                        properties: {},
                    });
                }
            }
        }

        console.log(`  Collected ${features.length.toLocaleString()} features`);

        // ── High-speed-rail post-processing ─────────────────────────────
        if (category.key === "high-speed-rail") {
            const t0 = Date.now();
            console.log(`  Stitching ${features.length} features...`);
            const stitched = stitchSegments(features);
            console.log(
                `  Stitched: ${features.length} → ${stitched.length} features ` +
                    `(${((Date.now() - t0) / 1000).toFixed(1)}s)`,
            );

            const t1 = Date.now();
            console.log(`  De-duplicating parallel tracks...`);
            const deduped = dedupeParallelTracks(stitched);
            console.log(
                `  De-duplicated: ${stitched.length} → ${deduped.length} features ` +
                    `(${((Date.now() - t1) / 1000).toFixed(1)}s)`,
            );

            // Bridge any short collinear gaps left by real OSM coverage breaks.
            const bridged = bridgeCollinearGaps(deduped);
            console.log(
                `  Bridged collinear gaps: ${deduped.length} → ${bridged.length} features`,
            );

            // Re-simplify with coarser tolerance.
            const t2 = Date.now();
            // Re-simplify with a coarser tolerance than the initial pass.
            // The stitcher works on full-resolution shared nodes; this pass
            // removes extra vertices introduced by centerline computation.
            const resimplified = bridged.map((f) => simplifyFeature(f, 0.0002));
            // Recompute bboxes.
            for (const f of resimplified) {
                f.bbox = computeBbox(f.geometry.coordinates);
            }
            console.log(
                `  Re-simplified ${resimplified.length} features ` +
                    `(${((Date.now() - t2) / 1000).toFixed(1)}s)`,
            );

            // Fail loudly if the assembled line is discontinuous.
            validateLineContinuity(resimplified, extractBbox);

            features.length = 0;
            features.push(...resimplified);
        }

        // Write bundle.
        const bundle = {
            schemaVersion: 1,
            category: category.key,
            generatedAt,
            source: "japan-latest",
            extractBbox,
            attribution,
            features,
        };

        const artifactPath = resolve(outputDir, `${category.key}.json`);
        const serialized = JSON.stringify(bundle);
        await writeFile(artifactPath, serialized + "\n");
        const rawSize = Buffer.byteLength(serialized);
        const gzipped = gzipSync(serialized, { level: 9 });
        console.log(
            `  Wrote ${category.key}.json (${(rawSize / 1024 / 1024).toFixed(2)} MB raw, ${(gzipped.length / 1024 / 1024).toFixed(2)} MB gzip)`,
        );

        sizes[category.key] = {
            rawBytes: rawSize,
            gzipBytes: gzipped.length,
            featureCount: features.length,
        };
    }

    // Clean up admin temp dir.
    try {
        await rm(adminTmpDir, { recursive: true, force: true });
    } catch {
        // best-effort
    }

    // 4. Print summary.
    console.log(`\n=== Bundle Size Summary ===`);
    let totalRaw = 0;
    let totalGzip = 0;
    for (const [key, s] of Object.entries(sizes)) {
        console.log(
            `  ${key}: ${s.featureCount.toLocaleString()} features, ${(s.rawBytes / 1024 / 1024).toFixed(2)} MB raw, ${(s.gzipBytes / 1024 / 1024).toFixed(2)} MB gzip`,
        );
        totalRaw += s.rawBytes;
        totalGzip += s.gzipBytes;
    }
    console.log(
        `  TOTAL: ${(totalRaw / 1024 / 1024).toFixed(2)} MB raw, ${(totalGzip / 1024 / 1024).toFixed(2)} MB gzip`,
    );

    // 5. --check mode: diff against committed.
    if (checkMode) {
        await checkAgainstCommitted(outputDir, root);
    }
}

// ─── --check mode ─────────────────────────────────────────────────────────────

async function checkAgainstCommitted(tempDir, root) {
    const committedDir = resolve(root, "assets", "measuring");

    if (!existsSync(committedDir)) {
        console.error(
            "[check] assets/measuring/ does not exist. Run pnpm data:measuring without --check first to generate bundles.",
        );
        process.exitCode = 1;
        return;
    }

    let mismatch = false;
    const files = CATEGORIES.map((c) => `${c.key}.json`);

    for (const file of files) {
        const genPath = resolve(tempDir, file);
        const commPath = resolve(committedDir, file);

        let generated, committed;
        try {
            generated = await readFile(genPath, "utf8");
            committed = await readFile(commPath, "utf8");
        } catch (err) {
            console.error(`[check] Cannot compare ${file}: ${err.message}`);
            mismatch = true;
            continue;
        }

        try {
            const genObj = JSON.parse(generated);
            const comObj = JSON.parse(committed);

            // Compare structural equality (not whitespace).
            // Strip generatedAt since it always differs.
            genObj.generatedAt = "";
            comObj.generatedAt = "";

            if (JSON.stringify(genObj) !== JSON.stringify(comObj)) {
                console.error(
                    `[check] Mismatch in ${file}: generated differs from committed`,
                );
                mismatch = true;
            } else {
                console.log(`[check] ${file}: OK`);
            }
        } catch {
            if (generated !== committed) {
                console.error(`[check] Mismatch in ${file}`);
                mismatch = true;
            }
        }
    }

    if (mismatch) {
        throw new Error(
            "Measuring bundle artifacts differ from committed versions. Run pnpm data:measuring to regenerate.",
        );
    }

    // Clean up temp dir.
    await rm(tempDir, { recursive: true, force: true });
}

// Exported for unit/structural tests (the module runs `main` only when invoked
// directly via the guard below, so importing it has no side effects).
export { stitchSegments, validateLineContinuity };

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}
