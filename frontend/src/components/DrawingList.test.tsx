import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DrawingList } from "./DrawingList";

const drawings = [
  { id: "1", title: "First", version: 1, created_at: "", updated_at: "" },
  { id: "2", title: "Second", version: 1, created_at: "", updated_at: "" },
];

describe("DrawingList", () => {
  it("renders a button per drawing title", () => {
    render(<DrawingList drawings={drawings} onOpen={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("calls onOpen with the drawing id when a title is clicked", () => {
    const onOpen = vi.fn();
    render(<DrawingList drawings={drawings} onOpen={onOpen} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText("First"));
    expect(onOpen).toHaveBeenCalledWith("1");
  });

  it("calls onDelete with the drawing id when delete is clicked", () => {
    const onDelete = vi.fn();
    render(<DrawingList drawings={drawings} onOpen={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText("Delete First"));
    expect(onDelete).toHaveBeenCalledWith("1");
  });

  it("shows an empty state when there are no drawings", () => {
    render(<DrawingList drawings={[]} onOpen={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/no drawings yet/i)).toBeInTheDocument();
  });
});
