import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
// @excalidraw/excalidraw@0.17.6 injects its styles via JS at runtime — no
// separate stylesheet ships in this version, so there's nothing to import
// here (the plan's Task 14 assumed one existed).

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
