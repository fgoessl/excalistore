import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DrawingList } from "../components/DrawingList";
import { listDrawings, deleteDrawing } from "../api/api";
import type { DrawingSummary } from "../types";

export function DrawingsPage() {
  const [drawings, setDrawings] = useState<DrawingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  async function refresh() {
    setLoading(true);
    const data = await listDrawings();
    setDrawings(data);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete(id: string) {
    await deleteDrawing(id);
    await refresh();
  }

  if (loading) {
    return (
      <div className="page">
        <p className="empty-state">Loading…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Drawings</h1>
          <p className="page-subtitle">
            {drawings.length === 1 ? "1 drawing" : `${drawings.length} drawings`} stored
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate("/drawings/new")}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          New drawing
        </button>
      </header>
      <DrawingList
        drawings={drawings}
        onOpen={(id) => navigate(`/drawings/${id}`)}
        onDelete={handleDelete}
      />
    </div>
  );
}
