import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { OfflineDataScreen } from "@/features/offline/OfflineDataScreen";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/state/queryClient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";

// ─── Mock catalog fetch ──────────────────────────────────────────────────

const CATALOG_FIXTURE = {
    schemaVersion: 2,
    generatedAt: "2026-06-12T00:00:00Z",
    packs: [
        {
            id: "europe-netherlands",
            label: "Netherlands",
            regionPath: ["Europe", "Netherlands"],
            bbox: [3.31, 50.75, 7.22, 53.7],
            osmSnapshot: "2026-06-08",
            totalBytes: 1000000,
            artifacts: [
                {
                    kind: "poi",
                    url: "https://cdn.example.com/packs/netherlands-poi.json.gz",
                    bytes: 500000,
                    md5: "abc123",
                    sha256: "def456",
                    schemaVersion: 1,
                },
            ],
        },
        {
            id: "europe-germany",
            label: "Germany",
            regionPath: ["Europe", "Germany"],
            bbox: [5.86, 47.27, 15.04, 55.06],
            osmSnapshot: "2026-06-07",
            totalBytes: 2000000,
            artifacts: [
                {
                    kind: "poi",
                    url: "https://cdn.example.com/packs/germany-poi.json.gz",
                    bytes: 1000000,
                    md5: "ghi789",
                    sha256: "jkl012",
                    schemaVersion: 1,
                },
            ],
        },
        {
            id: "asia-japan-kanto",
            label: "Kantō, Japan",
            regionPath: ["Asia", "Kantō, Japan"],
            bbox: [138.4, 34.8, 140.9, 37.1],
            osmSnapshot: "2026-06-05",
            totalBytes: 500000,
            artifacts: [
                {
                    kind: "poi",
                    url: "https://cdn.example.com/packs/japan-kanto-poi.json.gz",
                    bytes: 500000,
                    md5: "mno345",
                    sha256: "pqr678",
                    schemaVersion: 1,
                },
            ],
        },
    ],
};

// ─── Wrapper ─────────────────────────────────────────────────────────────

function renderWithProviders(ui: ReactElement) {
    // We wrap with QueryClientProvider + AppStateProviders (the existing ones).
    return render(
        <SafeAreaProvider
            initialMetrics={{
                frame: { height: 844, width: 390, x: 0, y: 0 },
                insets: { bottom: 34, left: 0, right: 0, top: 47 },
            }}
        >
            <QueryClientProvider client={queryClient}>
                {ui as any}
            </QueryClientProvider>
        </SafeAreaProvider>,
    );
}

describe("OfflineDataScreen", () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        queryClient.clear();
        await AsyncStorage.clear();
        (global as { fetch?: unknown }).fetch = undefined;
    });

    it("shows loading state while catalog is being fetched", () => {
        // Don't set up fetch — it'll be loading.
        (global as { fetch: typeof globalThis.fetch }).fetch = jest
            .fn()
            .mockReturnValue(new Promise(() => {})); // never resolves

        const screen = renderWithProviders(<OfflineDataScreen />);

        expect(screen.getByText("Loading pack catalog…")).toBeTruthy();
    });

    it("shows packs grouped by continent on successful fetch", async () => {
        (global as { fetch: typeof globalThis.fetch }).fetch = jest
            .fn()
            .mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(CATALOG_FIXTURE),
            });

        const screen = renderWithProviders(<OfflineDataScreen />);

        // Wait for the catalog to load.
        expect(await screen.findByText("Europe")).toBeTruthy();
        expect(await screen.findByText("Asia")).toBeTruthy();

        // Pack labels should appear.
        expect(screen.getByText("Netherlands")).toBeTruthy();
        expect(screen.getByText("Germany")).toBeTruthy();
        expect(screen.getByText("Kantō, Japan")).toBeTruthy();
    });

    it("shows error state when catalog fetch fails and no packs installed", async () => {
        (global as { fetch: typeof globalThis.fetch }).fetch = jest
            .fn()
            .mockResolvedValue({ ok: false, status: 500 });

        const screen = renderWithProviders(<OfflineDataScreen />);

        expect(
            await screen.findByText(
                "Could not load pack catalog. Check your connection.",
            ),
        ).toBeTruthy();
    });

    it("shows stale-catalog banner when fetch fails but packs are installed", async () => {
        // Seed an installed pack.
        await AsyncStorage.setItem(
            "installed-packs-v2",
            JSON.stringify({
                "europe-netherlands": {
                    id: "europe-netherlands",
                    osmSnapshot: "2026-06-08",
                    installedAt: "2026-06-10T00:00:00Z",
                    artifacts: [
                        {
                            kind: "poi",
                            bytes: 500000,
                            status: "installed",
                        },
                    ],
                },
            }),
        );

        (global as { fetch: typeof globalThis.fetch }).fetch = jest
            .fn()
            .mockResolvedValue({ ok: false, status: 500 });

        const screen = renderWithProviders(<OfflineDataScreen />);

        expect(
            await screen.findByText(
                "Could not check for updates. Installed packs still work.",
            ),
        ).toBeTruthy();
    });

    it("shows installed state with snapshot date", async () => {
        await AsyncStorage.setItem(
            "installed-packs-v2",
            JSON.stringify({
                "europe-netherlands": {
                    id: "europe-netherlands",
                    osmSnapshot: "2026-06-08",
                    installedAt: "2026-06-10T00:00:00Z",
                    artifacts: [
                        {
                            kind: "poi",
                            bytes: 500000,
                            status: "installed",
                        },
                    ],
                },
            }),
        );

        (global as { fetch: typeof globalThis.fetch }).fetch = jest
            .fn()
            .mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(CATALOG_FIXTURE),
            });

        const screen = renderWithProviders(<OfflineDataScreen />);

        // The installed pack should show "snapshot" in its description.
        expect(await screen.findByText(/snapshot/)).toBeTruthy();
    });

    it("shows incomplete state for packs with failed artifacts", async () => {
        await AsyncStorage.setItem(
            "installed-packs-v2",
            JSON.stringify({
                "europe-netherlands": {
                    id: "europe-netherlands",
                    osmSnapshot: "2026-06-08",
                    installedAt: "2026-06-10T00:00:00Z",
                    artifacts: [
                        {
                            kind: "poi",
                            bytes: 500000,
                            status: "installed",
                        },
                        {
                            kind: "measuring",
                            category: "coastline",
                            bytes: 200000,
                            status: "failed",
                        },
                    ],
                },
            }),
        );

        (global as { fetch: typeof globalThis.fetch }).fetch = jest
            .fn()
            .mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(CATALOG_FIXTURE),
            });

        const screen = renderWithProviders(<OfflineDataScreen />);

        expect(await screen.findByText(/Incomplete/)).toBeTruthy();
    });

    it("shows total offline storage when packs are installed", async () => {
        await AsyncStorage.setItem(
            "installed-packs-v2",
            JSON.stringify({
                "europe-netherlands": {
                    id: "europe-netherlands",
                    osmSnapshot: "2026-06-08",
                    installedAt: "2026-06-10T00:00:00Z",
                    artifacts: [
                        {
                            kind: "poi",
                            bytes: 500000,
                            status: "installed",
                        },
                    ],
                },
            }),
        );

        (global as { fetch: typeof globalThis.fetch }).fetch = jest
            .fn()
            .mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(CATALOG_FIXTURE),
            });

        const screen = renderWithProviders(<OfflineDataScreen />);

        // Should show storage summary with bytes.
        expect(await screen.findByText("Total offline storage")).toBeTruthy();
        // 500000 bytes = 488.3 KB (displays as "0.5 MB" due to rounding)
        expect(screen.getByText(/MB/)).toBeTruthy();
    });
});
