import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// STANDALONE=1 → one self-contained HTML file (all code, styles and the offline data snapshot inlined),
// which opens directly in a browser without a server: npm run build:standalone
const standalone = process.env.STANDALONE === "1";

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(standalone ? [viteSingleFile()] : [])],
  base: standalone ? "./" : "/",
  build: standalone ? { chunkSizeWarningLimit: 20000 } : undefined,
  server: { port: 5173, fs: { allow: [".."] } },
});
