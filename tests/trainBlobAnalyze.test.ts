import type { Feature, FeatureCollection, LineString, MultiLineString } from "geojson";
import osmtogeojson from "osmtogeojson";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import _ from "lodash";
import { describe, expect, it } from "vitest";

import type { TrainOverlaySimplifyPreset } from "@/maps/api/trainLineTrim";
import { trainOverlayCorridorCollapseStats } from "@/maps/api/trainLineTrim";

const runAnalyze = process.env.ANALYZE_TRAIN_BLOB === "1";
const maybeDescribe = runAnalyze ? describe : describe.skip;

maybeDescribe("train blob corridor analyze", () => {
    it("summarizes testdata/blob tag mix and corridor dedupe potential", () => {
        const blobPath = resolve(process.cwd(), "testdata/blob");
        const rawBlob = readFileSync(blobPath, "utf8");
        const overpassBlob = JSON.parse(rawBlob) as { elements?: unknown[] };

        const geoJSON = osmtogeojson(overpassBlob) as FeatureCollection;
        const lineFeatures = geoJSON.features.filter((feature: any) => {
            const geometryType = feature?.geometry?.type;
            return (
                geometryType === "LineString" || geometryType === "MultiLineString"
            );
        }) as Array<Feature<LineString | MultiLineString>>;

        expect(lineFeatures.length).toBeGreaterThan(0);

        const byRailway = _.countBy(lineFeatures, (f) =>
            String((f.properties as Record<string, unknown> | undefined)?.railway ?? "unknown"),
        );
        console.log("[train-blob-analyze] line count by railway tag:", byRailway);

        const PRESETS: TrainOverlaySimplifyPreset[] = ["balanced", "fast", "veryFast"];
        for (const preset of PRESETS) {
            const stats = trainOverlayCorridorCollapseStats(lineFeatures, preset);
            console.log("[train-blob-analyze] corridor collapse:", preset, stats);
        }
    });
});
