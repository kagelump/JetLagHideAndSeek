import { getImportErrorMessage } from "../errors";
import type { ImportLinkError } from "../errors";

describe("getImportErrorMessage", () => {
    it("returns a message for missing-payload", () => {
        const error: ImportLinkError = { code: "missing-payload" };
        expect(getImportErrorMessage(error)).toBe(
            "This share link is missing its setup payload.",
        );
    });

    it("returns a message for invalid-base64url", () => {
        const error: ImportLinkError = { code: "invalid-base64url" };
        expect(getImportErrorMessage(error)).toBe(
            "This share link could not be decoded.",
        );
    });

    it("returns a message for inflate-failed", () => {
        const error: ImportLinkError = { code: "inflate-failed" };
        expect(getImportErrorMessage(error)).toBe(
            "This share link could not be decoded.",
        );
    });

    it("returns a message for invalid-json", () => {
        const error: ImportLinkError = { code: "invalid-json" };
        expect(getImportErrorMessage(error)).toBe(
            "This share link could not be decoded.",
        );
    });

    it("returns a message for schema-invalid", () => {
        const error: ImportLinkError = {
            code: "schema-invalid",
            details: "Invalid play area format",
        };
        expect(getImportErrorMessage(error)).toBe(
            "This share link does not match a supported setup format.",
        );
    });

    it("returns a message for unsupported-version", () => {
        const error: ImportLinkError = {
            code: "unsupported-version",
            version: 42,
        };
        expect(getImportErrorMessage(error)).toBe(
            "This share link uses unsupported version 42.",
        );
    });
});
