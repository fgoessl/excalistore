import { useCallback, useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { useParams } from "react-router-dom";
import { Excalidraw } from "@excalidraw/excalidraw";
import { getDrawing, updateDrawing } from "../api/api";
import { useAutosave } from "../hooks/useAutosave";
import { SaveStatus } from "../components/SaveStatus";
import { logger } from "../lib/logger";
import type { Drawing, DrawingScene } from "../types";

// The persisted scene is deliberately opaque JSON on the wire (spec §4/§5 —
// the backend never models `elements`/`appState` relationally), so
// `DrawingScene.elements` is typed as `readonly unknown[]` in types.ts. This
// is the one place that opacity has to give way to Excalidraw's own typed
// props — cast through `unknown` rather than widening `DrawingScene` itself,
// which would leak Excalidraw's internal element types into the persistence
// layer.
type ExcalidrawInitialData = ComponentProps<typeof Excalidraw>["initialData"];

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  // Seeded once from the first successful load and never touched again —
  // NOT re-derived from `drawing` on every render. `drawing` itself updates
  // after every autosave (setDrawing(updated) below), and Excalidraw isn't
  // a controlled component: it treats a *new* `initialData` object
  // reference as "re-initialize the whole scene", which re-fires onChange,
  // which re-triggers autosave, which calls setDrawing again — an infinite
  // "Maximum update depth exceeded" loop. A stable reference here breaks
  // that cycle.
  const [initialData, setInitialData] = useState<ExcalidrawInitialData | null>(null);
  const [pendingScene, setPendingScene] = useState<DrawingScene | null>(null);

  useEffect(() => {
    if (!id) return;
    getDrawing(id)
      .then((loaded) => {
        setDrawing(loaded);
        setInitialData({
          elements: loaded.scene.elements,
          appState: {
            ...(loaded.scene.appState as Record<string, unknown>),
            // `collaborators` is live multiplayer cursor/presence state, not
            // persisted data — Maps aren't JSON-serializable in the first
            // place (JSON.stringify(new Map()) is "{}"), so it can never
            // legitimately come from the database. Excalidraw's
            // InteractiveCanvas calls `.forEach` on it directly and expects
            // a real Map; always seed a fresh empty one here rather than
            // whatever (if anything) survived the JSON round-trip.
            collaborators: new Map(),
          },
        } as unknown as ExcalidrawInitialData);
      })
      .catch((err) => {
        // api.ts already logged the request failure itself — this just
        // adds page-level context (which drawing id failed to load).
        logger.error("failed to load drawing", { id, err: String(err) });
      });
  }, [id]);

  // Stabilized the same way as `initialData` above: an inline arrow function
  // here would be a new reference on every render — confirmed by isolation
  // testing (a bare <Excalidraw /> with no props never crashes; adding this
  // component's props back is what triggers "Maximum update depth
  // exceeded"). Empty deps array is safe: the body only calls
  // `setPendingScene`, which React guarantees is a stable reference.
  const handleChange = useCallback<NonNullable<ComponentProps<typeof Excalidraw>["onChange"]>>(
    (elements, appState, files) => {
      // Same opacity boundary as ExcalidrawInitialData above: Excalidraw's
      // `AppState` is a concrete interface (no index signature), so it isn't
      // structurally assignable to `DrawingScene.appState`'s
      // `Record<string, unknown>` — cast through `unknown` rather than
      // widening DrawingScene.
      setPendingScene({ elements, appState: appState as unknown as Record<string, unknown>, files });
    },
    []
  );

  const status = useAutosave(pendingScene, async (scene) => {
    if (!id || !drawing || !scene) return;
    const updated = await updateDrawing(id, {
      title: drawing.title,
      scene,
      version: drawing.version,
    });
    setDrawing(updated);
  });

  if (!drawing || !initialData) {
    return (
      <div className="page">
        <p className="empty-state">Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh" }}>
      <SaveStatus status={status} />
      <Excalidraw initialData={initialData} onChange={handleChange} />
    </div>
  );
}
