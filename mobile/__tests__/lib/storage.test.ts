jest.mock("@nanostores/persistent", () => ({
    setPersistentEngine: jest.fn(),
    persistentAtom: jest.fn(),
}));

describe("storage", () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it("calls setPersistentEngine with a storage proxy and a no-op events engine", () => {
        require("../../lib/storage");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { setPersistentEngine } = require("@nanostores/persistent");
        expect(setPersistentEngine).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                addEventListener: expect.any(Function),
                removeEventListener: expect.any(Function),
            }),
        );
    });

    it("only calls setPersistentEngine once per module load", () => {
        require("../../lib/storage");
        require("../../lib/storage");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { setPersistentEngine } = require("@nanostores/persistent");
        expect(setPersistentEngine).toHaveBeenCalledTimes(1);
    });
});
