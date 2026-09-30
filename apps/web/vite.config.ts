/// <reference types="node" />
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig, type Plugin } from "vitest/config";

/** GitHub Pages serves 404.html for unknown paths: a copy of index.html keeps SPA routes working. */
function spaFallback(): Plugin {
  return {
    name: "nest-spa-404",
    apply: "build",
    closeBundle() {
      const index = resolve(__dirname, "dist/index.html");
      if (existsSync(index)) copyFileSync(index, resolve(__dirname, "dist/404.html"));
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: process.env.NEST_BASE ?? "/",
  plugins: [
    react(),
    ...(mode === "test"
      ? []
      : [
          VitePWA({
            registerType: "autoUpdate",
            includeAssets: ["icons/icon.svg"],
            manifest: {
              name: "Nest",
              short_name: "Nest",
              description: "A handheld virtual pet where your Rare Friend's wallet is the pet.",
              display: "standalone",
              start_url: ".",
              scope: ".",
              theme_color: "#31401f",
              background_color: "#c5d8a4",
              icons: [
                { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
                { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
                { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
              ],
            },
            workbox: {
              globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
              navigateFallback: "index.html",
              // The indexer snapshot must always be fetched fresh.
              runtimeCaching: [{ urlPattern: /\/data\/snapshot\.json$/, handler: "NetworkFirst" }],
            },
          }),
          spaFallback(),
        ]),
  ],
  build: { outDir: "dist", target: "es2022" },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
}));
