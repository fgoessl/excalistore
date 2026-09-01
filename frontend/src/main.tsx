import ReactDOM from "react-dom/client";
import { App } from "./App";
import "@excalidraw/excalidraw/index.css";
import "./index.css";

// Still deliberately NOT wrapped in <React.StrictMode>, carried over from
// the @excalidraw/excalidraw@0.17.6 investigation (tunnel-rat + jotai
// internals threw "Maximum update depth exceeded" under StrictMode's
// double-invoke). Upgrading to 0.18.x (real ESM, ADR-level rewrite) may
// well have fixed the underlying issue — re-enabling StrictMode is worth
// trying as a follow-up once 0.18 itself is confirmed stable, so as not to
// change two variables in the same test.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
