import { strFromU8, strToU8 } from "fflate";

import { base64UrlToBytes, bytesToBase64Url } from "@/sharing/wire/base64url";

import { e2eScenarioSchema, type E2eScenario } from "./scenarioSchema";

export type E2eLinkError =
    | { code: "missing-payload" }
    | { code: "invalid-base64url" }
    | { code: "invalid-json" }
    | { code: "schema-invalid"; details?: string };

export type ParsedE2eLink =
    | { ok: true; scenario: E2eScenario }
    | { ok: false; error: E2eLinkError };

/**
 * Encode a scenario into the `d` payload for `jetlag-hide-seek-v2://e2e?d=...`.
 *
 * `base64url(utf8(JSON.stringify(scenario)))` — no gzip (size is irrelevant for
 * test links, and skipping it keeps the payload human-debuggable when decoded).
 * Reuses the same base64url primitive as the production codec.
 */
export function encodeE2eScenario(scenario: E2eScenario): string {
    return bytesToBase64Url(strToU8(JSON.stringify(scenario)));
}

/**
 * Parse the `d` query param (as delivered by `useLocalSearchParams`) into a
 * validated scenario. Mirrors `parseImportPayload`: an array-valued or missing
 * `d` is `missing-payload`. Each failure stage is a distinct error so a flow can
 * assert the failure path.
 */
export function parseE2eLink(d: string | string[] | undefined): ParsedE2eLink {
    if (!d || Array.isArray(d)) {
        return { ok: false, error: { code: "missing-payload" } };
    }

    let bytes: Uint8Array;
    try {
        bytes = base64UrlToBytes(d);
    } catch {
        return { ok: false, error: { code: "invalid-base64url" } };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(strFromU8(bytes));
    } catch {
        return { ok: false, error: { code: "invalid-json" } };
    }

    const result = e2eScenarioSchema.safeParse(parsed);
    if (!result.success) {
        return {
            ok: false,
            error: { code: "schema-invalid", details: result.error.message },
        };
    }

    return { ok: true, scenario: result.data };
}
