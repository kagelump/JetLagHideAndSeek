import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildOperatorNormalizer,
    splitOperators,
} from "./normalizeOperator.mjs";

describe("buildOperatorNormalizer", () => {
    const operatorNames = {
        "JR East": ["東日本旅客鉄道", "JR東日本"],
        "Tokyu Railways": ["東京急行電鉄", "東急電鉄"],
    };
    const normalize = buildOperatorNormalizer(operatorNames);

    it("returns canonical for exact variant match", () => {
        assert.strictEqual(normalize("JR東日本"), "JR East");
    });

    it("returns raw string for unknown operator", () => {
        assert.strictEqual(normalize("未知の鉄道"), "未知の鉄道");
    });

    it("returns null for null/undefined input", () => {
        assert.strictEqual(normalize(null), null);
        assert.strictEqual(normalize(undefined), null);
    });

    it("matches by substring containment", () => {
        // e.g. "東日本旅客鉄道 (JR East)" contains "東日本旅客鉄道"
        assert.strictEqual(normalize("東日本旅客鉄道 (JR East)"), "JR East");
    });

    it("returns canonical name itself when used as input", () => {
        assert.strictEqual(normalize("JR East"), "JR East");
    });

    it("handles empty operatorNames config", () => {
        const n = buildOperatorNormalizer({});
        assert.strictEqual(n("JR East"), "JR East");
    });
});

describe("splitOperators", () => {
    const operatorNames = {
        "JR East": ["東日本旅客鉄道"],
        "Tokyo Metro": ["東京地下鉄"],
    };
    const normalize = buildOperatorNormalizer(operatorNames);

    it("splits semicolon-separated operators and normalizes each", () => {
        const result = splitOperators("東日本旅客鉄道;東京地下鉄", normalize);
        assert.deepStrictEqual(result, ["JR East", "Tokyo Metro"]);
    });

    it("returns single operator as array", () => {
        const result = splitOperators("JR East", normalize);
        assert.deepStrictEqual(result, ["JR East"]);
    });

    it("returns empty array for null/undefined", () => {
        assert.deepStrictEqual(splitOperators(null, normalize), []);
        assert.deepStrictEqual(splitOperators(undefined, normalize), []);
    });

    it("returns empty array for empty string", () => {
        assert.deepStrictEqual(splitOperators("", normalize), []);
    });

    it("filters empty parts from split", () => {
        const result = splitOperators("JR East;;Tokyo Metro", normalize);
        assert.deepStrictEqual(result, ["JR East", "Tokyo Metro"]);
    });

    it("trims whitespace around operators", () => {
        const result = splitOperators(" JR East ; Tokyo Metro ", normalize);
        assert.deepStrictEqual(result, ["JR East", "Tokyo Metro"]);
    });
});
