import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "node:path";

// Proxy preserves prefixes — server expects /api/auth/*, /api/me, /health, /dev/* intact.
export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5174,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/health": { target: "http://localhost:3000", changeOrigin: true },
      "/dev": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
