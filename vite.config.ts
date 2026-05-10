import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.WHISPBOOK_API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ["**/.venv/**", "**/storage/**", "**/dist/**"],
    },
    proxy: {
      "/api": apiTarget,
      "/media": apiTarget,
    },
  },
  build: {
    target: "es2022",
  },
});
