import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { DrawingsPage } from "./pages/DrawingsPage";
import * as api from "./api/api";

vi.mock("./api/api");

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
