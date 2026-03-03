import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwind from "tailwindcss";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  css: {
    postcss: {
      plugins: [tailwind(), autoprefixer()],
    },
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (
            id.includes("@react-three/fiber")
          ) {
            return "vendor-r3f";
          }
          if (
            id.includes("@react-three/drei") ||
            id.includes("three-stdlib")
          ) {
            return "vendor-drei";
          }
          if (
            id.includes("camera-controls")
          ) {
            return "vendor-camera-controls";
          }
          if (
            id.includes("react-dropzone") ||
            id.includes("file-selector") ||
            id.includes("attr-accept")
          ) {
            return "vendor-dropzone";
          }
          if (
            id.includes("/three/examples/")
          ) {
            return "vendor-three-extras";
          }
          if (id.includes("/three/")) {
            return "vendor-three-core";
          }
          if (id.includes("leva")) {
            return "vendor-leva";
          }
          if (
            id.includes("@radix-ui") ||
            id.includes("cmdk") ||
            id.includes("lucide-react")
          ) {
            return "vendor-ui";
          }
          if (id.includes("@tauri-apps")) {
            return "vendor-tauri";
          }
          if (
            id.includes("/react/") ||
            id.includes("react-router") ||
            id.includes("jotai")
          ) {
            return "vendor-react";
          }
          return "vendor-misc";
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  define: {
    '__APP_VERSION__': JSON.stringify(process.env.npm_package_version),
  }
}));
