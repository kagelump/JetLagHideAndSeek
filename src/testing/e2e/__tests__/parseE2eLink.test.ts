import { bytesToBase64Url } from "@/sharing/wire/base64url";
import { strToU8 } from "fflate";

import { encodeE2eScenario, parseE2eLink } from "../parseE2eLink";
import { e2eScenarioSchema, type E2eScenario } from "../scenarioSchema";

const scenario: E2eScenario = e2eScenarioSchema.parse({
    kind: "e2e-scenario",
    name: "round-trip",
    controls: { geometryBackend: "js", location: [139.7, 35.65] },
    state: {
        playArea: {
            bbox: [139.5, 35.5, 140.0, 35.9],
            center: [139.75, 35.7],
            label: "Tokyo 23 Wards",
            osmId: 19631009,
            osmType: "R",
        },
    },
});

describe("parseE2eLink", () => {
    it("round-trips a scenario (encode → parse → deep-equal)", () => {
        const d = encodeE2eScenario(scenario);
        const result = parseE2eLink(d);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.scenario).toEqual(scenario);
    });

    it("reports missing-payload for undefined or array d", () => {
        expect(parseE2eLink(undefined)).toEqual({
            ok: false,
            error: { code: "missing-payload" },
        });
        expect(parseE2eLink(["a", "b"])).toEqual({
            ok: false,
            error: { code: "missing-payload" },
        });
    });

    it("reports invalid-base64url for non-base64url input", () => {
        const result = parseE2eLink("not valid base64!!!");
        expect(result).toEqual({
            ok: false,
            error: { code: "invalid-base64url" },
        });
    });

    it("reports invalid-json for base64url that is not JSON", () => {
        const d = bytesToBase64Url(strToU8("this is not json"));
        const result = parseE2eLink(d);
        expect(result).toEqual({ ok: false, error: { code: "invalid-json" } });
    });

    it("reports schema-invalid for valid JSON that fails the schema", () => {
        const d = bytesToBase64Url(strToU8(JSON.stringify({ kind: "nope" })));
        const result = parseE2eLink(d);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("schema-invalid");
    });

    it("decodes a payload encoded by the CLI's node Buffer base64url", () => {
        // The build-scenario-link.mjs CLI encodes with node's Buffer base64url;
        // this proves that output is byte-compatible with the app's decoder.
        const d = Buffer.from(JSON.stringify(scenario), "utf8").toString(
            "base64url",
        );
        const result = parseE2eLink(d);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.scenario).toEqual(scenario);
    });
});
