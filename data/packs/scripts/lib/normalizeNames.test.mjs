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
