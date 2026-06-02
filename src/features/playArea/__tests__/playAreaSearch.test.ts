import {
    fetchPhotonResults,
    mapPhotonFeaturesToPlayAreaResults,
} from "../playAreaSearch";

describe("fetchPhotonResults", () => {
    beforeEach(() => {
        globalThis.fetch = jest.fn();
    });

    it("returns empty array for blank query", async () => {
        const results = await fetchPhotonResults("  ");
        expect(results).toEqual([]);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("throws on Photon API error", async () => {
        (globalThis.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 500,
        });

        await expect(fetchPhotonResults("Osaka")).rejects.toThrow(
            "Photon search error 500",
        );
    });

    it("passes an AbortSignal to fetch", async () => {
        (globalThis.fetch as jest.Mock).mockResolvedValue({
            json: jest.fn().mockResolvedValue({
                features: [
                    {
                        properties: {
                            name: "Osaka",
                            osm_id: 358674,
                            osm_type: "R",
                        },
                    },
                ],
            }),
            ok: true,
        });

        const controller = new AbortController();
        await fetchPhotonResults("Osaka", controller.signal);

        expect(globalThis.fetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ signal: controller.signal }),
        );
    });
});

describe("mapPhotonFeaturesToPlayAreaResults", () => {
    it("keeps relation results and deduplicates by OSM ID", () => {
        const results = mapPhotonFeaturesToPlayAreaResults([
            {
                properties: {
                    country: "Japan",
                    name: "Osaka",
                    osm_id: 358674,
                    osm_type: "R",
                    state: "Osaka Prefecture",
                },
            },
            {
                properties: {
                    name: "Osaka duplicate",
                    osm_id: 358674,
                    osm_type: "R",
                },
            },
            {
                properties: {
                    name: "Osaka Station",
                    osm_id: 123,
                    osm_type: "N",
                },
            },
        ]);

        expect(results).toEqual([
            {
                country: "Japan",
                label: "Osaka",
                osmId: 358674,
                state: "Osaka Prefecture",
            },
        ]);
    });
});
