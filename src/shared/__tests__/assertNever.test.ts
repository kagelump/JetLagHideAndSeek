import { assertNever } from "@/shared/assertNever";

describe("assertNever", () => {
    it("throws at runtime when called", () => {
        expect(() => assertNever("oops" as never)).toThrow(
            'Unexpected value: "oops"',
        );
    });
});
