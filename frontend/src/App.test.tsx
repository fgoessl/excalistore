import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { App } from "./App";
import { DrawingsPage } from "./pages/DrawingsPage";
import * as api from "./api/api";

vi.mock("./api/api");
// Excalidraw itself can't load under jsdom/vitest; routing is all that matters here.
vi.mock("./pages/EditorPage", () => ({ EditorPage: () => <div>editor</div> }));

describe("DrawingsPage routing", () => {
  it("renders the drawings list heading after loading", async () => {
    vi.mocked(api.listDrawings).mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<DrawingsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Drawings")).toBeInTheDocument());
    expect(screen.getByText(/no drawings yet/i)).toBeInTheDocument();
  });
});

describe("App routing", () => {
  it("creates a drawing and opens it when visiting /new", async () => {
    vi.mocked(api.createDrawing).mockResolvedValue({
      id: "abc",
      title: "Untitled drawing",
      scene: { elements: [], appState: {}, files: {} },
      version: 1,
      created_at: "",
      updated_at: "",
    } as never);
    window.history.pushState({}, "", "/new");

    render(<App />);

    await waitFor(() => expect(api.createDrawing).toHaveBeenCalled());
    await waitFor(() => expect(window.location.pathname).toBe("/drawings/abc"));
  });
});
