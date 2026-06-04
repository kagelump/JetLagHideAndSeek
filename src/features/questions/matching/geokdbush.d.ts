declare module "geokdbush" {
    import type KDBush from "kdbush";

    /**
     * Returns an array of indices from the index that are within
     * `maxDistance` kilometers from (`lng`, `lat`), sorted by haversine
     * distance ascending. If `maxResults` is provided, only the nearest N
     * items are returned.
     */
    export function around(
        index: KDBush,
        lng: number,
        lat: number,
        maxResults?: number,
        maxDistance?: number,
        predicate?: (id: number) => boolean,
    ): number[];
}
