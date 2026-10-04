import { useEffect, useRef, useState } from "react";

export function EditableTitle({
  title,
  onCommit,
}: {
  title: string;
  onCommit: (newTitle: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against double-committing the same edit: a normal outside click
  // fires both our capture-phase pointerdown listener below AND the input's
  // native blur, and both must not call onCommit twice.
  const committedRef = useRef(false);

  function startEditing() {
    setDraft(title);
    committedRef.current = false;
    setEditing(true);
  }

  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === title) return;
    onCommit(trimmed);
  }

  function cancel() {
    committedRef.current = true;
    setEditing(false);
    setDraft(title);
  }

  // Fallback for elements that call preventDefault() on pointerdown —
  // Excalidraw's canvas does this for its own interactions, which
  // suppresses the browser's default "move focus away" step. That means
  // the input's blur event never fires when clicking from the title into
  // the canvas, silently losing the edit unless the user remembers to
  // press Enter. A capture-phase listener still sees the pointerdown
  // regardless of whether its default action was prevented downstream.
  useEffect(() => {
    if (!editing) return;
    function handlePointerDown(e: PointerEvent) {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        commit();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft, title]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="editable-title-input"
        value={draft}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            cancel();
          }
        }}
      />
    );
  }

  return (
    <h1 className="editable-title" onClick={startEditing}>
      {title}
    </h1>
  );
}
