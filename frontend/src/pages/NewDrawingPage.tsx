import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createDrawing } from "../api/api";
import { logger } from "../lib/logger";

export function NewDrawingPage() {
  const navigate = useNavigate();

  useEffect(() => {
    createDrawing({ title: "Untitled drawing" })
      .then((drawing) => {
        navigate(`/drawings/${drawing.id}`, { replace: true });
      })
      .catch((err) => {
        // api.ts already logged the request failure itself — this just
        // makes sure a failed creation doesn't surface as an unhandled
        // promise rejection with no context on *why* navigation never
        // happened.
        logger.error("failed to create drawing", { err: String(err) });
      });
  }, [navigate]);

  return (
    <div className="page">
      <p className="empty-state">Creating drawing…</p>
    </div>
  );
}
