import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  base: "/",
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/file": "http://127.0.0.1:8000",
      "/open": "http://127.0.0.1:8000",
      "/download": "http://127.0.0.1:8000",
    },
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1600 },
});
