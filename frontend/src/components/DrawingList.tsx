import type { DrawingSummary } from "../types";

interface DrawingListProps {
  drawings: DrawingSummary[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

export function DrawingList({ drawings, onOpen, onDelete }: DrawingListProps) {
  if (drawings.length === 0) {
    return <p>No drawings yet. Create one to get started.</p>;
  }

  return (
    <ul>
      {drawings.map((drawing) => (
        <li key={drawing.id}>
          <button onClick={() => onOpen(drawing.id)}>{drawing.title}</button>
          <button onClick={() => onDelete(drawing.id)} aria-label={`Delete ${drawing.title}`}>
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}
