import type { DrawingSummary } from "../types";
import { formatRelativeTime } from "../lib/relativeTime";

interface DrawingListProps {
  drawings: DrawingSummary[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

/** Small document icon — indicates "this is a list of files", no icon
 *  library/asset dependency, just inline SVG. */
function DocumentIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="drawing-card__icon"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export function DrawingList({ drawings, onOpen, onDelete }: DrawingListProps) {
  if (drawings.length === 0) {
    return (
      <div className="drawing-list-empty">
        <DocumentIcon />
        <p>No drawings yet. Create one to get started.</p>
      </div>
    );
  }

  return (
    <ul className="drawing-list">
      {drawings.map((drawing) => (
        <li key={drawing.id} className="drawing-card">
          <button className="drawing-card__title" onClick={() => onOpen(drawing.id)}>
            <DocumentIcon />
            <span className="drawing-card__title-text">{drawing.title}</span>
            <span className="drawing-card__meta">
              Updated {formatRelativeTime(drawing.updated_at)}
            </span>
          </button>
          <button
            className="btn btn-danger"
            onClick={() => onDelete(drawing.id)}
            aria-label={`Delete ${drawing.title}`}
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}
