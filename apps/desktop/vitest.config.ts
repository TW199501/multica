import { resolve } from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "src/renderer/src") },
      { find: /^electron$/, replacement: resolve(__dirname, "test/electron-guard.ts") },
    ],
    // The linked orca-browser package resolves outside the repo; keep a single
    // React/Query instance when its renderer is imported by tests.
    dedupe: [
      "react",
      "react-dom",
      "@tanstack/react-query",
      "sonner",
      "zustand",
      "lucide-react",
    ],
  },
  test: {
    globals: true,
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    passWithNoTests: true,
  },
});
