import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useAutosave } from "./useAutosave";

describe("useAutosave", () => {
  it("does not save on the initial render", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutosave<string>("initial", onSave, 1000));
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

    expect(result.current[0]).toBe("error");
    vi.useRealTimers();
  });

  // Regression coverage for a real data-loss bug: a debounced-only save is
  // lost if the component unmounts (e.g. the user navigates away) before
  // the delay elapses — the setTimeout callback simply never fires. An
  // explicit "done editing" signal (like committing a title edit) needs a
  // way to save right away instead of trusting the debounce window.
  it("saveNow invokes onSave immediately, without waiting for the debounce delay", () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave<string>("initial", onSave, 1000));

    act(() => {
      result.current[1]("flushed value");
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("flushed value");
    vi.useRealTimers();
  });

  it("saveNow cancels a pending debounced save instead of double-saving", () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, onSave, 1000), {
      initialProps: { value: "a" },
    });

    rerender({ value: "b" }); // schedules a debounced save for "b"
    act(() => {
      result.current[1]("flushed"); // should cancel the pending one above
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("flushed");
    vi.useRealTimers();
  });

  it("saveNow sets status to saved on success", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave<string>("initial", onSave, 1000));

    await act(async () => {
      result.current[1]("flushed");
      await Promise.resolve();
    });

    expect(result.current[0]).toBe("saved");
  });
});
