import { render } from "@testing-library/react-native";

let mockHooksEnabled = true;
jest.mock("../isE2eHooksEnabled", () => ({
    get E2E_HOOKS_ENABLED() {
        return mockHooksEnabled;
    },
}));

let mockReadout: {
    active: boolean;
    name: string | null;
    expect: unknown;
    location: unknown;
} = { active: true, name: "scn", expect: null, location: null };
let mockBackend: "js" | "geos" = "geos";
jest.mock("../e2eControls", () => ({
    useE2eReadoutState: () => mockReadout,
    getActiveGeometryBackend: () => mockBackend,
}));

let mockElim: { value: number | null; isComputing: boolean } = {
    value: 42.134,
    isComputing: false,
};
jest.mock("@/features/map/useEliminationPercentage", () => ({
    useEliminationPercentage: () => mockElim,
}));

let mockSelectedStations: unknown[] = [{ id: "s1" }, { id: "s2" }];
jest.mock("@/state/hidingZoneStore", () => ({
    ...jest.requireActual("@/state/hidingZoneStore"),
    useHidingZoneDerived: jest.fn(() => ({
        selectedStations: mockSelectedStations,
    })),
}));

import {
    E2eDebugReadout,
    formatReadoutPct,
    readoutLabel,
} from "../E2eDebugReadout";

beforeEach(() => {
    mockHooksEnabled = true;
    mockReadout = { active: true, name: "scn", expect: null, location: null };
    mockBackend = "geos";
    mockElim = { value: 42.134, isComputing: false };
    mockSelectedStations = [{ id: "s1" }, { id: "s2" }];
});

describe("formatting helpers", () => {
    it("formats pct to 2 dp and builds the label contract", () => {
        expect(formatReadoutPct(42.134)).toBe("42.13");
        expect(formatReadoutPct(0)).toBe("0.00");
        expect(readoutLabel("totalPct", formatReadoutPct(42.134))).toBe(
            "e2e-readout:totalPct=42.13",
        );
    });
});

describe("E2eDebugReadout", () => {
    it("renders nothing when the hooks gate is off", () => {
        mockHooksEnabled = false;
        const { queryByTestId } = render(<E2eDebugReadout />);
        expect(queryByTestId("e2e-readout")).toBeNull();
    });

    it("renders nothing when no scenario has armed the readout", () => {
        mockReadout = {
            active: false,
            name: null,
            expect: null,
            location: null,
        };
        const { queryByTestId } = render(<E2eDebugReadout />);
        expect(queryByTestId("e2e-readout")).toBeNull();
    });

    it("renders name + backend + stations + totalPct + ready once settled", () => {
        const { getByLabelText } = render(<E2eDebugReadout />);
        expect(getByLabelText("e2e-readout:name=scn")).toBeTruthy();
        expect(getByLabelText("e2e-readout:backend=geos")).toBeTruthy();
        expect(getByLabelText("e2e-readout:stations=2")).toBeTruthy();
        expect(getByLabelText("e2e-readout:totalPct=42.13")).toBeTruthy();
        expect(getByLabelText("e2e-readout:ready=1")).toBeTruthy();
    });

    it("withholds totalPct + ready while derivation is in flight", () => {
        mockElim = { value: 10, isComputing: true };
        const { getByLabelText, queryByLabelText } = render(
            <E2eDebugReadout />,
        );
        // name + backend + stations always render once active …
        expect(getByLabelText("e2e-readout:backend=geos")).toBeTruthy();
        expect(getByLabelText("e2e-readout:stations=2")).toBeTruthy();
        // … but the numeric row + ready sentinel wait for the settle.
        expect(queryByLabelText("e2e-readout:ready=1")).toBeNull();
        expect(queryByLabelText("e2e-readout:totalPct=10.00")).toBeNull();
    });

    it("shows ready (settled) but no totalPct when nothing is eliminable", () => {
        // A bare play-area scenario: derivation has settled (isComputing
        // false) but there are no hiding-zone stations, so value is null.
        // The readout must still be ready — this is what unblocks the smoke
        // flow, which asserts name + backend, not totalPct.
        mockElim = { value: null, isComputing: false };
        const { getByLabelText, queryByLabelText } = render(
            <E2eDebugReadout />,
        );
        expect(getByLabelText("e2e-readout:ready=1")).toBeTruthy();
        expect(queryByLabelText(/e2e-readout:totalPct=/)).toBeNull();
    });

    it("renders the station count readout", () => {
        mockSelectedStations = [{ id: "a" }, { id: "b" }, { id: "c" }];
        const { getByLabelText } = render(<E2eDebugReadout />);
        expect(getByLabelText("e2e-readout:stations=3")).toBeTruthy();
    });
});
