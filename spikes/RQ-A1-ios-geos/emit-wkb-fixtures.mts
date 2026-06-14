// RQ-C1 spike: emit WKB-hex fixtures from the repo's own encoder (the JS
// engine's source of truth) so Swift/Kotlin can parse the exact same bytes.
//
// Run: node --import tsx spikes/RQ-A1-ios-geos/emit-wkb-fixtures.mts
import { encodeWkb } from "../../src/shared/geometry/wkb.ts";
import type { Polygon, MultiPolygon, LineString, MultiPoint } from "geojson";

const tokyoWard: Polygon = {
    type: "Polygon",
    coordinates: [
        [
            [139.74, 35.66],
            [139.79, 35.66],
            [139.79, 35.7],
            [139.74, 35.7],
            [139.74, 35.66],
        ],
    ],
};

const tokyoRailLine: LineString = {
    type: "LineString",
    coordinates: [
        [139.7006, 35.6896],
        [139.7454, 35.6586],
        [139.7671, 35.6812],
        [139.7966, 35.7101],
    ],
};

const osakaStations: MultiPoint = {
    type: "MultiPoint",
    coordinates: [
        [135.4959, 34.7024],
        [135.5018, 34.6663],
        [135.5206, 34.6464],
    ],
};

const twoWards: MultiPolygon = {
    type: "MultiPolygon",
    coordinates: [
        tokyoWard.coordinates,
        [
            [
                [139.6, 35.6],
                [139.65, 35.6],
                [139.65, 35.64],
                [139.6, 35.64],
                [139.6, 35.6],
            ],
        ],
    ],
};

const toHex = (b: Uint8Array) =>
    Array.from(b)
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");

// Flatten all coordinate pairs of a geometry (JS side's own count/bbox).
function allCoords(geom: {
    type: string;
    coordinates: unknown;
}): [number, number][] {
    const acc: [number, number][] = [];
    const walk = (c: unknown): void => {
        if (
            Array.isArray(c) &&
            c.length >= 2 &&
            typeof c[0] === "number" &&
            typeof c[1] === "number"
        ) {
            acc.push([c[0], c[1]]);
        } else if (Array.isArray(c)) {
            for (const x of c) walk(x);
        }
    };
    walk(geom.coordinates);
    return acc;
}

function bbox(coords: [number, number][]) {
    let xmin = Infinity,
        ymin = Infinity,
        xmax = -Infinity,
        ymax = -Infinity;
    for (const [x, y] of coords) {
        if (x < xmin) xmin = x;
        if (y < ymin) ymin = y;
        if (x > xmax) xmax = x;
        if (y > ymax) ymax = y;
    }
    return { xmin, ymin, xmax, ymax };
}

const fixtures: {
    name: string;
    geom: Polygon | MultiPolygon | LineString | MultiPoint;
}[] = [
    { name: "tokyo_ward_polygon", geom: tokyoWard },
    { name: "tokyo_rail_linestring", geom: tokyoRailLine },
    { name: "osaka_stations_multipoint", geom: osakaStations },
    { name: "two_wards_multipolygon", geom: twoWards },
];

const out = fixtures.map(({ name, geom }) => {
    const coords = allCoords(geom);
    return {
        name,
        type: geom.type,
        hex: toHex(encodeWkb(geom)),
        // JS-side ground truth for cross-engine comparison.
        numCoords: coords.length,
        bbox: bbox(coords),
    };
});

console.log(JSON.stringify(out, null, 2));
