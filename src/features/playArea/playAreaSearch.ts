import { useQuery } from "@tanstack/react-query";

export type PlayAreaSearchResult = {
    country?: string;
    label: string;
    osmId: number;
    state?: string;
};

type PhotonFeature = {
    properties: {
        country?: string;
        name?: string;
        osm_id?: number;
        osm_type?: string;
        state?: string;
    };
};

function normalizeQuery(query: string): string {
    return query.trim().toLowerCase();
}

export async function fetchPhotonResults(
    query: string,
    signal?: AbortSignal,
): Promise<PlayAreaSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const response = await fetch(
        `https://photon.komoot.io/api/?lang=en&q=${encodeURIComponent(trimmed)}&limit=10`,
        { signal },
    );
    if (!response.ok) {
        throw new Error(`Photon search error ${response.status}`);
    }

    const data = (await response.json()) as { features?: PhotonFeature[] };
    return mapPhotonFeaturesToPlayAreaResults(data.features ?? []);
}

export function usePlayAreaSearch(query: string) {
    const trimmed = query.trim();
    return useQuery({
        queryKey: ["play-area-search", normalizeQuery(trimmed)],
        queryFn: ({ signal }) => fetchPhotonResults(trimmed, signal),
        enabled: trimmed.length > 0,
        staleTime: 60 * 60 * 1000, // place names are stable within a session
    });
}

export function mapPhotonFeaturesToPlayAreaResults(
    features: PhotonFeature[],
): PlayAreaSearchResult[] {
    const seen = new Set<number>();
    const results: PlayAreaSearchResult[] = [];

    for (const feature of features) {
        const { osm_id: osmId, osm_type: osmType, name } = feature.properties;
        if (osmType !== "R" || typeof osmId !== "number" || !name) continue;
        if (seen.has(osmId)) continue;

        seen.add(osmId);
        results.push({
            country: feature.properties.country,
            label: name,
            osmId,
            state: feature.properties.state,
        });
    }

    return results;
}
