import {
    pointInPolygon,
    pointInMultiPolygon,
    pointInGeometry,
} from "../pointInPolygon";

type Position = [number, number];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** A simple 1°×1° square: bottom-left at (0,0), top-right at (1,1). */
const SQUARE: Position[][] = [
    [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
    ],
];

/** Square with a hole in the centre. */
const SQUARE_WITH_HOLE: Position[][] = [
    SQUARE[0],
    // hole: 0.25°–0.75°
    [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.75, 0.75],
        [0.25, 0.75],
        [0.25, 0.25],
    ],
];

// ─── pointInPolygon ──────────────────────────────────────────────────────────

describe("pointInPolygon", () => {
    it("returns true when point is inside the exterior ring", () => {
        expect(pointInPolygon(0.5, 0.5, SQUARE)).toBe(true);
    });

    it("returns false when point is outside the exterior ring", () => {
        expect(pointInPolygon(2, 2, SQUARE)).toBe(false);
    });

    it("returns false when point is exactly on the left edge", () => {
        // The ray extends to the right, so a point on the leftmost edge
        // is still "inside."
        expect(pointInPolygon(0, 0.5, SQUARE)).toBe(true);
    });

    it("returns false when point is inside a hole", () => {
        expect(pointInPolygon(0.5, 0.5, SQUARE_WITH_HOLE)).toBe(false);
    });

    it("returns true when point is between the exterior and the hole", () => {
        // Just outside the hole, still inside the exterior.
        expect(pointInPolygon(0.8, 0.5, SQUARE_WITH_HOLE)).toBe(true);
    });

    it("returns false for a degenerate 2-vertex ring", () => {
        // A ring with only 2 vertices can't enclose any area.
        const twoVerts: Position[][] = [
            [
                [0, 0],
                [1, 1],
            ],
        ];
        expect(pointInPolygon(0.5, 0.5, twoVerts)).toBe(false);
    });
});

// ─── pointInMultiPolygon ─────────────────────────────────────────────────────

describe("pointInMultiPolygon", () => {
    const TWO_SQUARES: Position[][][] = [
        SQUARE, // (0,0)–(1,1)
        [
            // (2,0)–(3,1)
            [
                [2, 0],
                [3, 0],
                [3, 1],
                [2, 1],
                [2, 0],
            ],
        ],
    ];

    it("returns true when point is in the first polygon", () => {
        expect(pointInMultiPolygon(0.5, 0.5, TWO_SQUARES)).toBe(true);
    });

    it("returns true when point is in the second polygon", () => {
        expect(pointInMultiPolygon(2.5, 0.5, TWO_SQUARES)).toBe(true);
    });

    it("returns false when point is outside all polygons", () => {
        expect(pointInMultiPolygon(1.5, 0.5, TWO_SQUARES)).toBe(false);
    });
});

// ─── pointInGeometry ─────────────────────────────────────────────────────────

describe("pointInGeometry", () => {
    it("handles Polygon geometry", () => {
        expect(
            pointInGeometry(0.5, 0.5, {
                type: "Polygon",
                coordinates: SQUARE,
            }),
        ).toBe(true);
        expect(
            pointInGeometry(2, 2, {
                type: "Polygon",
                coordinates: SQUARE,
            }),
        ).toBe(false);
    });

    it("handles MultiPolygon geometry", () => {
        expect(
            pointInGeometry(0.5, 0.5, {
                type: "MultiPolygon",
                coordinates: [
                    SQUARE,
                    [
                        [
                            [2, 0],
                            [3, 0],
                            [3, 1],
                            [2, 1],
                            [2, 0],
                        ],
                    ],
                ],
            }),
        ).toBe(true);
    });
});
