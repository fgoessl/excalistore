import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { useParams } from "react-router-dom";
import { Excalidraw } from "@excalidraw/excalidraw";
import { getDrawing, updateDrawing } from "../api/api";
import { useAutosave } from "../hooks/useAutosave";
import { EditorToolbar } from "../components/EditorToolbar";
import { logger } from "../lib/logger";
import { sceneSignature } from "../lib/sceneSignature";
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
  const [title, setTitle] = useState("");
  // What a save should send alongside the scene — kept in a ref rather than
  // read fresh from `title` state inside `handleChange` below, so that
  // callback can stay referentially stable (see its own comment).
  const titleRef = useRef(title);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  // Always the latest scene Excalidraw has reported, independent of whether
  // that scene counts as "changed" (see lastSignature below) — a title-only
  // edit still needs *some* scene to save alongside it, even before the user
  // has touched the canvas at all.
  const sceneRef = useRef<DrawingScene | null>(null);
  const [pendingSave, setPendingSave] = useState<{
    title: string;
    scene: DrawingScene;
  } | null>(null);
  // Signature of the last scene Excalidraw reported that we accepted for
  // saving. Excalidraw's onChange also fires for selection/tool/scroll
  // changes and once on mount; comparing against this keeps those from
  // triggering a save (and a version bump) when nothing about the drawing
  // itself changed. `null` until that first on-mount report, which becomes the
  // baseline — deliberately NOT derived from the raw loaded scene, because a
  // fresh drawing's stored appState is `{}` while Excalidraw reports its
  // defaults (theme, background) right away, which would look like an edit.
  const lastSignature = useRef<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getDrawing(id)
      .then((loaded) => {
        setDrawing(loaded);
        setTitle(loaded.title);
        sceneRef.current = loaded.scene;
        lastSignature.current = null;
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
  // exceeded"). Empty deps array is safe: the body only calls `setPendingSave`
  // and reads `titleRef`/`sceneRef`, all of which React/refs guarantee stay
  // stable references across renders.
  const handleChange = useCallback<NonNullable<ComponentProps<typeof Excalidraw>["onChange"]>>(
    (elements, appState, files) => {
      // Same opacity boundary as ExcalidrawInitialData above: Excalidraw's
      // `AppState` is a concrete interface (no index signature), so it isn't
      // structurally assignable to `DrawingScene.appState`'s
      // `Record<string, unknown>` — cast through `unknown` rather than
      // widening DrawingScene.
      const scene: DrawingScene = {
        elements,
        appState: appState as unknown as Record<string, unknown>,
        files,
      };
      sceneRef.current = scene;
      const signature = sceneSignature(scene);
      const isBaseline = lastSignature.current === null;
      const unchanged = signature === lastSignature.current;
      lastSignature.current = signature;
      if (isBaseline || unchanged) return;
      setPendingSave({ title: titleRef.current, scene });
    },
    []
  );

  const [status, saveNow] = useAutosave(pendingSave, async (pending) => {
    if (!id || !drawing || !pending) return;
    const updated = await updateDrawing(id, {
      title: pending.title,
      scene: pending.scene,
      version: drawing.version,
    });
    setDrawing(updated);
    setTitle(updated.title);
  });

  // Saves immediately rather than through the debounced `pendingSave` path
  // above: a title commit (Enter/blur/clicking away) is already an explicit
  // "done editing" signal, not a mid-stroke scene change, and debouncing it
  // was a real bug — navigating away (e.g. clicking "← Drawings") unmounts
  // the page before a 1.5s debounce timer ever fires, silently dropping the
  // edit. Saving synchronously here means the request goes out as part of
  // the same browser event that triggered the commit, before any
  // navigation gets a chance to unmount this component.
  const commitTitle = useCallback(
    (newTitle: string) => {
      setTitle(newTitle);
      if (!sceneRef.current) return;
      saveNow({ title: newTitle, scene: sceneRef.current });
    },
    [saveNow]
  );

  if (!drawing || !initialData) {
    return (
      <div className="page">
        <p className="empty-state">Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <EditorToolbar title={title} onTitleCommit={commitTitle} status={status} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <Excalidraw initialData={initialData} onChange={handleChange} />
      </div>
    </div>
  );
}
