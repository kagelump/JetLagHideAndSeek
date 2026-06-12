/**
 * Tests for name normalization.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeName, collectNormalizedVariants } from "./normalizeNames.mjs";

describe("normalizeName", () => {
    it("lowercases ASCII", () => {
        assert.equal(normalizeName("Utrecht"), "utrecht");
    });

    it("strips diacritics from Latin text", () => {
        assert.equal(normalizeName("São Paulo"), "sao paulo");
    });

    it("strips combined diacritics (NFKD decomposed)", () => {
        assert.equal(normalizeName("Kreis Düren"), "kreis duren");
    });

    it("handles multiple diacritics", () => {
        assert.equal(
            normalizeName("München-Neuperlach Süd"),
            "munchen-neuperlach sud",
        );
    });

    it("passes CJK through unchanged", () => {
        // Tokyo / 東京 in Japanese — no diacritics to strip, just lowercase
        assert.equal(normalizeName("東京"), "東京");
        assert.equal(normalizeName("北海道"), "北海道");
    });

    it("passes mixed CJK + Latin through", () => {
        // Mixed script: CJK stays, Latin lowercased
        assert.equal(normalizeName("東京都 Tokyo"), "東京都 tokyo");
    });

    it("handles empty string", () => {
        assert.equal(normalizeName(""), "");
    });

    it("handles null/undefined gracefully", () => {
        assert.equal(normalizeName(null), "");
        assert.equal(normalizeName(undefined), "");
    });
});

describe("collectNormalizedVariants", () => {
    it("collects name and name:en", () => {
        const variants = collectNormalizedVariants({
            name: "Utrecht",
            "name:en": "Utrecht",
        });
        assert.deepEqual(variants, ["utrecht"]);
    });

    it("deduplicates same normalized form", () => {
        const variants = collectNormalizedVariants({
            name: "Utrecht",
            "name:en": "Utrecht",
            "name:nl": "Utrecht",
        });
        assert.deepEqual(variants, ["utrecht"]);
    });

    it("collects different normalized variants", () => {
        const variants = collectNormalizedVariants({
            name: "São Paulo",
            "name:en": "Sao Paulo",
        });
        assert.deepEqual(variants, ["sao paulo"]);
    });

    it("includes local-language names", () => {
        const variants = collectNormalizedVariants({
            name: "東京都",
            "name:en": "Tokyo",
            "name:ja": "東京都",
        });
        // "東京都" survives as CJK; "tokyo" is ASCII — sort order places ASCII first
        assert.deepEqual(variants, ["tokyo", "東京都"]);
    });

    it("handles properties without name", () => {
        const variants = collectNormalizedVariants({
            admin_level: "4",
        });
        assert.deepEqual(variants, []);
    });

    it("handles null/undefined properties", () => {
        assert.deepEqual(collectNormalizedVariants(null), []);
        assert.deepEqual(collectNormalizedVariants(undefined), []);
    });
});

// ─── Cross-format consistency fixture ───────────────────────────────────
//
// These fixtures are the contract between the pipeline normalizer and the
// app-side normalizeForSearch() in src/features/offline/boundaryStore.ts.
// Both MUST produce identical output for every fixture — if either side
// changes, this test and the corresponding Jest test must be updated
// together.

const CROSS_FORMAT_FIXTURES = [
    // [input, expected]
    ["Amsterdam", "amsterdam"],
    ["Den Haag", "den haag"],
    ["São Paulo", "sao paulo"],
    ["München", "munchen"],
    ["Düsseldorf", "dusseldorf"],
    ["東京", "東京"],
    ["北海道", "北海道"],
    ["東京都 Tokyo", "東京都 tokyo"],
    // Japanese dakuten — U+3099 combining mark. These are OUTSIDE the
    // U+0300–U+036F Combining Diacritical Marks block, so they are
    // intentionally preserved by both normalizers.
    ["が", "が"], // か + dakuten → が in composed form; NFKD keeps decomposed
    // Edge: empty
    ["", ""],
];

describe("cross-format fixture consistency", () => {
    for (const [input, expected] of CROSS_FORMAT_FIXTURES) {
        it(`normalizes "${input}" → "${expected}"`, () => {
            assert.equal(
                normalizeName(input),
                expected,
                `normalizeName("${input}") must equal "${expected}"`,
            );
        });
    }
});
