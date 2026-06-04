import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";

import { base64UrlToBytes, bytesToBase64Url } from "@/sharing/wire/base64url";
import { canonicalize } from "@/sharing/wire/canonicalize";
import {
    decodeEnvelopePayload as decodeEnvelopePayloadRaw,
    type DecodeEnvelopeResult,
    encodeEnvelope,
} from "@/sharing/wire/codec";
import { FIELD_MAP } from "@/sharing/wire/minified";
import type { AppStateEnvelopeV1 } from "@/sharing/wire/schema";

// These tests cover app-state payloads; narrow the widened WireEnvelope union
// success branch back to AppStateEnvelopeV1 so existing assertions stay valid.
type AppStateDecodeResult =
    | { envelope: AppStateEnvelopeV1; ok: true }
    | Extract<DecodeEnvelopeResult, { ok: false }>;

function decodeEnvelopePayload(payload: string): AppStateDecodeResult {
    const decoded = decodeEnvelopePayloadRaw(payload);
    if (decoded.ok && decoded.envelope.kind !== "app-state") {
        throw new Error(
            `Expected app-state envelope, got ${decoded.envelope.kind}`,
        );
    }
    return decoded as AppStateDecodeResult;
}

const envelope: AppStateEnvelopeV1 = {
    kind: "app-state",
    payload: {
        gameId: "game-1",
        hidingZones: {
            radiusMeters: 600,
            radiusUnit: "m",
            selectedPresetIds: ["tokyo-metro"],
        },
        metadata: {
            createdAt: "2026-05-17T00:00:00.000Z",
            updatedAt: "2026-05-17T00:00:00.000Z",
        },
        playArea: {
            bbox: [1, 2, 3, 4],
            boundary: { features: [], type: "FeatureCollection" },
            center: [2, 3],
            label: "Test Area",
            osmId: 123,
            osmType: "R",
        },
    },
    version: 1,
};

describe("sharing wire codec", () => {
    it("canonicalizes objects with sorted keys and strips undefined", () => {
        expect(canonicalize({ b: 1, a: { d: undefined, c: 2 } })).toBe(
            '{"a":{"c":2},"b":1}',
        );
    });

    it("round trips base64url bytes", () => {
        const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253]);
        const encoded = bytesToBase64Url(bytes);

        expect(encoded).not.toContain("+");
        expect(encoded).not.toContain("/");
        expect(encoded).not.toContain("=");
        expect(base64UrlToBytes(encoded)).toEqual(bytes);
    });

    it("encodes and decodes an app-state envelope", () => {
        const payload = encodeEnvelope(envelope);
        const decoded = decodeEnvelopePayload(payload);

        expect(decoded.ok).toBe(true);
        if (decoded.ok) {
            expect(decoded.envelope.kind).toBe("app-state");
            expect(decoded.envelope.version).toBe(1);
            expect(decoded.envelope.payload.gameId).toBe("game-1");
            expect(decoded.envelope.payload.playArea?.label).toBe("Test Area");
            expect(decoded.envelope.payload.playArea?.osmId).toBe(123);
        }
    });

    it("returns a structured error for invalid payloads", () => {
        expect(decodeEnvelopePayload("not*base64")).toEqual({
            error: { code: "invalid-base64url" },
            ok: false,
        });
    });

    it("encodes using minified keys", () => {
        const payload = encodeEnvelope(envelope);
        const raw = strFromU8(inflateSync(base64UrlToBytes(payload)));
        const json = JSON.parse(raw);

        expect(json[FIELD_MAP.kind]).toBe("app-state");
        expect(json[FIELD_MAP.version]).toBe(1);
        expect(json[FIELD_MAP.payload][FIELD_MAP.gameId]).toBe("game-1");
        expect(
            json[FIELD_MAP.payload][FIELD_MAP.metadata][FIELD_MAP.createdAt],
        ).toBe("2026-05-17T00:00:00.000Z");

        expect(json.kind).toBeUndefined();
        expect(json.version).toBeUndefined();
        expect(json.payload).toBeUndefined();
    });

    it("decoded envelope restores full-key format", () => {
        const payload = encodeEnvelope(envelope);
        const decoded = decodeEnvelopePayload(payload);

        expect(decoded.ok).toBe(true);
        if (decoded.ok) {
            const result = decoded.envelope;
            expect(result.kind).toBe("app-state");
            expect(result.payload.hidingZones?.radiusMeters).toBe(600);
            expect(result.payload.hidingZones?.radiusUnit).toBe("m");
            expect(result.payload.metadata.updatedAt).toBe(
                result.payload.metadata.createdAt,
            );
            expect(result.payload.playArea?.osmType).toBe("R");
        }
    });

    it("encodes and decodes matching questions", () => {
        const withMatching = {
            ...envelope,
            payload: {
                ...envelope.payload,
                questions: [
                    {
                        answer: "unanswered" as const,
                        candidates: [],
                        category: "transit-line" as const,
                        center: [139.7, 35.7] as [number, number],
                        createdAt: "2026-05-17T00:00:00.000Z",
                        id: "matching-1",
                        lineId: "gtfs:test:route:line-1",
                        lineName: "Line 1",
                        selectedOsmId: null,
                        selectedOsmType: null,
                        targetName: null,
                        targetOsmId: null,
                        targetOsmType: null,
                        type: "matching" as const,
                        updatedAt: "2026-05-17T00:00:00.000Z",
                    },
                ],
            },
        };

        const payload = encodeEnvelope(withMatching);
        const decoded = decodeEnvelopePayload(payload);
        expect(decoded.ok).toBe(true);
        if (decoded.ok) {
            expect(decoded.envelope.payload.questions?.[0]).toEqual(
                withMatching.payload.questions[0],
            );
        }
    });

    it("round-trips matching question with non-default category and target fields", () => {
        const withMatching = {
            ...envelope,
            payload: {
                ...envelope.payload,
                questions: [
                    {
                        answer: "positive" as const,
                        candidates: [],
                        category: "park" as const,
                        center: [139.7, 35.7] as [number, number],
                        createdAt: "2026-05-17T00:00:00.000Z",
                        id: "matching-park",
                        lineId: null,
                        lineName: null,
                        selectedOsmId: null,
                        selectedOsmType: null,
                        targetName: "Ueno Park",
                        targetOsmId: 123456,
                        targetOsmType: "way" as const,
                        type: "matching" as const,
                        updatedAt: "2026-05-17T00:00:00.000Z",
                    },
                ],
            },
        };

        const payload = encodeEnvelope(withMatching);
        const decoded = decodeEnvelopePayload(payload);
        expect(decoded.ok).toBe(true);
        if (decoded.ok) {
            const question = decoded.envelope.payload.questions?.[0];
            expect(question).toEqual(withMatching.payload.questions[0]);
        }
    });

    // -------------------------------------------------------------------
    // Error branches
    // -------------------------------------------------------------------

    it("returns inflate-failed for valid base64url that is not deflate data", () => {
        // Raw bytes that are valid base64url but not valid deflate.
        const garbage = bytesToBase64Url(
            new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa]),
        );

        const result = decodeEnvelopePayload(garbage);

        expect(result).toEqual({
            error: { code: "inflate-failed" },
            ok: false,
        });
    });

    it("returns invalid-json for valid base64url + deflate with non-JSON content", () => {
        // Deflate valid (non-JSON) text → the inflation succeeds but JSON.parse fails.
        const nonJson = bytesToBase64Url(deflateSync(strToU8("hello world")));

        const result = decodeEnvelopePayload(nonJson);

        expect(result).toEqual({
            error: { code: "invalid-json" },
            ok: false,
        });
    });

    it("returns unsupported-version for a payload with v !== 1", () => {
        // A minified JSON object with version 2 — valid JSON but wrong version.
        const v2Payload = bytesToBase64Url(deflateSync(strToU8('{"v":2}')));

        const result = decodeEnvelopePayload(v2Payload);

        expect(result).toEqual({
            error: { code: "unsupported-version", version: 2 },
            ok: false,
        });
    });

    it("returns schema-invalid for a payload with v:1 but invalid schema", () => {
        // v:1 but missing the required `kind` field.
        const badSchemaPayload = bytesToBase64Url(
            deflateSync(strToU8('{"v":1}')),
        );

        const result = decodeEnvelopePayload(badSchemaPayload);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe("schema-invalid");
        }
    });
});
