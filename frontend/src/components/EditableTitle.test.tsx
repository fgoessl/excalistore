import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EditableTitle } from "./EditableTitle";

describe("EditableTitle", () => {
  it("renders the title as text", () => {
    render(<EditableTitle title="My drawing" onCommit={vi.fn()} />);
    expect(screen.getByText("My drawing")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("clicking the title shows an input prefilled with the current title", () => {
    render(<EditableTitle title="My drawing" onCommit={vi.fn()} />);
    fireEvent.click(screen.getByText("My drawing"));
    expect(screen.getByRole("textbox")).toHaveValue("My drawing");
  });

  it("commits the trimmed new title on Enter", () => {
    const onCommit = vi.fn();
    render(<EditableTitle title="My drawing" onCommit={onCommit} />);
    fireEvent.click(screen.getByText("My drawing"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Renamed  " } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Renamed");
  });

  it("commits on blur", () => {
    const onCommit = vi.fn();
    render(<EditableTitle title="My drawing" onCommit={onCommit} />);
    fireEvent.click(screen.getByText("My drawing"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Renamed" } });
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onCommit).toHaveBeenCalledWith("Renamed");
  });

  it("reverts without committing on Escape", () => {
    const onCommit = vi.fn();
    render(<EditableTitle title="My drawing" onCommit={onCommit} />);
    fireEvent.click(screen.getByText("My drawing"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Renamed" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText("My drawing")).toBeInTheDocument();
  });

  it("does not commit an empty title", () => {
    const onCommit = vi.fn();
    render(<EditableTitle title="My drawing" onCommit={onCommit} />);
    fireEvent.click(screen.getByText("My drawing"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText("My drawing")).toBeInTheDocument();
  });

  it("does not commit when the title is unchanged", () => {
    const onCommit = vi.fn();
    render(<EditableTitle title="My drawing" onCommit={onCommit} />);
    fireEvent.click(screen.getByText("My drawing"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  // Regression test for a real bug: Excalidraw's canvas calls
  // preventDefault() on pointerdown, which suppresses the browser's default
  // "move focus away" step — so clicking from the title into the canvas
  // never fires the input's blur event, and the edit was silently lost
  // unless the user remembered to press Enter. A plain `fireEvent.click`
  // outside the input wouldn't reproduce this (jsdom doesn't simulate real
  // focus-shift-on-mousedown semantics at all), so this asserts the actual
  // fallback mechanism instead: a capture-phase pointerdown listener that
  // fires regardless of whether the browser's default action was prevented.
  it("commits on an outside pointerdown even when no blur event fires", () => {
    const onCommit = vi.fn();
    render(<EditableTitle title="My drawing" onCommit={onCommit} />);
    fireEvent.click(screen.getByText("My drawing"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Renamed" } });

    fireEvent.pointerDown(document.body);

    expect(onCommit).toHaveBeenCalledWith("Renamed");
  });

  it("does not double-commit when both an outside pointerdown and a blur fire for the same click", () => {
    const onCommit = vi.fn();
    render(<EditableTitle title="My drawing" onCommit={onCommit} />);
    fireEvent.click(screen.getByText("My drawing"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Renamed" } });

    fireEvent.pointerDown(document.body);
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("does not commit on a pointerdown inside the input itself", () => {
    const onCommit = vi.fn();
    render(<EditableTitle title="My drawing" onCommit={onCommit} />);
    fireEvent.click(screen.getByText("My drawing"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Renamed" } });

    fireEvent.pointerDown(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue("Renamed");
  });
});
