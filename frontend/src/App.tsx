import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DrawingsPage } from "./pages/DrawingsPage";
import { EditorPage } from "./pages/EditorPage";
import { NewDrawingPage } from "./pages/NewDrawingPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DrawingsPage />} />
        <Route path="/drawings/new" element={<NewDrawingPage />} />
        <Route path="/drawings/:id" element={<EditorPage />} />
      </Routes>
    </BrowserRouter>
  );
}
