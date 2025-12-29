import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import vitePluginBundleObfuscator from "vite-plugin-bundle-obfuscator";

export default defineConfig({
  root: "src",
  plugins: [
    react(),
    ...(process.env.NODE_ENV === "production"
      ? [
          vitePluginBundleObfuscator({
            autoExcludeNodeModules: true,
            threadPool: true,
          }),
        ]
      : []),
  ],
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 3007,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
});
