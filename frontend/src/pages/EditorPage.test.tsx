import { act, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorPage } from "./EditorPage";
import * as api from "../api/api";
import type { Drawing } from "../types";

vi.mock("../api/api");
// Excalidraw can't load under jsdom (see App.test.tsx) — a stub standing in
// for it is enough here since these tests cover the toolbar/title wiring
// around it, not the canvas itself.
vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: () => <div data-testid="excalidraw-stub" />,
}));

const loadedDrawing: Drawing = {
  id: "abc",
  title: "Untitled drawing",
  scene: { elements: [], appState: {}, files: {} },
  owner_id: null,
  version: 1,
  created_at: "",
  updated_at: "",
};

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={["/drawings/abc"]}>
      <Routes>
        <Route path="/drawings/:id" element={<EditorPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("EditorPage toolbar", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getDrawing).mockResolvedValue(loadedDrawing);
  });

  it("renders a back link to the drawing list once loaded", async () => {
    renderEditor();
    expect(await screen.findByRole("link", { name: /drawings/i })).toHaveAttribute(
      "href",
      "/"
    );
  });

  it("renders the drawing's title", async () => {
    renderEditor();
    expect(await screen.findByText("Untitled drawing")).toBeInTheDocument();
  });

  it("commits a title edit immediately, without waiting for the autosave debounce", async () => {
    vi.mocked(api.updateDrawing).mockResolvedValue({
      ...loadedDrawing,
      title: "Renamed",
      version: 2,
    });
    renderEditor();

    await screen.findByText("Untitled drawing");
    fireEvent.click(screen.getByText("Untitled drawing"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Renamed" } });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
      await Promise.resolve();
    });

    expect(api.updateDrawing).toHaveBeenCalledWith("abc", {
      title: "Renamed",
      scene: loadedDrawing.scene,
      version: 1,
    });
    expect(await screen.findByText("✓ Saved")).toBeInTheDocument();
    expect(await screen.findByText("Renamed")).toBeInTheDocument();
  });

  // Regression test for a real bug: committing a title then immediately
  // navigating away (e.g. clicking "← Drawings") used to lose the edit,
  // because the save was debounced ~1.5s and the page unmounts (cancelling
  // the pending timer) well before that. This asserts the request fires
  // synchronously as part of the commit itself — with no fake-timer advance
  // at all — so it's already in flight before any navigation could unmount
  // the page.
  it("has already sent the save request before any debounce delay would elapse", async () => {
    vi.mocked(api.updateDrawing).mockResolvedValue({
      ...loadedDrawing,
      title: "Renamed",
      version: 2,
    });
    renderEditor();

    await screen.findByText("Untitled drawing");
    fireEvent.click(screen.getByText("Untitled drawing"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Renamed" } });
    fireEvent.blur(screen.getByRole("textbox"));

    // No timer advance, no awaited microtask before this assertion — it
    // runs in the same tick as the commit.
    expect(api.updateDrawing).toHaveBeenCalledWith("abc", {
      title: "Renamed",
      scene: loadedDrawing.scene,
      version: 1,
    });

    // Flush the mocked response's resolution so the resulting state update
    // doesn't leak into the next test as an unhandled act() warning.
    await act(async () => {
      await Promise.resolve();
    });
  });
});
