import { defineConfig } from "wxt";
import { viteStaticCopy } from "vite-plugin-static-copy";
import react from "@vitejs/plugin-react";

export default defineConfig({
  runner: {
    disabled: true,
  },
  manifest: {
    name: "Second Brain",
    description:
      "Privacy-first personal RAG — index your browsing, ask questions with citations.",
    version: "1.0.0",
    permissions: [
      "activeTab",
      "storage",
      "sidePanel",
      "offscreen",
      "history",
      "tabs",
      "webNavigation",
    ],
    host_permissions: ["<all_urls>"],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    side_panel: {
      default_path: "sidepanel/index.html",
    },
    web_accessible_resources: [
      {
        resources: ["transformers/*", "ort/*"],
        matches: ["<all_urls>"],
      },
    ],
  },
  vite: () => ({
    plugins: [
      react(),
      viteStaticCopy({
        targets: [
          {
            src: "node_modules/onnxruntime-web/dist/*.wasm",
            dest: "ort",
          },
          {
            src: "node_modules/onnxruntime-web/dist/*.mjs",
            dest: "ort",
          },
        ],
      }),
    ],
    build: {
      target: "esnext",
    },
    resolve: {
      alias: {
        "@": __dirname,
      },
    },
  }),
});
