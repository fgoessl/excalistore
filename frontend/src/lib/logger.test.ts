import { describe, expect, it, vi } from "vitest";
import { logger } from "./logger";

describe("logger", () => {
  it("prefixes messages with [excalistore]", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logger.info("hello");
    expect(spy).toHaveBeenCalledWith("[excalistore] hello");
    spy.mockRestore();
  });

  it("passes context through as a second argument when provided", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("save failed", { id: "abc-123", status: 500 });
    expect(spy).toHaveBeenCalledWith("[excalistore] save failed", {
      id: "abc-123",
      status: 500,
    });
    spy.mockRestore();
  });

  it("omits the context argument entirely when none is given", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("stale version");
    expect(spy).toHaveBeenCalledWith("[excalistore] stale version");
    expect(spy.mock.calls[0]).toHaveLength(1);
    spy.mockRestore();
  });

  it("debug logs in dev/test (PROD is false under vitest)", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    logger.debug("autosave scheduled");
    expect(spy).toHaveBeenCalledWith("[excalistore] autosave scheduled");
    spy.mockRestore();
  });
});
