import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Two standalone HTML entry points (the playable game and the model smoke
// test) instead of a single-page app -- see README.md for what each one is.
//
// legacy/index.html is deliberately NOT an entry here: its scripts are plain
// global <script> tags (no build step, by design -- see README.md), so Rollup
// can't bundle them and `vite build` would only copy the HTML/CSS, not the
// JS, leaving a broken page in dist/. `npm run dev` still serves legacy/ fine
// since it just serves the source tree directly.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        modelDemo: fileURLToPath(new URL("./model-demo.html", import.meta.url)),
      },
    },
  },
});
