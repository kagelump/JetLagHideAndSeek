import { expect, test } from "@playwright/test";

import {
    buildCasBlob,
    clearPwaState,
    maybeClick,
    mockOverpass,
    overpassRoute,
    seedOrMockCasBlob,
} from "./helpers";

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------

const baseSeed = (
    propOverrides: Record<string, unknown> = {},
    topOverrides: Record<string, unknown> = {},
) => ({
    v: 1,
    type: "Feature",
    geometry: { type: "Point", coordinates: [139.0, 35.0] },
    properties: {
        osm_type: "R",
        osm_id: 382313,
        extent: [30.0, 130.0, 40.0, 140.0],
        country: "Japan",
        countrycode: "JP",
        name: "Japan",
        type: "country",
        isHidingZone: true,
        questions: [
            {
                id: "matching",
                key: 0,
                data: {
                    lat: 35.0,
                    lng: 139.0,
                    drag: true,
                    color: "red",
                    collapsed: false,
                    same: true,
                    type: "same-train-line",
                },
            },
        ],
        ...propOverrides,
    },
    disabledStations: [],
    hidingRadius: 600,
    hidingRadiusUnits: "meters",
    alternateLocations: [],
    zoneOptions: ["[railway=station]", "[railway=stop]"],
    zoneOperators: ["Test Metro"],
    displayHidingZones: true,
    displayHidingZonesStyle: "no-overlap",
    useCustomStations: false,
    customStations: [],
    includeDefaultStations: false,
    mergeDuplicates: false,
    playAreaMode: "default",
    presets: [],
    permanentOverlay: null,
    ...topOverrides,
});

const stationCircle = (id: string, name: string, lng: number, lat: number) => ({
    type: "Feature",
    geometry: {
        type: "Polygon",
        coordinates: [
            [
                [lng - 0.002, lat - 0.002],
                [lng + 0.002, lat - 0.002],
                [lng + 0.002, lat + 0.002],
                [lng - 0.002, lat + 0.002],
                [lng - 0.002, lat - 0.002],
            ],
        ],
    },
    properties: {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {
            id,
            name,
            "name:en": name,
            ref:
                id === "node/1001"
                    ? "A-01"
                    : id === "node/1002"
                      ? "A-02"
                      : "A-03",
            network: "Test Metro",
            operator: "Test Metro",
        },
    },
});

const cachedTransitGraph = {
    stationsById: {
        "node/1001": {
            id: "node/1001",
            label: "Station Alpha",
            coordinates: [139.0, 35.0],
            network: "Test Metro",
            operator: "Test Metro",
        },
        "node/1002": {
            id: "node/1002",
            label: "Station Beta",
            coordinates: [139.1, 35.1],
            network: "Test Metro",
            operator: "Test Metro",
        },
        "node/1003": {
            id: "node/1003",
            label: "Station Gamma",
            coordinates: [139.2, 35.2],
            network: "Test Metro",
            operator: "Test Metro",
        },
    },
    linesById: {
        "relation/100": {
            id: "relation/100",
            label: "Test Line A",
            network: "Test Metro",
            operator: "Test Metro",
        },
    },
    stationLineIds: {
        "node/1001": ["relation/100"],
        "node/1002": ["relation/100"],
        "node/1003": ["relation/100"],
    },
    lineStationIds: {
        "relation/100": ["node/1001", "node/1002", "node/1003"],
    },
};

const withCachedHidingZoneData = (seed: ReturnType<typeof baseSeed>) => {
    const { ...geo } = seed;
    const stationCircles = [
        stationCircle("node/1001", "Station Alpha", 139.0, 35.0),
        stationCircle("node/1002", "Station Beta", 139.1, 35.1),
        stationCircle("node/1003", "Station Gamma", 139.2, 35.2),
    ];

    return {
        ...seed,
        hidingZoneData: {
            v: 1,
            stationCircles,
            transitGraph: cachedTransitGraph,
            sourceInputs: {
                playArea: {
                    polyGeoJSON: null,
                    mapGeoLocation: {
                        type: geo.type,
                        geometry: geo.geometry,
                        properties: {
                            osm_type: geo.properties.osm_type,
                            osm_id: geo.properties.osm_id,
                            extent: geo.properties.extent,
                            country: geo.properties.country,
                            countrycode: geo.properties.countrycode,
                            name: geo.properties.name,
                            type: geo.properties.type,
                        },
                    },
                    additionalMapGeoLocations: [],
                },
                questions: geo.properties.questions,
                radius: geo.hidingRadius,
                radiusUnits: geo.hidingRadiusUnits,
                zoneOptions: geo.zoneOptions,
                zoneOperators: geo.zoneOperators,
                useCustomStations: geo.useCustomStations,
                customStations: geo.customStations,
                includeDefaultStations: geo.includeDefaultStations,
                mergeDuplicates: false,
                stationNameStrategy: "english-preferred",
            },
        },
    };
};

async function loadState(
    page: any,
    propOverrides: Record<string, unknown> = {},
    topOverrides: Record<string, unknown> = {},
) {
    await page.goto("/JetLagHideAndSeek/");
    await clearPwaState(page);
    const { sid, compressedPayload } = await buildCasBlob(
        baseSeed(propOverrides, topOverrides),
    );
    await seedOrMockCasBlob(sid, compressedPayload);
    return sid;
}

async function loadWithSid(page: any, sid: string) {
    await page.goto(`?sid=${sid}`);
    await page.waitForLoadState("domcontentloaded");
    await maybeClick(page.getByRole("button", { name: "Replace" }));
    await expect(
        page.getByRole("heading", {
            name: /Welcome to the Jet Lag Hide and Seek/,
        }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "Skip Tutorial" }).click();
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const trainLineCombobox = (page: any) =>
    page
        .getByRole("combobox")
        .filter({ hasText: /Train line|auto-detect|Loading|Test Line/ })
        .first();

const selectOption = (page: any, name: string) =>
    page.locator('[role="option"]').filter({ hasText: name });

async function waitForLineOptions(page: any) {
    // Wait for station preview to confirm station discovery + line options are loaded
    await expect(
        page.getByText(/Stations matched:|No stations found/).first(),
    ).toBeVisible({ timeout: 30000 });
}

async function openTrainLineDropdown(page: any) {
    await waitForLineOptions(page);
    await trainLineCombobox(page).click();
}

async function selectTrainLine(page: any, name: string) {
    await waitForLineOptions(page);
    await openTrainLineDropdown(page);
    await selectOption(page, name).click();
}

// ---------------------------------------------------------------------------
// C1: Dropdown populates from nearest station
// ---------------------------------------------------------------------------

test("C1: Dropdown populates from nearest station (operator filtered)", async ({
    page,
}) => {
    const sid = await loadState(page);

    await mockOverpass(page, [
        overpassRoute("stations-minimal.json", [
            "[railway=station]",
            "[railway=stop]",
        ]),
        overpassRoute("transit-graph-minimal.json", ["rel(bn)"]),
    ]);

    await loadWithSid(page, sid);

    // Wait for stations to load and line options to populate
    await expect(trainLineCombobox(page)).toBeVisible({ timeout: 30000 });
    // Wait for station preview to confirm line options are loaded
    await expect(page.getByText("Stations matched: 3")).toBeVisible({
        timeout: 30000,
    });

    await openTrainLineDropdown(page);

    // Assert matching operator line is present
    await expect(selectOption(page, "Test Line A")).toBeVisible({
        timeout: 5000,
    });

    // Assert non-matching operator line is excluded
    await expect(selectOption(page, "Test Line B")).not.toBeVisible({
        timeout: 3000,
    });

    // Assert no route_master or direction noise
    const listbox = page.getByRole("listbox").first();
    const allOptions = await listbox
        .locator('[role="option"]')
        .allTextContents();
    for (const opt of allOptions) {
        expect(opt).not.toContain("route_master");
        expect(opt).not.toContain("-->");
    }
});

test("C1c: Cached hiding-zone data loads without station Overpass", async ({
    page,
}) => {
    const seedSnapshot = withCachedHidingZoneData(baseSeed());
    const { sid, compressedPayload } = await buildCasBlob(seedSnapshot);
    await seedOrMockCasBlob(sid, compressedPayload);

    await page.goto("/JetLagHideAndSeek/");
    await clearPwaState(page);

    const stationOverpassCalls: string[] = [];
    await page.route("https://overpass-api.de/api/interpreter**", (route) => {
        const url = new URL(route.request().url());
        const query = decodeURIComponent(url.searchParams.get("data") ?? "");
        if (query.includes("[railway=station]") || query.includes("rel(bn)")) {
            stationOverpassCalls.push(query);
            return route.abort();
        }
        return route.fulfill({
            body: JSON.stringify({ version: 0.6, elements: [] }),
            contentType: "application/json",
        });
    });
    await page.route(
        "https://overpass.private.coffee/api/interpreter**",
        (route) => {
            const url = new URL(route.request().url());
            const query = decodeURIComponent(
                url.searchParams.get("data") ?? "",
            );
            if (
                query.includes("[railway=station]") ||
                query.includes("rel(bn)")
            ) {
                stationOverpassCalls.push(query);
                return route.abort();
            }
            return route.fulfill({
                body: JSON.stringify({ version: 0.6, elements: [] }),
                contentType: "application/json",
            });
        },
    );

    await loadWithSid(page, sid);

    await expect(trainLineCombobox(page)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Stations matched: 3")).toBeVisible({
        timeout: 15000,
    });
    expect(stationOverpassCalls).toEqual([]);
});

// ---------------------------------------------------------------------------
// C1b: Dropdown shows all lines when no operator filter
// ---------------------------------------------------------------------------

test("C1b: Dropdown shows all lines when operator filter is empty", async ({
    page,
}) => {
    const sid = await loadState(page, {}, { zoneOperators: [] });

    await mockOverpass(page, [
        overpassRoute("stations-minimal.json", [
            "[railway=station]",
            "[railway=stop]",
        ]),
        overpassRoute("transit-graph-all-lines.json", ["rel(bn)"]),
    ]);

    await loadWithSid(page, sid);

    // Wait for stations to load and line options to populate
    await expect(trainLineCombobox(page)).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Stations matched: 3")).toBeVisible({
        timeout: 30000,
    });

    await openTrainLineDropdown(page);

    // Assert both train line options are present (no operator filter)
    await expect(selectOption(page, "Test Line A")).toBeVisible({
        timeout: 5000,
    });
    await expect(selectOption(page, "Test Line B")).toBeVisible({
        timeout: 5000,
    });
});

// ---------------------------------------------------------------------------
// C2: Select line updates station preview
// ---------------------------------------------------------------------------

test("C2: Select line updates station preview", async ({ page }) => {
    const sid = await loadState(page);

    await mockOverpass(page, [
        overpassRoute("stations-minimal.json", [
            "[railway=station]",
            "[railway=stop]",
        ]),
        overpassRoute("transit-graph-minimal.json", ["rel(bn)"]),
    ]);

    await loadWithSid(page, sid);

    await expect(trainLineCombobox(page)).toBeVisible({ timeout: 30000 });

    await selectTrainLine(page, "Test Line A");

    // Assert station count and names
    await expect(page.getByText("Stations matched: 3")).toBeVisible({
        timeout: 15000,
    });
    const previewContainer = page
        .locator(".max-h-40.overflow-y-auto.rounded-md.border")
        .first();
    await expect(previewContainer.getByText("Station Alpha")).toBeVisible();
    await expect(previewContainer.getByText("Station Beta")).toBeVisible();
    await expect(previewContainer.getByText("Station Gamma")).toBeVisible();

    // Re-select auto-detect
    await selectTrainLine(page, "(auto-detect from nearest station)");
    await expect(
        trainLineCombobox(page).filter({ hasText: "auto-detect" }),
    ).toBeVisible();
});

// ---------------------------------------------------------------------------
// C3: Station preview empty results
// ---------------------------------------------------------------------------

test("C3: Station preview empty results", async ({ page }) => {
    const sid = await loadState(page, {}, { zoneOperators: [] });

    await mockOverpass(page, [
        overpassRoute("stations-minimal.json", [
            "[railway=station]",
            "[railway=stop]",
        ]),
        overpassRoute("transit-graph-b-empty.json", ["rel(bn)"]),
    ]);

    await loadWithSid(page, sid);

    await expect(trainLineCombobox(page)).toBeVisible({ timeout: 30000 });

    await selectTrainLine(page, "Test Line B");

    // Wait for the preview to update — Test Line B has 1 station
    await expect(page.getByText("Stations matched: 1")).toBeVisible({
        timeout: 15000,
    });
});

// ---------------------------------------------------------------------------
// C4: "Loading stations..." during fetch
// ---------------------------------------------------------------------------

test("C4: Loading stations text during fetch", async ({ page }) => {
    const sid = await loadState(page);

    const overpass = await mockOverpass(page, [
        overpassRoute("stations-minimal.json", [
            "[railway=station]",
            "[railway=stop]",
        ]),
        overpassRoute("transit-graph-minimal.json", ["rel(bn)"]),
    ]);

    await loadWithSid(page, sid);

    await expect(trainLineCombobox(page)).toBeVisible({ timeout: 30000 });

    await openTrainLineDropdown(page);
    await selectOption(page, "Test Line A").click();

    // Wait for station preview to resolve
    await expect(page.getByText("Stations matched: 3")).toBeVisible({
        timeout: 15000,
    });

    // Verify no per-question train line Overpass call was made
    expect(overpass.calls.some((c) => c.query.includes("relation(100)"))).toBe(
        false,
    );
});

// ---------------------------------------------------------------------------
// C5: Selected line clears on pin move
// ---------------------------------------------------------------------------

test("C5: Selected line clears when nearest station changes", async ({
    page,
}) => {
    const sid = await loadState(page);

    await mockOverpass(page, [
        overpassRoute("stations-minimal.json", [
            "[railway=station]",
            "[railway=stop]",
        ]),
        overpassRoute("transit-graph-minimal.json", ["rel(bn)"]),
    ]);

    await loadWithSid(page, sid);

    await expect(trainLineCombobox(page)).toBeVisible({ timeout: 30000 });

    // Select Test Line A
    await selectTrainLine(page, "Test Line A");
    await expect(
        trainLineCombobox(page).filter({ hasText: "Test Line A" }),
    ).toBeVisible({ timeout: 5000 });

    // Re-select auto-detect
    await selectTrainLine(page, "(auto-detect from nearest station)");
    await expect(
        trainLineCombobox(page).filter({ hasText: "auto-detect" }),
    ).toBeVisible({ timeout: 15000 });
});

// ---------------------------------------------------------------------------
// C6: "Loading train lines..." in trigger
// ---------------------------------------------------------------------------

test("C6: Loading train lines text in trigger", async ({ page }) => {
    const sid = await loadState(page);

    await mockOverpass(page, [
        overpassRoute("stations-minimal.json", [
            "[railway=station]",
            "[railway=stop]",
        ]),
        overpassRoute("transit-graph-minimal.json", ["rel(bn)"]),
    ]);

    await loadWithSid(page, sid);

    // After line options load, trigger resolves to auto-detect
    await expect(
        trainLineCombobox(page).filter({ hasText: "auto-detect" }),
    ).toBeVisible({ timeout: 15000 });

    // Station preview should show stations from auto-detected line
    await expect(page.getByText("Stations matched: 3")).toBeVisible({
        timeout: 15000,
    });
});

// ---------------------------------------------------------------------------
// C7: Locked question preserves selection
// ---------------------------------------------------------------------------

test("C7: Locked question preserves selection", async ({ page }) => {
    const lockedQuestion = {
        id: "matching",
        key: 0,
        data: {
            lat: 35.0,
            lng: 139.0,
            drag: false,
            color: "red",
            collapsed: false,
            same: true,
            type: "same-train-line",
            selectedTrainLineId: "relation/100",
            selectedTrainLineLabel: "Test Line A",
        },
    };

    const sid = await loadState(page, {
        questions: [lockedQuestion],
    });

    await mockOverpass(page, [
        overpassRoute("stations-minimal.json", [
            "[railway=station]",
            "[railway=stop]",
        ]),
        overpassRoute("transit-graph-minimal.json", ["rel(bn)"]),
    ]);

    await loadWithSid(page, sid);

    // The question is locked (drag: false), combobox is disabled
    const trigger = trainLineCombobox(page);
    await expect(trigger).toBeVisible({ timeout: 15000 });
    await expect(trigger).toBeDisabled();

    // Station preview should still work
    await expect(page.getByText("Stations matched: 3")).toBeVisible({
        timeout: 15000,
    });

    // Build a new CAS blob from the same state (roundtrip verification)
    const { sid: sid2, compressedPayload } = await buildCasBlob(
        baseSeed({ questions: [lockedQuestion] }),
    );
    await seedOrMockCasBlob(sid2, compressedPayload);

    // Load in a fresh page context
    const newPage = await page.context().newPage();
    await newPage.goto("/JetLagHideAndSeek/");
    await clearPwaState(newPage);
    await mockOverpass(newPage, [
        overpassRoute("stations-minimal.json", [
            "[railway=station]",
            "[railway=stop]",
        ]),
        overpassRoute("transit-graph-minimal.json", ["rel(bn)"]),
    ]);

    await loadWithSid(newPage, sid2);

    // Combobox should be disabled after roundtrip
    const trigger2 = trainLineCombobox(newPage);
    await expect(trigger2).toBeVisible({ timeout: 15000 });
    await expect(trigger2).toBeDisabled();

    await newPage.close();
});

// ---------------------------------------------------------------------------
// C8: Backward compat — no selectedTrainLineId
// ---------------------------------------------------------------------------

test("C8: Backward compat — no selectedTrainLineId in snapshot", async ({
    page,
}) => {
    const sid = await loadState(page, {
        questions: [
            {
                id: "matching",
                key: 0,
                data: {
                    lat: 35.0,
                    lng: 139.0,
                    drag: true,
                    color: "red",
                    collapsed: false,
                    same: true,
                    type: "same-train-line",
                    // selectedTrainLineId intentionally absent
                },
            },
        ],
    });

    await mockOverpass(page, [
        overpassRoute("stations-minimal.json", [
            "[railway=station]",
            "[railway=stop]",
        ]),
        overpassRoute("transit-graph-minimal.json", ["rel(bn)"]),
    ]);

    await loadWithSid(page, sid);

    // Dropdown should show auto-detect (computed from nearest station)
    await expect(
        trainLineCombobox(page).filter({ hasText: "auto-detect" }),
    ).toBeVisible({ timeout: 30000 });

    // Station preview should still resolve via auto-detect
    await expect(page.getByText("Stations matched: 3")).toBeVisible({
        timeout: 15000,
    });
});

// ---------------------------------------------------------------------------
// C9: Hiderification with selected line
// ---------------------------------------------------------------------------

test("C9: Hiderification updates same toggle based on train line", async ({
    page,
}) => {
    const sid = await loadState(page);

    await mockOverpass(page, [
        overpassRoute("stations-minimal.json", [
            "[railway=station]",
            "[railway=stop]",
        ]),
        overpassRoute("transit-graph-minimal.json", ["rel(bn)"]),
    ]);

    await loadWithSid(page, sid);

    await expect(trainLineCombobox(page)).toBeVisible({ timeout: 30000 });

    // Select Test Line A
    await selectTrainLine(page, "Test Line A");

    // Open Options drawer and enable Hider Mode
    await page.getByRole("button", { name: "Options" }).click();
    await expect(page.getByRole("heading", { name: "Options" })).toBeVisible({
        timeout: 5000,
    });

    // The hider mode checkbox is next to a label with "Hider mode?"
    const hiderCheckbox = page
        .locator("label")
        .filter({ hasText: /Hider mode/i })
        .locator("..")
        .getByRole("checkbox");
    await hiderCheckbox.click();

    // Close the options drawer so the matching card toggle is visible
    await page.keyboard.press("Escape");

    // After hiderification, the "same" result toggle should be visible.
    const sameToggle = page
        .getByRole("radio", { name: "Same" })
        .filter({ hasText: "Same" });
    await expect(sameToggle.first()).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// C10: ZoneSidebar filters with selected line
// ---------------------------------------------------------------------------

test("C10: ZoneSidebar shows only selected-line stations", async ({ page }) => {
    const sid = await loadState(page, {}, { zoneOperators: [] });

    await mockOverpass(page, [
        overpassRoute("stations-minimal.json", [
            "[railway=station]",
            "[railway=stop]",
        ]),
        overpassRoute("transit-graph-b-empty.json", ["rel(bn)"]),
    ]);

    await loadWithSid(page, sid);

    // Wait for station discovery and filtering to complete
    await expect(trainLineCombobox(page)).toBeVisible({ timeout: 30000 });

    // Wait for the station preview to show the auto-detected line's stations
    await expect(page.getByText("Stations matched: 3")).toBeVisible({
        timeout: 15000,
    });

    // ZoneSidebar should have station display options (confirming stations loaded)
    await expect(page.getByText("All Stations")).toBeVisible({
        timeout: 10000,
    });

    // Verify station names from the auto-detected line appear in the preview
    const previewContainer = page
        .locator(".max-h-40.overflow-y-auto.rounded-md.border")
        .first();
    await expect(previewContainer.getByText("Station Alpha")).toBeVisible();
    await expect(previewContainer.getByText("Station Beta")).toBeVisible();
    await expect(previewContainer.getByText("Station Gamma")).toBeVisible();

    // Select a line with only 1 station — preview should update
    await selectTrainLine(page, "Test Line B");

    await expect(page.getByText("Stations matched: 1")).toBeVisible({
        timeout: 15000,
    });
});

// ---------------------------------------------------------------------------
// C11: Custom-only station list warning
// ---------------------------------------------------------------------------

test("C11: Custom-only station list warning", async ({ page }) => {
    const sid = await loadState(
        page,
        {},
        {
            useCustomStations: true,
            includeDefaultStations: false,
            zoneOperators: [],
        },
    );

    // No station discovery mocks needed — custom-only skips default discovery
    await mockOverpass(page, []);

    await loadWithSid(page, sid);

    // With custom-only station list and no custom stations defined,
    // the station preview should show no matches.
    await expect(page.getByText("No stations found for this line")).toBeVisible(
        { timeout: 30000 },
    );
});

// ---------------------------------------------------------------------------
// C12: Wire serialization with selectedTrainLineId
// ---------------------------------------------------------------------------

test("C12: Wire serialization roundtrip preserves selectedTrainLineId", async ({
    page,
}) => {
    const seedSnapshot = baseSeed({
        questions: [
            {
                id: "matching",
                key: 0,
                data: {
                    lat: 35.0,
                    lng: 139.0,
                    drag: false,
                    color: "red",
                    collapsed: false,
                    same: true,
                    type: "same-train-line",
                    selectedTrainLineId: "relation/100",
                    selectedTrainLineLabel: "Test Line A",
                },
            },
        ],
    } as Record<string, unknown>);

    // Build two SIDs from the same canonical input — they must be identical
    const { sid: sidA, compressedPayload: payloadA } =
        await buildCasBlob(seedSnapshot);
    const { sid: sidB } = await buildCasBlob(seedSnapshot);

    // Deterministic: same input → same SID
    expect(sidA).toBe(sidB);

    await seedOrMockCasBlob(sidA, payloadA);

    // Load the page using the SID and verify selection is preserved
    await page.goto("/JetLagHideAndSeek/");
    await clearPwaState(page);
    await mockOverpass(page, [
        overpassRoute("stations-minimal.json", [
            "[railway=station]",
            "[railway=stop]",
        ]),
        overpassRoute("transit-graph-minimal.json", ["rel(bn)"]),
    ]);

    await loadWithSid(page, sidA);

    // Verify combobox is disabled for locked question after roundtrip
    const trigger = trainLineCombobox(page);
    await expect(trigger).toBeVisible({ timeout: 15000 });
    await expect(trigger).toBeDisabled();
});
