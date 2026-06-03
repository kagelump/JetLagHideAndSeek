import { formatFetchDebug, type FetchDebugInfo } from "../fetchDebug";

const baseInfo: FetchDebugInfo = {
    totalCount: 0,
    origins: {},
    durationMs: 0,
    status: "done",
    at: Date.now(),
};

describe("formatFetchDebug", () => {
    it("returns 'searching…' when status is loading", () => {
        expect(formatFetchDebug({ ...baseInfo, status: "loading" })).toBe(
            "searching…",
        );
    });

    it("returns empty string when status is error", () => {
        expect(formatFetchDebug({ ...baseInfo, status: "error" })).toBe("");
    });

    it("returns empty string when totalCount is 0", () => {
        expect(formatFetchDebug(baseInfo)).toBe("");
    });

    it("cache only", () => {
        expect(
            formatFetchDebug({
                ...baseInfo,
                totalCount: 9,
                origins: { memory: 6, disk: 3 },
                durationMs: 12,
            }),
        ).toBe("9 items from cache");
    });

    it("bundle only", () => {
        expect(
            formatFetchDebug({
                ...baseInfo,
                totalCount: 9,
                origins: { "local-bundle": 9 },
                durationMs: 50,
            }),
        ).toBe("fetched 9 items from local bundle");
    });

    it("overpass only (with timing)", () => {
        expect(
            formatFetchDebug({
                ...baseInfo,
                totalCount: 4,
                origins: { overpass: 4 },
                durationMs: 3050,
                networkMs: 3000,
            }),
        ).toBe("fetched 4 items from overpass (3.0s)");
    });

    it("overpass only sub-second timing", () => {
        expect(
            formatFetchDebug({
                ...baseInfo,
                totalCount: 2,
                origins: { overpass: 2 },
                durationMs: 450,
                networkMs: 400,
            }),
        ).toBe("fetched 2 items from overpass (400ms)");
    });

    it("mixed sources with full __DEV__ breakdown", () => {
        expect(
            formatFetchDebug({
                ...baseInfo,
                totalCount: 13,
                origins: { "local-bundle": 9, overpass: 4 },
                durationMs: 3100,
                networkMs: 3000,
            }),
        ).toBe("9 from bundle · 4 from overpass (3.0s) (13 total, 3.1s)");
    });

    it("mixed with cache, bundle, and overpass", () => {
        expect(
            formatFetchDebug({
                ...baseInfo,
                totalCount: 17,
                origins: {
                    memory: 2,
                    disk: 1,
                    "local-bundle": 10,
                    overpass: 4,
                },
                durationMs: 3200,
                networkMs: 3000,
            }),
        ).toBe(
            "10 from bundle · 4 from overpass (3.0s) · 3 from cache (17 total, 3.2s)",
        );
    });

    it("cache + bundle without overpass", () => {
        expect(
            formatFetchDebug({
                ...baseInfo,
                totalCount: 15,
                origins: { memory: 5, "local-bundle": 10 },
                durationMs: 100,
            }),
        ).toBe("10 from bundle · 5 from cache (15 total, 100ms)");
    });
});
