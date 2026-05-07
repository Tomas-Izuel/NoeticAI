import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "node:path";

// Proxy preserves prefixes — server expects /api/auth/*, /api/me, /health, /dev/* intact.
// Server runs on 8080; web on 3000; landing stays on 5173.
export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/health": { target: "http://localhost:8080", changeOrigin: true },
      "/dev": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
});
