import { describe, it, expect, vi, beforeEach } from "vitest";
import { listDrawings, createDrawing, updateDrawing, deleteDrawing, ConflictError } from "./api";

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, ...response })
  );
}

describe("api client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("listDrawings GETs /api/drawings and returns parsed JSON", async () => {
    const mockData = [{ id: "1", title: "Test", version: 1, created_at: "", updated_at: "" }];
    mockFetchOnce({ json: async () => mockData });

    const result = await listDrawings();

    expect(result).toEqual(mockData);
    expect(fetch).toHaveBeenCalledWith("/api/drawings");
  });

  it("createDrawing POSTs the title and returns the created drawing", async () => {
    const mockDrawing = {
      id: "1",
      title: "New",
      scene: { elements: [], appState: {}, files: {} },
      owner_id: null,
      version: 1,
      created_at: "",
      updated_at: "",
    };
    mockFetchOnce({ status: 201, json: async () => mockDrawing });

    const result = await createDrawing({ title: "New" });

    expect(result).toEqual(mockDrawing);
    expect(fetch).toHaveBeenCalledWith(
      "/api/drawings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "New" }),
      })
    );
  });

  it("updateDrawing throws ConflictError on HTTP 409", async () => {
    mockFetchOnce({ ok: false, status: 409, json: async () => ({ error: "conflict" }) });

    await expect(
      updateDrawing("1", {
        title: "X",
        scene: { elements: [], appState: {}, files: {} },
        version: 1,
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("deleteDrawing DELETEs /api/drawings/:id", async () => {
    mockFetchOnce({ status: 204 });

    await deleteDrawing("42");

    expect(fetch).toHaveBeenCalledWith(
      "/api/drawings/42",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
