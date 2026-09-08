import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = process.env["WEB_API"] ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      ["/api", "/files", "/runs"].map((prefix) => [prefix, { target: API, changeOrigin: false }])
    )
  }
});
