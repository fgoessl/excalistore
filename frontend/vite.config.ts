import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // @excalidraw/excalidraw's main.js reads `process.env.IS_PREACT` at
  // module scope to pick its React vs. Preact build — `process` doesn't
  // exist in the browser and Vite doesn't polyfill it, so without this the
  // import throws `ReferenceError: process is not defined` and (since
  // App.tsx eagerly imports EditorPage, which imports Excalidraw) crashes
  // the whole app on every route, not just the editor. This is Excalidraw's
  // own documented Vite integration fix, not a plan deviation.
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  // The root `define` above covers the app's own transform/build pipeline,
  // but Vite's dependency pre-bundling step (which is what actually
  // processes @excalidraw/excalidraw's CJS `main.js`) runs esbuild
  // separately and does not inherit it — without this block the
  // `process.env.IS_PREACT` reference survives pre-bundling untouched.
  optimizeDeps: {
    esbuildOptions: {
      define: {
        "process.env.IS_PREACT": JSON.stringify("false"),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
