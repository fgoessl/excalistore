import type { DrawingScene } from "../types";

interface ElementLike {
  id?: unknown;
  version?: unknown;
  isDeleted?: unknown;
}

/**
 * Reduces a scene to the parts that actually count as "the drawing changed":
 * each element's id/version/deleted flag, which files (images) exist, and the
 * few appState values that are real document settings (theme, background).
 *
 * Excalidraw calls `onChange` for far more than edits — selection, active
 * tool, scroll and zoom all fire it, including once on load — so comparing
 * signatures lets autosave skip those instead of bumping the version (and
 * `updated_at`) every time a drawing is merely opened or clicked.
 */
export function sceneSignature(scene: DrawingScene): string {
  const elements = (scene.elements as readonly ElementLike[]).map(
    (el) => `${String(el.id)}:${String(el.version)}:${el.isDeleted ? 1 : 0}`
  );
  const files = Object.keys(scene.files ?? {}).sort();
  const { theme, viewBackgroundColor } = scene.appState ?? {};
  return JSON.stringify({ elements, files, theme, viewBackgroundColor });
}
