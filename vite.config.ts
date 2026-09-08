import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: path.resolve("src/client"),
  publicDir: path.resolve("src/client/public"),
  resolve: {
    alias: {
      "@shared": path.resolve("src/shared"),
      "@domain": path.resolve("src/domain"),
    },
  },
  build: {
    outDir: path.resolve("dist/client"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
