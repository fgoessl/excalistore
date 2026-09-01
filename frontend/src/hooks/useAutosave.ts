import { useEffect, useRef, useState } from "react";

export type SaveStatusValue = "idle" | "saving" | "saved" | "error";

export function useAutosave<T>(
  value: T,
  onSave: (value: T) => Promise<void>,
  delayMs = 1500
): SaveStatusValue {
  const [status, setStatus] = useState<SaveStatusValue>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setStatus("saving");
      onSave(value)
        .then(() => setStatus("saved"))
        .catch(() => setStatus("error"));
    }, delayMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return status;
}
