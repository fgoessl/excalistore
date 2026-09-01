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
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h1>Drawings</h1>
      <button onClick={() => navigate("/drawings/new")}>New drawing</button>
      <DrawingList
        drawings={drawings}
        onOpen={(id) => navigate(`/drawings/${id}`)}
        onDelete={handleDelete}
      />
    </div>
  );
}
