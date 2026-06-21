import { createLogger, setLoggerNamespaceLevel } from "@/shared/logger";

describe("createLogger", () => {
    const original = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
    };
    let log: jest.Mock;
    let info: jest.Mock;
    let warn: jest.Mock;
    let error: jest.Mock;

    beforeEach(() => {
        log = jest.fn();
        info = jest.fn();
        warn = jest.fn();
        error = jest.fn();
        console.log = log;
        console.info = info;
        console.warn = warn;
        console.error = error;
    });

    afterEach(() => {
        console.log = original.log;
        console.info = original.info;
        console.warn = original.warn;
        console.error = original.error;
        setLoggerNamespaceLevel("test-ns", undefined);
    });

    it("folds the namespace tag into a leading string arg", () => {
        createLogger("test-ns").warn("hello", 1);
        expect(warn).toHaveBeenCalledWith("[test-ns] hello", 1);
    });

    it("passes the tag separately when the leading arg is not a string", () => {
        const err = new Error("boom");
        createLogger("test-ns").error(err);
        expect(error).toHaveBeenCalledWith("[test-ns]", err);
    });

    it("emits all levels at the default level (debug) in __DEV__", () => {
        const l = createLogger("test-ns");
        l.debug("d");
        l.info("i");
        l.warn("w");
        l.error("e");
        expect(log).toHaveBeenCalledWith("[test-ns] d");
        expect(info).toHaveBeenCalledWith("[test-ns] i");
        expect(warn).toHaveBeenCalledWith("[test-ns] w");
        expect(error).toHaveBeenCalledWith("[test-ns] e");
    });

    it("demoting a namespace to warn drops debug/info but keeps warn/error", () => {
        setLoggerNamespaceLevel("test-ns", "warn");
        const l = createLogger("test-ns");
        l.debug("d");
        l.info("i");
        l.warn("w");
        l.error("e");
        expect(log).not.toHaveBeenCalled();
        expect(info).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(error).toHaveBeenCalledTimes(1);
    });

    it("silencing a namespace mutes every level including error", () => {
        setLoggerNamespaceLevel("test-ns", "silent");
        const l = createLogger("test-ns");
        l.debug("d");
        l.warn("w");
        l.error("e");
        expect(log).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    it("restores the configured level after clearing a runtime override", () => {
        setLoggerNamespaceLevel("test-ns", "silent");
        setLoggerNamespaceLevel("test-ns", undefined);
        createLogger("test-ns").debug("d");
        expect(log).toHaveBeenCalledWith("[test-ns] d");
    });
});
