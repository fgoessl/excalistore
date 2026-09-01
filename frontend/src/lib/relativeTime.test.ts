import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { formatRelativeTime } from "./relativeTime";

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats seconds in the past", () => {
    expect(formatRelativeTime("2026-09-01T11:59:30.000Z")).toBe("30 seconds ago");
  });

  it("formats minutes in the past", () => {
    expect(formatRelativeTime("2026-09-01T11:55:00.000Z")).toBe("5 minutes ago");
  });

  it("formats hours in the past", () => {
    expect(formatRelativeTime("2026-09-01T09:00:00.000Z")).toBe("3 hours ago");
  });

  it("formats days in the past", () => {
    expect(formatRelativeTime("2026-08-30T12:00:00.000Z")).toBe("2 days ago");
  });

  it("formats future timestamps", () => {
    expect(formatRelativeTime("2026-09-01T12:05:00.000Z")).toBe("in 5 minutes");
  });

  it("falls back to 'unknown time' for an invalid/empty timestamp", () => {
    expect(formatRelativeTime("")).toBe("unknown time");
  });
});
