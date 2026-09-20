import { describe, it, expect } from "vitest";
import { sceneSignature } from "./sceneSignature";
import type { DrawingScene } from "../types";

function scene(overrides: Partial<DrawingScene> = {}): DrawingScene {
  return {
    elements: [{ id: "a", version: 3, isDeleted: false, x: 10 }],
    appState: { theme: "dark", viewBackgroundColor: "#121212" },
    files: {},
    ...overrides,
  };
}

describe("sceneSignature", () => {
  it("is identical for the same scene", () => {
    expect(sceneSignature(scene())).toBe(sceneSignature(scene()));
  });

  it("ignores transient appState such as selection, active tool and scroll", () => {
    const base = scene();
    const noisy = scene({
      appState: {
        ...base.appState,
        selectedElementIds: { a: true },
        activeTool: { type: "rectangle" },
        scrollX: 120,
        scrollY: -40,
        zoom: { value: 1.5 },
      },
    });
    expect(sceneSignature(noisy)).toBe(sceneSignature(base));
  });

  it("changes when an element's version changes", () => {
    const edited = scene({ elements: [{ id: "a", version: 4, isDeleted: false }] });
    expect(sceneSignature(edited)).not.toBe(sceneSignature(scene()));
  });

  it("changes when an element is added", () => {
    const added = scene({
      elements: [
        { id: "a", version: 3, isDeleted: false },
        { id: "b", version: 1, isDeleted: false },
      ],
    });
    expect(sceneSignature(added)).not.toBe(sceneSignature(scene()));
  });

  it("changes when an element is deleted", () => {
    const deleted = scene({ elements: [{ id: "a", version: 3, isDeleted: true }] });
    expect(sceneSignature(deleted)).not.toBe(sceneSignature(scene()));
  });

  it("changes when the theme or background colour changes", () => {
    const light = scene({ appState: { theme: "light", viewBackgroundColor: "#121212" } });
    const recoloured = scene({ appState: { theme: "dark", viewBackgroundColor: "#ffffff" } });
    expect(sceneSignature(light)).not.toBe(sceneSignature(scene()));
    expect(sceneSignature(recoloured)).not.toBe(sceneSignature(scene()));
  });

  it("changes when a file (image) is added", () => {
    const withFile = scene({ files: { f1: { id: "f1" } } });
    expect(sceneSignature(withFile)).not.toBe(sceneSignature(scene()));
  });
});
