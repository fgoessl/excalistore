import { useEffect, useRef, useState } from "react";

export type SaveStatusValue = "idle" | "saving" | "saved" | "error";

/**
 * Debounces `value` into a save `delayMs` after the last change, and also
 * returns `saveNow` — an immediate, non-debounced save for callers that
 * already know "the user is done" (e.g. committing a title edit) rather
 * than "the user might still be typing" (continuous scene edits). A
 * debounce-only save is silently lost if the component unmounts before the
 * timer fires — e.g. the user commits a title then immediately navigates
 * away — so an explicit "done" signal needs a way to flush right away
 * instead of trusting the window to stay open long enough.
 */
export function useAutosave<T>(
  value: T,
  onSave: (value: T) => Promise<void>,
  delayMs = 1500
): [SaveStatusValue, (value: T) => void] {
  const [status, setStatus] = useState<SaveStatusValue>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const isFirstRender = useRef(true);
  // Always the latest onSave, read from inside saveNow/the debounce timeout
  // without either needing it in a dependency array (which would re-trigger
  // the debounce every render, since callers pass a fresh closure each time).
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  function runSave(v: T) {
    setStatus("saving");
    onSaveRef.current(v).then(() => setStatus("saved")).catch(() => setStatus("error"));
  }

  function saveNow(v: T) {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    runSave(v);
  }

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => runSave(value), delayMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return [status, saveNow];
}
