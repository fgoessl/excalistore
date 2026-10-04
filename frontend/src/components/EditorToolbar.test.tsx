import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { EditorToolbar } from "./EditorToolbar";

function renderToolbar(props: Partial<React.ComponentProps<typeof EditorToolbar>> = {}) {
  return render(
    <MemoryRouter>
      <EditorToolbar
        title="My drawing"
        onTitleCommit={vi.fn()}
        status="idle"
        {...props}
      />
    </MemoryRouter>
  );
}

describe("EditorToolbar", () => {
  it("shows a back link to the drawing list", () => {
    renderToolbar();
    expect(screen.getByRole("link", { name: /drawings/i })).toHaveAttribute("href", "/");
  });

  it("shows the drawing's title", () => {
    renderToolbar();
    expect(screen.getByText("My drawing")).toBeInTheDocument();
  });

  it("shows the save status", () => {
    renderToolbar({ status: "saved" });
    expect(screen.getByText("✓ Saved")).toBeInTheDocument();
  });
});
