import type {
  Drawing,
  DrawingSummary,
  CreateDrawingInput,
  UpdateDrawingInput,
} from "../types";
import { logger } from "../lib/logger";

const BASE_URL = "/api/drawings";

export class ConflictError extends Error {
  constructor() {
    super("drawing was modified since it was loaded");
    this.name = "ConflictError";
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 409) {
    // Not logged as an error — a stale-version conflict is an expected,
    // recoverable outcome of optimistic versioning, not a failure. The
    // caller (autosave, later tasks) decides how to surface it to the user.
    logger.warn("optimistic update conflict", { url: response.url });
    throw new ConflictError();
  }
  if (!response.ok) {
    logger.error("request failed", { url: response.url, status: response.status });
    throw new Error(`request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function listDrawings(): Promise<DrawingSummary[]> {
  const response = await fetch(BASE_URL);
  return handleResponse<DrawingSummary[]>(response);
}

export async function createDrawing(input: CreateDrawingInput): Promise<Drawing> {
  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<Drawing>(response);
}

export async function getDrawing(id: string): Promise<Drawing> {
  const response = await fetch(`${BASE_URL}/${id}`);
  return handleResponse<Drawing>(response);
}

export async function updateDrawing(
  id: string,
  input: UpdateDrawingInput
): Promise<Drawing> {
  const response = await fetch(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<Drawing>(response);
}

export async function deleteDrawing(id: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/${id}`, { method: "DELETE" });
  // No response body to parse on success (204), so this can't reuse
  // handleResponse<T> — same status handling, duplicated for the void case.
  if (response.status === 409) {
    logger.warn("optimistic update conflict", { url: response.url });
    throw new ConflictError();
  }
  if (!response.ok) {
    logger.error("request failed", { url: response.url, status: response.status });
    throw new Error(`request failed with status ${response.status}`);
  }
}
