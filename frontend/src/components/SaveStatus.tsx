import type { SaveStatusValue } from "../hooks/useAutosave";

const LABELS: Record<SaveStatusValue, string> = {
  idle: "",
  saving: "⟳ Saving…",
  saved: "✓ Saved",
  error: "⚠ Save failed — retry",
};

export function SaveStatus({ status }: { status: SaveStatusValue }) {
  const label = LABELS[status];
  if (!label) return null;
  return (
    <span role="status" className="save-status" data-status={status}>
      {label}
    </span>
  );
}
