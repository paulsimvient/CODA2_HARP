/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@coa": resolve(__dirname, "src/coa"),
      "@components": resolve(__dirname, "src/components"),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "CODA2_HARP/**"],
  },
});
