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
    // Loopback by default; EVAL_LAN_ACCESS=1 binds all interfaces for phone testing.
    host:
      process.env.EVAL_LAN_ACCESS === "1" || process.env.EVAL_LAN_ACCESS === "true"
        ? true
        : "127.0.0.1",
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      // Match only API routes. A bare "/api" prefix also captures Vite's
      // "/api.ts" module URL and returns a blank page.
      "/api/v1": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});

