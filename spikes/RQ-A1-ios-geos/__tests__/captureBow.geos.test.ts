/**
 * RQ-C3 capture (THROWAWAY spike). Runs the real body-of-water measuring
 * pipeline under the GEOS backend with geos-wasm wired into native-geometry,
 * and records the *exact* WKB inputs handed to the native `unaryUnionWKB`
 * (the ~25 s polyclip-JS dissolve case) and `differenceWKB` (the mask op).
 *
 * Run:
 *   cp .claude/worktrees/.../assets/measuring/body-of-water.json /tmp/bow-asset.json
 *   NODE_OPTIONS=--experimental-vm-modules npx jest --config jest.config.geos.js \
 *     spikes/RQ-A1-ios-geos/__tests__/captureBow.geos.test.ts
 *
 * Output: spikes/RQ-A1-ios-geos/bow-fixtures.json (committed as the C3 fixture).
 * This test is not part of the suite — it exists only to mint the fixture.
 */
import * as fs from "fs";
import * as path from "path";
import {
    initGeosWasm,
    geosWasmVersion,
    bufferWKB as geosWasmBufferWKB,
    unaryUnionWKB as geosWasmUnaryUnionWKB,
    differenceWKB as geosWasmDifferenceWKB,
    unionWKB as geosWasmUnionWKB,
    intersectionWKB as geosWasmIntersectionWKB,
} from "@/shared/geometry/__tests__/helpers/geosWasmShim";
import { geosGeometryBackend } from "@/shared/geometry/geosGeometryBackend";
import { jsGeometryBackend } from "@/shared/geometry/jsGeometryBackend";
import { __setGeometryBackendForTest } from "@/shared/geometry/geometryBackend";
import {
    buildCombinedEligibilityMask,
    clearMaskResultCache,
} from "@/features/map/maskBuilder";
import type {
    GeoJsonFeature,
    GeoJsonFeatureCollection,
} from "@/features/map/geojsonTypes";
import {
    clearLineCategoryCache,
    clearLineDistanceCache,
    clearLineBufferCache,
    computeLineCategory,
    computeLineBuffer,
} from "@/features/questions/measuring/lineMeasuringGeometry";
import {
    __setLineBundleForTest,
    __clearLineBundlesForTest,
    type LineBundle,
} from "@/features/questions/measuring/lineBundleLoader";
import type { Feature, Polygon, MultiPolygon } from "geojson";

const CENTER: [number, number] = [139.658499, 35.68783];
const PLAY_AREA_BBOX: [number, number, number, number] = [139, 35, 140, 36];

const toHex = (b: Uint8Array) =>
    Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("hex");

describe("RQ-C3 capture: body-of-water op inputs", () => {
    it("captures the unaryUnion + difference WKB inputs", async () => {
        await initGeosWasm();

        // Largest-by-bytes captures.
        let unaryInput: Uint8Array | null = null;
        let diffA: Uint8Array | null = null;
        let diffB: Uint8Array | null = null;

        const native = require("native-geometry");
        native.bufferWKB = geosWasmBufferWKB;
        native.unionWKB = geosWasmUnionWKB;
        native.intersectionWKB = geosWasmIntersectionWKB;
        native.unaryUnionWKB = (wkb: Uint8Array) => {
            if (!unaryInput || wkb.length > unaryInput.length) unaryInput = wkb;
            return geosWasmUnaryUnionWKB(wkb);
        };
        native.differenceWKB = (a: Uint8Array, b: Uint8Array) => {
            if (!diffA || a.length > diffA.length) {
                diffA = a;
                diffB = b;
            }
            return geosWasmDifferenceWKB(a, b);
        };

        const bundle: LineBundle = JSON.parse(
            fs.readFileSync("/tmp/bow-asset.json", "utf8"),
        );
        __setLineBundleForTest("body-of-water", bundle);

        clearLineCategoryCache();
        clearLineDistanceCache();
        clearLineBufferCache();
        clearMaskResultCache();
        __clearLineBundlesForTest();
        __setLineBundleForTest("body-of-water", bundle);

        __setGeometryBackendForTest(geosGeometryBackend);
        const cat = computeLineCategory(
            CENTER,
            "body-of-water",
            PLAY_AREA_BBOX,
        );
        if (!cat) throw new Error("computeLineCategory returned null");
        const buf = computeLineBuffer(cat.windowFeatures, cat.distanceMeters);
        if (!buf) throw new Error("computeLineBuffer returned null");
        const eligibleFC: GeoJsonFeatureCollection = {
            type: "FeatureCollection",
            features: [buf as unknown as GeoJsonFeature],
        };
        const [w, s, e, n] = PLAY_AREA_BBOX;
        const playAreaFC: GeoJsonFeatureCollection = {
            type: "FeatureCollection",
            features: [
                {
                    type: "Feature",
                    properties: {},
                    geometry: {
                        type: "Polygon",
                        coordinates: [
                            [
                                [w, s],
                                [e, s],
                                [e, n],
                                [w, n],
                                [w, s],
                            ],
                        ],
                    },
                } as unknown as GeoJsonFeature,
            ],
        };
        buildCombinedEligibilityMask(playAreaFC, [eligibleFC], []);

        // Time the polyclip-JS dissolve on the captured input (headline contrast).
        let jsMs = -1;
        let jsOk = false;
        if (unaryInput) {
            const { decodeWkb } = require("@/shared/geometry/wkb");
            const merged = decodeWkb(unaryInput) as Polygon | MultiPolygon;
            const mergedFeature = {
                type: "Feature",
                properties: {},
                geometry: merged,
            } as Feature<Polygon | MultiPolygon>;
            const t0 = Date.now();
            try {
                const r = jsGeometryBackend.unaryUnion(mergedFeature);
                jsOk = !!r;
            } catch {
                jsOk = false;
            }
            jsMs = Date.now() - t0;
        }

        __setGeometryBackendForTest(null);

        const numCoords = (b: Uint8Array | null) => {
            if (!b) return 0;
            const { decodeWkb } = require("@/shared/geometry/wkb");
            const g = decodeWkb(b) as Polygon | MultiPolygon | null;
            if (!g) return 0;
            let c = 0;
            const walk = (a: any) => {
                if (Array.isArray(a) && typeof a[0] === "number") c++;
                else if (Array.isArray(a)) a.forEach(walk);
            };
            walk(g.coordinates);
            return c;
        };

        const out = {
            note: "RQ-C3 body-of-water op inputs (geos-wasm oracle wired)",
            wasmVersion: geosWasmVersion(),
            center: CENTER,
            playAreaBbox: PLAY_AREA_BBOX,
            distanceMeters: cat.distanceMeters,
            windowFeatures: cat.windowFeatures.length,
            jsPolyclipUnaryUnionMs: jsMs,
            jsPolyclipUnaryUnionOk: jsOk,
            unaryUnion: unaryInput
                ? { numCoords: numCoords(unaryInput), hex: toHex(unaryInput) }
                : null,
            differenceA: diffA
                ? { numCoords: numCoords(diffA), hex: toHex(diffA) }
                : null,
            differenceB: diffB
                ? { numCoords: numCoords(diffB), hex: toHex(diffB) }
                : null,
        };

        const outPath = path.join(__dirname, "..", "bow-fixtures.json");
        fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

        console.log(
            `[C3] distance=${out.distanceMeters?.toFixed?.(1)}m windowFeatures=${out.windowFeatures} ` +
                `unaryCoords=${out.unaryUnion?.numCoords} diffA=${out.differenceA?.numCoords} ` +
                `jsPolyclipMs=${jsMs} jsOk=${jsOk} -> ${outPath}`,
        );
        expect(unaryInput).not.toBeNull();
    }, 120000);
});
