/**
 * Array helpers for the packs pipeline.
 *
 * @module arrayUtil
 */

/**
 * Append every element of `source` to `target`, in place.
 *
 * Use this instead of `target.push(...source)` whenever `source` may be large.
 * The spread / `Function.prototype.apply` form turns each element into a
 * separate call argument, which overflows V8's argument-count limit (~10k–20k
 * elements) — a real hazard in this pipeline, where water-dense regions emit
 * tens of thousands of features or coordinate values at once. See
 * docs/bugs/deltaEncode-stack-overflow.md.
 *
 * A plain element-by-element loop has no such ceiling, allocates nothing, and
 * is well-optimised by V8.
 *
 * @template T
 * @param {T[]} target - array to append to (mutated)
 * @param {ArrayLike<T>} source - elements to append
 * @returns {T[]} the same `target`, for chaining
 */
export function pushAll(target, source) {
    for (let i = 0; i < source.length; i++) {
        target.push(source[i]);
    }
    return target;
}
