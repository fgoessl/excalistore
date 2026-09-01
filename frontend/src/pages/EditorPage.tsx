import { useEffect, useState } from "react";
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
  const [pendingScene, setPendingScene] = useState<DrawingScene | null>(null);

  useEffect(() => {
    if (!id) return;
    getDrawing(id)
      .then(setDrawing)
      .catch((err) => {
        // api.ts already logged the request failure itself — this just
        // adds page-level context (which drawing id failed to load).
        logger.error("failed to load drawing", { id, err: String(err) });
      });
  }, [id]);

  const status = useAutosave(pendingScene, async (scene) => {
    if (!id || !drawing || !scene) return;
    const updated = await updateDrawing(id, {
      title: drawing.title,
      scene,
      version: drawing.version,
    });
    setDrawing(updated);
  });

  if (!drawing) {
    return <p>Loading…</p>;
  }

  return (
    <div style={{ height: "100vh" }}>
      <SaveStatus status={status} />
      <Excalidraw
        initialData={
          {
            elements: drawing.scene.elements,
            appState: drawing.scene.appState,
          } as unknown as ExcalidrawInitialData
        }
        onChange={(elements, appState, files) => {
          setPendingScene({ elements, appState, files });
        }}
      />
    </div>
  );
}
