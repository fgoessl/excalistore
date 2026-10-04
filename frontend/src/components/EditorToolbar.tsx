import { Link } from "react-router-dom";
import { EditableTitle } from "./EditableTitle";
import { SaveStatus } from "./SaveStatus";
import type { SaveStatusValue } from "../hooks/useAutosave";

// A 2x2 grid of files/cards — the back-to-all-files convention Figma,
// Google Docs and Notion all use, rather than a house/home icon: there's no
// dashboard beyond the drawing list here, so "home" would imply more than
// this app actually has. Same thin-stroke style as the "+" on DrawingsPage's
// New drawing button.
function GridIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function EditorToolbar({
  title,
  onTitleCommit,
  status,
}: {
  title: string;
  onTitleCommit: (newTitle: string) => void;
  status: SaveStatusValue;
}) {
  return (
    <header className="editor-toolbar">
      <Link to="/" className="editor-toolbar-back" aria-label="Back to drawings">
        <GridIcon />
      </Link>
      <EditableTitle title={title} onCommit={onTitleCommit} />
      <div className="editor-toolbar-spacer" />
      <SaveStatus status={status} />
    </header>
  );
}
