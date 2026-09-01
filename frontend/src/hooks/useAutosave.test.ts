import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useAutosave } from "./useAutosave";

describe("useAutosave", () => {
  it("does not save on the initial render", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutosave("initial", onSave, 1000));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("debounces and calls onSave with the latest value after the delay", () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ value }) => useAutosave(value, onSave, 1000), {
      initialProps: { value: "a" },
    });

    rerender({ value: "b" });
    rerender({ value: "c" });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("c");
    vi.useRealTimers();
  });

  it("sets status to error when onSave rejects", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockRejectedValue(new Error("save failed"));
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, onSave, 1000), {
      initialProps: { value: "a" },
    });

    rerender({ value: "b" });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(result.current).toBe("error");
    vi.useRealTimers();
  });
});
