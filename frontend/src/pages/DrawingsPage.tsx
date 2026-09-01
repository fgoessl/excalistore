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
      <h1>Drawings</h1>
      <button className="btn btn-primary" onClick={() => navigate("/drawings/new")}>
        New drawing
      </button>
      <DrawingList
        drawings={drawings}
        onOpen={(id) => navigate(`/drawings/${id}`)}
        onDelete={handleDelete}
      />
    </div>
  );
}
