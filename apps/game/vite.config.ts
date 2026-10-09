import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/ws": {
        target: "ws://127.0.0.1:2567",
        ws: true,
      },
    },
  },
});
