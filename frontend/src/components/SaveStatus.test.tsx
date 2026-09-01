import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SaveStatus } from "./SaveStatus";

describe("SaveStatus", () => {
  it.each([
    ["saving", "⟳ Saving…"],
    ["saved", "✓ Saved"],
    ["error", "⚠ Save failed — retry"],
  ] as const)("renders the label for status %s", (status, label) => {
    render(<SaveStatus status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("renders nothing for idle status", () => {
    const { container } = render(<SaveStatus status="idle" />);
    expect(container).toBeEmptyDOMElement();
  });
});
