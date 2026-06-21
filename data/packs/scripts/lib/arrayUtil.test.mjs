/**
 * Tests for arrayUtil: pushAll bulk-append helper.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pushAll } from "./arrayUtil.mjs";

describe("pushAll", () => {
    it("appends all elements in order onto existing content", () => {
        const target = [1, 2];
        const ret = pushAll(target, [3, 4, 5]);
        assert.deepEqual(target, [1, 2, 3, 4, 5]);
        assert.equal(ret, target); // returns the same array for chaining
    });

    it("is a no-op for an empty source", () => {
        const target = [1, 2];
        pushAll(target, []);
        assert.deepEqual(target, [1, 2]);
    });

    it("does not overflow the stack for very large sources (regression)", () => {
        // `target.push(...source)` throws RangeError around this size; pushAll
        // must not. See docs/bugs/deltaEncode-stack-overflow.md.
        const source = new Array(500_000).fill(0).map((_, i) => i);
        const target = [];
        assert.doesNotThrow(() => pushAll(target, source));
        assert.equal(target.length, source.length);
        assert.equal(target[0], 0);
        assert.equal(target[target.length - 1], source.length - 1);
    });
});
