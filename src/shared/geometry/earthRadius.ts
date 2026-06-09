/**
 * Mean Earth radius in meters (WGS-84 / IUGG) — matches `@turf/*` exactly.
 *
 * This lives in a **dependency-free leaf module** on purpose. It is consumed by
 * both `@/shared/geojson` and `@/shared/geometry/bufferProjection`. If
 * `bufferProjection` imported the constant from `geojson` instead, it would
 * close a require cycle (geojson → geometryBackend → geosGeometryBackend →
 * bufferProjection → geojson). Under Hermes that cycle resolved with
 * `EARTH_RADIUS` still `undefined` at module-init, so the AEQD projection ran
 * with `scale(undefined)` and produced all-NaN coordinates — silently breaking
 * every GEOS buffer. Keep this module import-free so it can never participate
 * in a cycle.
 */
export const EARTH_RADIUS_METERS = 6_371_008.8;
